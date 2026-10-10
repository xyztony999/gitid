<template>
  <div>
    <div class="toolbar">
      <span class="dim">{{ t('cred.hint') }}</span>
      <a-space>
        <a-button @click="openLogin">
          <template #icon><LoginOutlined /></template>
          {{ t('cred.login') }}
        </a-button>
        <a-button type="primary" @click="openCreate">
          <template #icon><PlusOutlined /></template>
          {{ t('cred.save') }}
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
          <a-tooltip v-else :title="t('cred.selectorTip')">
            <span class="dim">{{ t('common.dash') }}</span>
          </a-tooltip>
        </template>
        <template v-else-if="column.key === 'stored'">
          <a-tag v-if="record.stored" color="green">{{ t('cred.stored', { user: record.storedUsername }) }}</a-tag>
          <a-tag v-else>{{ t('cred.notStored') }}</a-tag>
        </template>
        <template v-else-if="column.key === 'actions'" align="right">
          <a-space :size="4">
            <a-button type="link" size="small" @click="openEdit(record)">{{ t('cred.overwrite') }}</a-button>
            <a-popconfirm
              :title="delTitle(record)"
              :ok-text="t('cred.remove')"
              :cancel-text="t('common.cancel')"
              @confirm="removeCred(record)"
            >
              <a-button type="link" size="small" danger>{{ t('cred.remove') }}</a-button>
            </a-popconfirm>
          </a-space>
        </template>
      </template>
      <template #emptyText>
        <a-empty :description="t('cred.empty')">
          <a-space>
            <a-button @click="openLogin">{{ t('cred.login') }}</a-button>
            <a-button type="primary" @click="openCreate">{{ t('cred.save') }}</a-button>
          </a-space>
        </a-empty>
      </template>
    </a-table>
    <div v-else-if="!loading" class="hint dim">{{ t('cred.emptyHint') }}</div>

    <a-modal
      v-model:open="loginOpen"
      :title="t('cred.loginTitle')"
      :ok-text="t('cred.loginOk')"
      :cancel-text="t('common.cancel')"
      :confirm-loading="logging"
      @ok="doLogin"
    >
      <a-form layout="vertical" class="cred-form">
        <a-form-item :label="t('cred.host')" required>
          <a-input v-model:value="loginForm.host" :placeholder="t('cred.hostPh')" @pressEnter="doLogin" />
        </a-form-item>
        <a-form-item :label="t('cred.usernameOpt')">
          <a-input v-model:value="loginForm.username" :placeholder="t('cred.usernameOptPh')" />
        </a-form-item>
        <div class="dim note">{{ t('cred.loginNote') }}</div>
      </a-form>
    </a-modal>

    <a-modal
      v-model:open="modalOpen"
      :title="editing ? t('cred.overwriteTitle', { host: form.host, username: form.username }) : t('cred.saveTitle')"
      :ok-text="t('common.save')"
      :cancel-text="t('common.cancel')"
      :confirm-loading="saving"
      @ok="save"
    >
      <a-form layout="vertical" class="cred-form">
        <a-form-item :label="t('cred.hostRequired')" required>
          <a-input v-model:value="form.host" :placeholder="t('cred.hostPh')" />
        </a-form-item>
        <a-form-item :label="t('cred.username')" required>
          <a-input v-model:value="form.username" :placeholder="t('cred.usernamePh')" />
        </a-form-item>
        <a-form-item :label="t('cred.token')" required>
          <a-input-password v-model:value="form.token" :placeholder="t('cred.tokenPh')" />
        </a-form-item>
        <div class="dim note">{{ t('cred.saveNote') }}</div>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { message } from 'ant-design-vue';
import { LoginOutlined, PlusOutlined } from '@ant-design/icons-vue';
import { api } from '../api.js';
import { t } from '../i18n.js';

const columns = computed(() => [
  { title: t('cred.colHost'), key: 'host', dataIndex: 'host', width: 200 },
  { title: t('cred.colSelector'), key: 'selector', width: 200 },
  { title: t('cred.colStored'), key: 'stored', width: 180 },
  { title: t('cred.colActions'), key: 'actions', width: 160, align: 'right' },
]);

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
    message.error(t('cred.listFailed', { error: e.message }));
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
    message.warning(t('cred.needFields'));
    return;
  }
  saving.value = true;
  try {
    await api.credentialSet(form.host.trim(), form.username.trim(), form.token);
    message.success(t('cred.saved', { host: form.host.trim(), username: form.username.trim() }));
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
  if (!loginForm.host.trim()) { message.warning(t('cred.needHost')); return; }
  logging.value = true;
  try {
    const r = await api.credentialLogin(loginForm.host.trim(), loginForm.username.trim());
    message.success(t('cred.loggedIn', { host: r.host, username: r.username }));
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
  return who
    ? t('cred.delWho', { host: record.host, who })
    : t('cred.delAll', { host: record.host });
}

async function removeCred(record) {
  const who = credWho(record);
  try {
    await api.credentialRemove(record.host, who || null);
    message.success(t('cred.removed', { host: record.host, who: who ? `（${who}）` : '' }));
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
