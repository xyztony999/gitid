<template>
  <div>
    <div class="toolbar">
      <a-space>
        <a-input
          v-model:value="root"
          :placeholder="`扫描根目录（默认 ${defaultRoot()}）`"
          style="width: 380px"
          @pressEnter="scan"
        >
          <template #prefix><FolderOutlined class="dim" /></template>
        </a-input>
        <a-button @click="pickDirectory">选择目录</a-button>
        <span class="dim">深度</span>
        <a-input-number v-model:value="depth" :min="1" :max="12" style="width: 72px" />
        <a-button type="primary" :loading="scanning" @click="scan">
          <template #icon><ScanOutlined /></template>
          扫描
        </a-button>
        <a-tooltip title="保存当前目录与深度；此后桌面端与 CLI 的 scan 不带参数即用它">
          <a-button @click="saveDefault">
            <template #icon><SaveOutlined /></template>
            设为默认
          </a-button>
        </a-tooltip>
        <a-button v-if="hasDefault" type="link" @click="clearDefault">清除默认</a-button>
      </a-space>
      <span v-if="summaryText" class="dim">{{ summaryText }}</span>
    </div>

    <a-alert
      v-if="scanned && rows.length === 0"
      type="info"
      show-icon
      :message="`在 ${root || defaultRoot()} 下未发现 git 仓库（深度 ${depth}）`"
      class="mb"
    />

    <a-table
      v-if="rows.length"
      :columns="columns"
      :data-source="rows"
      :pagination="false"
      row-key="path"
      size="middle"
      :loading="scanning"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'status'">
          <a-tag :color="statusMeta[record.status].color">{{ statusMeta[record.status].text }}</a-tag>
        </template>
        <template v-else-if="column.key === 'repo'">
          <a-tooltip :title="record.path">
            <span class="mono">{{ record.rel }}</span>
          </a-tooltip>
        </template>
        <template v-else-if="column.key === 'identity'">
          <a-select
            :value="selectValue(record)"
            placeholder="本地手配（未匹配档案）"
            style="width: 100%"
            :class="{ 'manual-local': record.hasLocal && !localIdentityId(record) }"
            @change="(val) => changeRepoIdentity(record, val)"
          >
            <a-select-option :value="INHERIT">
              <span class="dim">继承全局</span>{{ inheritHint }}
            </a-select-option>
            <a-select-option v-for="opt in identityOptions" :key="opt.id" :value="opt.id">
              {{ opt.id }} — {{ opt.name }} &lt;{{ opt.email }}&gt;
            </a-select-option>
          </a-select>
        </template>
        <template v-else-if="column.key === 'effective'">
          <span v-if="record.status === 'missing'" class="mono">user.name/email 缺失</span>
          <span v-else>{{ record.effective.name }} <span class="dim">&lt;{{ record.effective.email }}&gt;</span></span>
        </template>
      </template>
    </a-table>
    <div v-else-if="!scanned" class="hint dim">
      扫描目录查看各仓库生效身份；每个仓库可独立选择「继承全局」或单独设置本地身份。
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { message } from 'ant-design-vue';
import { FolderOutlined, SaveOutlined, ScanOutlined } from '@ant-design/icons-vue';
import { api } from '../api.js';

const props = defineProps({ store: { type: Object, required: true } });
const emit = defineEmits(['changed']);

const INHERIT = '__inherit__';

const root = ref('');
const depth = ref(6);
const scanning = ref(false);
const scanned = ref(false);
const rows = ref([]);
const summary = ref(null);

// 已保存的默认扫描目录（settings:save 写入，CLI scan --save 共用同一份）
const hasDefault = computed(() => !!(props.store.settings && props.store.settings.scanRoot));

// 首次拿到真实档案时用已存默认初始化输入框；此后档案刷新（含 CLI 侧改动广播）
// 不再回填，避免覆盖用户正在输入的目录
let settingsInited = false;
watch(() => props.store, (s) => {
  if (settingsInited || !s.settings) return;
  settingsInited = true;
  root.value = s.settings.scanRoot || '';
  depth.value = s.settings.scanDepth || 6;
}, { immediate: true });

