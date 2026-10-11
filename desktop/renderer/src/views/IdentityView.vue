<template>
  <div>
    <a-alert v-if="globalInfo" :type="globalInfo.type" show-icon class="global-alert">
      <template #message>
        {{ t('identity.globalCurrent') }}
        <b v-if="store.global.identityId">{{ store.global.identityId }} — {{ store.global.name }} &lt;{{ store.global.email }}&gt;</b>
        <b v-else>{{ store.global.name || '?' }} &lt;{{ store.global.email || '?' }}&gt;</b>
        <span class="dim">（{{ store.global.identityId ? t('identity.matched') : t('identity.unmatched') }}）</span>
      </template>
      <template #description>
        {{ t('identity.globalActual') }}<code>{{ store.global.name ?? t('identity.unset') }}</code> ·
        user.email=<code>{{ store.global.email ?? t('identity.unset') }}</code>
        <span v-if="store.global.signingkey"> · {{ t('identity.signingKeyLabel') }} <code>{{ store.global.signingkey }}</code></span>
      </template>
    </a-alert>

    <div class="toolbar">
      <span class="dim">{{ t('identity.toolbarHint', { n: store.identities.length }) }}</span>
      <a-space>
        <a-button @click="openImport" :disabled="importDisabled">{{ t('identity.importGlobal') }}</a-button>
        <a-button type="primary" @click="openCreate">
          <template #icon><PlusOutlined /></template>
          {{ t('identity.create') }}
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
            <a-tag v-if="record.id === store.global.identityId" color="gold">{{ t('identity.globalTag') }}</a-tag>
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
            <span>{{ t('identity.itemsInstead', { n: record.insteadOf.length }) }}</span>
          </a-tooltip>
          <span v-else class="dim">{{ t('common.dash') }}</span>
        </template>
        <template v-else-if="column.key === 'accounts'">
          <a-tooltip
            v-if="record.accounts && record.accounts.length"
            :title="record.accounts.map((a) => `${a.host} → ${a.username}`).join('\n')"
          >
            <span>{{ t('identity.itemsAccount', { n: record.accounts.length }) }}</span>
          </a-tooltip>
          <span v-else class="dim">{{ t('common.dash') }}</span>
        </template>
        <template v-else-if="column.key === 'signingkey'">
          <span v-if="signingLabel(record)"><code>{{ signingLabel(record) }}</code></span>
          <span v-else class="dim">{{ t('common.dash') }}</span>
        </template>
        <template v-else-if="column.key === 'gitdirs'">
          <a-space v-if="record.gitdirs && record.gitdirs.length" :size="4" wrap>
            <a-popconfirm
              v-for="dir in record.gitdirs"
              :key="dir"
              :title="t('identity.unbindConfirm', { dir })"
              :ok-text="t('common.ok')"
              :cancel-text="t('common.cancel')"
              @confirm="unbindDir(record, dir)"
            >
              <a-tag class="gitdir-tag">
                {{ dir }}
                <CloseOutlined class="gitdir-close" />
              </a-tag>
            </a-popconfirm>
          </a-space>
          <span v-else class="dim">{{ t('identity.gitdirsNone') }}</span>
        </template>
        <template v-else-if="column.key === 'actions'">
          <a-space :size="4">
            <a-popconfirm
              :title="t('identity.applyConfirm', { id: record.id })"
              :ok-text="t('identity.applyOk')"
              :cancel-text="t('common.cancel')"
              @confirm="applyGlobal(record)"
            >
              <a-button type="link" size="small" :disabled="record.id === store.global.identityId">
                {{ record.id === store.global.identityId ? t('identity.currentGlobal') : t('identity.setGlobal') }}
              </a-button>
            </a-popconfirm>
            <a-button type="link" size="small" @click="openEdit(record)">{{ t('identity.edit') }}</a-button>
            <a-popconfirm
              :title="t('identity.removeConfirm', { id: record.id })"
              :ok-text="t('identity.remove')"
              :cancel-text="t('common.cancel')"
              @confirm="removeIdentity(record)"
            >
              <a-button type="link" size="small" danger>{{ t('identity.remove') }}</a-button>
            </a-popconfirm>
          </a-space>
        </template>
      </template>
      <template #emptyText>
        <a-empty :description="t('identity.empty')">
          <a-space>
            <a-button type="primary" @click="openCreate">{{ t('identity.create') }}</a-button>
            <a-button @click="openImport" :disabled="importDisabled">{{ t('identity.importGlobal') }}</a-button>
          </a-space>
        </a-empty>
      </template>
    </a-table>

    <a-modal
      v-model:open="modalOpen"
      :title="editing ? t('identity.editTitle', { id: form.id }) : t('identity.createTitle')"
      :ok-text="t('common.save')"
      :cancel-text="t('common.cancel')"
      :confirm-loading="saving"
      @ok="save"
    >
      <a-form layout="vertical" class="identity-form">
        <a-form-item :label="t('identity.fieldId')" required>
          <a-input v-model:value="form.id" :disabled="!!editing" :placeholder="t('identity.fieldIdPh')" />
        </a-form-item>
        <a-form-item :label="t('identity.fieldName')" required>
          <a-input v-model:value="form.name" :placeholder="t('identity.fieldNamePh')" />
        </a-form-item>
        <a-form-item :label="t('identity.fieldEmail')" required>
          <a-input v-model:value="form.email" :placeholder="t('identity.fieldEmailPh')" />
        </a-form-item>
        <a-form-item :label="t('identity.fieldSigning')">
          <a-input v-model:value="form.signingkey" :placeholder="t('identity.fieldSigningPh')" />
        </a-form-item>
        <a-form-item :label="t('identity.fieldFormat')">
          <a-select v-model:value="form.gpgFormat" :options="formatOptions" />
        </a-form-item>
        <a-form-item :label="t('identity.fieldGpgsign')">
          <a-switch v-model:checked="form.gpgsign" />
        </a-form-item>
        <a-form-item :label="t('identity.fieldInsteadOf')">
          <a-textarea
            v-model:value="form.insteadOfText"
            :rows="2"
            :placeholder="t('identity.fieldInsteadOfPh')"
          />
        </a-form-item>
        <a-form-item :label="t('identity.fieldAccounts')">
          <a-textarea
            v-model:value="form.accountsText"
            :rows="2"
            :placeholder="t('identity.fieldAccountsPh')"
          />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue';
