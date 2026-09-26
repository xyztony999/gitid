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
        <template v-else-if="column.key === 'remotes'">
          <a-space :size="4" wrap>
            <template v-for="r in record.remotes || []" :key="r.name">
              <a-tooltip v-if="!r.mirror" :title="`${r.url}${r.account ? `\n凭据账号：${r.account}` : ''}`">
                <a-tag class="mono remote-tag">
                  {{ r.name }}<span v-if="r.account" class="dim">@{{ r.account }}</span>
                </a-tag>
              </a-tooltip>
              <a-tooltip v-else :title="`push 同时推：\n${r.pushurls.join('\n')}${r.account ? `\n凭据账号：${r.account}` : ''}`">
                <a-tag class="mono remote-tag" color="blue">{{ r.name }} ⊕</a-tag>
              </a-tooltip>
            </template>
            <a-button type="link" size="small" @click="openMirror(record)">
              {{ (record.remotes || []).some((r) => r.mirror) ? '管理' : '镜像' }}
            </a-button>
          </a-space>
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
      扫描目录查看各仓库生效身份；每个仓库可独立选择「继承全局」或单独设置本地身份，并管理远程镜像推送。
    </div>

    <a-modal
      v-model:open="mirrorModal.open"
      :title="mirrorModal.repo ? `镜像推送：${mirrorModal.repo.rel}` : '镜像推送'"
      ok-text="启用镜像"
      cancel-text="关闭"
      :confirm-loading="mirrorModal.loading"
      @ok="enableMirror"
    >
      <a-form layout="vertical" class="mirror-form">
        <a-alert
          v-if="mirrorModal.repo && !(mirrorModal.repo.remotes || []).length"
          type="warning"
          show-icon
          message="该仓库尚无远程，先在仓库内 git remote add <name> <url>"
          class="mb"
        />
        <a-form-item label="远程">
          <a-select v-model:value="mirrorModal.remote" style="width: 100%">
            <a-select-option
              v-for="r in (mirrorModal.repo && mirrorModal.repo.remotes) || []"
              :key="r.name"
              :value="r.name"
            >
              {{ r.name }}{{ r.mirror ? '（已镜像 ⊕）' : '' }}{{ r.url ? ` — ${r.url}` : '' }}
            </a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="镜像地址（git push 时与原地址同时推送）" required>
          <a-input v-model:value="mirrorModal.url" placeholder="https://gitee.com/<user>/<repo>.git" />
        </a-form-item>
        <a-form-item v-if="mirrorTarget && mirrorTarget.mirror">
          <a-button danger size="small" @click="disableMirror">取消该远程的镜像推送</a-button>
        </a-form-item>
        <div class="dim mirror-note">
          凭据仍由 git 自身（GCM/SSH）管理；fetch 不受影响，仅 push 同时推两端。
        </div>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
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
  { title: '远程/镜像', key: 'remotes', width: 190 },
  { title: '仓库身份（继承全局 / 单独设置）', key: 'identity', width: 280 },
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
  return `共 ${s.total} 个仓库 · ${s.withLocal} 个单独设置 · ${s.missing} 个配置缺失${s.unknown ? ` · ${s.unknown} 个未匹配档案` : ''}${s.mirrored ? ` · ${s.mirrored} 个镜像推送` : ''}`;
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

// 镜像推送管理（per-repo：remote.<name>.pushurl 多值，push 同时推两端）
const mirrorModal = reactive({ open: false, repo: null, remote: 'origin', url: '', loading: false });
const mirrorTarget = computed(() => {
  const list = (mirrorModal.repo && mirrorModal.repo.remotes) || [];
  return list.find((r) => r.name === mirrorModal.remote) || null;
});

function openMirror(record) {
  mirrorModal.repo = record;
  mirrorModal.remote = (record.remotes && record.remotes[0] && record.remotes[0].name) || 'origin';
  mirrorModal.url = '';
  mirrorModal.open = true;
}

async function enableMirror() {
  if (!mirrorModal.url.trim()) { message.warning('请填写镜像地址'); return; }
  mirrorModal.loading = true;
  try {
    await api.setMirror(mirrorModal.repo.path, mirrorModal.remote, mirrorModal.url.trim());
    message.success(`已开启 ${mirrorModal.repo.rel} · ${mirrorModal.remote} 镜像推送（git push 同时推两端）`);
    mirrorModal.open = false;
    await scan();
  } catch (e) {
    message.error(e.message);
  } finally {
    mirrorModal.loading = false;
  }
}

async function disableMirror() {
  try {
    await api.clearMirror(mirrorModal.repo.path, mirrorModal.remote);
    message.success(`已取消 ${mirrorModal.repo.rel} · ${mirrorModal.remote} 镜像推送`);
    mirrorModal.open = false;
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
.remote-tag { font-size: 12px; margin-right: 0; }
.mirror-note { font-size: 12px; margin-top: -8px; }
</style>
