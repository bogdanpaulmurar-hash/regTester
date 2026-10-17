// Browser-only backend used when no regTester server answers (phone preview, quick look).
// Same interface as RemoteApi; data lives in this browser's storage and starts with fictional examples.
import { generateYear } from './timeline-gen.js';
import { uid } from './util.js';

const KEY = 'rt.demo.v2';
const now = () => Date.now() / 1000;

export const DEFAULT_TEMPLATE = {
  kind: 'template', key: 'TPL-NEW-FEATURE', title: 'New function / Funcție nouă',
  data: {
    sections: [
      { id: 'purpose', label: 'Purpose', required: true, type: 'textarea', hint: 'What the function does, in one or two sentences.' },
      { id: 'users', label: 'Users and roles', required: true, type: 'text', hint: 'Who can use it; role limits.' },
      { id: 'pre', label: 'Preconditions', required: true, type: 'textarea', hint: 'Data and settings needed before the test.' },
      { id: 'steps', label: 'Test steps', required: true, type: 'list', hint: 'One step per line.' },
      { id: 'expected', label: 'Expected result', required: true, type: 'textarea', hint: 'What the tester must see.' },
      { id: 'risk', label: 'Regression risk', required: false, type: 'textarea', hint: 'Existing areas this change can break.' },
    ],
  },
};

