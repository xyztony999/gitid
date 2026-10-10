<template>
  <a-config-provider :locale="antdLocale" :theme="themeConfig">
    <a-layout class="app">
      <a-layout-header class="app-header">
        <div class="brand">
          <img src="./assets/logo.png" class="brand-icon" alt="gitid" v-if="iconOk" @error="iconOk = false" />
          <span class="brand-name">gitid</span>
          <span class="brand-sub">{{ t('app.subtitle') }}</span>
        </div>
        <div class="header-right">
          <a-select
            :value="locale"
            size="small"
            class="locale-select"
            @change="changeLocale"
          >
            <a-select-option value="zh">中文</a-select-option>
            <a-select-option value="en">EN</a-select-option>
          </a-select>
          <a-button size="small" @click="openDoctor">{{ t('app.doctor') }}</a-button>
          <a-tag v-if="globalTag.color" :color="globalTag.color" class="global-tag">
            {{ t('app.globalPrefix', { text: globalTag.text }) }}
          </a-tag>
          <a-tooltip :title="t('app.refreshTitle', { path: store.configPath || '…' })">
            <a-button size="small" @click="refresh" :loading="loading">
              <template #icon><ReloadOutlined /></template>
              {{ t('app.refresh') }}
            </a-button>
          </a-tooltip>
        </div>
      </a-layout-header>
      <a-alert
        v-if="updateInfo.updateAvailable"
        type="info"
        show-icon
        banner
        class="update-banner"
        :message="t('app.updateMessage', { version: updateInfo.releaseName || updateInfo.version || '' })"
      >
        <template #action>
          <a-space>
            <a-button size="small" type="primary" @click="installUpdate">{{ t('app.updateRestart') }}</a-button>
            <a-button size="small" @click="dismissUpdate">{{ t('app.updateLater') }}</a-button>
          </a-space>
        </template>
      </a-alert>
      <a-layout-content class="app-body">
        <a-tabs v-model:activeKey="tab" class="app-tabs" size="large">
          <a-tab-pane key="identities" :tab="t('app.tabIdentities')">
            <IdentityView :store="store" @changed="refresh" />
          </a-tab-pane>
          <a-tab-pane key="repos" :tab="t('app.tabRepos')">
            <RepoView :store="store" @changed="refresh" />
          </a-tab-pane>
          <a-tab-pane key="credentials" :tab="t('app.tabCredentials')">
            <CredentialView />
          </a-tab-pane>
        </a-tabs>
      </a-layout-content>
    </a-layout>

    <a-modal
      v-model:open="doctorOpen"
      :title="t('app.doctorTitle')"
      :footer="null"
      width="640"
    >
      <div class="doctor-head">
        <a-tag :color="doctorLevelColor">{{ t(`app.level.${doctorLevel}`) }}</a-tag>
      </div>
      <a-table
        :columns="doctorColumns"
        :data-source="doctorRows"
        :pagination="false"
        row-key="id"
        size="small"
        :loading="doctorLoading"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'level'">
            <a-tag :color="levelColor(record.level)">{{ t(`app.level.${record.level}`) }}</a-tag>
          </template>
          <template v-else-if="column.key === 'check'">{{ t(`app.check.${record.id}`) }}</template>
          <template v-else-if="column.key === 'detail'">{{ record.message }}<span v-if="record.detail && record.detail !== record.message" class="dim"> · {{ record.detail }}</span></template>
        </template>
      </a-table>
      <div class="doctor-actions">
        <a-space>
          <a-button type="primary" :loading="doctorLoading" @click="loadDoctor">{{ t('app.doctorRecheck') }}</a-button>
          <a-button @click="doctorOpen = false">{{ t('app.doctorClose') }}</a-button>
        </a-space>
      </div>
    </a-modal>
  </a-config-provider>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { message, theme } from 'ant-design-vue';
import { ReloadOutlined } from '@ant-design/icons-vue';
import zhCN from 'ant-design-vue/es/locale/zh_CN';
import enUS from 'ant-design-vue/es/locale/en_US';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import 'dayjs/locale/en';
import IdentityView from './views/IdentityView.vue';
import RepoView from './views/RepoView.vue';
import CredentialView from './views/CredentialView.vue';
import { api } from './api.js';
import { locale, setLocale, t } from './i18n.js';

const dark = ref(typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-color-scheme: dark)').matches);
const themeConfig = computed(() => ({
  algorithm: dark.value ? theme.darkAlgorithm : theme.defaultAlgorithm,
}));
const mql = typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-color-scheme: dark)') : null;
const onSchemeChange = (e) => { dark.value = e.matches; };
watch(dark, (v) => document.documentElement.classList.toggle('dark', v), { immediate: true });

const antdLocale = computed(() => (locale.value === 'en' ? enUS : zhCN));
watch(locale, (v) => { dayjs.locale(v === 'en' ? 'en' : 'zh-cn'); }, { immediate: true });