const columns = [
  { title: '状态', key: 'status', width: 96 },
  { title: '仓库', key: 'repo', ellipsis: true },
  { title: '仓库身份（继承全局 / 单独设置）', key: 'identity', width: 300 },
  { title: '生效配置', key: 'effective', ellipsis: true },
];

const statusMeta = {
  ok: { color: 'green', text: '✓ 正常' },
  missing: { color: 'red', text: '✗ 缺失' },
  unknown: { color: 'orange', text: '⚠ 手配' },
};

const identityOptions = computed(() => props.store.identities || []);

const inheritHint = computed(() => {
  const g = props.store.global || {};
  if (g.identityId) return `（当前 ${g.identityId}）`;
  if (g.name !== undefined || g.email !== undefined) {
    return `（当前 ${g.name || '?'} <${g.email || '?'}>，未匹配档案）`;
  }
  return '（全局未配置）';
});

// 本地覆盖若与某档案 name+email 完全一致，视为该身份
function localIdentityId(record) {
  if (!record.hasLocal) return null;
  const it = (props.store.identities || []).find(
    (x) => x.name === record.local.name && x.email === record.local.email,
  );
  return it ? it.id : null;
}

function selectValue(record) {
  if (!record.hasLocal) return INHERIT;
  return localIdentityId(record) ?? undefined; // 手配 → undefined，显示占位符
}

const summaryText = computed(() => {
  if (!summary.value) return '';
  const s = summary.value;
  return `共 ${s.total} 个仓库 · ${s.withLocal} 个单独设置 · ${s.missing} 个配置缺失${s.unknown ? ` · ${s.unknown} 个未匹配档案` : ''}`;
});

async function scan() {
  scanning.value = true;
  try {
    const r = await api.scan(root.value || defaultRoot(), depth.value);
    rows.value = r.rows;
    summary.value = r.summary;
    scanned.value = true;
  } catch (e) {
    message.error(e.message);
  } finally {
    scanning.value = false;
  }
}

function defaultRoot() {
  // 与占位符一致；~ / ~/x 由核心 scanRepos 展开为真实主目录路径
  return (props.store.settings && props.store.settings.scanRoot) || '~/Projects';
}

async function pickDirectory() {
  try {
    const dir = await api.pickDirectory();
    if (dir) { root.value = dir; await scan(); }
  } catch (e) {
    message.error(e.message);
  }
}

async function saveDefault() {
  if (!root.value.trim()) { message.warning('请先填写或选择扫描目录，再保存为默认'); return; }
  try {
    await api.saveSettings({ scanRoot: root.value.trim(), scanDepth: depth.value });
    message.success(`已保存默认扫描目录：${root.value.trim()}（深度 ${depth.value}）`);
    emit('changed');
  } catch (e) {
    message.error(e.message);
  }
}

async function clearDefault() {
  try {
    await api.saveSettings({ scanRoot: '' });
    message.success('已清除默认扫描目录，回退 ~/Projects');
    emit('changed');
  } catch (e) {
    message.error(e.message);
  }
}

// 选择即生效：继承全局 = 清除本地覆盖（unsetLocal）；身份 = 写入本地（applyLocal）
async function changeRepoIdentity(record, val) {
  try {
    if (val === INHERIT) {
      await api.unsetLocal(record.path);
      message.success(`${record.rel} 已改为继承全局`);
      emit('changed');
    } else {
      await api.applyLocal(record.path, val);
      message.success(`已为 ${record.rel} 单独设置身份：${val}（全局不受影响）`);
    }
    await scan();
  } catch (e) {
    message.error(e.message);
  }
}

// 集成验证用：GITID_SCAN_ROOT 指定时自动扫描
onMounted(() => {
  const flags = (window.gitid && window.gitid.getFlags) ? window.gitid.getFlags() : {};
  if (flags.scanRoot) { root.value = flags.scanRoot; scan(); }
});
</script>

<style scoped>
.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.dim { color: #94a3b8; }
.mono { font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: 13px; }
.hint { padding: 32px 0; text-align: center; }
.mb { margin-bottom: 12px; }
.manual-local :deep(.ant-select-selection-item) { color: #d46b08; }
</style>