function seed() {
  const recs = [];
  const add = (section, r) => recs.push({ id: uid(), section, kind: '', key: '', title: '', body: '', data: {}, tags: [], version: 1,
    created_at: now() - 86400 * 20, updated_at: now() - 86400 * 2, created_by: 'demo', updated_by: 'demo', import_id: null, ...r });

  generateYear({ start: '2026-01-05', sprints: 26, sprintWeeks: 2, firstNumber: 31, prefix: 'Sprint', sprintsPerRelease: 3,
    releasePrefix: 'R', releaseStart: 1, year: 2026, freezeDays: 1, regtestDays: 7, qaDays: 4, deployGapDays: 1,
    holidays: ['2026-01-01', '2026-01-02', '2026-04-03', '2026-04-06', '2026-05-01', '2026-05-14', '2026-05-25', '2026-10-03', '2026-12-24', '2026-12-25', '2026-12-31'] })
    .forEach(e => add('timeline', e));

  const features = [
    ['FN-1042', 'Export PDF facturi', 'S39', 'Invoice'], ['FN-1051', 'Filtru avansat clienți', 'S40', 'Invoice'],
    ['FN-1055', 'Import comenzi din CSV', 'S40', 'Orders'], ['FN-1060', 'Notificări e-mail scadență', 'S41', 'Invoice'],
    ['FN-1033', 'Arhivare automată documente', 'S39', 'Archive'], ['FN-1036', 'Rol nou Auditor', 'S39', 'Admin'],
    ['FN-1047', 'Câmp Centru de cost pe comenzi', 'S40', 'Orders'], ['FN-1058', 'Dashboard stocuri', 'S41', 'Stock'],
    ['FN-1062', 'Limba germană în rapoarte', 'S41', 'Reports'],
  ];
  features.forEach(([key, title, sprint, module]) => add('features', { key, title, data: { sprint, release: 'R-2026.4', module, description: '' } }));

  const tests = [
    ['TC-2201', 'FN-1055 import orders csv happy path', 'Orders'], ['TC-2202', 'FN-1055 import orders wrong delimiter', 'Orders'],
    ['TC-2210', 'FN-1060 reminder mail 3 days before due', 'Invoice'], ['TC-2215', 'FN-1033 archive after 90 days', 'Archive'],
    ['TC-2216', 'FN-1036 auditor read only access', 'Admin'], ['TC-2220', 'FN-1047 cost center mandatory on order', 'Orders'],
    ['TC-2224', 'FN-1058 stock dashboard totals', 'Stock'], ['TC-2230', 'FN-1062 report labels in German', 'Reports'],
    ['TC-1800', 'Invoice VAT total rounding', 'Invoice'], ['TC-1801', 'Customer K-77 order flow', 'Orders'],
  ];
  tests.forEach(([key, title, module]) => add('tests', { key, title, data: { module, status: 'ready' } }));

  const specs = [
    ['spec', 'SP-310', 'Invoice filter by region and cost center (FN-1051)', 'Invoice list gets two new filters: customer region and cost center. Filters combine with AND. Empty cost center is shown as (none).', 'open', 'Invoice'],
    ['spec', 'SP-311', 'Archive retention rules', 'Documents are archived automatically 90 days after closing. Auditor role can read archived documents. FN-1033', 'done', 'Archive'],
    ['spec', 'SP-312', 'Auditor role permissions (FN-1036)', 'Read only access to invoices, orders and archive. No export of personal data.', 'done', 'Admin'],
    ['spec', 'SP-313', 'Cost center field on orders (FN-1047)', 'Mandatory field for new orders, optional for orders created before release R-2026.4.', 'done', 'Orders'],
    ['spec', 'SP-314', 'Stock dashboard (FN-1058)', 'Totals per warehouse, refreshed every 15 minutes, red when below minimum stock.', 'done', 'Stock'],
    ['spec', 'SP-315', 'German labels in reports (FN-1062)', 'All report labels translated; numbers formatted 1.234,56.', 'done', 'Reports'],
    ['spec', 'SP-316', 'Import orders from CSV (FN-1055)', 'Semicolon or comma delimiter, UTF-8, max 5 000 lines per file, error report per line.', 'done', 'Orders'],
    ['procedure', 'PR-120', 'Regtest preparation in sandbox', '1. Refresh sandbox from production copy\n2. Anonymise customer data\n3. Load test customers K-70..K-80\n4. Check interfaces are pointed to test endpoints\n5. Run smoke test set', 'done', 'General'],
    ['procedure', 'PR-121', 'Procedure: Archive automatic run (FN-1033)', 'Start the archive job manually in sandbox, check log, verify document status Archived.', 'done', 'Archive'],
    ['procedure', 'PR-122', 'Procedure: Auditor role setup (FN-1036)', 'Create user with role Auditor; verify menus visible; try edit and expect refusal.', 'done', 'Admin'],
    ['procedure', 'PR-123', 'Procedure: Stock dashboard check (FN-1058)', 'Compare dashboard totals with stock report for 3 warehouses.', 'done', 'Stock'],
    ['procedure', 'PR-124', 'Procedure: Filter customers in invoices (FN-1051)', 'Apply region Nord and cost center CC-200, compare with saved query.', 'done', 'Invoice'],
    ['procedure', 'PR-125', 'Procedure: German report check (FN-1062)', 'Switch user language to DE, print 3 reports, compare labels with glossary.', 'done', 'Reports'],
    ['bug', 'BUG-2231', 'Rounding difference 0.01 in VAT total', 'VAT total differs by 0.01 when invoice has more than 20 lines with 19% VAT. Workaround: none. Fixed in R-2026.5.', 'open', 'Invoice'],
    ['bug', 'BUG-2240', 'Session expires during long test step', 'Session timeout 10 min hits long regtest step 5 in order flow; intermittent.', 'open', 'Orders'],
    ['bug', 'BUG-2102', 'PDF export blank page with long customer names', 'Customer names longer than 80 chars produce an empty second page. Closed in R-2026.2.', 'closed', 'Invoice'],
    ['issue', 'ISS-88', 'Sandbox refresh takes 6 hours', 'Refresh job is slow since the database grew; ask ops for weekend slot.', 'open', 'General'],
    ['issue', 'ISS-91', 'Test customer K-77 missing after refresh', 'Customer K-77 is not part of the production copy anymore; recreate with script before regtest.', 'open', 'General'],
  ];
  specs.forEach(([kind, key, title, body, status, module]) => add('specs', { kind, key, title, body, tags: [module.toLowerCase()], data: { status, module, release: 'R-2026.4' } }));

  const baseTests = ['TC-1800', 'TC-1801', 'TC-2201', 'TC-2202', 'TC-2210', 'TC-2215', 'TC-2216', 'TC-2220', 'TC-2224', 'TC-2230'];
  const mkRun = (date, fails) => ({
    title: `Regtest ${date}`, data: {
      date, source: `rezultate_regtest_${date}.csv`,
      results: [...baseTests, ...Array.from({ length: 40 }, (_, i) => `TC-${3000 + i}`)].map(test => {
        const f = fails[test];
        return f ? { test, status: 'failed', message: f } : { test, status: 'passed', message: '' };
      }),
    },
  });
  add('runs', mkRun('2026-10-10', { 'TC-1800': 'Rounding diff 0.01 in VAT total (expected 1190.00, got 1190.01)', 'TC-1801': 'Test data missing: customer K-77', 'TC-3004': 'Session expired during step 5' }));
  add('runs', mkRun('2026-10-17', { 'TC-1800': 'Rounding diff 0.01 in VAT total (expected 2380.00, got 2380.01)', 'TC-1801': 'Test data missing: customer K-77', 'TC-2230': "Label text changed: 'Rechnung' expected 'Invoice'" }));
  add('runs', mkRun('2026-10-24', {
    'TC-1800': 'Rounding diff 0.01 in VAT total (expected 595.00, got 595.01)', 'TC-1801': 'Test data missing: customer K-77',
    'TC-3004': 'Session expired during step 5', 'TC-2220': "Field 'CostCenter' is mandatory (order 88123)", 'TC-2201': "Field 'CostCenter' is mandatory (order 88130)",
    'TC-3011': 'PDF render timeout after 30s', 'TC-3012': 'PDF render timeout after 30s', 'TC-3013': 'PDF render timeout after 31s', 'TC-2230': "Label text changed: 'Rechnung' expected 'Invoice'",
  }));
  add('known', { title: 'Rounding diff 0.01 in VAT total', data: { pattern: 'rounding diff 0.01 in vat total', reason: 'Known bug, fixed in R-2026.5', bug: 'BUG-2231' } });
  add('known', { title: 'Test data missing: customer K-77', data: { pattern: 'test data missing: customer k-77', reason: 'Recreate before regtest (ISS-91)', bug: 'ISS-91' } });
  add('known', { title: 'Label text changed', data: { pattern: 'label text changed', reason: 'Accepted: new German labels', bug: '' } });

  [['in voice', 'Invoice'], ['custom are', 'customer'], ['cost centre', 'cost center'], ['reg test', 'regtest'], ['sales order', 'Kundenauftrag']]
    .forEach(([wrong, right]) => add('glossary', { title: wrong, data: { wrong, right } }));

  add('docs', {
    kind: 'doc', key: 'FN-1051', title: 'Filtru avansat clienți', data: {
      templateId: null, complete: false, source: '',
      meta: { title: 'Filtru avansat clienți', code: 'FN-1051', sprint: 'S40', release: 'R-2026.4', module: 'Invoice' },
      values: {
        purpose: 'Lista de facturi poate fi filtrată după regiunea clientului și după centrul de cost.',
        users: 'Toate rolurile; export PDF doar admin.',
        pre: 'Client de test cu regiune și centru de cost completate (K-70..K-80).',
        steps: 'Deschide lista de facturi\nAplică filtrul Regiune = Nord\nAplică filtrul Centru de cost = CC-200',
        expected: '', risk: 'Căutarea salvată existentă din lista de facturi.',
      },
    },
  });
  add('transcripts', {
    title: 'Sprint 40 Review', data: {
      date: '2026-10-08', source: 'sprint40_review.vtt',
      raw: SAMPLE_VTT,
    },
  });
  return { records: recs, history: [], imports: [], logs: [], settings: {} };
}

