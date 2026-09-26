<template>
  <div>
    <a-alert v-if="globalInfo" :type="globalInfo.type" show-icon class="global-alert">
      <template #message>
        当前全局身份：
        <b v-if="store.global.identityId">{{ store.global.identityId }} — {{ store.global.name }} &lt;{{ store.global.email }}&gt;</b>
        <b v-else>{{ store.global.name || '?' }} &lt;{{ store.global.email || '?' }}&gt;</b>
        <span class="dim">（{{ store.global.identityId ? '已匹配档案' : '未匹配任何档案，可能为手动配置' }}）</span>
      </template>
      <template #description>
        git 全局配置实际值：user.name=<code>{{ store.global.name ?? '未设置' }}</code> ·
        user.email=<code>{{ store.global.email ?? '未设置' }}</code>
        <span v-if="store.global.signingkey"> · 签名键 <code>{{ store.global.signingkey }}</code></span>
      </template>
    </a-alert>

    <div class="toolbar">
      <span class="dim">身份档案 {{ store.identities.length }} 条 · 切换全局身份即时生效（含签名键自动清理）</span>
      <a-space>
        <a-button @click="openImport" :disabled="importDisabled">导入当前全局配置</a-button>
        <a-button type="primary" @click="openCreate">
          <template #icon><PlusOutlined /></template>
          新增身份
        </a-button>
      </a-space>
    </div>

    <a-table
      :columns="columns"
      :data-source="rows"
      :pagination="false"
      row-key="id"
      size="middle"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'id'">
          <a-space :size="6">
            <a-tag v-if="record.id === store.global.identityId" color="gold">★ 全局</a-tag>
            <b>{{ record.id }}</b>
          </a-space>
        </template>
        <template v-else-if="column.key === 'name'">{{ record.name }}</template>
        <template v-else-if="column.key === 'email'">{{ record.email }}</template>
        <template v-else-if="column.key === 'insteadOf'">
          <a-tooltip
            v-if="record.insteadOf && record.insteadOf.length"
            :title="record.insteadOf.map((p) => `${p.original} → ${p.url}`).join('\n')"
          >
            <span>{{ record.insteadOf.length }} 条</span>
          </a-tooltip>
          <span v-else class="dim">—</span>
        </template>
        <template v-else-if="column.key === 'accounts'">
          <a-tooltip
            v-if="record.accounts && record.accounts.length"
            :title="record.accounts.map((a) => `${a.host} → ${a.username}`).join('\n')"
          >
            <span>{{ record.accounts.length }} 个</span>
          </a-tooltip>
          <span v-else class="dim">—</span>
        </template>
        <template v-else-if="column.key === 'signingkey'">
          <span v-if="record.signingkey"><code>{{ record.signingkey }}</code>{{ record.gpgsign === true ? ' · GPG 签名开' : '' }}</span>
          <span v-else class="dim">—</span>
        </template>
        <template v-else-if="column.key === 'actions'">
          <a-space :size="4">
            <a-popconfirm
              :title="`将全局身份切换为 ${record.id}？`"
              ok-text="切换"
              cancel-text="取消"
              @confirm="applyGlobal(record)"
            >
              <a-button type="link" size="small" :disabled="record.id === store.global.identityId">
                {{ record.id === store.global.identityId ? '当前全局' : '设为全局' }}
              </a-button>
            </a-popconfirm>
            <a-button type="link" size="small" @click="openEdit(record)">编辑</a-button>
            <a-popconfirm :title="`删除身份档案 ${record.id}？（已写入的 git 配置不受影响）`" ok-text="删除" cancel-text="取消" @confirm="removeIdentity(record)">
              <a-button type="link" size="small" danger>删除</a-button>
            </a-popconfirm>
          </a-space>
        </template>
      </template>
      <template #emptyText>
        <a-empty description="尚无身份档案">
          <a-space>
            <a-button type="primary" @click="openCreate">新增身份</a-button>
            <a-button @click="openImport" :disabled="importDisabled">导入当前全局配置</a-button>
          </a-space>
        </a-empty>
      </template>
    </a-table>

    <a-modal
      v-model:open="modalOpen"
      :title="editing ? `编辑身份：${form.id}` : '新增身份'"
      ok-text="保存"
      cancel-text="取消"
      :confirm-loading="saving"
      @ok="save"
    >
      <a-form layout="vertical" class="identity-form">
        <a-form-item label="身份 ID（用于命令行 gitid use）" required>
          <a-input v-model:value="form.id" :disabled="!!editing" placeholder="如 work / personal" />
        </a-form-item>
        <a-form-item label="姓名（user.name）" required>
          <a-input v-model:value="form.name" placeholder="张三" />
        </a-form-item>
        <a-form-item label="邮箱（user.email）" required>
          <a-input v-model:value="form.email" placeholder="zhangsan@corp.com" />
        </a-form-item>
        <a-form-item label="签名键（user.signingkey，可选）">
          <a-input v-model:value="form.signingkey" placeholder="留空表示该身份不使用签名" />
        </a-form-item>
        <a-form-item label="提交时启用 GPG 签名（commit.gpgsign）">
          <a-switch v-model:checked="form.gpgsign" />
        </a-form-item>
        <a-form-item label="URL 重写 insteadOf（每行一条：原始地址=替换地址）">
          <a-textarea
            v-model:value="form.insteadOfText"
            :rows="2"
            placeholder="https://github.com/=https://gh.example.com/（镜像加速 / 多账号协议切换；凭据仍归 GCM/SSH）"
          />
        </a-form-item>
        <a-form-item label="凭据账号选择器（每行一条：host=用户名）">
          <a-textarea
            v-model:value="form.accountsText"
            :rows="2"
            placeholder="github.com=corp-zhang（GCM 按用户名取凭据；token 不入档案，在「凭据」页或 CLI 管理）"
          />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue';
