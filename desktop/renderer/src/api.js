// 渲染层 IPC 封装：统一解开 {ok, data|error}
export async function call(fn, ...args) {
  const r = await fn(...args);
  if (!r || r.ok !== true) {
    throw new Error((r && r.error) || 'IPC 调用失败');
  }
  return r.data;
}

export const api = {
  getStore: () => call(window.gitid.getStore),
  saveIdentity: (id, fields) => call(window.gitid.saveIdentity, id, fields),
  removeIdentity: (id) => call(window.gitid.removeIdentity, id),
  applyGlobal: (id) => call(window.gitid.applyGlobal, id),
  applyLocal: (repo, id) => call(window.gitid.applyLocal, repo, id),
  unsetLocal: (repo) => call(window.gitid.unsetLocal, repo),
  importGlobal: () => call(window.gitid.importGlobal),
  scan: (root, depth) => call(window.gitid.scan, root, depth),
  saveSettings: (patch) => call(window.gitid.saveSettings, patch),
  pickDirectory: () => call(window.gitid.pickDirectory),
  onStoreUpdated: (cb) => window.gitid.onStoreUpdated(cb),
};