export const SAMPLE_VTT = `WEBVTT

00:14:02.310 --> 00:14:05.120
<v Ravi K.>so so basically uh now the in voice module have new filter</v>

00:14:05.400 --> 00:14:09.800
<v Ravi K.>you can filter the custom are by region yeah yeah and by cost centre</v>

00:14:10.020 --> 00:14:12.900
<v Jonas M.>ähm und der Export geht dann auch als PDF?</v>

00:14:13.100 --> 00:14:16.400
<v Ravi K.>yes PDF only only for admin role for now</v>

00:14:17.000 --> 00:14:21.500
<v Ravi K.>and uh the reg test for this you know should check the totals per region</v>`;

const DEMO_SETTINGS = {
  language: 'ro', theme: 'auto', app_name: 'regTester', port: 8765, lan_access: false, require_login: false, autostart: false,
  start_minimized: true, open_browser_on_start: true, log_level: 'INFO', log_retention_days: 30, backup_on_start: true, backup_keep: 10,
  feature_code_regex: '\\b[A-Z]{2,5}-\\d{2,6}\\b', match_threshold: 0.5, flaky_window: 5,
  filler_words: 'uh, um, uhm, ähm, äh, hmm, basically, you know, like, so so, yeah yeah, okay okay, also also, sozusagen',
  ai_prompt: 'From the transcript below extract, for every new function:\n1. Function name 2. What it does 3. Who can use it\n4. Preconditions 5. What must be tested 6. Open questions\nAnswer in {language}. Do not invent anything that is not in the text.',
  timeline_colors: { sprint: '#2F6FB0', planning: '#7A5AA6', review: '#0F7C7C', deployment: '#B4441F', regtest: '#B07A12', qa: '#3B8B3B', freeze: '#5B6470', holiday: '#9AA3AE', other: '#6B7280' },
};