const flags = api.getFlags();
const tab = ref(flags.tab === 'repos' ? 'repos' : 'identities');
const store = ref({ identities: [], global: {}, configPath: '', settings: {} });
const loading = ref(false);
const iconOk = ref(true);
const updateInfo = ref({ updateAvailable: false });
const doctorOpen = ref(false);
const doctorLoading = ref(false);
const doctorRows = ref([]);

const globalTag = computed(() => {
  const g = store.value.global || {};
  if (g.identityId) {
    const it = store.value.identities.find((x) => x.id === g.identityId);
    return { color: 'green', text: it ? `${g.identityId} · ${it.name}` : g.identityId };
  }
  if (g.name !== undefined || g.email !== undefined) {
    return { color: 'orange', text: t('app.globalUnmatched', { name: g.name || '?', email: g.email || '?' }) };
  }
  return { color: 'red', text: t('app.globalUnset') };
});

const doctorColumns = computed(() => [
  { title: t('app.doctorLevel'), key: 'level', width: 90 },
  { title: t('app.doctorCheck'), key: 'check', width: 160 },
  { title: t('app.doctorDetail'), key: 'detail' },
]);

const doctorLevel = computed(() => {
  const levels = doctorRows.value.map((r) => r.level);
  if (levels.includes('fail')) return 'fail';
  if (levels.includes('warn')) return 'warn';
  return 'ok';
});
const doctorLevelColor = computed(() => levelColor(doctorLevel.value));

function levelColor(level) {
  if (level === 'fail') return 'red';
  if (level === 'warn') return 'orange';
  return 'green';
}

async function refresh() {
  loading.value = true;
  try {
    store.value = await api.getStore();
  } catch (e) {
    message.error(t('app.readStoreFailed', { error: e.message }));
  } finally {
    loading.value = false;
  }
}

async function changeLocale(next) {
  setLocale(next);
  try {
    await api.saveSettings({ locale: next });
  } catch (e) {
    message.error(t('app.localeSaveFailed', { error: e.message }));
  }
}

async function loadDoctor() {
  doctorLoading.value = true;
  try {
    const r = await api.runDoctor();
    doctorRows.value = (r.checks || []).map((c) => ({
      id: c.id,
      level: c.level === 'fail' || c.level === 'warn' ? c.level : 'ok',
      message: c.message || '',
      detail: c.detail || '',
    }));
  } catch (e) {
    message.error(e.message);
  } finally {
    doctorLoading.value = false;
  }
}

async function openDoctor() {
  doctorOpen.value = true;
  await loadDoctor();
}

async function installUpdate() {
  try {
    await api.quitAndInstall();
  } catch (e) {
    message.error(e.message);
  }
}

function dismissUpdate() {
  updateInfo.value = { updateAvailable: false };
}

watch(() => store.value.settings && store.value.settings.locale, (v) => {
  if (v === 'en' || v === 'zh') setLocale(v);
});

let off = null;
let offUpdate = null;
onMounted(async () => {
  if (mql) mql.addEventListener('change', onSchemeChange);
  await refresh();
  off = api.onStoreUpdated((payload) => { store.value = payload; });
  offUpdate = api.onUpdateAvailable((payload) => { if (payload) updateInfo.value = payload; });
  try {
    const u = await api.checkUpdate();
    if (u) updateInfo.value = u;
  } catch { /* 开发/无网络不当成故障 */ }
});
onUnmounted(() => {
  if (mql) mql.removeEventListener('change', onSchemeChange);
  if (off) off();
  if (offUpdate) offUpdate();
});
</script>

<style>
* { margin: 0; padding: 0; }
:root { --app-bg: #f5f6f8; }
html.dark { --app-bg: #0f1115; }
html, body, #app { height: 100%; }
body { background: var(--app-bg); }
.app { height: 100%; background: var(--app-bg); }

.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #0f172a;
  padding: 0 20px;
  height: 56px;
  line-height: 56px;
}
.brand { display: flex; align-items: center; gap: 10px; }
.brand-icon { width: 28px; height: 28px; }
.brand-name { color: #f8fafc; font-size: 20px; font-weight: 700; letter-spacing: 0.5px; }
.brand-sub { color: #94a3b8; font-size: 13px; }
.header-right { display: flex; align-items: center; gap: 12px; }
.global-tag { font-size: 13px; padding: 3px 10px; margin: 0; }
.locale-select { width: 84px; }
.update-banner { padding: 8px 24px; }
.doctor-head { margin-bottom: 12px; }
.doctor-actions { margin-top: 16px; text-align: right; }
.dim { color: #94a3b8; }

.app-body { padding: 16px 24px 24px; overflow: auto; }
.app-tabs > .ant-tabs-nav { margin-bottom: 16px; background: transparent; }
</style>