import { message } from 'ant-design-vue';
import { PlusOutlined } from '@ant-design/icons-vue';
import { api } from '../api.js';

const props = defineProps({ store: { type: Object, required: true } });
const emit = defineEmits(['changed']);

const columns = [
  { title: 'ID', key: 'id', width: 160 },
  { title: '姓名', key: 'name', width: 110 },
  { title: '邮箱', key: 'email', ellipsis: true },
  { title: 'URL 重写', key: 'insteadOf', width: 90 },
  { title: '凭据账号', key: 'accounts', width: 90 },
  { title: '签名', key: 'signingkey', width: 150 },
  { title: '操作', key: 'actions', width: 200, align: 'right' },
];

const rows = computed(() => props.store.identities || []);
const importDisabled = computed(() => {
  const g = props.store.global || {};
  return g.name === undefined && g.email === undefined;
});
const globalInfo = computed(() => {
  const g = props.store.global || {};
  if (g.identityId) return { type: 'success' };
  if (g.name !== undefined || g.email !== undefined) return { type: 'warning' };
  return { type: 'error' };
});

const modalOpen = ref(false);
const saving = ref(false);
const editing = ref(null);
const form = reactive({ id: '', name: '', email: '', signingkey: '', gpgsign: false, insteadOfText: '', accountsText: '' });

function openCreate() {
  editing.value = null;
  Object.assign(form, { id: '', name: '', email: '', signingkey: '', gpgsign: false, insteadOfText: '', accountsText: '' });
  modalOpen.value = true;
}

function openEdit(record) {
  editing.value = record;
  Object.assign(form, {
    id: record.id,
    name: record.name,
    email: record.email,
    signingkey: record.signingkey || '',
    gpgsign: record.gpgsign === true,
    insteadOfText: (record.insteadOf || []).map((p) => `${p.original}=${p.url}`).join('\n'),
    accountsText: (record.accounts || []).map((a) => `${a.host}=${a.username}`).join('\n'),
  });
  modalOpen.value = true;
}

async function save() {
  if (!form.id.trim() || !form.name.trim() || !form.email.trim()) {
    message.warning('身份 ID、姓名、邮箱均为必填');
    return;
  }
  const insteadOf = [];
  for (const line of form.insteadOfText.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    const eq = s.indexOf('=');
    if (eq <= 0) { message.warning(`URL 重写格式应为 原始地址=替换地址：${s}`); return; }
    insteadOf.push({ original: s.slice(0, eq), url: s.slice(eq + 1) });
  }
  const accounts = [];
  for (const line of form.accountsText.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    const eq = s.indexOf('=');
    if (eq <= 0) { message.warning(`凭据账号格式应为 host=用户名：${s}`); return; }
    accounts.push({ host: s.slice(0, eq), username: s.slice(eq + 1) });
  }
  saving.value = true;
  try {
    const r = await api.saveIdentity(form.id.trim(), {
      name: form.name.trim(),
      email: form.email.trim(),
      signingkey: form.signingkey.trim(),
      gpgsign: form.gpgsign,
      insteadOf,
      accounts,
    });
    message.success(r.exists ? `身份 ${form.id} 已更新` : `身份 ${form.id} 已创建`);
    modalOpen.value = false;
    emit('changed');
  } catch (e) {
    message.error(e.message);
  } finally {
    saving.value = false;
  }
}

async function applyGlobal(record) {
  try {
    await api.applyGlobal(record.id);
    message.success(`全局身份已切换为 ${record.id} — ${record.name}`);
    emit('changed');
  } catch (e) {
    message.error(e.message);
  }
}

async function removeIdentity(record) {
  try {
    await api.removeIdentity(record.id);
    message.success(`已删除身份档案 ${record.id}（git 配置不受影响）`);
    emit('changed');
  } catch (e) {
    message.error(e.message);
  }
}

async function openImport() {
  try {
    const r = await api.importGlobal();
    message.success(`已导入为身份 ${r.id}`);
    emit('changed');
  } catch (e) {
    message.error(e.message);
  }
}
</script>

<style scoped>
.global-alert { margin-bottom: 16px; }
.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.dim { color: #94a3b8; font-weight: normal; }
.identity-form { margin-top: 8px; }
</style>