import { message } from 'ant-design-vue';
import { CloseOutlined, PlusOutlined } from '@ant-design/icons-vue';
import { api } from '../api.js';
import { t } from '../i18n.js';

const props = defineProps({ store: { type: Object, required: true } });
const emit = defineEmits(['changed']);

const columns = computed(() => [
  { title: t('identity.colId'), key: 'id', width: 160 },
  { title: t('identity.colName'), key: 'name', width: 110 },
  { title: t('identity.colEmail'), key: 'email', ellipsis: true },
  { title: t('identity.colInsteadOf'), key: 'insteadOf', width: 90 },
  { title: t('identity.colAccounts'), key: 'accounts', width: 90 },
  { title: t('identity.colSigning'), key: 'signingkey', width: 160 },
  { title: t('identity.colGitdirs'), key: 'gitdirs', width: 220 },
  { title: t('identity.colActions'), key: 'actions', width: 200, align: 'right' },
]);

const formatOptions = computed(() => [
  { value: '', label: t('identity.formatNone') },
  { value: 'openpgp', label: 'openpgp' },
  { value: 'ssh', label: 'ssh' },
  { value: 'x509', label: 'x509' },
]);

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
const form = reactive({
  id: '', name: '', email: '', signingkey: '', gpgFormat: '', gpgsign: false, insteadOfText: '', accountsText: '',
});

function emptyForm() {
  return { id: '', name: '', email: '', signingkey: '', gpgFormat: '', gpgsign: false, insteadOfText: '', accountsText: '' };
}

function signingLabel(record) {
  const bits = [];
  if (record.signingkey) bits.push(record.signingkey);
  if (record.gpgFormat) bits.push(record.gpgFormat);
  let s = bits.join(' · ');
  if (record.gpgsign === true) s = s ? `${s} · ${t('identity.gpgsignOn')}` : t('identity.gpgsignOn');
  return s;
}

function openCreate() {
  editing.value = null;
  Object.assign(form, emptyForm());
  modalOpen.value = true;
}

function openEdit(record) {
  editing.value = record;
  Object.assign(form, {
    id: record.id,
    name: record.name,
    email: record.email,
    signingkey: record.signingkey || '',
    gpgFormat: record.gpgFormat || '',
    gpgsign: record.gpgsign === true,
    insteadOfText: (record.insteadOf || []).map((p) => `${p.original}=${p.url}`).join('\n'),
    accountsText: (record.accounts || []).map((a) => `${a.host}=${a.username}`).join('\n'),
  });
  modalOpen.value = true;
}

async function save() {
  if (!form.id.trim() || !form.name.trim() || !form.email.trim()) {
    message.warning(t('identity.needFields'));
    return;
  }
  const insteadOf = [];
  for (const line of form.insteadOfText.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    const eq = s.indexOf('=');
    if (eq <= 0) { message.warning(t('identity.badInsteadOf', { line: s })); return; }
    insteadOf.push({ original: s.slice(0, eq), url: s.slice(eq + 1) });
  }
  const accounts = [];
  for (const line of form.accountsText.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    const eq = s.indexOf('=');
    if (eq <= 0) { message.warning(t('identity.badAccount', { line: s })); return; }
    accounts.push({ host: s.slice(0, eq), username: s.slice(eq + 1) });
  }
  saving.value = true;
  try {
    const r = await api.saveIdentity(form.id.trim(), {
      name: form.name.trim(),
      email: form.email.trim(),
      signingkey: form.signingkey.trim(),
      gpgFormat: form.gpgFormat || '',
      gpgsign: form.gpgsign,
      insteadOf,
      accounts,
    });
    message.success(r.exists ? t('identity.updated', { id: form.id }) : t('identity.created', { id: form.id }));
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
    message.success(t('identity.applied', { id: record.id, name: record.name }));
    emit('changed');
  } catch (e) {
    message.error(e.message);
  }
}

async function removeIdentity(record) {
  try {
    await api.removeIdentity(record.id);
    message.success(t('identity.removed', { id: record.id }));
    emit('changed');
  } catch (e) {
    message.error(e.message);
  }
}

async function unbindDir(record, dir) {
  try {
    await api.unbindIdentity({ id: record.id, dir });
    message.success(t('identity.unbound', { dir }));
    emit('changed');
  } catch (e) {
    message.error(e.message);
  }
}

async function openImport() {
  try {
    const r = await api.importGlobal();
    message.success(t('identity.imported', { id: r.id }));
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
.gitdir-tag { max-width: 200px; cursor: pointer; font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: 12px; }
.gitdir-close { margin-left: 4px; font-size: 10px; opacity: 0.65; }
</style>
