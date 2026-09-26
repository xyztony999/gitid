<template>
  <div>
    <div class="toolbar">
      <span class="dim">
        凭据本体存于 helper（GCM/钥匙串）；此处只做选择器展示与管道写入，token 不落档案不回显（ADR-017）
      </span>
      <a-button type="primary" @click="openCreate">
        <template #icon><PlusOutlined /></template>
        保存凭据
      </a-button>
    </div>

    <a-alert
      type="info"
      show-icon
      class="mb"
      message="推荐用 CLI 触发登录：gitid credential login <host> —— GCM 弹自身窗口完成 OAuth，token 全程不经 gitid"
      description="本页粘贴 PAT 亦不留存：token 仅在内存中转直达 git credential 协议；同 host+用户名再次保存即覆盖。"
    />

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
        <template v-if="column.key === 'stored'">
          <a-tag v-if="record.stored" color="green">{{ record.storedUsername }} ✓</a-tag>
          <a-tag v-else>未存储</a-tag>
        </template>
        <template v-else-if="column.key === 'actions'" align="right">
          <a-space :size="4">
            <a-button type="link" size="small" @click="openEdit(record)">覆盖</a-button>
            <a-popconfirm
              :title="`从 helper 删除 ${record.host}（${record.selector}）的凭据？`"
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
        <a-empty description="尚无凭据账号选择器">
          <a-button type="primary" @click="openCreate">保存凭据</a-button>
        </a-empty>
      </template>
    </a-table>
    <div v-else-if="!loading" class="hint dim">
      先在身份档案里配置凭据账号选择器（--account host=用户名），再在此保存对应 token。
    </div>

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
import { PlusOutlined } from '@ant-design/icons-vue';
import { api } from '../api.js';

const columns = [
  { title: 'host', key: 'host', dataIndex: 'host', width: 220 },
  { title: '选择器 username', key: 'selector', dataIndex: 'selector' },
  { title: 'helper 实存', key: 'stored', width: 200 },
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
  Object.assign(form, { host: record.host, username: record.selector, token: '' });
  modalOpen.value = true;
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

async function removeCred(record) {
  try {
    await api.credentialRemove(record.host, record.selector);
    message.success(`已从 helper 删除 ${record.host}（${record.selector}）的凭据`);
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
.mb { margin-bottom: 12px; }
.cred-form { margin-top: 8px; }
.note { font-size: 12px; margin-top: -8px; }
</style>
