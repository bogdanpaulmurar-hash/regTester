// Coverage matrix: every new function against PO session, test case, specification and procedure.
import { openEditor } from '../editor.js';
import { historyTab } from '../history-view.js';
import { t } from '../i18n.js';
import { openImport } from '../importer.js';
import { buildCoverage, COVER_COLS, featuresFromDoc } from '../match.js';
import { btn, chip, clear, copyText, download, emptyState, h, iso, modal, normalize, seg, store, tabs, toast, toCsv } from '../util.js';

const CELL = { ok: ['ok', 'cov_ok'], weak: ['warn', 'cov_weak'], gap: ['bad', 'cov_gap'], na: ['', 'cov_na'] };

export async function render(root, ctx) {
  const st = Object.assign({ tab: 'matrix', filter: 'all', release: '', q: '' }, store('cov') || {});
  const save = () => store('cov', st);
  const canWrite = ctx.canWriteSection('features');
  let data = { features: [], tests: [], specs: [], transcripts: [] }, rows = [];

  root.appendChild(h('div', { class: 'page-head' },
    h('div', null, h('h1', null, t('nav_coverage')), h('p', null, t('cov_intro'))),
    h('div', { class: 'actions' }, canWrite ? [
      btn(t('cov_import_rn'), importReleaseNotes, { icon: 'upload' }),
      btn(t('cov_import_tests'), importTests, { icon: 'upload' }),
    ] : null, btn(t('cov_copy_gaps'), copyGaps, { icon: 'copy' }), btn('CSV', exportCsv, { icon: 'download' }))));
  const tabBox = h('div'), body = h('div', { class: 'stack' });
  root.append(tabBox, body);

  async function load(force) {
    const [features, tests, specs, transcripts] = await Promise.all(['features', 'tests', 'specs', 'transcripts'].map(s => ctx.records(s, force).catch(() => [])));
    data = { features, tests, specs, transcripts };
    rows = buildCoverage({ ...data, settings: ctx.settings });
    paint();
  }

  function visible() {
    const q = normalize(st.q);
    return rows.filter(r => (!st.release || r.feature.data?.release === st.release)
      && (st.filter === 'all' || (st.filter === 'gaps' ? r.gaps > 0 : r.gaps === 0))
      && (!q || normalize(`${r.feature.key} ${r.feature.title} ${r.feature.data?.module}`).includes(q)));
  }

  function paint() {
    clear(tabBox).appendChild(tabs([['matrix', t('cov_t_matrix')], ['features', t('cov_t_features')], ['tests', t('cov_t_tests')], ['history', t('tab_history')]],
      st.tab, v => { st.tab = v; save(); paint(); }));
    clear(body);
    if (st.tab === 'history') { historyTab(body, ctx, ['features', 'tests'], () => load(true)); return; }
    if (st.tab === 'features') { simpleList(data.features, 'features'); return; }
    if (st.tab === 'tests') { simpleList(data.tests, 'tests'); return; }
    matrix();
  }

  function matrix() {
    if (!rows.length) {
      body.appendChild(emptyState(t('cov_empty'), canWrite ? btn(t('cov_import_rn'), importReleaseNotes, { icon: 'upload', cls: 'primary' }) : null));
      return;
    }
    const withGaps = rows.filter(r => r.gaps > 0).length;
    const colGaps = c => rows.filter(r => r.status[c] === 'gap').length;
    body.appendChild(h('div', { class: 'kpis' },
      kpi(t('cov_k_features'), rows.length), kpi(t('cov_k_with_gaps'), withGaps, withGaps ? 'bad' : 'ok'),
      ...COVER_COLS.map(c => kpi(t('cov_k_missing', { what: t('cov_c_' + c) }), colGaps(c), colGaps(c) ? 'warn' : 'ok'))));
    const releases = [...new Set(data.features.map(f => f.data?.release).filter(Boolean))].sort();
    const search = h('input', { type: 'search', value: st.q, placeholder: t('cov_search'), 'aria-label': t('cov_search') });
    search.addEventListener('input', () => { st.q = search.value; save(); paintTable(); });
    body.appendChild(h('div', { class: 'toolbar' },
      seg([['all', `${t('all')} · ${rows.length}`], ['gaps', `${t('cov_with_gaps')} · ${withGaps}`], ['done', `${t('cov_complete')} · ${rows.length - withGaps}`]], st.filter, v => { st.filter = v; save(); paint(); }),
      releases.length ? h('select', { 'aria-label': t('f_release'), onchange: e => { st.release = e.target.value; save(); paint(); } },
        h('option', { value: '' }, t('tl_all_releases')), releases.map(r => h('option', { value: r, selected: st.release === r }, r))) : null,
      h('div', { class: 'grow' }, search)));
    const tableBox = h('div');
    body.appendChild(tableBox);
    body.appendChild(h('div', { class: 'hint' }, t('cov_legend')));
    function paintTable() {
      clear(tableBox);
      const vis = visible();
      if (!vis.length) { tableBox.appendChild(emptyState(t('no_match'))); return; }
      tableBox.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 't' },
        h('thead', null, h('tr', null, h('th', null, t('cov_feature')), h('th', null, t('f_sprint')), h('th', null, t('f_module')),
          COVER_COLS.map(c => h('th', null, t('cov_c_' + c))), h('th', null, t('f_status')))),
        h('tbody', null, vis.map(r => h('tr', null,
          h('td', null, h('button', { type: 'button', class: 'cover-cell', style: { textAlign: 'left' }, onclick: () => editFeature(r.feature) },
            r.feature.key ? h('span', { class: 'mono muted' }, r.feature.key + ' ') : null, h('b', null, r.feature.title))),
          h('td', null, r.feature.data?.sprint || ''), h('td', null, r.feature.data?.module || ''),
          COVER_COLS.map(c => h('td', null, h('button', { type: 'button', class: 'cover-cell', onclick: () => cellDetail(r, c), 'aria-label': `${r.feature.title}: ${t('cov_c_' + c)}` },
            chip(t(CELL[r.status[c]][1]) + (r.m[c].length > 1 ? ` · ${r.m[c].length}` : ''), CELL[r.status[c]][0])))),
          h('td', { class: 'nowrap', style: { fontWeight: 500, color: r.gaps ? 'var(--bad)' : 'var(--ok)' } },
            r.gaps ? t('cov_n_gaps', { n: r.gaps }) : t('cov_complete'))))))));
    }
    paintTable();
  }

  function kpi(label, value, kind) { return h('div', { class: 'kpi ' + (kind || '') }, h('div', { class: 'l' }, label), h('div', { class: 'v' }, value)); }

  function cellDetail(r, col) {
    const ov = r.feature.data?.overrides || {};
    const setOv = async v => {
      const overrides = { ...ov }; if (v) overrides[col] = v; else delete overrides[col];
      try { await ctx.api.update(r.feature.id, { data: { ...r.feature.data, overrides } }); ctx.invalidate('features'); close(); load(true); toast(t('saved')); }
      catch (e) { toast(e.message, 'bad'); }
    };
    const target = { test: 'coverage', spec: 'specs', procedure: 'specs', session: 'transcripts' }[col];
    const close = modal({
      title: `${r.feature.title} · ${t('cov_c_' + col)}`,
      body: [
        r.m[col].length ? h('div', { class: 'list' }, r.m[col].map(({ item, how, score }) => h('div', { class: 'li' },
          chip(how === 'code' ? t('cov_by_code') : t('cov_by_title', { p: Math.round(score * 100) }), how === 'code' ? 'ok' : 'warn'),
          h('div', { class: 'grow' }, item.key ? h('span', { class: 'mono muted' }, item.key + ' ') : null, item.title)))) : h('p', null, t('cov_none_found')),
        h('p', { class: 'hint' }, t('cov_override_hint')),
        ov[col] ? chip(t('cov_override_set', { v: t(CELL[ov[col]][1]) }), 'info') : null],
      footer: c => [
        canWrite ? btn(t('cov_mark_ok'), () => setOv('ok')) : null,
        canWrite ? btn(t('cov_mark_na'), () => setOv('na')) : null,
        canWrite && ov[col] ? btn(t('cov_clear_ov'), () => setOv(null), { cls: 'ghost' }) : null,
        btn(t('cov_go', { where: t('nav_' + target) }), () => { c(); ctx.navigate(target); }, { cls: 'primary' })],
    });
  }

  function editFeature(f) {
    openEditor({
      ctx, section: 'features', record: f, fields: [
        { key: 'key', label: t('f_code') }, { key: 'title', label: t('f_title') },
        { key: 'data.sprint', label: t('f_sprint') }, { key: 'data.release', label: t('f_release') }, { key: 'data.module', label: t('f_module') },
        { key: 'body', label: t('f_description'), type: 'textarea', rows: 6 }],
      onSaved: () => { ctx.invalidate('features'); load(true); },
    });
  }

  function editTest(x) {
    openEditor({
      ctx, section: 'tests', record: x, fields: [
        { key: 'key', label: t('f_test_id') }, { key: 'title', label: t('f_title') }, { key: 'data.module', label: t('f_module') },
        { key: 'data.feature', label: t('f_feature_code') }, { key: 'data.status', label: t('f_status') }, { key: 'body', label: t('f_description'), type: 'textarea' }],
      onSaved: () => { ctx.invalidate('tests'); load(true); },
    });
  }

  function simpleList(items, section) {
    const isF = section === 'features';
    body.appendChild(h('div', { class: 'toolbar' }, h('span', { class: 'hint' }, t('n_items', { n: items.length })), h('span', { class: 'sp' }),
      canWrite ? btn(t('add'), () => isF ? editFeature(null) : editTest(null), { icon: 'plus' }) : null));
    if (!items.length) { body.appendChild(emptyState(t('no_items'))); return; }
    body.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 't' },
      h('thead', null, h('tr', null, [t('f_key'), t('f_title'), isF ? t('f_sprint') : t('f_module'), isF ? t('f_release') : t('f_status')].map(x => h('th', null, x)))),
      h('tbody', null, items.map(x => h('tr', { class: 'click', tabindex: '0', onclick: () => isF ? editFeature(x) : editTest(x) },
        h('td', { class: 'mono' }, x.key), h('td', null, x.title), h('td', null, isF ? x.data?.sprint : x.data?.module), h('td', null, isF ? x.data?.release : x.data?.status)))))));
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

  function importTests() {
    openImport({
      api: ctx.api, section: 'tests', title: t('cov_import_tests'), accept: '.xlsx,.xlsm,.csv', hint: t('cov_import_tests_hint'),
      fields: [
        { key: 'key', label: t('f_test_id'), required: true, aliases: ['id', 'test id', 'testcase', 'test case id', 'tc', 'key', 'nr'] },
        { key: 'title', label: t('f_title'), required: true, aliases: ['title', 'name', 'titel', 'test case', 'testfall', 'summary', 'denumire'] },
        { key: 'module', label: t('f_module'), aliases: ['module', 'modul', 'area', 'folder', 'ordner', 'suite'] },
        { key: 'feature', label: t('f_feature_code'), aliases: ['feature', 'requirement', 'anforderung', 'cerinta', 'story', 'link'] },
        { key: 'status', label: t('f_status'), aliases: ['status', 'state', 'zustand', 'stare'] },
      ],
      toRecord: m => String(m.key).trim() ? { key: String(m.key).trim(), title: String(m.title || '').trim() || String(m.key),
        data: { module: String(m.module || ''), feature: String(m.feature || ''), status: String(m.status || '') } } : null,
      onDone: () => { ctx.invalidate('tests'); load(true); },
    });
  }

  function gapLines() {
    return visible().filter(r => r.gaps).map(r => `- ${r.feature.key ? r.feature.key + ' ' : ''}${r.feature.title}: ${t('cov_missing_list')} ${COVER_COLS.filter(c => r.status[c] === 'gap').map(c => t('cov_c_' + c)).join(', ')}`);
  }
  function copyGaps() {
    const lines = gapLines();
    copyText(lines.length ? `${t('cov_gaps_title')} (${iso(new Date())})\n${lines.join('\n')}` : t('cov_no_gaps'));
  }
  function exportCsv() {
    download(`coverage-${iso(new Date())}.csv`, '﻿' + toCsv(visible(), [
      { label: 'Code', get: r => r.feature.key }, { label: 'Function', get: r => r.feature.title }, { label: 'Sprint', get: r => r.feature.data?.sprint },
      ...COVER_COLS.map(c => ({ label: c, get: r => r.status[c] })), { label: 'Gaps', get: r => r.gaps }]), 'text/csv');
  }

  await load();
}
