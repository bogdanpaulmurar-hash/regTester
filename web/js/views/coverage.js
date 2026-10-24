// Test case catalogue from the regtest tool, and the coverage matrix: every new function against
// RegTest document, test case, specification, procedure (and PO session while that page is in use).
import { openEditor } from '../editor.js';
import { historyTab } from '../history-view.js';
import { t } from '../i18n.js';
import { openImport, pickFile } from '../importer.js';
import { buildCoverage, coverCols, featuresFromDoc } from '../match.js';
import { catalogFromList, catalogFromTree, looksLikeTree, mergeTree } from '../regtool.js';
import { cmpVersion } from '../timeline-gen.js';
import {
  btn, chip, clear, copyText, directed, download, drillApply, drillBand, drillClear, drillFromParams, emptyState, h, hasContent, iso, kpiBox, listOrder, modal,
  normalize, orderToggle, plainText, seg, store, tabs, toast, toCsv,
} from '../util.js';

// filters of the catalogue and of the matrix; a KPI sets them (drill), the notice above the list gives the old ones back
const CKEYS = ['cq', 'app', 'quality', 'main', 'uncat', 'qlevel', 'once'];
const CDEF = { cq: '', app: '', quality: '', main: '', uncat: false, qlevel: '', once: false };
const MKEYS = ['q', 'release', 'filter', 'gapcol', 'norel'];
const MDEF = { q: '', release: '', filter: 'all', gapcol: '', norel: false };

const CELL = { ok: ['ok', 'cov_ok'], weak: ['warn', 'cov_weak'], gap: ['bad', 'cov_gap'], na: ['', 'cov_na'] };
const QCHIP = { high: 'bad', hight: 'bad', medium: 'warn', low: '' };
const groupOf = x => [x.data?.main, x.data?.sub, x.data?.secondary].filter(Boolean).join(' › ');
// Record timestamps; a feature read from a specification document takes them from that document.
const added = x => x.created_at ?? x.doc?.created_at ?? 0;
const changed = x => x.updated_at ?? x.doc?.updated_at ?? added(x);
const byGroup = (a, b) => (a.data?.main ? 0 : 1) - (b.data?.main ? 0 : 1) || groupOf(a).localeCompare(groupOf(b)) || a.title.localeCompare(b.title);
// Sort keys per list: comparators written oldest-first; `chrono` ones follow the newest/oldest switch.
// Ties (e.g. a whole import saved at once) always fall back to `tie`, whatever the direction.
const CAT_SORT = { added: { cmp: (a, b) => added(a) - added(b), chrono: true, tie: byGroup }, updated: { cmp: (a, b) => changed(a) - changed(b), chrono: true, tie: byGroup }, group: { cmp: byGroup } };
const FEAT_SORT = {
  updated: { cmp: (a, b) => changed(a.feature) - changed(b.feature), chrono: true },
  release: { cmp: (a, b) => cmpVersion(a.feature.data?.release || '', b.feature.data?.release || '') || changed(a.feature) - changed(b.feature), chrono: true },
  name: { cmp: (a, b) => a.feature.title.localeCompare(b.feature.title) },
};
FEAT_SORT.updated.tie = FEAT_SORT.release.tie = FEAT_SORT.name.cmp;
const sortWith = (defs, key, list) => {
  const d = defs[key] || Object.values(defs)[0];
  if (!d.chrono) return d.cmp;
  const cmp = directed(d.cmp, listOrder(list));
  return d.tie ? (a, b) => cmp(a, b) || d.tie(a, b) : cmp;
};

