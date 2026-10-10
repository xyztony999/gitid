<template>
  <div>
    <div class="toolbar">
      <a-space>
        <a-input
          v-model:value="root"
          :placeholder="t('repo.rootPh', { root: defaultRoot() })"
          style="width: 380px"
          @pressEnter="scan"
        >
          <template #prefix><FolderOutlined class="dim" /></template>
        </a-input>
        <a-button @click="pickDirectory">{{ t('repo.pickDir') }}</a-button>
        <span class="dim">{{ t('repo.depth') }}</span>
        <a-input-number v-model:value="depth" :min="1" :max="12" style="width: 72px" />
        <a-button type="primary" :loading="scanning" @click="scan">
          <template #icon><ScanOutlined /></template>
          {{ t('repo.scan') }}
        </a-button>
        <a-tooltip :title="t('repo.saveDefaultTip')">
          <a-button @click="saveDefault">
            <template #icon><SaveOutlined /></template>
            {{ t('repo.saveDefault') }}
          </a-button>
        </a-tooltip>
        <a-button v-if="hasDefault" type="link" @click="clearDefault">{{ t('repo.clearDefault') }}</a-button>
      </a-space>
      <span v-if="summaryText" class="dim">{{ summaryText }}</span>
    </div>

    <div v-if="rows.length" class="toolbar actions-bar">
      <a-space>
        <a-button v-if="unknownCount" @click="confirmImport">{{ t('repo.importUnknown') }}</a-button>
        <a-button :disabled="!selectedKeys.length" @click="openBatch">{{ t('repo.batch') }}</a-button>
        <a-button @click="selectMissing">{{ t('repo.selectMissing') }}</a-button>
        <a-dropdown>
          <a-button>{{ t('repo.export') }}</a-button>
          <template #overlay>
            <a-menu @click="onExport">
              <a-menu-item key="json">JSON</a-menu-item>
              <a-menu-item key="markdown">Markdown</a-menu-item>
              <a-menu-item key="csv">CSV</a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>
      </a-space>
    </div>

    <a-alert
      v-if="scanned && rows.length === 0"
      type="info"
      show-icon
      :message="t('repo.emptyScan', { root: root || defaultRoot(), depth })"
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
      :row-selection="rowSelection"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'status'">
          <a-tag :color="statusMeta[record.status].color">{{ t(`repo.status.${record.status}`) }}</a-tag>
        </template>
        <template v-else-if="column.key === 'repo'">
          <a-tooltip :title="record.path">
            <span class="mono">{{ record.rel }}</span>
          </a-tooltip>
        </template>
        <template v-else-if="column.key === 'remotes'">
          <a-space :size="4" wrap>
            <template v-for="r in record.remotes || []" :key="r.name">
              <a-tooltip v-if="!r.mirror" :title="`${r.url}${r.account ? `\n${t('repo.accountHint', { user: r.account })}` : ''}`">
                <a-tag class="mono remote-tag">
                  {{ r.name }}<span v-if="r.account" class="dim">@{{ r.account }}</span>
                </a-tag>
              </a-tooltip>
              <a-tooltip v-else :title="`${t('repo.pushBoth')}\n${r.pushurls.join('\n')}${r.account ? `\n${t('repo.accountHint', { user: r.account })}` : ''}`">
                <a-tag class="mono remote-tag" color="blue">{{ r.name }} ⊕</a-tag>
              </a-tooltip>
            </template>
            <a-button type="link" size="small" @click="openMirror(record)">
              {{ (record.remotes || []).some((r) => r.mirror) ? t('repo.manage') : t('repo.mirror') }}
            </a-button>
          </a-space>
        </template>
        <template v-else-if="column.key === 'identity'">
          <a-select
            :value="selectValue(record)"
            :placeholder="t('repo.manualLocal')"
            style="width: 100%"
            :class="{ 'manual-local': record.hasLocal && !localIdentityId(record) }"
            @change="(val) => changeRepoIdentity(record, val)"
          >
            <a-select-option :value="INHERIT">
              <span class="dim">{{ t('repo.inherit') }}</span>{{ inheritHint }}
            </a-select-option>
            <a-select-option v-for="opt in identityOptions" :key="opt.id" :value="opt.id">
              {{ opt.id }} — {{ opt.name }} &lt;{{ opt.email }}&gt;
            </a-select-option>
          </a-select>
        </template>
        <template v-else-if="column.key === 'effective'">
          <span v-if="record.status === 'missing'" class="mono">{{ t('repo.missingKeys') }}</span>
          <span v-else>{{ record.effective.name }} <span class="dim">&lt;{{ record.effective.email }}&gt;</span></span>
        </template>
        <template v-else-if="column.key === 'actions'">
          <a-button type="link" size="small" @click="openAudit(record)">{{ t('repo.history') }}</a-button>
        </template>
      </template>
    </a-table>
    <div v-else-if="!scanned" class="hint dim">
      {{ t('repo.hint') }}
    </div>

    <a-modal
      v-model:open="mirrorModal.open"
      :title="mirrorModal.repo ? t('repo.mirrorTitle', { rel: mirrorModal.repo.rel }) : t('repo.mirrorPlain')"
      :ok-text="t('repo.mirrorEnable')"
      :cancel-text="t('common.close')"
      :confirm-loading="mirrorModal.loading"
      @ok="enableMirror"
    >
      <a-form layout="vertical" class="mirror-form">
        <a-alert
          v-if="mirrorModal.repo && !(mirrorModal.repo.remotes || []).length"
          type="warning"
          show-icon
          :message="t('repo.noRemote')"
          class="mb"
        />
        <a-form-item :label="t('repo.remote')">
          <a-select v-model:value="mirrorModal.remote" style="width: 100%">
            <a-select-option
              v-for="r in (mirrorModal.repo && mirrorModal.repo.remotes) || []"
              :key="r.name"
              :value="r.name"
            >
              {{ r.name }}{{ r.mirror ? t('repo.mirrored') : '' }}{{ r.url ? ` — ${r.url}` : '' }}
            </a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item :label="t('repo.mirrorUrl')" required>
          <a-input v-model:value="mirrorModal.url" :placeholder="t('repo.mirrorUrlPh')" />
        </a-form-item>
        <a-form-item v-if="mirrorTarget && mirrorTarget.mirror">
          <a-button danger size="small" @click="disableMirror">{{ t('repo.clearMirror') }}</a-button>
        </a-form-item>
        <div class="dim mirror-note">{{ t('repo.mirrorNote') }}</div>
      </a-form>
    </a-modal>

    <a-modal
      v-model:open="batch.open"
      :title="t('repo.batchTitle')"
      :ok-text="t('common.ok')"
      :cancel-text="t('common.cancel')"
      :confirm-loading="batch.loading"
      @ok="doBatch"
    >
      <a-form layout="vertical">
        <a-form-item :label="t('repo.batchIdentity')" required>
          <a-select v-model:value="batch.id" :placeholder="t('repo.batchIdentityPh')" style="width: 100%">
            <a-select-option v-for="opt in identityOptions" :key="opt.id" :value="opt.id">
              {{ opt.id }} — {{ opt.name }} &lt;{{ opt.email }}&gt;
            </a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item>
          <a-checkbox v-model:checked="batch.missingOnly">{{ t('repo.missingOnly') }}</a-checkbox>
        </a-form-item>
        <div class="dim mb">{{ t('repo.batchPreview', { n: batchTargets.length }) }}</div>
        <ul class="batch-list">
          <li v-for="r in batchTargets" :key="r.path" class="mono">{{ r.rel }}</li>
        </ul>
      </a-form>
    </a-modal>

    <a-drawer
      v-model:open="audit.open"
      :title="audit.repo ? t('repo.auditTitle', { rel: audit.repo.rel }) : t('repo.history')"
      width="640"
    >
      <a-form-item :label="t('repo.expectId')">
        <a-select
          v-model:value="audit.expectId"
          allow-clear
          :placeholder="t('repo.expectPh')"
          style="width: 100%"
          @change="reloadAudit"
        >
          <a-select-option v-for="opt in identityOptions" :key="opt.id" :value="opt.id">
            {{ opt.id }} — {{ opt.name }} &lt;{{ opt.email }}&gt;
          </a-select-option>
        </a-select>
      </a-form-item>
      <a-table
        :columns="auditColumns"
        :data-source="audit.authors"
        :pagination="false"
        row-key="rowKey"
        size="small"
        :loading="audit.loading"
        class="mb"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'match'">{{ record.matchId || t('repo.unmatchedAuthor') }}</template>
          <template v-else-if="column.key === 'polluted'">
            <span v-if="record.polluted === true">{{ t('repo.pollutedYes') }}</span>
            <span v-else-if="record.polluted === false">{{ t('repo.pollutedNo') }}</span>
            <span v-else class="dim">{{ t('common.dash') }}</span>
          </template>
        </template>
      </a-table>
      <a-form-item :label="t('repo.mailmap')">
        <a-textarea :value="audit.mailmap || t('repo.mailmapEmpty')" :rows="8" readonly />
        <a-button class="copy-btn" :disabled="!audit.mailmap" @click="copyMailmap">{{ t('common.copy') }}</a-button>
      </a-form-item>
    </a-drawer>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { Modal, message } from 'ant-design-vue';
