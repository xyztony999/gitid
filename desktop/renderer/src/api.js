// 渲染层 IPC 封装：统一解开 {ok, data|error}
export async function call(fn, ...args) {
  const r = await fn(...args);
  if (!r || r.ok !== true) {
    throw new Error((r && r.error) || 'IPC 调用失败');
  }
  return r.data;
}

export const api = {
  getFlags: () => (window.gitid && window.gitid.getFlags ? window.gitid.getFlags() : { tab: '', scanRoot: '' }),
  getStore: () => call(window.gitid.getStore),
  saveIdentity: (id, fields) => call(window.gitid.saveIdentity, id, fields),
  removeIdentity: (id) => call(window.gitid.removeIdentity, id),
  bindIdentity: (payload) => call(window.gitid.bindIdentity, payload),
  unbindIdentity: (payload) => call(window.gitid.unbindIdentity, payload),
  applyGlobal: (id) => call(window.gitid.applyGlobal, id),
  applyLocal: (repo, id) => call(window.gitid.applyLocal, repo, id),
  unsetLocal: (repo) => call(window.gitid.unsetLocal, repo),
  importGlobal: () => call(window.gitid.importGlobal),
  importScan: (root, depth, dryRun) => call(window.gitid.importScan, root, depth, dryRun),
  applyLocalBatch: (id, repos) => call(window.gitid.applyLocalBatch, id, repos),
  scan: (root, depth) => call(window.gitid.scan, root, depth),
  auditRepo: (repo, expectId) => call(window.gitid.auditRepo, repo, expectId),
  exportScan: (root, depth, format, report) => call(window.gitid.exportScan, root, depth, format, report),
  setMirror: (repo, remote, url) => call(window.gitid.setMirror, repo, remote, url),
  clearMirror: (repo, remote) => call(window.gitid.clearMirror, repo, remote),
  runDoctor: () => call(window.gitid.runDoctor),
  credentialList: () => call(window.gitid.credentialList),
  credentialSet: (host, username, token) => call(window.gitid.credentialSet, host, username, token),
  credentialLogin: (host, username) => call(window.gitid.credentialLogin, host, username),
  credentialRemove: (host, username) => call(window.gitid.credentialRemove, host, username),
  saveSettings: (patch) => call(window.gitid.saveSettings, patch),
  pickDirectory: () => call(window.gitid.pickDirectory),
  saveFile: (opts) => call(window.gitid.saveFile, opts),
  checkUpdate: () => call(window.gitid.checkUpdate),
  quitAndInstall: () => call(window.gitid.quitAndInstall),
  onStoreUpdated: (cb) => window.gitid.onStoreUpdated(cb),
  onUpdateAvailable: (cb) => window.gitid.onUpdateAvailable(cb),
};
