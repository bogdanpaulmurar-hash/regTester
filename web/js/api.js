// Data access. RemoteApi talks to the Python server; DemoApi keeps everything in the
// browser (used when the page is opened without the server, e.g. the phone preview).
import { DemoApi } from './demo.js';
import { t } from './i18n.js';
import { store } from './util.js';

// server error codes with a translated explanation (err_<code> in i18n.js)
const KNOWN = new Set(['read_only', 'busy', 'shared_unavailable', 'shared_not_found', 'shared_not_writable',
  'shared_init_required', 'shared_no_db']);

class HttpError extends Error {
  constructor(status, body) {
    const code = body?.code || body?.error;
    super(KNOWN.has(code) ? t('err_' + code) : (body?.error || `HTTP ${status}`));
    this.status = status; this.body = body; this.code = code;
  }
}

class RemoteApi {
  constructor() { this.demo = false; this.token = store('token') || null; }

  async req(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers.Authorization = 'Bearer ' + this.token;
    const res = await fetch('/api/' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let data = null;
    try { data = await res.json(); } catch { if (res.ok) throw new HttpError(res.status, { error: 'incomplete response' }); }
    if (!res.ok) {
      if (res.status === 401 && path !== 'login') { this.token = null; store('token', null); window.dispatchEvent(new Event('rt-auth')); }
      throw new HttpError(res.status, data);
    }
    return data;
  }

  publicSettings() { return this.req('GET', 'public-settings'); }
  async login(username, password) {
    const r = await this.req('POST', 'login', { username, password });
    this.token = r.token; store('token', r.token); return r.user;
  }
  async logout() { try { await this.req('POST', 'logout'); } finally { this.token = null; store('token', null); } }
  me() { return this.req('GET', 'me'); }
  updateMe(data) { return this.req('PUT', 'me', data); }

  list(section) { return this.req('GET', 'records?section=' + encodeURIComponent(section)); }
  create(section, record) { return this.req('POST', 'records', { section, record }); }
  update(id, record, version) { return this.req('PUT', 'records/' + id, { record, version }); }
  remove(id) { return this.req('DELETE', 'records/' + id); }
  importRecords(section, filename, records, mode) { return this.req('POST', 'import', { section, filename, records, mode }); }
  imports(section) { return this.req('GET', 'imports' + (section ? '?section=' + section : '')); }
  history(params = {}) { return this.req('GET', 'history?' + new URLSearchParams(params)); }
  restore(history_id) { return this.req('POST', 'history/restore', { history_id }); }

  settings() { return this.req('GET', 'settings'); }
  saveSettings(values) { return this.req('PUT', 'settings', values); }
  logs(params = {}) { return this.req('GET', 'logs?' + new URLSearchParams(params)); }
  log(level, message) { return this.req('POST', 'logs', { level, message }).catch(() => {}); }
  system() { return this.req('GET', 'system'); }
  quit() { return this.req('POST', 'system/quit'); }
  setLogo(data_url) { return this.req('POST', 'logo', { data_url }); }
  resetLogo() { return this.req('POST', 'logo', { reset: true }); }
  logoUrl() { return '/logo.png?v=' + Date.now(); }

  users() { return this.req('GET', 'users'); }
  createUser(u) { return this.req('POST', 'users', u); }
  updateUser(name, u) { return this.req('PUT', 'users/' + encodeURIComponent(name), u); }
  deleteUser(name) { return this.req('DELETE', 'users/' + encodeURIComponent(name)); }
  shared() { return this.req('GET', 'shared'); }
  sharedCheck(path) { return this.req('POST', 'shared/check', { path }); }
  sharedConnect(path, init) { return this.req('POST', 'shared/connect', { path, init }); }
  sharedSetup(path) { return this.req('POST', 'shared/setup', { path }); }
  sharedDisconnect() { return this.req('POST', 'shared/disconnect', {}); }
  sharedUnlock() { return this.req('POST', 'shared/unlock', {}); }
  backups() { return this.req('GET', 'backups'); }
  backupNow() { return this.req('POST', 'backups'); }
  restoreBackup(name) { return this.req('POST', 'backups/restore', { name }); }
}

export async function connect() {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 2500);
    const res = await fetch('/api/health', { signal: ctl.signal, cache: 'no-store' });
    clearTimeout(timer);
    const j = res.ok ? await res.json() : null;
    if (j && j.app === 'regTester') { const api = new RemoteApi(); api.serverVersion = j.version || ''; return api; }
  } catch { /* no server: fall through to demo */ }
  return new DemoApi();
}

export { HttpError };
