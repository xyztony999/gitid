<template>
  <a-config-provider :locale="zhCN">
    <a-layout class="app">
      <a-layout-header class="app-header">
        <div class="brand">
          <img src="./assets/logo.png" class="brand-icon" alt="gitid" v-if="iconOk" @error="iconOk = false" />
          <span class="brand-name">gitid</span>
          <span class="brand-sub">Git 多身份管理器</span>
        </div>
        <div class="header-right">
          <a-tag v-if="globalTag.color" :color="globalTag.color" class="global-tag">
            全局：{{ globalTag.text }}
          </a-tag>
          <a-tooltip :title="`身份档案：${store.configPath || '…'}`">
            <a-button size="small" @click="refresh" :loading="loading">
              <template #icon><ReloadOutlined /></template>
              刷新
            </a-button>
          </a-tooltip>
        </div>
      </a-layout-header>
      <a-layout-content class="app-body">
        <a-tabs v-model:activeKey="tab" class="app-tabs" size="large">
          <a-tab-pane key="identities" tab="身份管理">
            <IdentityView :store="store" @changed="refresh" />
          </a-tab-pane>
          <a-tab-pane key="repos" tab="仓库审计">
            <RepoView :store="store" @changed="refresh" />
          </a-tab-pane>
        </a-tabs>
      </a-layout-content>
    </a-layout>
  </a-config-provider>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { message } from 'ant-design-vue';
import { ReloadOutlined } from '@ant-design/icons-vue';
import zhCN from 'ant-design-vue/es/locale/zh_CN';
import IdentityView from './views/IdentityView.vue';
import RepoView from './views/RepoView.vue';
import { api } from './api.js';

const flags = (window.gitid && window.gitid.getFlags) ? window.gitid.getFlags() : { tab: '', scanRoot: '' };
const tab = ref(flags.tab === 'repos' ? 'repos' : 'identities');
const store = ref({ identities: [], global: {}, configPath: '' });
const loading = ref(false);
const iconOk = ref(true);

const globalTag = computed(() => {
  const g = store.value.global || {};
  if (g.identityId) {
    const it = store.value.identities.find((x) => x.id === g.identityId);
    return { color: 'green', text: it ? `${g.identityId} · ${it.name}` : g.identityId };
  }
  if (g.name !== undefined || g.email !== undefined) return { color: 'orange', text: `未匹配档案 · ${g.name || '?'} <${g.email || '?'}>` };
  return { color: 'red', text: '未配置 user.name/email' };
});

async function refresh() {
  loading.value = true;
  try {
    store.value = await api.getStore();
  } catch (e) {
    message.error(`读取身份档案失败：${e.message}`);
  } finally {
    loading.value = false;
  }
}

let off = null;
onMounted(async () => {
  await refresh();
  // CLI 侧改动（gitid add/use 等）实时同步到界面
  off = api.onStoreUpdated((payload) => { store.value = payload; });
});
onUnmounted(() => off && off());
</script>

<style>
* { margin: 0; padding: 0; }
html, body, #app { height: 100%; }
.app { height: 100%; background: #f5f6f8; }

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

.app-body { padding: 16px 24px 24px; overflow: auto; }
.app-tabs > .ant-tabs-nav { margin-bottom: 16px; background: transparent; }
</style>
