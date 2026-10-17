// Regtest triage: compare two runs, grouped errors, known errors list, trend and daily report.
import { openEditor } from '../editor.js';
import { historyTab } from '../history-view.js';
import { t } from '../i18n.js';
import { openImport } from '../importer.js';
import { analyse, statusOf } from '../triage.js';
import { btn, chip, clear, confirmBox, copyText, emptyState, fmtDate, h, iso, modal, seg, store, tabs, toast, toIsoDate } from '../util.js';

const TYPE_KIND = { new: 'bad', recurring: 'warn', flaky: 'info', known: '' };

export async function render(root, ctx) {
  const st = Object.assign({ tab: 'analysis', type: 'all', cur: '', prev: '' }, store('tri') || {});
  const save = () => store('tri', st);
  const canWrite = ctx.canWriteSection('runs');
  let runs = [], known = [];

  root.appendChild(h('div', { class: 'page-head' },
    h('div', null, h('h1', null, t('nav_triage')), h('p', null, t('tri_intro'))),
    h('div', { class: 'actions' }, canWrite ? btn(t('tri_import'), importRun, { icon: 'upload', cls: 'primary' }) : null)));
  const tabBox = h('div'), body = h('div', { class: 'stack' });
  root.append(tabBox, body);

  async function load(force) {
    runs = (await ctx.records('runs', force)).slice().sort((a, b) => String(a.data?.date || '').localeCompare(String(b.data?.date || '')) || a.created_at - b.created_at);
    known = await ctx.records('known', force);
    paint();
  }

  function paint() {
    clear(tabBox).appendChild(tabs([['analysis', t('tri_t_analysis')], ['runs', t('tri_t_runs')], ['known', t('tri_t_known')], ['history', t('tab_history')]], st.tab, v => { st.tab = v; save(); paint(); }));
    clear(body);
    if (st.tab === 'history') { historyTab(body, ctx, ['runs', 'known'], () => load(true)); return; }
    if (st.tab === 'runs') { runList(); return; }
    if (st.tab === 'known') { knownList(); return; }
    analysis();
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
    body.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 't' },
      h('thead', null, h('tr', null, [t('f_date'), t('f_title'), t('tri_k_run'), t('tri_k_failed'), t('f_file'), ''].map(x => h('th', null, x)))),
      h('tbody', null, runs.slice().reverse().map(r => h('tr', null,
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
