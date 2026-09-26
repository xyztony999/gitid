<template>
  <div>
    <div class="toolbar">
      <span class="dim">
        凭据本体存于 helper（GCM/钥匙串）；此处只做选择器展示与管道写入，token 不落档案不回显（ADR-017）
      </span>
      <a-space>
        <a-button @click="openLogin">
          <template #icon><LoginOutlined /></template>
          登录（GCM 弹窗）
        </a-button>
        <a-button type="primary" @click="openCreate">
          <template #icon><PlusOutlined /></template>
          保存凭据
        </a-button>
      </a-space>
    </div>

    <a-table
      v-if="rows.length"
      :columns="columns"
      :data-source="rows"
      :pagination="false"
      row-key="host"
      size="middle"
      :loading="loading"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'selector'">
          <span v-if="record.selector" class="mono">{{ record.selector }}</span>
          <a-tooltip v-else title="未配置选择器（在身份里配 --account 后才会写入 credential.<host>.username）；本行来自登录/保存记录">
            <span class="dim">—</span>
          </a-tooltip>
        </template>
        <template v-else-if="column.key === 'stored'">
          <a-tag v-if="record.stored" color="green">{{ record.storedUsername }} ✓</a-tag>
          <a-tag v-else>未存储</a-tag>
        </template>
        <template v-else-if="column.key === 'actions'" align="right">
          <a-space :size="4">
            <a-button type="link" size="small" @click="openEdit(record)">覆盖</a-button>
            <a-popconfirm
              :title="delTitle(record)"
              ok-text="删除"
              cancel-text="取消"
              @confirm="removeCred(record)"
            >
              <a-button type="link" size="small" danger>删除</a-button>
            </a-popconfirm>
          </a-space>
        </template>
      </template>
      <template #emptyText>
        <a-empty description="尚无凭据线索">
          <a-space>
            <a-button @click="openLogin">登录（GCM 弹窗）</a-button>
            <a-button type="primary" @click="openCreate">保存凭据</a-button>
          </a-space>
        </a-empty>
      </template>
    </a-table>
    <div v-else-if="!loading" class="hint dim">
      还没有任何凭据：点上方「登录」让 GCM 弹窗完成 OAuth（推荐），或「保存凭据」粘贴 PAT。
    </div>

    <a-modal
      v-model:open="loginOpen"
      title="登录（GCM 弹窗）"
      ok-text="登录"
      cancel-text="取消"
      :confirm-loading="logging"
      @ok="doLogin"
    >
      <a-form layout="vertical" class="cred-form">
        <a-form-item label="host（如 github.com / gitee.com）" required>
          <a-input v-model:value="loginForm.host" placeholder="github.com" @pressEnter="doLogin" />
        </a-form-item>
        <a-form-item label="用户名（可选，多账号时指定）">
          <a-input v-model:value="loginForm.username" placeholder="留空由 GCM 窗口询问" />
        </a-form-item>
        <div class="dim note">点击后将弹出系统凭据管理器（GCM）自身窗口完成登录；token 直达钥匙串，不经过 gitid。</div>
      </a-form>
    </a-modal>

    <a-modal
      v-model:open="modalOpen"
      :title="editing ? `覆盖凭据：${form.host} · ${form.username}` : '保存凭据'"
      ok-text="保存"
      cancel-text="取消"
      :confirm-loading="saving"
      @ok="save"
    >
      <a-form layout="vertical" class="cred-form">
        <a-form-item label="host（如 github.com）" required>
          <a-input v-model:value="form.host" placeholder="github.com" />
        </a-form-item>
        <a-form-item label="用户名（GCM 按此取凭据）" required>
          <a-input v-model:value="form.username" placeholder="corp-zhang" />
        </a-form-item>
        <a-form-item label="Token / PAT" required>
          <a-input-password v-model:value="form.token" placeholder="粘贴 PAT；保存后不回显、不留存" />
        </a-form-item>
        <div class="dim note">token 仅内存中转直达 helper；同 host+用户名再次保存即覆盖（修改）。</div>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { message } from 'ant-design-vue';
import { LoginOutlined, PlusOutlined } from '@ant-design/icons-vue';
import { api } from '../api.js';

const columns = [
  { title: 'host', key: 'host', dataIndex: 'host', width: 200 },
  { title: '选择器（--account）', key: 'selector', width: 200 },
  { title: 'helper 实存', key: 'stored', width: 180 },
  { title: '操作', key: 'actions', width: 160, align: 'right' },
];

const rows = ref([]);
const loading = ref(false);
const modalOpen = ref(false);
const saving = ref(false);
const editing = ref(null);
const form = reactive({ host: '', username: '', token: '' });

async function refresh() {
  loading.value = true;
  try {
    rows.value = await api.credentialList();
  } catch (e) {
    message.error(`读取凭据状态失败：${e.message}`);
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  editing.value = null;
  Object.assign(form, { host: '', username: '', token: '' });
  modalOpen.value = true;
}

function openEdit(record) {
  editing.value = record;
  Object.assign(form, { host: record.host, username: record.selector || record.storedUsername || '', token: '' });
  modalOpen.value = true;
}

function credWho(record) {
  return record.selector || record.storedUsername || '';
}

async function save() {
  if (!form.host.trim() || !form.username.trim() || !form.token) {
    message.warning('host、用户名、Token 均为必填');
    return;
  }
  saving.value = true;
  try {
    await api.credentialSet(form.host.trim(), form.username.trim(), form.token);
    message.success(`已保存 ${form.host.trim()} · ${form.username.trim()}（凭据在 helper，gitid 不留存）`);
    modalOpen.value = false;
    form.token = '';
    await refresh();
  } catch (e) {
    message.error(e.message);
  } finally {
    saving.value = false;
  }
}

const loginOpen = ref(false);
const logging = ref(false);
const loginForm = reactive({ host: '', username: '' });

function openLogin() {
  Object.assign(loginForm, { host: '', username: '' });
  loginOpen.value = true;
}

async function doLogin() {
  if (!loginForm.host.trim()) { message.warning('请填写 host，如 github.com'); return; }
  logging.value = true;
  try {
    const r = await api.credentialLogin(loginForm.host.trim(), loginForm.username.trim());
    message.success(`已登录 ${r.host} —— ${r.username}（凭据在 helper/钥匙串，gitid 不留存）`);
    loginOpen.value = false;
    await refresh();
  } catch (e) {
    message.error(e.message);
  } finally {
    logging.value = false;
  }
}

function delTitle(record) {
  const who = credWho(record);
  return who ? `从 helper 删除 ${record.host}（${who}）的凭据？` : `从 helper 删除 ${record.host} 的全部凭据？`;
}

async function removeCred(record) {
  const who = credWho(record);
  try {
    await api.credentialRemove(record.host, who || null);
    message.success(`已从 helper 删除 ${record.host}${who ? `（${who}）` : ''}的凭据`);
    await refresh();
  } catch (e) {
    message.error(e.message);
  }
}

onMounted(refresh);
</script>

<style scoped>
.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.dim { color: #94a3b8; font-weight: normal; }
.hint { padding: 32px 0; text-align: center; }
.cred-form { margin-top: 8px; }
.note { font-size: 12px; margin-top: -8px; }
</style>