import { FolderOutlined, SaveOutlined, ScanOutlined } from '@ant-design/icons-vue';
import { api } from '../api.js';
import { t } from '../i18n.js';

const props = defineProps({ store: { type: Object, required: true } });
const emit = defineEmits(['changed']);

const INHERIT = '__inherit__';

const root = ref('');
const depth = ref(6);
const scanning = ref(false);
const scanned = ref(false);
const rows = ref([]);
const summary = ref(null);
const selectedKeys = ref([]);

const hasDefault = computed(() => !!(props.store.settings && props.store.settings.scanRoot));

let settingsInited = false;
watch(() => props.store, (s) => {
  if (settingsInited || !s.settings) return;
  settingsInited = true;
  root.value = s.settings.scanRoot || '';
  depth.value = s.settings.scanDepth || 6;
}, { immediate: true });

const columns = computed(() => [
  { title: t('repo.colStatus'), key: 'status', width: 96 },
  { title: t('repo.colRepo'), key: 'repo', ellipsis: true },
  { title: t('repo.colRemotes'), key: 'remotes', width: 190 },
  { title: t('repo.colIdentity'), key: 'identity', width: 260 },
  { title: t('repo.colEffective'), key: 'effective', ellipsis: true },
  { title: t('repo.colActions'), key: 'actions', width: 72, align: 'right' },
]);

