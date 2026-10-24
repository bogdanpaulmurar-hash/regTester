// Errors & runs: error items from the regtest tool (with changes between exports), plus run-result
// analysis, known error patterns, trend and a copy-ready report.
import { openEditor } from '../editor.js';
import { diffErrors, EM_FIELDS, isOpen, matchText, regtestWindow, snapshot, toItem, toRecord, within } from '../errors.js';
import { historyTab } from '../history-view.js';
import { t } from '../i18n.js';
import { openImport } from '../importer.js';
import { analyse, statusOf } from '../triage.js';
import {
  btn, chip, clear, confirmBox, copyText, directed, download, emptyState, fmtDate, fmtDateTime, h, iso, listOrder, modal, orderToggle, seg, store, tabs, toast,
  toCsv, toIsoDate,
} from '../util.js';

const TYPE_KIND = { new: 'bad', recurring: 'warn', flaky: 'info', known: '' };

export async function render(root, ctx) {
  const st = Object.assign({ tab: 'errors', type: 'all', cur: '', prev: '', q: '', status: 'open', etype: '', app: '', resp: '', only: '', sort: 'last', snap: '' }, store('tri') || {});
  if (st.tab === 'analysis' && !store('tri.v2')) st.tab = 'errors';
  store('tri.v2', true);
  const save = () => store('tri', st);
  const canWrite = ctx.canWriteSection('runs');
  let runs = [], known = [], errors = [], snaps = [], timeline = [];

  root.appendChild(h('div', { class: 'page-head' },
    h('div', null, h('h1', null, ctx.pageLabel('triage')), h('p', null, t('tri_intro'))),
    h('div', { class: 'actions' }, canWrite ? [btn(t('err_import'), importErrors, { icon: 'upload', cls: 'primary' }), btn(t('tri_import'), importRun, { icon: 'upload' })] : null)));
  const tabBox = h('div'), body = h('div', { class: 'stack' });
  root.append(tabBox, body);

  async function load(force) {
    runs = (await ctx.records('runs', force)).slice().sort((a, b) => String(a.data?.date || '').localeCompare(String(b.data?.date || '')) || a.created_at - b.created_at);
    [known, errors, snaps] = await Promise.all([ctx.records('known', force), ctx.records('errors', force), ctx.records('errsnaps', force)]);
    snaps = snaps.slice().sort((a, b) => String(b.data?.date || '').localeCompare(String(a.data?.date || '')) || b.created_at - a.created_at);
    timeline = ctx.canPage('timeline') ? await ctx.records('timeline').catch(() => []) : [];
    paint();
  }

  function paint() {
    clear(tabBox).appendChild(tabs([['errors', `${t('err_t_items')}${errors.length ? ' · ' + errors.length : ''}`], ['changes', t('err_t_changes')],
      ['analysis', t('tri_t_analysis')], ['runs', t('tri_t_runs')], ['known', t('tri_t_known')], ['history', t('tab_history')]], st.tab, v => { st.tab = v; save(); paint(); }));
    clear(body);
    if (st.tab === 'history') { historyTab(body, ctx, ['errors', 'runs', 'known'], () => load(true)); return; }
    if (st.tab === 'errors') { errorsTab(); return; }
    if (st.tab === 'changes') { changesTab(); return; }
    if (st.tab === 'runs') { runList(); return; }
    if (st.tab === 'known') { knownList(); return; }
    analysis();
  }

  // ------------------------------------------------------------ error items
  const lastSnap = () => snaps[0] || null;
  const win = () => regtestWindow(timeline, iso(new Date()));
  const statusKind = s => (isOpen(s) ? (/^new$/i.test(s) ? 'bad' : 'warn') : /solved|closed/i.test(s) ? 'ok' : '');

  function changedIds(snap) {
    if (!snap) return new Set();
    return new Set([...(snap.data.added || []), ...(snap.data.status || []).map(x => x.id), ...(snap.data.runs_up || []).map(x => x.id)]);
  }

  function errorsTab() {
    if (!errors.length) { body.appendChild(emptyState(t('err_empty'), canWrite ? btn(t('err_import'), importErrors, { icon: 'upload', cls: 'primary' }) : null)); return; }
    const snap = lastSnap(), w = win(), changed = changedIds(snap);
    const open = errors.filter(r => isOpen(r.data?.status));
    const inWin = w ? errors.filter(r => within(r.data?.last, w.s, w.e)) : [];
    body.appendChild(h('div', { class: 'kpis' },
      kpi(t('err_k_total'), errors.length), kpi(t('err_k_open'), open.length, open.length ? 'warn' : 'ok'),
      kpi(t('err_k_new'), snap ? (snap.data.added || []).length : '—', snap?.data.added?.length ? 'bad' : ''),
      kpi(t('err_k_status'), snap ? (snap.data.status || []).length : '—', snap?.data.status?.length ? 'info' : ''),
      kpi(t('err_k_runs_up'), snap ? (snap.data.runs_up || []).length : '—', snap?.data.runs_up?.length ? 'warn' : ''),
      kpi(t('err_k_window'), w ? inWin.length : '—', inWin.length ? 'warn' : '')));
    body.appendChild(h('p', { class: 'hint', style: { margin: 0 } },
      snap ? t('err_last_import', { file: snap.data.file, at: fmtDate(snap.data.date) }) : '',
      w ? ' · ' + t(w.current ? 'err_window_now' : 'err_window_last', { title: w.r.title, from: fmtDate(w.s), to: fmtDate(w.e) }) : ' · ' + t('err_window_none')));
    const uniq = f => [...new Set(errors.flatMap(f).filter(Boolean))].sort();
    const search = h('input', { type: 'search', value: st.q, placeholder: t('err_search'), 'aria-label': t('err_search') });
    search.addEventListener('input', () => { st.q = search.value; save(); paintTable(); });
    const sel = (key, label, opts) => h('select', { 'aria-label': label, onchange: e => { st[key] = e.target.value; save(); paintTable(); } },
      h('option', { value: '' }, label), opts.map(([v, l]) => h('option', { value: v, selected: st[key] === v }, l)));
    // Sort field; the newest/oldest switch only applies to "last seen".
    const sortBox = h('div', { class: 'toolbar', style: { margin: 0 } });
    const paintSort = () => clear(sortBox).append(
      h('select', { 'aria-label': t('err_sort'), onchange: e => { st.sort = e.target.value; save(); paintSort(); paintTable(); } },
        [['last', t('err_sort_last')], ['runs', t('err_sort_runs')], ['id', t('err_sort_id')]].map(([v, l]) => h('option', { value: v, selected: st.sort === v }, l))),
      st.sort === 'last' ? orderToggle('tri.errors', () => paintTable()) : '');
    paintSort();
    body.appendChild(h('div', { class: 'toolbar' },
      h('div', { class: 'grow' }, search),
      sel('status', t('err_all_status'), [['open', t('err_open_only')], ...uniq(r => [r.data?.status]).map(s => [s, s])]),
      sel('etype', t('err_all_types'), uniq(r => [r.data?.type]).map(s => [s, s])),
      sel('app', t('err_all_apps'), uniq(r => [r.data?.app]).map(s => [s, s])),
      sel('resp', t('err_all_resp'), uniq(r => r.data?.responsibles || []).map(s => [s, s])),
      sel('only', t('err_all_items'), [['changed', t('err_only_changed')], ...(w ? [['window', t('err_only_window')]] : [])]),
      sortBox,
      btn(t('err_report'), () => copyText(errorReport()), { icon: 'copy' }),
      btn('CSV', exportErrors, { icon: 'download' })));
    const tableBox = h('div');
    body.appendChild(tableBox);
    function visible() {
      return errors.filter(r => matchText(r, st.q)
        && (!st.status || (st.status === 'open' ? isOpen(r.data?.status) : r.data?.status === st.status))
        && (!st.etype || r.data?.type === st.etype) && (!st.app || r.data?.app === st.app)
        && (!st.resp || (r.data?.responsibles || []).includes(st.resp))
        && (!st.only || (st.only === 'changed' ? changed.has(r.key) : w && within(r.data?.last, w.s, w.e))))
        .sort((a, b) => st.sort === 'runs' ? (b.data?.runs?.[2] || 0) - (a.data?.runs?.[2] || 0)
          : st.sort === 'id' ? String(a.key).localeCompare(String(b.key), undefined, { numeric: true })
            : directed((x, y) => String(x.data?.last || '').localeCompare(String(y.data?.last || '')), listOrder('tri.errors'))(a, b)
              || String(a.key).localeCompare(String(b.key), undefined, { numeric: true }));
    }
    function paintTable() {
      clear(tableBox);
      const vis = visible();
      if (!vis.length) { tableBox.appendChild(emptyState(t('no_match'))); return; }
      tableBox.appendChild(h('div', { class: 'hint' }, t('n_items', { n: vis.length })));
      tableBox.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 't' },
        h('thead', null, h('tr', null, ['ID', t('f_title'), t('f_status'), t('f_type'), t('err_runs'), t('err_packages'), t('err_resp'), t('err_last'), t('err_app')].map(x => h('th', null, x)))),
        h('tbody', null, vis.map(r => {
          const d = r.data || {}, prev = d.prev_runs?.[2], delta = prev !== undefined && prev !== null ? (d.runs?.[2] || 0) - prev : 0;
          return h('tr', { class: 'click', tabindex: '0', onclick: () => errorDetail(r), onkeydown: e => { if (e.key === 'Enter') errorDetail(r); } },
            h('td', { class: 'mono nowrap' }, r.key, (snap?.data.added || []).includes(r.key) ? h('span', null, ' ', chip(t('err_new'), 'bad')) : null),
            h('td', { style: { minWidth: '240px' } }, r.title),
            h('td', { class: 'nowrap' }, chip(d.status || '—', statusKind(d.status)),
              d.prev_status && d.status_since === d.last_import ? h('div', { class: 'small muted' }, `${t('err_was')} ${d.prev_status}`) : null),
            h('td', { class: 'small' }, d.type || ''),
            h('td', { class: 'num nowrap', title: t('err_runs_hint') }, (d.runs || []).join(' / '), delta > 0 ? h('span', { style: { color: 'var(--bad)', fontWeight: 600 } }, ` +${delta}`) : null),
            h('td', { class: 'num' }, d.packages || ''),
            h('td', { class: 'small' }, (d.responsibles || []).join(', ')),
            h('td', { class: 'nowrap small' }, d.last ? fmtDateTime(Date.parse(d.last) / 1000) : '', w && within(d.last, w.s, w.e) ? h('div', null, chip(t('err_in_window'), 'warn')) : null),
            h('td', { class: 'small' }, d.app || ''));
        })))));
    }
    paintTable();
  }

  function errorDetail(r) {
    const d = r.data || {};
    const hist = snaps.slice().reverse().map(sn => ({ sn, it: (sn.data.items || []).find(x => x[0] === r.key) })).filter(x => x.it);
    const max = Math.max(1, ...hist.map(x => x.it[2] || 0));
    // hist runs oldest → newest (bars); the table follows the list's newest/oldest switch.
    const histBox = h('div', { class: 'stack' });
    const paintHist = () => clear(histBox).append(
      h('div', { class: 'toolbar', style: { margin: 0 } }, orderToggle('tri.errhist', () => paintHist())),
      h('div', { class: 'table-wrap' }, h('table', { class: 't' },
        h('thead', null, h('tr', null, [t('f_date'), t('f_file'), t('f_status'), t('err_runs_total')].map(x => h('th', null, x)))),
        h('tbody', null, (listOrder('tri.errhist') === 'asc' ? hist : hist.slice().reverse()).map(({ sn, it }) => h('tr', null, h('td', { class: 'nowrap' }, fmtDate(sn.data.date)), h('td', { class: 'small' }, sn.data.file),
          h('td', null, chip(it[1] || '—', statusKind(it[1]))), h('td', { class: 'num' }, it[2])))))));
    paintHist();
    modal({
      title: `${r.key} · ${r.title}`, wide: true,
      body: [
        h('div', { class: 'grid-form' }, [[t('f_status'), d.status], [t('err_status_since'), fmtDate(d.status_since)], [t('f_type'), d.type], [t('err_app'), d.app],
          [t('err_runs'), (d.runs || []).join(' / ')], [t('err_packages'), d.packages], [t('err_resp'), (d.responsibles || []).join(', ')],
          [t('err_first'), d.first ? fmtDateTime(Date.parse(d.first) / 1000) : ''], [t('err_last'), d.last ? fmtDateTime(Date.parse(d.last) / 1000) : ''],
          [t('err_first_import'), fmtDate(d.first_import)]].map(([l, v]) => h('div', null, h('div', { class: 'small muted' }, l), h('div', null, String(v ?? '') || '—')))),
        h('p', { class: 'hint' }, t('err_runs_hint')),
        hist.length > 1 ? h('div', { class: 'card' }, h('h3', null, t('err_hist')),
          h('div', { class: 'bars', role: 'img', 'aria-label': t('err_hist') }, hist.map(({ sn, it }) => h('div', { class: 'b', title: `${sn.data.file}: ${it[1]} · ${it[2]}` },
            h('em', null, it[2]), h('span', { style: { height: Math.max(3, (it[2] || 0) / max * 100) + '%' } }), h('small', null, fmtDate(sn.data.date, { day: '2-digit', month: 'short' })))))) : null,
        hist.length ? histBox : null],
    });
  }

  function changesTab() {
    if (!snaps.length) { body.appendChild(emptyState(t('err_no_snaps'), canWrite ? btn(t('err_import'), importErrors, { icon: 'upload', cls: 'primary' }) : null)); return; }
    const cur = snaps.find(s => s.id === st.snap) || snaps[0];
    const title = id => errors.find(r => r.key === id)?.title || '';
    body.appendChild(h('div', { class: 'toolbar' },
      h('label', { class: 'field' }, t('err_import_of'), h('select', { onchange: e => { st.snap = e.target.value; save(); paint(); } },
        snaps.map(s => h('option', { value: s.id, selected: s.id === cur.id }, `${fmtDate(s.data.date)} · ${s.data.file}`)))),
      h('span', { class: 'sp' }), btn(t('err_report'), () => copyText(errorReport(cur)), { icon: 'copy' })));
    const d = cur.data;
    body.appendChild(h('div', { class: 'kpis' }, kpi(t('err_k_total'), d.total), kpi(t('err_k_open'), d.open, 'warn'), kpi(t('err_k_new'), d.added.length, d.added.length ? 'bad' : ''),
      kpi(t('err_k_status'), d.status.length, d.status.length ? 'info' : ''), kpi(t('err_k_runs_up'), d.runs_up.length, d.runs_up.length ? 'warn' : ''),
      kpi(t('err_k_seen'), d.seen_again.length), kpi(t('err_k_gone'), d.gone.length)));
    const section = (label, rows, cols) => rows.length ? h('section', { class: 'card' }, h('h2', null, `${label} · ${rows.length}`),
      h('div', { class: 'table-wrap' }, h('table', { class: 't' }, h('tbody', null, rows.map(cols))))) : null;
    const open = id => { const r = errors.find(x => x.key === id); if (r) errorDetail(r); };
    const idCell = id => h('td', { class: 'mono nowrap' }, h('button', { type: 'button', class: 'btn sm ghost', onclick: () => open(id) }, id));
    body.append(...[
      section(t('err_k_new'), d.added, id => h('tr', null, idCell(id), h('td', null, title(id)))),
      section(t('err_k_status'), d.status, x => h('tr', null, idCell(x.id), h('td', null, title(x.id)), h('td', { class: 'nowrap' }, chip(x.from || '—'), ' → ', chip(x.to, statusKind(x.to))))),
      section(t('err_k_runs_up'), d.runs_up, x => h('tr', null, idCell(x.id), h('td', null, title(x.id)), h('td', { class: 'num nowrap' }, `${x.from} → ${x.to}`, h('b', { style: { color: 'var(--bad)' } }, ` +${x.to - x.from}`)))),
      section(t('err_k_gone'), d.gone, id => h('tr', null, idCell(id), h('td', null, title(id)))),
    ].filter(Boolean));
    if (!d.added.length && !d.status.length && !d.runs_up.length && !d.gone.length) body.appendChild(emptyState(t('err_no_changes')));
  }

  function errorReport(snap = lastSnap()) {
    const w = win();
    const open = errors.filter(r => isOpen(r.data?.status));
    const lines = [`${t('err_report_title')} · ${fmtDate(new Date())}`];
    if (w) lines.push(`${w.r.title}: ${fmtDate(w.s)} – ${fmtDate(w.e)}`);
    lines.push(`${t('err_k_open')}: ${open.length} / ${errors.length}`);
    if (snap) {
      const d = snap.data, ttl = id => errors.find(r => r.key === id)?.title || '';
      lines.push(`${t('err_since_import', { file: d.file })}: ${t('err_k_new')} ${d.added.length} · ${t('err_k_status')} ${d.status.length} · ${t('err_k_runs_up')} ${d.runs_up.length}`);
      if (d.added.length) { lines.push('', t('err_k_new') + ':'); d.added.forEach(id => lines.push(`- ${id} ${ttl(id)}`)); }
      if (d.status.length) { lines.push('', t('err_k_status') + ':'); d.status.forEach(x => lines.push(`- ${x.id} ${ttl(x.id)}: ${x.from || '—'} → ${x.to}`)); }
      if (d.runs_up.length) { lines.push('', t('err_k_runs_up') + ':'); d.runs_up.slice(0, 15).forEach(x => lines.push(`- ${x.id} ${ttl(x.id)}: ${x.from} → ${x.to}`)); }
    }
    if (w) {
      const inWin = open.filter(r => within(r.data?.last, w.s, w.e));
      if (inWin.length) { lines.push('', t('err_open_in_window') + ':'); inWin.forEach(r => lines.push(`- ${r.key} ${r.title} [${r.data.status}]`)); }
    }
    return lines.join('\n');
  }

  function exportErrors() {
    {
      download(`errors-${iso(new Date())}.csv`, '\uFEFF' + toCsv(errors, [{ label: 'Error-ID', key: 'key' }, { label: 'Title', key: 'title' }, { label: 'Status', get: r => r.data?.status },
        { label: 'Type', get: r => r.data?.type }, { label: 'TestRunCount', get: r => (r.data?.runs || []).join(' / ') }, { label: 'Affected TestPackages', get: r => r.data?.packages },
        { label: 'Responsibles', get: r => (r.data?.responsibles || []).join(';') }, { label: 'First Time Stamp', get: r => r.data?.first }, { label: 'Last Time Stamp', get: r => r.data?.last },
        { label: 'Application Name', get: r => r.data?.app }, { label: 'Status since', get: r => r.data?.status_since }]), 'text/csv');
    }
  }

  function importErrors() {
    const today = iso(new Date());
    let diff = null, items = [];
    openImport({
      api: ctx.api, section: 'errors', title: t('err_import'), accept: '.xlsx,.xlsm,.csv', hint: t('err_import_hint'), modes: ['upsert'], defaultMode: 'upsert',
      fields: EM_FIELDS.map(f => ({ ...f, label: t('em_' + f.key) })),
      toRecord: m => toItem(m),
      collect: rows => {
        items = rows;
        diff = diffErrors(errors, items);
        const byKey = new Map(errors.map(r => [r.key, r]));
        return items.map(it => toRecord(it, byKey.get(it.id), today));
      },
      summary: () => h('div', { class: 'pill-row' },
        chip(`${t('err_k_new')} · ${diff.added.length}`, diff.added.length ? 'bad' : ''), chip(`${t('err_k_status')} · ${diff.status.length}`, diff.status.length ? 'info' : ''),
        chip(`${t('err_k_runs_up')} · ${diff.runsUp.length}`, diff.runsUp.length ? 'warn' : ''), chip(`${t('err_k_gone')} · ${diff.gone.length}`)),
      previewCols: [['key', 'ID'], ['title', t('f_title')], ['kind', t('f_type')]],
      onDone: async (res, recs, file) => {
        try { await ctx.api.create('errsnaps', snapshot(items, diff, file?.name || 'export', today)); } catch (e) { toast(e.message, 'bad'); }
        ctx.invalidate('errors', 'errsnaps'); st.snap = ''; st.tab = 'changes'; save(); load(true);
      },
    });
  }

  function analysis() {
    if (!runs.length) { body.appendChild(emptyState(t('tri_empty'), canWrite ? btn(t('tri_import'), importRun, { icon: 'upload', cls: 'primary' }) : null)); return; }
    let cur = runs.find(r => r.id === st.cur) || runs[runs.length - 1];
    let prev = runs.find(r => r.id === st.prev && r !== cur) || runs[runs.indexOf(cur) - 1] || null;
    const runSel = (val, on, allowNone) => h('select', { onchange: e => on(e.target.value) },
      allowNone ? h('option', { value: '' }, '—') : null,
      runs.slice().reverse().map(r => h('option', { value: r.id, selected: r.id === val }, `${r.title} (${fmtDate(r.data?.date)})`)));
    body.appendChild(h('div', { class: 'toolbar' },
      h('label', { class: 'field' }, t('tri_run'), runSel(cur.id, v => { st.cur = v; st.prev = ''; save(); paint(); })),
      h('label', { class: 'field' }, t('tri_compare'), runSel(prev?.id, v => { st.prev = v; save(); paint(); }, true)),
      h('span', { class: 'sp' }),
      btn(t('tri_report'), () => copyText(report(a, cur, prev)), { icon: 'copy' })));
    const a = analyse(runs, cur, prev, known, +ctx.settings.flaky_window || 5);
    body.appendChild(h('div', { class: 'kpis' },
      kpi(t('tri_k_run'), a.total), kpi(t('tri_k_passed'), a.passed, 'ok'), kpi(t('tri_k_failed'), a.failed, a.failed ? 'bad' : 'ok'),
      kpi(t('tri_k_new'), a.count('new'), a.count('new') ? 'bad' : ''), kpi(t('tri_k_recurring'), a.count('recurring'), 'warn'),
      kpi(t('tri_k_known'), a.count('known')), kpi(t('tri_k_flaky'), a.count('flaky')), kpi(t('tri_k_resolved'), a.resolved.length, 'ok')));
    body.appendChild(h('p', { class: 'muted', style: { margin: 0 } }, t('tri_grouped', { f: a.failed, g: a.groups.length })));
    const counts = type => a.groups.filter(g => g.type === type).length;
    body.appendChild(seg([['all', `${t('all')} · ${a.groups.length}`], ...['new', 'recurring', 'flaky', 'known'].map(x => [x, `${t('tri_type_' + x)} · ${counts(x)}`])],
      st.type, v => { st.type = v; save(); paint(); }));
    const groups = a.groups.filter(g => st.type === 'all' || g.type === st.type);
    if (!groups.length) body.appendChild(emptyState(t('tri_no_groups')));
    else body.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 't' },
      h('thead', null, h('tr', null, [t('f_type'), t('tri_message'), t('tri_tests'), t('tri_first_seen'), t('tri_reason'), ''].map(x => h('th', null, x)))),
      h('tbody', null, groups.map(g => h('tr', null,
        h('td', null, chip(t('tri_type_' + g.type), TYPE_KIND[g.type])),
        h('td', { style: { minWidth: '260px' } }, h('span', { class: 'mono' }, g.sample)),
        h('td', null, h('button', { type: 'button', class: 'btn sm ghost', onclick: () => testList(g) }, String(g.tests.length))),
        h('td', { class: 'nowrap' }, fmtDate(g.firstSeen)),
        h('td', null, g.known ? `${g.known.data?.reason || ''}${g.known.data?.bug ? ' · ' + g.known.data.bug : ''}` : ''),
        h('td', null, canWrite && g.type !== 'known' ? btn(t('tri_mark_known'), () => editKnown(null, g.sample), { cls: 'sm' }) : null)))))));
    if (a.resolved.length) body.appendChild(h('div', { class: 'card' }, h('h2', null, t('tri_resolved')),
      h('div', { class: 'list' }, a.resolved.map(f => h('div', { class: 'li' }, chip(t('tri_k_resolved'), 'ok'), h('span', { class: 'mono grow' }, f.message), h('span', { class: 'muted' }, f.test))))));
    body.appendChild(trend());
  }

  function kpi(label, v, kind) { return h('div', { class: 'kpi ' + (kind || '') }, h('div', { class: 'l' }, label), h('div', { class: 'v' }, v)); }

  function testList(g) {
    modal({ title: g.sample, body: h('div', { class: 'list' }, g.tests.map(x => h('div', { class: 'li' }, h('span', { class: 'mono grow' }, x),
      g.flakyTests.includes(x) ? chip(t('tri_type_flaky'), 'info') : null))) });
  }

  function trend() {
    const last = runs.slice(-12);
    const max = Math.max(1, ...last.map(r => (r.data?.results || []).filter(x => x.status === 'failed').length));
    return h('div', { class: 'card' }, h('h2', null, t('tri_trend')),
      h('div', { class: 'bars', role: 'img', 'aria-label': t('tri_trend') }, last.map(r => {
        const n = (r.data?.results || []).filter(x => x.status === 'failed').length;
        return h('div', { class: 'b', title: `${r.title}: ${n}` }, h('em', null, n), h('span', { style: { height: Math.max(3, n / max * 100) + '%' } }),
          h('small', null, fmtDate(r.data?.date, { day: '2-digit', month: 'short' })));
      })));
  }

  function report(a, cur, prev) {
    const lines = [`${t('tri_report_title')} · ${cur.title} (${fmtDate(cur.data?.date)})${prev ? ` vs ${fmtDate(prev.data?.date)}` : ''}`,
      `${t('tri_k_run')}: ${a.total} · ${t('tri_k_passed')}: ${a.passed} · ${t('tri_k_failed')}: ${a.failed}`,
      `${t('tri_k_new')}: ${a.count('new')} · ${t('tri_k_recurring')}: ${a.count('recurring')} · ${t('tri_k_known')}: ${a.count('known')} · ${t('tri_k_flaky')}: ${a.count('flaky')} · ${t('tri_k_resolved')}: ${a.resolved.length}`];
    const news = a.groups.filter(g => g.type === 'new');
    if (news.length) { lines.push('', t('tri_report_new') + ':'); news.forEach(g => lines.push(`- ${g.sample} (${g.tests.length}: ${g.tests.slice(0, 5).join(', ')}${g.tests.length > 5 ? '…' : ''})`)); }
    return lines.join('\n');
  }

  function runList() {
    if (!runs.length) { body.appendChild(emptyState(t('tri_empty'))); return; }
    body.appendChild(h('div', { class: 'toolbar' }, orderToggle('tri.runs', () => paint())));
    body.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 't' },
      h('thead', null, h('tr', null, [t('f_date'), t('f_title'), t('tri_k_run'), t('tri_k_failed'), t('f_file'), ''].map(x => h('th', null, x)))),
      h('tbody', null, (listOrder('tri.runs') === 'asc' ? runs : runs.slice().reverse()).map(r => h('tr', null,
        h('td', { class: 'nowrap' }, fmtDate(r.data?.date)), h('td', null, r.title), h('td', { class: 'num' }, (r.data?.results || []).length),
        h('td', { class: 'num' }, (r.data?.results || []).filter(x => x.status === 'failed').length), h('td', { class: 'small muted' }, r.data?.source || ''),
        h('td', null, canWrite ? btn(t('delete'), async () => {
          if (!(await confirmBox(t('confirm_delete', { name: r.title }), t('delete')))) return;
          await ctx.api.remove(r.id); ctx.invalidate('runs'); load(true);
        }, { cls: 'sm danger', icon: 'trash' }) : null)))))));
  }

  function knownList() {
    body.appendChild(h('div', { class: 'toolbar' }, h('p', { class: 'hint grow', style: { margin: 0 } }, t('tri_known_hint')),
      canWrite ? btn(t('add'), () => editKnown(null, ''), { icon: 'plus' }) : null,
      canWrite ? btn(t('import'), importKnown, { icon: 'upload' }) : null));
    if (!known.length) { body.appendChild(emptyState(t('no_items'))); return; }
    body.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 't' },
      h('thead', null, h('tr', null, [t('tri_pattern'), t('tri_reason'), t('tri_bug')].map(x => h('th', null, x)))),
      h('tbody', null, known.map(k => h('tr', { class: 'click', tabindex: '0', onclick: () => editKnown(k) },
        h('td', { class: 'mono' }, k.data?.pattern || k.title), h('td', null, k.data?.reason || ''), h('td', null, k.data?.bug || '')))))));
  }

  function editKnown(k, sample) {
    const pattern = sample ? sample.replace(/\(.*?\d.*?\)/g, '').replace(/\d+([.,]\d+)?/g, '').replace(/\s+/g, ' ').trim().toLowerCase() : '';
    openEditor({
      ctx, section: 'known', record: k, defaults: { title: sample || '', data: { pattern } },
      fields: [{ key: 'title', label: t('f_title') }, { key: 'data.pattern', label: t('tri_pattern'), hint: t('tri_pattern_hint') },
        { key: 'data.reason', label: t('tri_reason') }, { key: 'data.bug', label: t('tri_bug') }],
      onSaved: () => { ctx.invalidate('known'); load(true); },
    });
  }

  function importRun() {
    openImport({
      api: ctx.api, section: 'runs', title: t('tri_import'), accept: '.xlsx,.xlsm,.csv', hint: t('tri_import_hint'), modes: ['append'], defaultMode: 'append',
      fields: [
        { key: 'test', label: t('f_test_id'), required: true, aliases: ['test', 'test id', 'testcase', 'test case', 'tc', 'id', 'name', 'testfall'] },
        { key: 'status', label: t('f_status'), required: true, aliases: ['status', 'result', 'ergebnis', 'rezultat', 'outcome', 'verdict', 'state'] },
        { key: 'message', label: t('tri_message'), aliases: ['message', 'error', 'error message', 'fehler', 'fehlermeldung', 'eroare', 'mesaj', 'reason', 'details'] },
        { key: 'date', label: t('f_date'), aliases: ['date', 'datum', 'data', 'run date', 'executed', 'timestamp'] },
      ],
      toRecord: m => String(m.test).trim() ? { test: String(m.test).trim(), status: statusOf(m.status), message: String(m.message || '').trim(), date: toIsoDate(m.date) } : null,
      collect: (rows, file) => {
        if (!rows.length) return [];
        const date = rows.find(r => r.date)?.date || iso(new Date());
        return [{ title: `Regtest ${date}`, key: '', data: { date, source: file?.name || '', results: rows.map(({ test, status, message }) => ({ test, status, message })) } }];
      },
      previewCols: [['title', t('f_title')], ['data.date', t('f_date')], ['data.source', t('f_file')]],
      onDone: () => { ctx.invalidate('runs'); st.cur = ''; st.prev = ''; save(); load(true); toast(t('tri_imported')); },
    });
  }

  function importKnown() {
    openImport({
      api: ctx.api, section: 'known', title: t('tri_t_known'), accept: '.xlsx,.csv',
      fields: [{ key: 'pattern', label: t('tri_pattern'), required: true, aliases: ['pattern', 'message', 'error', 'fehler', 'eroare'] },
        { key: 'reason', label: t('tri_reason'), aliases: ['reason', 'grund', 'motiv', 'comment'] }, { key: 'bug', label: t('tri_bug'), aliases: ['bug', 'ticket', 'issue', 'defect'] }],
      toRecord: m => String(m.pattern).trim() ? { key: String(m.pattern).trim().toLowerCase(), title: String(m.pattern).trim(), data: { pattern: String(m.pattern).trim().toLowerCase(), reason: String(m.reason || ''), bug: String(m.bug || '') } } : null,
      onDone: () => { ctx.invalidate('known'); load(true); },
    });
  }

  await load();
}