export class DemoApi {
  constructor() {
    this.demo = true;
    let s = null;
    try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { /* ignore */ }
    this.s = s || seed();
    this.user = { username: 'demo', display: 'Demo', role: 'admin', sections: ['*'], active: true, must_change: false };
    this.users_ = [this.user,
      { username: 'ana.pop', display: 'Ana Pop', role: 'editor', sections: ['*'], active: true, must_change: false, created_at: now() - 86400 * 30, last_login: now() - 3600 },
      { username: 'jonas.m', display: 'Jonas M.', role: 'viewer', sections: ['timeline', 'specs'], active: true, must_change: false, created_at: now() - 86400 * 10, last_login: null }];
    this._log('INFO', 'Demo mode started (no server)');
    this.save();
  }
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.s)); } catch { /* storage full or blocked */ } }
  reset() { this.s = seed(); this.save(); }
  _hist(section, record_id, action, summary, before, after) {
    this.s.history.unshift({ id: (this.s.history[0]?.id || 0) + 1, ts: now(), user: this.user.username, section, record_id, action, summary, before, after });
    this.s.history = this.s.history.slice(0, 2000);
  }
  _log(level, message, source = 'regtester.client') {
    const d = new Date(); const p = n => String(n).padStart(2, '0');
    this.s?.logs.unshift({ ts: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`, level, source, message });
    if (this.s) this.s.logs = this.s.logs.slice(0, 1000);
  }
  _clean(r) {
    let tags = r.tags || []; if (typeof tags === 'string') tags = tags.split(',').map(x => x.trim()).filter(Boolean);
    return { kind: String(r.kind || ''), key: String(r.key || ''), title: String(r.title || ''), body: String(r.body || ''), data: r.data && typeof r.data === 'object' ? r.data : {}, tags };
  }
  async publicSettings() { return { ...DEMO_SETTINGS, ...this.s.settings }; }
  async login() { return this.user; }
  async logout() {}
  async me() { return { user: this.user, pages: ['dashboard', 'timeline', 'coverage', 'triage', 'transcripts', 'docs', 'specs'] }; }
  async updateMe() { return { user: this.user }; }
  async list(section) { return this.s.records.filter(r => r.section === section && !r.deleted).map(r => structuredClone(r)); }
  async create(section, record) {
    const r = { id: record.id || uid(), section, ...this._clean(record), version: 1, created_at: now(), updated_at: now(), created_by: this.user.username, updated_by: this.user.username };
    this.s.records.push(r);
    this._hist(section, r.id, 'create', r.title.slice(0, 200), null, { id: r.id, ...this._clean(r) });
    this._log('INFO', `created ${section}/${r.id} '${r.title.slice(0, 60)}'`, 'regtester.server');
    this.save(); return structuredClone(r);
  }
  async update(id, record, version) {
    const r = this.s.records.find(x => x.id === id);
    if (!r) throw new Error('not found');
    if (version !== undefined && version !== null && version !== r.version) { const e = new Error('conflict'); e.status = 409; throw e; }
    const before = this._clean(r);
    const after = this._clean({ ...before, ...record });
    const changed = Object.keys(after).filter(k => JSON.stringify(after[k]) !== JSON.stringify(before[k]));
    if (!changed.length) return structuredClone(r);
    Object.assign(r, after, { version: r.version + 1, updated_at: now(), updated_by: this.user.username });
    this._hist(r.section, id, 'update', changed.join(', '), before, after);
    this._log('INFO', `updated ${r.section}/${id} v${r.version}`, 'regtester.server');
    this.save(); return structuredClone(r);
  }
  async remove(id) {
    const r = this.s.records.find(x => x.id === id);
    if (!r) throw new Error('not found');
    r.deleted = true;
    this._hist(r.section, id, 'delete', r.title.slice(0, 200), structuredClone(r), null);
    this.save(); return { ok: true };
  }
  async importRecords(section, filename, records, mode) {
    const import_id = uid(); let created = 0, updated = 0, removed = 0;
    if (mode === 'replace') for (const r of this.s.records) if (r.section === section && !r.deleted) {
      r.deleted = true; removed++; this._hist(section, r.id, 'delete', `replaced by import ${filename}`, structuredClone(r), null);
    }
    for (const rec of records) {
      const ex = mode === 'upsert' && rec.key ? this.s.records.find(r => r.section === section && !r.deleted && r.key === rec.key) : null;
      if (ex) {
        const before = this._clean(ex), after = this._clean({ ...before, ...rec });
        if (JSON.stringify(before) !== JSON.stringify(after)) {
          Object.assign(ex, after, { version: ex.version + 1, updated_at: now(), import_id });
          this._hist(section, ex.id, 'import-update', filename, before, after); updated++;
        }
      } else {
        const r = { id: uid(), section, ...this._clean(rec), version: 1, created_at: now(), updated_at: now(), created_by: this.user.username, updated_by: this.user.username, import_id };
        this.s.records.push(r); this._hist(section, r.id, 'create', r.title.slice(0, 200), null, this._clean(r)); created++;
      }
    }
    this.s.imports.unshift({ id: import_id, ts: now(), user: this.user.username, section, filename, mode, count: records.length });
    this._hist(section, import_id, 'import', `${filename}: +${created} ~${updated} -${removed} (${mode})`, null, null);
    this._log('INFO', `imported ${filename} into ${section}: +${created} ~${updated} -${removed}`, 'regtester.server');
    this.save(); return { import_id, created, updated, removed };
  }
  async imports(section) { return this.s.imports.filter(i => !section || i.section === section); }
  async history(p = {}) {
    return this.s.history.filter(h => (!p.section || h.section === p.section) && (!p.record_id || h.record_id === p.record_id) && (!p.user || h.user === p.user))
      .slice(0, +p.limit || 300).map(h => structuredClone(h));
  }
  async restore(hid) {
    const h = this.s.history.find(x => x.id === hid);
    if (!h || h.action === 'import') throw new Error('this history entry cannot be restored');
    const state = h.after || h.before;
    const r = this.s.records.find(x => x.id === h.record_id);
    if (r && r.deleted) { r.deleted = false; this._hist(r.section, r.id, 'restore', `from #${hid}`, null, null); }
    if (!r) return this.create(h.section, { ...state, id: h.record_id });
    return this.update(r.id, this._clean(state));
  }
  async settings() { return { ...DEMO_SETTINGS, ...this.s.settings }; }
  async saveSettings(values) {
    const before = await this.settings();
    const changed = Object.keys(values).filter(k => JSON.stringify(before[k]) !== JSON.stringify(values[k]));
    Object.assign(this.s.settings, values);
    if (changed.length) this._hist('settings', 'settings', 'update', changed.join(', '), Object.fromEntries(changed.map(k => [k, before[k]])), Object.fromEntries(changed.map(k => [k, values[k]])));
    this._log('INFO', `changed settings: ${changed.join(', ') || '-'}`, 'regtester.server');
    this.save();
    return { settings: await this.settings(), restart_required: changed.some(k => k === 'port' || k === 'lan_access') };
  }
  async logs(p = {}) {
    const order = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'];
    const min = order.indexOf((p.level || 'DEBUG').toUpperCase());
    return this.s.logs.filter(l => order.indexOf(l.level) >= min && (!p.q || (l.message + l.source).toLowerCase().includes(p.q.toLowerCase()))).slice(0, +p.limit || 500);
  }
  async log(level, message) { this._log(level, `[demo] ${message}`); this.save(); }
  async system() {
    const counts = {}; for (const r of this.s.records) if (!r.deleted) counts[r.section] = (counts[r.section] || 0) + 1;
    return { version: '0.1.0', python: '-', platform: navigator.userAgent, windows: false, autostart: false, data_dir: 'browser storage', log_file: '-', uptime: 0, counts, host: '-', port: '-', lan_urls: [], tray: false, demo: true };
  }
  async quit() {}
  async setLogo(data_url) { this.s.logo = data_url; this.save(); }
  async resetLogo() { delete this.s.logo; this.save(); }
  logoUrl() { return this.s.logo || 'icons/icon-192.png'; }
  async users() { return structuredClone(this.users_); }
  async createUser(u) {
    if (this.users_.some(x => x.username === u.username)) throw new Error('user exists');
    const nu = { username: u.username, display: u.display || u.username, role: u.role || 'viewer', sections: u.sections || ['*'], active: true, must_change: true, created_at: now(), last_login: null };
    this.users_.push(nu); this._hist('admin', u.username, 'user-create', `${u.username} (${nu.role})`); this.save(); return nu;
  }
  async updateUser(name, u) {
    const x = this.users_.find(y => y.username === name); Object.assign(x, { ...u, password: undefined });
    this._hist('admin', name, 'user-update', Object.keys(u).join(', ')); this.save(); return x;
  }
  async deleteUser(name) { this.users_ = this.users_.filter(u => u.username !== name); this._hist('admin', name, 'user-delete', name); this.save(); }
  async backups() { return [{ name: 'regtester-20261017-090102.db', size: 1843200, ts: now() - 3600 * 5 }]; }
  async backupNow() { return { name: 'regtester-demo.db' }; }
  async restoreBackup() { throw new Error('Not available in demo mode'); }
}