const statusMeta = {
  ok: { color: 'green' },
  missing: { color: 'red' },
  unknown: { color: 'orange' },
};

const identityOptions = computed(() => props.store.identities || []);
const unknownCount = computed(() => rows.value.filter((r) => r.status === 'unknown').length);

const inheritHint = computed(() => {
  const g = props.store.global || {};
  if (g.identityId) return t('repo.inheritCurrent', { id: g.identityId });
  if (g.name !== undefined || g.email !== undefined) {
    return t('repo.inheritUnmatched', { name: g.name || '?', email: g.email || '?' });
  }
  return t('repo.inheritUnset');
});

function localIdentityId(record) {
  if (!record.hasLocal) return null;
  const it = (props.store.identities || []).find(
    (x) => x.name === record.local.name && x.email === record.local.email,
  );
  return it ? it.id : null;
}

function selectValue(record) {
  if (!record.hasLocal) return INHERIT;
  return localIdentityId(record) ?? undefined;
}

const summaryText = computed(() => {
  if (!summary.value) return '';
  const s = summary.value;
  return t('repo.summary', { total: s.total, withLocal: s.withLocal, missing: s.missing })
    + (s.unknown ? t('repo.summaryUnknown', { n: s.unknown }) : '')
    + (s.mirrored ? t('repo.summaryMirror', { n: s.mirrored }) : '');
});

const rowSelection = computed(() => ({
  selectedRowKeys: selectedKeys.value,
  onChange: (keys) => { selectedKeys.value = keys; },
}));

function pruneSelection() {
  const live = new Set(rows.value.map((r) => r.path));
  selectedKeys.value = selectedKeys.value.filter((k) => live.has(k));
}

async function scan() {
  scanning.value = true;
  try {
    const r = await api.scan(root.value || defaultRoot(), depth.value);
    rows.value = r.rows;
    summary.value = r.summary;
    scanned.value = true;
    pruneSelection();
  } catch (e) {
    message.error(e.message);
  } finally {
    scanning.value = false;
  }
}

function defaultRoot() {
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
  if (!root.value.trim()) { message.warning(t('repo.needDefaultRoot')); return; }
  try {
    await api.saveSettings({ scanRoot: root.value.trim(), scanDepth: depth.value });
    message.success(t('repo.savedDefault', { root: root.value.trim(), depth: depth.value }));
    emit('changed');
  } catch (e) {
    message.error(e.message);
  }
}

async function clearDefault() {
  try {
    await api.saveSettings({ scanRoot: '' });
    message.success(t('repo.clearedDefault'));
    emit('changed');
  } catch (e) {
    message.error(e.message);
  }
}

async function changeRepoIdentity(record, val) {
  try {
    if (val === INHERIT) {
      await api.unsetLocal(record.path);
      message.success(t('repo.inheritDone', { rel: record.rel }));
      emit('changed');
    } else {
      await api.applyLocal(record.path, val);
      message.success(t('repo.localDone', { rel: record.rel, id: val }));
    }
    await scan();
  } catch (e) {
    message.error(e.message);
  }
}

function selectMissing() {
  selectedKeys.value = rows.value.filter((r) => r.status === 'missing').map((r) => r.path);
}

function confirmImport() {
  Modal.confirm({
    title: t('repo.importTitle'),
    content: t('repo.importConfirm', { n: unknownCount.value }),
    okText: t('common.ok'),
    cancelText: t('common.cancel'),
    async onOk() { await doImport(); },
  });
}

async function doImport() {
  try {
    const r = await api.importScan(root.value || defaultRoot(), depth.value, false);
    const n = (r.imported || []).length;
    const skipped = (r.skipped || []).length;
    if (n === 0 && skipped === 0) message.info(t('repo.importedNone'));
    else message.success(t('repo.imported', { n, skipped }));
    emit('changed');
    await scan();
  } catch (e) {
    message.error(e.message);
  }
}