export async function render(root, ctx, params) {
  const st = Object.assign({ tab: 'catalog', filter: 'all', release: '', q: '', cq: '', app: '', quality: '', main: '', uncat: false, csort: 'added', fsort: 'updated' }, store('cov') || {});
  if (!store('cov.v2')) { st.tab = 'catalog'; store('cov.v2', true); }
  let limit = 300;
  const save = () => store('cov', st);
  // opened from a KPI elsewhere: #coverage?tab=catalog&uncat=1 or #coverage?tab=matrix&filter=gaps&release=X&norel=1
  const ptab = params?.get('tab');
  if (ptab === 'catalog' || ptab === 'matrix') {
    const isCat = ptab === 'catalog';
    if (drillFromParams(st, isCat ? CKEYS : MKEYS, isCat ? CDEF : MDEF, params, ['tab'])) {
      for (const k of ['uncat', 'once', 'norel']) if (typeof st[k] === 'string') st[k] = st[k] === '1' || st[k] === 'true';
      st.drillTab = ptab; save();
    }
  }
  const drill = (tab, values, from) => { drillApply(st, tab === 'catalog' ? CKEYS : MKEYS, tab === 'catalog' ? CDEF : MDEF, values, from); st.drillTab = tab; st.tab = tab; limit = 300; save(); paint(); };
  const drillLabel = () => (st.gapcol && st.drill === 'cov_c_' + st.gapcol ? t('cov_k_missing', { what: t(st.drill) }) : t(st.drill));
  const band = () => (st.drill && st.drillTab === st.tab ? drillBand(drillLabel(), () => { drillClear(st); st.drillTab = null; save(); paint(); }) : null);
  const undrill = () => { if (st.drill) { st.drill = null; delete st.preDrill; st.drillTab = null; return true; } return false; };
  const canWrite = ctx.canWriteSection('features');
  const COLS = coverCols(ctx);
  let data = { features: [], tests: [], specs: [], transcripts: [], errors: [] }, rows = [];

  root.appendChild(h('div', { class: 'page-head' },
    h('div', null, h('h1', null, ctx.pageLabel('coverage')), h('p', null, t('cov_intro'))),
    h('div', { class: 'actions' }, canWrite ? [
      btn(t('cat_import'), importCatalog, { icon: 'upload', cls: 'primary' }),
      btn(t('cov_import_rn'), importReleaseNotes, { icon: 'upload' }),
    ] : null, btn(t('cov_copy_gaps'), copyGaps, { icon: 'copy' }), btn('CSV', exportCsv, { icon: 'download' }))));
  const tabBox = h('div'), body = h('div', { class: 'stack' });
  root.append(tabBox, body);

  async function load(force) {
    const get = (s, page) => (ctx.canPage(page) ? ctx.records(s, force).catch(() => []) : Promise.resolve([]));
    const [features, tests, specs, transcripts, errors] = await Promise.all([get('features', 'coverage'), get('tests', 'coverage'), get('specs', 'specs'),
      get('transcripts', 'transcripts'), get('errors', 'triage')]);
    data = { features, tests, specs, transcripts, errors };
    rows = buildCoverage({ ...data, settings: ctx.settings, cols: COLS });
    paint();
  }

  function paint() {
    clear(tabBox).appendChild(tabs([['catalog', `${t('cat_tab')}${data.tests.length ? ' · ' + data.tests.length : ''}`], ['matrix', t('cov_t_matrix')], ['features', t('cov_t_features')], ['history', t('tab_history')]],
      st.tab, v => { st.tab = v; save(); paint(); }));
    clear(body);
    if (st.tab === 'history') { historyTab(body, ctx, ['features', 'tests'], () => load(true)); return; }
    if (st.tab === 'features') { simpleList(data.features); return; }
    if (st.tab === 'catalog') { catalog(); return; }
    matrix();
  }

  // ------------------------------------------------------------- catalogue
  function catalog() {
    const tests = data.tests;
    if (!tests.length) { body.appendChild(emptyState(t('cat_empty'), canWrite ? btn(t('cat_import'), importCatalog, { icon: 'upload', cls: 'primary' }) : null)); return; }
    const uncat = tests.filter(x => !x.data?.main);
    const byApp = {}; tests.forEach(x => { const a = x.data?.app || '—'; byApp[a] = (byApp[a] || 0) + 1; });
    const qn = q => tests.filter(x => normalize(x.data?.quality).startsWith(q)).length;
    const ck = (id, label, v, kind, values) => kpiBox(label, v, kind, () => drill('catalog', values, id), { id, active: st.drill === id && st.drillTab === 'catalog' });
    body.appendChild(h('div', { class: 'kpis' }, ck('cat_k_total', t('cat_k_total'), tests.length, '', {}), ck('cat_k_high', t('cat_k_high'), qn('high'), '', { qlevel: 'high' }),
      ck('cat_k_medium', t('cat_k_medium'), qn('medium'), '', { qlevel: 'medium' }), ck('cat_k_low', t('cat_k_low'), qn('low'), '', { qlevel: 'low' }),
      ck('cat_k_uncat', t('cat_k_uncat'), uncat.length, uncat.length ? 'warn' : 'ok', { uncat: true }),
      ck('cat_k_once', t('cat_k_once'), tests.filter(x => (x.data?.count || 0) <= 1).length, '', { once: true })));
    const b = band(); if (b) body.appendChild(b);
    body.appendChild(h('div', { class: 'pill-row' }, Object.entries(byApp).sort((a, b) => b[1] - a[1]).map(([a, n]) =>
      h('button', { type: 'button', class: 'chip' + (st.app === a ? ' info' : ''), 'aria-pressed': String(st.app === a), onclick: () => { st.app = st.app === a ? '' : a; undrill(); save(); paint(); } }, `${a} · ${n}`))));
    const uniq = f => [...new Set(tests.map(f).filter(Boolean))].sort();
    const search = h('input', { type: 'search', value: st.cq, placeholder: t('cat_search'), 'aria-label': t('cat_search') });
    search.addEventListener('input', () => { st.cq = search.value; limit = 300; if (undrill()) { save(); paint(); search.focus(); return; } save(); paintTable(); });
    const sel = (key, label, opts) => h('select', { 'aria-label': label, onchange: e => { st[key] = e.target.value; limit = 300; const had = undrill(); save(); if (had) paint(); else paintTable(); } },
      h('option', { value: '' }, label), opts.map(v => h('option', { value: v, selected: st[key] === v }, v)));
    body.appendChild(h('div', { class: 'toolbar' }, h('div', { class: 'grow' }, search),
      sel('main', t('cat_all_main'), uniq(x => x.data?.main)), sel('quality', t('cat_all_quality'), uniq(x => x.data?.quality)),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: st.uncat, onchange: e => { st.uncat = e.target.checked; const had = undrill(); save(); if (had) paint(); else paintTable(); } }), t('cat_only_uncat')),
      sortBar(CAT_SORT, 'csort', [['added', t('sort_added')], ['updated', t('sort_updated')], ['group', t('sort_group')]], 'cov.catalog', () => paintTable())));
    const tableBox = h('div');
    body.appendChild(tableBox);
    function paintTable() {
      clear(tableBox);
      const q = normalize(st.cq);
      const vis = tests.filter(x => (!st.app || (x.data?.app || '—') === st.app) && (!st.quality || x.data?.quality === st.quality)
        && (!st.main || x.data?.main === st.main) && (!st.uncat || !x.data?.main)
        && (!st.qlevel || normalize(x.data?.quality).startsWith(st.qlevel)) && (!st.once || (x.data?.count || 0) <= 1)
        && (!q || normalize(`${x.key} ${x.title} ${x.data?.main} ${x.data?.sub} ${x.data?.secondary}`).includes(q)))
        .sort(sortWith(CAT_SORT, st.csort, 'cov.catalog'));
      if (!vis.length) { tableBox.appendChild(emptyState(t('no_match'))); return; }
      tableBox.appendChild(h('div', { class: 'hint' }, t('n_items', { n: vis.length })));
      const counts = {}; vis.forEach(x => { const g = groupOf(x) || t('cat_uncat'); counts[g] = (counts[g] || 0) + 1; });
      const trs = []; let grp = null;
      for (const x of vis.slice(0, limit)) {
        const g = groupOf(x) || t('cat_uncat');
        if (st.csort === 'group' && g !== grp) { grp = g; trs.push(h('tr', null, h('td', { colspan: 5, style: { background: 'var(--surface-2)', fontWeight: 600 } }, g, h('span', { class: 'small muted' }, ` · ${counts[g]}`)))); }
        trs.push(h('tr', { class: 'click', tabindex: '0', onclick: () => editTest(x, vis), onkeydown: e => { if (e.key === 'Enter') editTest(x, vis); } },
          h('td', { class: 'mono nowrap' }, x.key.startsWith('TREE:') ? '—' : x.key),
          h('td', null, x.title, hasContent(x.data?.notes) ? h('span', { class: 'small muted', title: t('f_notes_rich') }, ' 📝') : null, st.csort !== 'group' ? h('div', { class: 'small muted' }, g) : null), h('td', { class: 'small' }, x.data?.app || ''),
          h('td', null, x.data?.quality ? chip(x.data.quality, QCHIP[normalize(x.data.quality)] || '') : ''), h('td', { class: 'num' }, x.data?.count ?? '')));
      }
      tableBox.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 't' },
        h('thead', null, h('tr', null, [t('f_test_id'), t('f_title'), t('err_app'), t('cat_quality'), t('cat_count')].map(x => h('th', null, x)))), h('tbody', null, trs))));
      if (vis.length > limit) tableBox.appendChild(h('div', { style: { marginTop: '8px' } }, btn(t('more_n', { n: vis.length - limit }), () => { limit += 500; paintTable(); }, { cls: 'sm' })));
    }
    paintTable();
  }

  function importCatalog() {
    pickFile('.xlsx,.xlsm,.csv', fileData => {
      const sheet = (fileData.sheets || []).find(s => s.rows.length > 1);
      if (!sheet) { toast(t('import_need_table'), 'bad'); return; }
      const tree = looksLikeTree(sheet.rows);
      let recs = [], info = '';
      if (tree) {
        const res = mergeTree(data.tests, catalogFromTree(sheet.rows));
        recs = res.records; info = t('cat_tree_info', { m: res.matched, a: res.added });
      } else {
        recs = catalogFromList(sheet.rows).records;
        info = t('cat_list_info', { n: recs.length, u: recs.filter(r => !r.data.main).length });
      }
      if (!recs.length) { toast(t('cat_nothing'), 'bad'); return; }
      let mode = 'upsert';
      modal({
        title: `${t('cat_import')} · ${fileData.name}`, wide: true,
        body: [h('p', null, chip(tree ? t('cat_kind_tree') : t('cat_kind_list'), 'info'), ' ', info),
          h('p', { class: 'hint' }, tree ? t('cat_tree_hint') : t('cat_list_hint')),
          tree ? null : h('div', { class: 'pill-row' }, ['upsert', 'replace'].map(m => h('label', { class: 'check' },
            h('input', { type: 'radio', name: 'cat-mode', checked: m === mode, onchange: () => { mode = m; } }), t('mode_' + m)))),
          h('div', { class: 'table-wrap', style: { maxHeight: '300px' } }, h('table', { class: 't' },
            h('thead', null, h('tr', null, [t('f_test_id'), t('f_title'), t('err_app'), t('cat_quality'), t('cat_category')].map(x => h('th', null, x)))),
            h('tbody', null, recs.slice(0, 12).map(r => h('tr', null, h('td', { class: 'mono' }, r.key.startsWith('TREE:') ? '—' : r.key), h('td', null, r.title),
              h('td', null, r.data.app || ''), h('td', null, r.data.quality || ''), h('td', { class: 'small' }, groupOf(r)))))))],
        footer: c => [btn(t('cancel'), c), btn(t('import_do'), async () => {
          try { const res = await ctx.api.importRecords('tests', fileData.name, recs, mode); toast(t('import_done', res)); c(); ctx.invalidate('tests'); load(true); }
          catch (e) { toast(e.message, 'bad'); }
        }, { cls: 'primary', icon: 'upload' })],
      });
    });
  }

  // ---------------------------------------------------------------- matrix
  function visible() {
    const q = normalize(st.q);
    return rows.filter(r => (!st.release || r.feature.data?.release === st.release || (st.norel && !r.feature.data?.release))
      && (!st.gapcol || r.status[st.gapcol] === 'gap')
      && (st.filter === 'all' || (st.filter === 'gaps' ? r.gaps > 0 : st.filter === 'errors' ? r.errors.length > 0 : r.gaps === 0))
      && (!q || normalize(`${r.feature.key} ${r.feature.title} ${r.feature.data?.module}`).includes(q)))
      .sort(sortWith(FEAT_SORT, st.fsort, 'cov.features'));
  }

  /** Sort field select plus the newest/oldest switch, which only shows for date-like fields. */
  function sortBar(defs, key, opts, list, repaint) {
    const box = h('div', { class: 'toolbar', style: { margin: 0 } });
    const fill = () => {
      clear(box).append(h('select', { 'aria-label': t('sort_label'), onchange: e => { st[key] = e.target.value; save(); fill(); repaint(); } },
        opts.map(([v, l]) => h('option', { value: v, selected: st[key] === v }, l))));
      if ((defs[st[key]] || Object.values(defs)[0]).chrono) box.append(orderToggle(list, repaint));
    };
    fill();
    return box;
  }

  function matrix() {
    if (!rows.length) {
      body.appendChild(emptyState(t('cov_empty'), canWrite ? btn(t('cov_import_rn'), importReleaseNotes, { icon: 'upload', cls: 'primary' }) : null));
      return;
    }
    const withGaps = rows.filter(r => r.gaps > 0).length;
    const withErr = rows.filter(r => r.errors.length).length;
    const colGaps = c => rows.filter(r => r.status[c] === 'gap').length;
    const mk = (id, label, v, kind, values) => kpiBox(label, v, kind, () => drill('matrix', values, id), { id, active: st.drill === id && st.drillTab === 'matrix' });
    body.appendChild(h('div', { class: 'kpis' },
      mk('cov_k_features', t('cov_k_features'), rows.length, '', {}), mk('cov_k_with_gaps', t('cov_k_with_gaps'), withGaps, withGaps ? 'bad' : 'ok', { filter: 'gaps' }),
      ...COLS.map(c => mk('cov_c_' + c, t('cov_k_missing', { what: t('cov_c_' + c) }), colGaps(c), colGaps(c) ? 'warn' : 'ok', { gapcol: c })),
      mk('cov_k_errors', t('cov_k_errors'), withErr, withErr ? 'warn' : 'ok', { filter: 'errors' })));
    const b = band(); if (b) body.appendChild(b);
    const releases = [...new Set(rows.map(r => r.feature.data?.release).filter(Boolean))].sort();
    const search = h('input', { type: 'search', value: st.q, placeholder: t('cov_search'), 'aria-label': t('cov_search') });
    search.addEventListener('input', () => { st.q = search.value; if (undrill()) { save(); paint(); search.focus(); return; } save(); paintTable(); });
    body.appendChild(h('div', { class: 'toolbar' },
      seg([['all', `${t('all')} · ${rows.length}`], ['gaps', `${t('cov_with_gaps')} · ${withGaps}`], ['done', `${t('cov_complete')} · ${rows.length - withGaps}`], ['errors', `${t('cov_with_errors')} · ${withErr}`]], st.filter, v => { st.filter = v; undrill(); save(); paint(); }),
      releases.length ? h('select', { 'aria-label': t('f_release'), onchange: e => { st.release = e.target.value; st.norel = false; undrill(); save(); paint(); } },
        h('option', { value: '' }, t('tl_all_releases')), releases.map(r => h('option', { value: r, selected: st.release === r }, r))) : null,
      h('div', { class: 'grow' }, search),
      sortBar(FEAT_SORT, 'fsort', [['updated', t('sort_updated')], ['release', t('sort_release')], ['name', t('sort_name')]], 'cov.features', () => paintTable())));
    const tableBox = h('div');
    body.appendChild(tableBox);
    body.appendChild(h('div', { class: 'hint' }, t('cov_legend')));
    function paintTable() {
      clear(tableBox);
      const vis = visible();
      if (!vis.length) { tableBox.appendChild(emptyState(t('no_match'))); return; }
      tableBox.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 't' },
        h('thead', null, h('tr', null, h('th', null, t('cov_feature')), h('th', null, t('f_release')), h('th', null, t('f_sprint')),
          COLS.map(c => h('th', null, t('cov_c_' + c))), h('th', null, t('cov_c_errors')), h('th', null, t('f_status')))),
        h('tbody', null, vis.map(r => h('tr', null,
          h('td', null, h('button', { type: 'button', class: 'cover-cell', style: { textAlign: 'left' }, onclick: () => (r.feature.virtual ? ctx.navigate('specs?id=' + r.feature.doc.id) : editFeature(r.feature, vis.map(x => x.feature).filter(x => !x.virtual))) },
            r.feature.key ? h('span', { class: 'mono muted' }, r.feature.key + ' ') : null, h('b', null, r.feature.title),
            r.feature.virtual ? h('div', { class: 'small muted' }, t('cov_from_doc')) : null)),
          h('td', null, r.feature.data?.release || ''), h('td', null, r.feature.data?.sprint || ''),
          COLS.map(c => h('td', null, h('button', { type: 'button', class: 'cover-cell', onclick: () => cellDetail(r, c), 'aria-label': `${r.feature.title}: ${t('cov_c_' + c)}` },
            chip(t(CELL[r.status[c]][1]) + (r.m[c].length > 1 ? ` · ${r.m[c].length}` : ''), CELL[r.status[c]][0])))),
          h('td', null, r.errors.length ? h('button', { type: 'button', class: 'cover-cell', onclick: () => errorList(r) }, chip(String(r.errors.length), 'warn')) : ''),
          h('td', { class: 'nowrap', style: { fontWeight: 500, color: r.gaps ? 'var(--bad)' : 'var(--ok)' } },
            r.gaps ? t('cov_n_gaps', { n: r.gaps }) : t('cov_complete'))))))));
    }
    paintTable();
  }


  // errors linked to a function: each opens the error list filtered on it, where the error can be opened and edited
  function errorList(r) {
    let close = null;
    const toErr = e => { close(); ctx.drill('triage', { tab: 'errors', status: '', q: e.key, from: 'cov_c_errors' }); };
    close = modal({
      title: `${r.feature.title} · ${t('cov_c_errors')}`,
      body: h('div', { class: 'list' }, r.errors.map(e => h('div', { class: 'li click', tabindex: '0', role: 'button', onclick: () => toErr(e), onkeydown: ev => { if (ev.key === 'Enter') toErr(e); } },
        h('span', { class: 'mono' }, e.key), h('span', { class: 'grow' }, e.title), chip(e.data?.status || '—')))),
      footer: c => [btn(t('cov_go', { where: ctx.pageLabel('triage') }), () => { c(); ctx.drill('triage', { tab: 'errors', status: 'open', from: 'err_k_open' }); }, { cls: 'primary' })],
    });
  }

  function cellDetail(r, col) {
    if (r.feature.virtual && col === 'regspec') { ctx.navigate('specs?id=' + r.feature.doc.id); return; }
    const ov = r.feature.data?.overrides || {};
    const setOv = async v => {
      const overrides = { ...ov }; if (v) overrides[col] = v; else delete overrides[col];
      try { await ctx.api.update(r.feature.id, { data: { ...r.feature.data, overrides } }); ctx.invalidate('features'); close(); load(true); toast(t('saved')); }
      catch (e) { toast(e.message, 'bad'); }
    };
    const target = { regspec: 'specs', test: 'coverage', spec: 'specs', procedure: 'specs', session: 'transcripts' }[col];
    const close = modal({
      title: `${r.feature.title} · ${t('cov_c_' + col)}`,
      body: [
        r.m[col].length ? h('div', { class: 'list' }, r.m[col].map(({ item, how, score }) => h('div', { class: 'li' },
          chip(how === 'code' ? t('cov_by_code') : t('cov_by_title', { p: Math.round(score * 100) }), how === 'code' ? 'ok' : 'warn'),
          h('div', { class: 'grow' }, item.key ? h('span', { class: 'mono muted' }, item.key + ' ') : null, item.title),
          item.data?.status ? chip(item.data.status) : null))) : h('p', null, t('cov_none_found')),
        h('p', { class: 'hint' }, col === 'regspec' ? t('cov_regspec_hint') : t('cov_override_hint')),
        r.feature.virtual ? h('p', { class: 'hint' }, t('cov_virtual_ov')) : null,
        ov[col] ? chip(t('cov_override_set', { v: t(CELL[ov[col]][1]) }), 'info') : null],
      footer: c => [
        canWrite && !r.feature.virtual ? btn(t('cov_mark_ok'), () => setOv('ok')) : null,
        canWrite && !r.feature.virtual ? btn(t('cov_mark_na'), () => setOv('na')) : null,
        canWrite && ov[col] && !r.feature.virtual ? btn(t('cov_clear_ov'), () => setOv(null), { cls: 'ghost' }) : null,
        btn(t('cov_go', { where: col === 'test' ? t('cat_tab') : ctx.pageLabel(target) }), () => { c(); if (col === 'test') { st.tab = 'catalog'; save(); paint(); } else ctx.navigate(target); }, { cls: 'primary' })],
    });
  }

  function editFeature(f, navList) {
    openEditor({
      ctx, section: 'features', record: f, fields: [
        { key: 'key', label: t('f_code') }, { key: 'title', label: t('f_title') },
        { key: 'data.sprint', label: t('f_sprint') }, { key: 'data.release', label: t('f_release') }, { key: 'data.module', label: t('f_module') },
        { key: 'body', label: t('f_description'), type: 'textarea', rows: 6, hint: t('f_desc_import_hint') },
        { key: 'data.notes', label: t('f_notes_rich'), type: 'rich', hint: t('f_notes_rich_hint') }],
      nav: navList ? { list: navList, open: x => editFeature(data.features.find(y => y.id === x.id) || x, navList) } : null,
      onSaved: () => { ctx.invalidate('features'); load(true); },
    });
  }

  function editTest(x, navList) {
    openEditor({
      ctx, section: 'tests', record: x, fields: [
        { key: 'key', label: t('f_test_id') }, { key: 'title', label: t('f_title') }, { key: 'data.app', label: t('err_app') },
        { key: 'data.quality', label: t('cat_quality'), datalist: ['High', 'Medium', 'Low'] },
        { key: 'data.main', label: t('cat_main') }, { key: 'data.sub', label: t('cat_sub') }, { key: 'data.secondary', label: t('cat_secondary') },
        { key: 'data.feature', label: t('f_feature_code') }, { key: 'body', label: t('f_description'), type: 'textarea', hint: t('f_desc_import_hint') },
        { key: 'data.notes', label: t('f_notes_rich'), type: 'rich', hint: t('f_notes_rich_hint') }],
      nav: navList ? { list: navList, open: y => editTest(data.tests.find(z => z.id === y.id) || y, navList) } : null,
      onSaved: () => { ctx.invalidate('tests'); load(true); },
    });
  }

  function simpleList(items) {
    body.appendChild(h('div', { class: 'toolbar' }, h('span', { class: 'hint' }, t('n_items', { n: items.length })), h('span', { class: 'sp' }),
      canWrite ? btn(t('add'), () => editFeature(null), { icon: 'plus' }) : null));
    if (!items.length) { body.appendChild(emptyState(t('no_items'))); return; }
    body.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 't' },
      h('thead', null, h('tr', null, [t('f_key'), t('f_title'), t('f_sprint'), t('f_release')].map(x => h('th', null, x)))),
      h('tbody', null, items.map(x => h('tr', { class: 'click', tabindex: '0', onclick: () => editFeature(x, items), onkeydown: e => { if (e.key === 'Enter') editFeature(x, items); } },
        h('td', { class: 'mono' }, x.key), h('td', null, x.title), h('td', null, x.data?.sprint), h('td', null, x.data?.release)))))));
  }

  function importReleaseNotes() {
    openImport({
      api: ctx.api, section: 'features', title: t('cov_import_rn'), accept: '.xlsx,.xlsm,.csv,.docx,.html,.htm,.txt,.md', hint: t('cov_import_rn_hint'),
      fields: [
        { key: 'key', label: t('f_code'), aliases: ['id', 'key', 'code', 'cod', 'ticket', 'story', 'jira', 'pbi', 'work item', 'nr'] },
        { key: 'title', label: t('f_title'), required: true, aliases: ['title', 'titel', 'name', 'feature', 'function', 'funktion', 'functie', 'summary', 'zusammenfassung'] },
        { key: 'sprint', label: t('f_sprint'), aliases: ['sprint', 'iteration'] },
        { key: 'release', label: t('f_release'), aliases: ['release', 'version', 'versiune'] },
        { key: 'module', label: t('f_module'), aliases: ['module', 'modul', 'area', 'bereich', 'component', 'komponente', 'componenta'] },
        { key: 'description', label: t('f_description'), aliases: ['description', 'beschreibung', 'descriere', 'details', 'text'] },
      ],
      toRecord: m => String(m.title).trim() ? { key: String(m.key || '').trim(), title: String(m.title).trim(), body: String(m.description || ''),
        data: { sprint: String(m.sprint || ''), release: String(m.release || ''), module: String(m.module || '') } } : null,
      fromDoc: d => featuresFromDoc(d, ctx.settings),
      onDone: () => { ctx.invalidate('features'); load(true); },
    });
  }

  function gapLines() {
    return visible().filter(r => r.gaps).map(r => `- ${r.feature.key ? r.feature.key + ' ' : ''}${r.feature.title}: ${t('cov_missing_list')} ${COLS.filter(c => r.status[c] === 'gap').map(c => t('cov_c_' + c)).join(', ')}`);
  }
  function copyGaps() {
    const lines = gapLines();
    copyText(lines.length ? `${t('cov_gaps_title')} (${iso(new Date())})\n${lines.join('\n')}` : t('cov_no_gaps'));
  }
  function exportCsv() {
    if (st.tab === 'catalog') {
      download(`testcases-${iso(new Date())}.csv`, '﻿' + toCsv(data.tests, [{ label: 'TestCase ID', key: 'key' }, { label: 'Title', key: 'title' },
        { label: 'Application', get: r => r.data?.app }, { label: 'Quality', get: r => r.data?.quality }, { label: 'Count', get: r => r.data?.count },
        { label: 'Main Category', get: r => r.data?.main }, { label: 'Sub Category', get: r => r.data?.sub }, { label: 'Secondary Category', get: r => r.data?.secondary }]), 'text/csv');
      return;
    }
    download(`coverage-${iso(new Date())}.csv`, '﻿' + toCsv(visible(), [
      { label: 'Code', get: r => r.feature.key }, { label: 'Function', get: r => r.feature.title }, { label: 'Release', get: r => r.feature.data?.release }, { label: 'Sprint', get: r => r.feature.data?.sprint },
      ...COLS.map(c => ({ label: c, get: r => r.status[c] })), { label: 'Open errors', get: r => r.errors.length }, { label: 'Gaps', get: r => r.gaps }]), 'text/csv');
  }

  await load();
}