const batch = reactive({ open: false, id: undefined, missingOnly: true, loading: false });
const batchTargets = computed(() => {
  const selected = rows.value.filter((r) => selectedKeys.value.includes(r.path));
  return batch.missingOnly ? selected.filter((r) => r.status === 'missing') : selected;
});

function openBatch() {
  batch.id = (identityOptions.value[0] && identityOptions.value[0].id) || undefined;
  batch.missingOnly = true;
  batch.open = true;
}

async function doBatch() {
  if (!batch.id) { message.warning(t('repo.batchNeedId')); return; }
  const repos = batchTargets.value.map((r) => r.path);
  if (!repos.length) { message.warning(t('repo.batchNeedRepos')); return; }
  batch.loading = true;
  try {
    const r = await api.applyLocalBatch(batch.id, repos);
    const results = (r && r.results) || [];
    const okN = results.filter((x) => x.ok).length;
    const fail = results.length - okN;
    message.success(t('repo.batchDone', { id: batch.id, ok: okN, fail }));
    batch.open = false;
    emit('changed');
    await scan();
  } catch (e) {
    message.error(e.message);
  } finally {
    batch.loading = false;
  }
}

async function onExport({ key }) {
  const format = key;
  try {
    const data = await api.exportScan(
      root.value || defaultRoot(),
      depth.value,
      format,
      { rows: rows.value, summary: summary.value },
    );
    const ext = format === 'markdown' ? 'md' : format;
    const saved = await api.saveFile({
      defaultPath: `gitid-scan.${ext}`,
      content: data.text,
      filters: [{ name: format.toUpperCase(), extensions: [ext] }],
    });
    if (saved) message.success(t('repo.exported', { path: saved }));
    else message.info(t('repo.exportCanceled'));
  } catch (e) {
    message.error(e.message);
  }
}

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
  if (!mirrorModal.url.trim()) { message.warning(t('repo.needMirrorUrl')); return; }
  mirrorModal.loading = true;
  try {
    await api.setMirror(mirrorModal.repo.path, mirrorModal.remote, mirrorModal.url.trim());
    message.success(t('repo.mirrorOn', { rel: mirrorModal.repo.rel, remote: mirrorModal.remote }));
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
    message.success(t('repo.mirrorOff', { rel: mirrorModal.repo.rel, remote: mirrorModal.remote }));
    mirrorModal.open = false;
    await scan();
  } catch (e) {
    message.error(e.message);
  }
}

const audit = reactive({
  open: false, repo: null, expectId: undefined, authors: [], mailmap: '', loading: false,
});
const auditColumns = computed(() => [
  { title: t('repo.colCount'), key: 'count', dataIndex: 'count', width: 72 },
  { title: t('repo.colAuthor'), key: 'name', dataIndex: 'name', width: 120 },
  { title: t('repo.colAuthorEmail'), key: 'email', dataIndex: 'email' },
  { title: t('repo.colMatch'), key: 'match', width: 110 },
  { title: t('repo.colPolluted'), key: 'polluted', width: 72 },
]);

async function openAudit(record) {
  audit.repo = record;
  audit.expectId = localIdentityId(record) || undefined;
  audit.open = true;
  await reloadAudit();
}

async function reloadAudit() {
  if (!audit.repo) return;
  audit.loading = true;
  try {
    const r = await api.auditRepo(audit.repo.path, audit.expectId || undefined);
    audit.authors = (r.authors || []).map((a, i) => ({ ...a, rowKey: `${a.name}|${a.email}|${i}` }));
    audit.mailmap = r.mailmapSuggestion || '';
  } catch (e) {
    message.error(e.message);
  } finally {
    audit.loading = false;
  }
}

async function copyMailmap() {
  try {
    await navigator.clipboard.writeText(audit.mailmap);
    message.success(t('repo.copied'));
  } catch (e) {
    message.error(t('repo.copyFailed', { error: e.message }));
  }
}

onMounted(() => {
  const flags = api.getFlags();
  if (flags.scanRoot) { root.value = flags.scanRoot; scan(); }
});
</script>

<style scoped>
.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.actions-bar { justify-content: flex-start; }
.dim { color: #94a3b8; }
.mono { font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: 13px; }
.hint { padding: 32px 0; text-align: center; }
.mb { margin-bottom: 12px; }
.manual-local :deep(.ant-select-selection-item) { color: #d46b08; }
.remote-tag { font-size: 12px; margin-right: 0; }
.mirror-note { font-size: 12px; margin-top: -8px; }
.batch-list { max-height: 200px; overflow: auto; padding-left: 20px; }
.copy-btn { margin-top: 8px; }
</style>
