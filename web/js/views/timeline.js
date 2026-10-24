// Release timeline: SharePoint import, data-quality check, release cloning, Gantt / calendar / year / list views.
import { openEditor } from '../editor.js';
import { historyTab } from '../history-view.js';
import { t } from '../i18n.js';
import { openImport } from '../importer.js';
import {
  checkTimeline, cloneRelease, cmpVersion, ENVIRONMENTS, fromSharePoint, ISSUE_TYPES, nextVersion, normalizeKind, releaseGapWeeks,
  SP_FIELDS, TIMELINE_KINDS, toSharePointRows,
} from '../timeline-gen.js';
import {
  addDays, btn, chip, clear, confirmBox, daysBetween, directed, download, emptyState, fmtDate, h, iso, isoWeek, listOrder, modal, normalize,
  orderToggle, parseIso, seg, store, tabs, toast, toCsv, toIsoDate,
} from '../util.js';

const PRIORITY = ['deployment', 'regtest', 'performance', 'integration', 'review', 'protocol', 'documentation', 'qa', 'freeze', 'planning', 'holiday', 'other', 'sprint'];
const LANES = { kind: r => r.kind || 'other', env: r => r.data.env || (r.kind === 'holiday' ? '~holiday' : '~none'), release: r => r.data.product ? '~' + r.data.product : r.data.release || '~none' };

export async function render(root, ctx) {
  const st = Object.assign({ view: 'gantt', zoom: 'month', lanes: 'kind', q: '', release: '', env: '', product: '', hidden: false,
    kinds: [...TIMELINE_KINDS], from: '', to: '', year: new Date().getFullYear() }, store('tl') || {});
  st.kinds = st.kinds.filter(k => TIMELINE_KINDS.includes(k));
  for (const k of TIMELINE_KINDS) if (!(store('tl.k') || []).includes(k) && !st.kinds.includes(k)) st.kinds.push(k);
  store('tl.k', TIMELINE_KINDS);
  const save = () => store('tl', st);
  const colors = ctx.settings.timeline_colors || {};
  const colorOf = k => colors[k] || colors.other || '#6B7280';
  const canWrite = ctx.canWriteSection('timeline');
  let records = [], all = [], issues = [];

  const head = h('div', { class: 'page-head' },
    h('div', null, h('h1', null, ctx.pageLabel('timeline')), h('p', null, t('tl_intro'))),
    h('div', { class: 'actions' },
      canWrite ? [
        btn(t('tl_import_sp'), importSharePoint, { icon: 'upload', cls: 'primary' }),
        btn(t('tl_clone'), openClone, { icon: 'wand' }),
        btn(t('tl_add'), () => edit(null), { icon: 'plus' }),
      ] : null,
      btn(t('tl_export_sp'), exportSharePoint, { icon: 'download', title: t('tl_export_sp_hint') }),
      btn('ICS', exportIcs, { icon: 'download', title: t('tl_export_ics') })));
  const tabBox = h('div');
  const filterBox = h('div', { class: 'stack' });
  const content = h('div');
  root.append(head, tabBox, filterBox, content);

  async function load(force) {
    records = await ctx.records('timeline', force);
    issues = checkTimeline(records);
    all = records.filter(r => r.data?.start)
      .map(r => ({ ...r, s: parseIso(r.data.start), e: parseIso(r.data.end && r.data.end >= r.data.start ? r.data.end : r.data.start) }))
      .filter(r => r.s).sort((a, b) => a.s - b.s || PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind));
    paint();
  }

  function filtered() {
    const q = normalize(st.q);
    const from = parseIso(st.from), to = parseIso(st.to);
    return all.filter(r => st.kinds.includes(r.kind || 'other')
      && (st.hidden || r.data.show !== false)
      && (!st.release || r.data.release === st.release)
      && (!st.env || r.data.env === st.env)
      && (!st.product || (st.product === '~main' ? !r.data.product : r.data.product === st.product))
      && (!q || normalize(`${r.title} ${r.data.release} ${r.data.sprint} ${r.data.owner || ''} ${r.data.substitute || ''} ${r.data.ot || ''} ${r.body}`).includes(q))
      && (!from || r.e >= from) && (!to || r.s <= to));
  }

  function paint() {
    const nIssues = issues.length;
    clear(tabBox).appendChild(tabs([['gantt', t('tl_v_gantt')], ['calendar', t('tl_v_calendar')], ['year', t('tl_v_year')], ['list', t('tl_v_list')],
      ['quality', nIssues ? `${t('tl_v_quality')} · ${nIssues}` : t('tl_v_quality')], ['history', t('tab_history')]],
    st.view, v => { st.view = v; save(); paint(); }));
    clear(filterBox); clear(content);
    if (st.view === 'history') { historyTab(content, ctx, ['timeline'], () => load(true)); return; }
    if (st.view === 'quality') { quality(); return; }
    paintFilters();
    const items = filtered();
    if (!all.length) {
      content.appendChild(emptyState(t('tl_empty'), canWrite ? btn(t('tl_import_sp'), importSharePoint, { icon: 'upload', cls: 'primary' }) : null));
      return;
    }
    if (!items.length) { content.appendChild(emptyState(t('no_match'))); return; }
    ({ gantt, calendar, year, list })[st.view]?.(items);
  }

  function paintFilters() {
    const releases = [...new Set(all.map(r => r.data.release).filter(Boolean))].sort(cmpVersion);
    const products = [...new Set(all.map(r => r.data.product).filter(Boolean))];
    const envs = ENVIRONMENTS.filter(e => all.some(r => r.data.env === e));
    const search = h('input', { type: 'search', placeholder: t('tl_search'), value: st.q, 'aria-label': t('tl_search') });
    search.addEventListener('input', () => { st.q = search.value; save(); clear(content); const it = filtered(); if (!it.length) content.appendChild(emptyState(t('no_match'))); else ({ gantt, calendar, year, list })[st.view](it); });
    const sel = (key, label, opts) => h('select', { 'aria-label': label, onchange: e => { st[key] = e.target.value; save(); paint(); } },
      h('option', { value: '' }, label), opts.map(([v, l]) => h('option', { value: v, selected: st[key] === v }, l)));
    const dirty = st.from || st.to || st.q || st.release || st.env || st.product || st.hidden || st.kinds.length !== TIMELINE_KINDS.length;
    filterBox.appendChild(h('div', { class: 'toolbar' },
      h('div', { class: 'grow' }, search),
      sel('release', t('tl_all_releases'), releases.slice().reverse().map(r => [r, r])),
      envs.length ? sel('env', t('tl_all_envs'), envs.map(e => [e, e])) : null,
      products.length ? sel('product', t('tl_all_products'), [['~main', t('tl_main_product')], ...products.map(p => [p, p])]) : null,
      h('label', { class: 'field', style: { flexDirection: 'row', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' } }, t('from'),
        h('input', { type: 'date', value: st.from, onchange: e => { st.from = e.target.value; save(); paint(); } })),
      h('label', { class: 'field', style: { flexDirection: 'row', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' } }, t('to'),
        h('input', { type: 'date', value: st.to, onchange: e => { st.to = e.target.value; save(); paint(); } })),
      all.some(r => r.data.show === false) ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: st.hidden, onchange: e => { st.hidden = e.target.checked; save(); paint(); } }), t('tl_show_hidden')) : null,
      dirty ? btn(t('reset_filters'), () => { Object.assign(st, { q: '', release: '', env: '', product: '', hidden: false, from: '', to: '', kinds: [...TIMELINE_KINDS] }); save(); paint(); }, { cls: 'ghost sm' }) : null));
    filterBox.appendChild(h('div', { class: 'toolbar' },
      st.view === 'gantt' ? seg([['kind', t('tl_lanes_kind')], ['env', t('tl_lanes_env')], ['release', t('tl_lanes_release')]], st.lanes, v => { st.lanes = v; save(); paint(); }) : null,
      st.view === 'gantt' ? seg([['week', t('zoom_week')], ['month', t('zoom_month')], ['quarter', t('zoom_quarter')]], st.zoom, z => { st.zoom = z; save(); paint(); }) : null,
      st.view === 'list' ? orderToggle('timeline.list', () => paint()) : null,
      st.view !== 'list' ? btn(t('today'), () => scrollToday(), { cls: 'sm' }) : null));
    const present = new Set(all.map(r => r.kind || 'other'));
    filterBox.appendChild(h('div', { class: 'pill-row', role: 'group', 'aria-label': t('f_type') },
      TIMELINE_KINDS.filter(k => present.has(k)).map(k => {
        const on = st.kinds.includes(k);
        return h('button', { type: 'button', class: 'chip' + (on ? '' : ' off'), 'aria-pressed': String(on),
          style: on ? { background: colorOf(k), color: '#FFFFFF' } : null,
          onclick: () => { st.kinds = on ? st.kinds.filter(x => x !== k) : [...st.kinds, k]; save(); paint(); } },
        t('k_' + k), h('span', { class: 'num', style: { opacity: .8 } }, ' ' + all.filter(r => r.kind === k).length));
      })));
  }

  let scrollToday = () => {};
  const laneLabel = v => (v === '~none' ? t('tl_lane_none') : v === '~holiday' ? t('k_holiday') : v.startsWith('~') ? v.slice(1) : st.lanes === 'kind' ? t('k_' + v) : v);
  const tip = r => [r.title, `${fmtDate(r.s)} – ${fmtDate(r.e)}`, [r.data.release, r.data.sprint, r.data.env, r.data.ot && 'OT ' + r.data.ot].filter(Boolean).join(' · '),
    r.data.substitute ? `${t('f_substitute')}: ${r.data.substitute}` : ''].filter(Boolean).join('\n');

  // ---------------------------------------------------------------- Gantt
  function gantt(items) {
    const dayW = { week: 34, month: 11, quarter: 4 }[st.zoom];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let min = parseIso(st.from) || items[0].s, max = parseIso(st.to) || items.reduce((m, r) => r.e > m ? r.e : m, items[0].e);
    min = new Date(min.getFullYear(), min.getMonth(), 1);
    max = addDays(new Date(max.getFullYear(), max.getMonth() + 1, 0), 1);
    const width = daysBetween(min, max) * dayW;
    const x = d => daysBetween(min, d) * dayW;
    const months = [], weeks = [];
    for (let d = new Date(min); d < max; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      months.push(h('div', { style: { left: x(d) + 'px', width: (x(next > max ? max : next) - x(d)) + 'px' } },
        d.toLocaleDateString(t.locale(), { month: dayW < 6 ? 'short' : 'long', year: 'numeric' })));
    }
    if (dayW * 7 >= 30) {
      let d = new Date(min); while (d.getDay() !== 1) d = addDays(d, 1);
      for (; d < max; d = addDays(d, 7)) weeks.push(h('div', { style: { left: x(d) + 'px', width: 7 * dayW + 'px' } }, `${t('week_short')} ${isoWeek(d)}`));
    }
    const weekend = [];
    if (dayW >= 10) for (let d = new Date(min); d < max; d = addDays(d, 1)) if (d.getDay() === 0 || d.getDay() === 6) weekend.push(h('div', { class: 'g-weekend', style: { left: x(d) + 'px', width: dayW + 'px' } }));
    const keyOf = LANES[st.lanes] || LANES.kind;
    let laneKeys = [...new Set(items.map(keyOf))];
    if (st.lanes === 'kind') laneKeys.sort((a, b) => TIMELINE_KINDS.indexOf(a) - TIMELINE_KINDS.indexOf(b));
    else if (st.lanes === 'env') laneKeys.sort((a, b) => (ENVIRONMENTS.indexOf(a) + 1 || 99) - (ENVIRONMENTS.indexOf(b) + 1 || 99));
    else laneKeys.sort((a, b) => (a.startsWith('~') ? 1 : 0) - (b.startsWith('~') ? 1 : 0) || cmpVersion(a, b));
    const lanes = laneKeys.map(key => {
      const ev = items.filter(r => keyOf(r) === key);
      const rows = []; // greedy packing so overlapping bars get their own row
      const placed = ev.map(r => {
        const left = x(r.s), w = Math.max(dayW * (daysBetween(r.s, r.e) + 1), 6);
        let row = rows.findIndex(end => end <= left - 2);
        if (row < 0) { row = rows.length; rows.push(0); }
        rows[row] = left + Math.max(w, 60);
        return { r, left, w, row };
      });
      return h('div', { class: 'g-lane', style: { height: (rows.length * 28 + 30) + 'px', width: width + 'px' } },
        weekend.map(n => n.cloneNode()),
        h('span', { class: 'g-lane-label' }, laneLabel(key)),
        placed.map(({ r, left, w, row }) => h('button', { type: 'button', class: 'g-bar', title: tip(r),
          style: { left: left + 'px', width: w + 'px', top: (26 + row * 28) + 'px', background: colorOf(r.kind), opacity: r.kind === 'sprint' ? .55 : 1 },
          onclick: () => edit(r) }, w > 30 ? r.title : '')));
    });
    const todayLine = today >= min && today <= max ? h('div', { class: 'g-today', style: { left: x(today) + 'px' } }) : null;
    const box = h('div', { class: 'gantt', tabindex: '0', 'aria-label': t('tl_v_gantt') },
      h('div', { class: 'gantt-inner', style: { width: width + 'px' } },
        h('div', { class: 'g-head' }, h('div', { class: 'g-months' }, months), weeks.length ? h('div', { class: 'g-weeks' }, weeks) : null),
        lanes, todayLine));
    content.appendChild(box);
    content.appendChild(legend());
    scrollToday = () => { box.scrollLeft = Math.max(0, x(today) - box.clientWidth / 3); };
    requestAnimationFrame(scrollToday);
  }

  // -------------------------------------------------------------- calendar
  function eventsOn(items, d) { const we = d.getDay() === 0 || d.getDay() === 6; return items.filter(r => r.s <= d && r.e >= d && !(we && r.kind === 'sprint')).sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind)); }

  function calendar(items) {
    const first = parseIso(st.from) || new Date(items[0].s.getFullYear(), items[0].s.getMonth(), 1);
    const last = parseIso(st.to) || items.reduce((m, r) => r.e > m ? r.e : m, items[0].e);
    const scroller = h('div', { class: 'cal-scroll' });
    const todayIso = iso(new Date());
    let todayMonth = null;
    const dows = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(t.locale(), { weekday: 'short' }));
    for (let m = new Date(first.getFullYear(), first.getMonth(), 1); m <= last; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) {
      const start = addDays(m, -((m.getDay() + 6) % 7));
      const cells = [];
      for (let i = 0; i < 42; i++) {
        const d = addDays(start, i);
        if (i >= 35 && d.getMonth() !== m.getMonth()) break;
        const ev = eventsOn(items, d);
        cells.push(h('div', { class: 'day' + (d.getMonth() !== m.getMonth() ? ' out' : '') + (iso(d) === todayIso ? ' today' : '') },
          h('span', { class: 'd' }, d.getDate()),
          ev.slice(0, 3).map(r => h('button', { type: 'button', class: 'ev', style: { background: colorOf(r.kind) }, title: tip(r), onclick: () => edit(r) }, r.title)),
          ev.length > 3 ? h('button', { type: 'button', class: 'more btn ghost sm', onclick: () => dayList(d, ev) }, t('more_n', { n: ev.length - 3 })) : null));
      }
      const block = h('section', { class: 'cal-month' },
        h('h3', null, m.toLocaleDateString(t.locale(), { month: 'long', year: 'numeric' })),
        h('div', { class: 'cal' }, dows.map(d => h('div', { class: 'dow' }, d)), cells));
      if (m.getFullYear() === new Date().getFullYear() && m.getMonth() === new Date().getMonth()) todayMonth = block;
      scroller.appendChild(block);
    }
    content.appendChild(scroller);
    content.appendChild(legend());
    scrollToday = () => { if (todayMonth) scroller.scrollTop = todayMonth.offsetTop - scroller.offsetTop; };
    requestAnimationFrame(scrollToday);
  }

  function dayList(d, ev) {
    modal({ title: fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
      body: h('div', { class: 'list' }, ev.map(r => h('div', { class: 'li' }, chip(t('k_' + r.kind), '', colorOf(r.kind)),
        h('div', { class: 'grow' }, r.title, h('div', { class: 'small muted' }, `${fmtDate(r.s)} – ${fmtDate(r.e)}`)),
        btn(t('open'), () => edit(r), { cls: 'sm' })))) });
  }

  // ------------------------------------------------------------------ year
  function year(items) {
    const years = [...new Set(items.flatMap(r => [r.s.getFullYear(), r.e.getFullYear()]))].sort();
    if (!years.includes(+st.year)) st.year = years.includes(new Date().getFullYear()) ? new Date().getFullYear() : years[years.length - 1];
    const y = +st.year;
    const grid = h('div', { class: 'year' });
    const dows = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(t.locale(), { weekday: 'narrow' }));
    for (let mo = 0; mo < 12; mo++) {
      const m = new Date(y, mo, 1);
      const lead = (m.getDay() + 6) % 7;
      const cells = dows.map(d => h('div', { class: 'c blank small muted' }, d));
      for (let i = 0; i < lead; i++) cells.push(h('div', { class: 'c blank' }));
      for (let d = new Date(m); d.getMonth() === mo; d = addDays(d, 1)) {
        const ev = eventsOn(items, d);
        const top = ev.find(r => r.kind !== 'sprint') || ev[0];
        const dd = new Date(d);
        cells.push(top
          ? h('button', { type: 'button', class: 'c has', style: { background: colorOf(top.kind) }, title: ev.map(r => r.title).join('\n'), onclick: () => dayList(dd, ev) }, d.getDate())
          : h('div', { class: 'c' }, d.getDate()));
      }
      grid.appendChild(h('div', { class: 'card mini' }, h('h3', null, m.toLocaleDateString(t.locale(), { month: 'long' })), h('div', { class: 'g' }, cells)));
    }
    content.appendChild(h('div', { class: 'stack' },
      h('div', { class: 'toolbar' }, seg(years.map(v => [String(v), String(v)]), String(y), v => { st.year = +v; save(); paint(); }),
        h('span', { class: 'hint' }, t('tl_year_hint'))),
      grid, legend()));
  }

  // ------------------------------------------------------------------ list
  function list(items) {
    items = items.slice().sort(directed((a, b) => a.s - b.s || a.e - b.e, listOrder('timeline.list')));
    const rows = [];
    let month = '';
    const cols = [t('f_type'), t('f_title'), t('f_start'), t('f_end'), t('f_days'), t('f_release'), t('f_sprint'), t('f_env'), 'OT', t('f_owner')];
    for (const r of items) {
      const mk = r.s.toLocaleDateString(t.locale(), { month: 'long', year: 'numeric' });
      if (mk !== month) { month = mk; rows.push(h('tr', null, h('td', { colspan: cols.length, style: { background: 'var(--surface-2)', fontWeight: 600 } }, mk))); }
      rows.push(h('tr', { class: 'click', onclick: () => edit(r), tabindex: '0', onkeydown: e => { if (e.key === 'Enter') edit(r); } },
        h('td', null, chip(t('k_' + r.kind), '', colorOf(r.kind))), h('td', null, r.title, r.data.show === false ? h('span', { class: 'small muted' }, ` (${t('tl_hidden')})`) : null),
        h('td', { class: 'nowrap num' }, fmtDate(r.s)), h('td', { class: 'nowrap num' }, fmtDate(r.e)),
        h('td', { class: 'num right' }, daysBetween(r.s, r.e) + 1), h('td', null, r.data.release || r.data.product || ''), h('td', null, r.data.sprint || ''),
        h('td', { class: 'nowrap' }, r.data.env || ''), h('td', { class: 'nowrap' }, r.data.ot || ''),
        h('td', null, r.kind === 'holiday' && r.data.substitute ? `→ ${r.data.substitute}` : r.data.owner || '')));
    }
    content.appendChild(h('div', { class: 'hint' }, t('n_items', { n: items.length })));
    content.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 't' },
      h('thead', null, h('tr', null, cols.map(x => h('th', null, x)))),
      h('tbody', null, rows))));
  }

  function legend() {
    const present = new Set(all.map(r => r.kind));
    return h('div', { class: 'legend', style: { marginTop: '10px' } }, TIMELINE_KINDS.filter(k => present.has(k)).map(k => chip(t('k_' + k), '', colorOf(k))));
  }

  // --------------------------------------------------------------- quality
  function quality() {
    content.appendChild(h('p', { class: 'hint' }, t('tlq_intro')));
    if (!records.length) { content.appendChild(emptyState(t('tl_empty'))); return; }
    if (!issues.length) { content.appendChild(emptyState(t('tlq_none'))); return; }
    content.appendChild(h('div', { class: 'kpis' }, ISSUE_TYPES.map(tp => {
      const n = issues.filter(i => i.type === tp).length;
      return h('div', { class: 'kpi ' + (n ? (tp === 'no_dates' ? 'warn' : 'bad') : 'ok') }, h('div', { class: 'l' }, t('tlq_' + tp)), h('div', { class: 'v' }, n));
    })));
    for (const tp of ISSUE_TYPES) {
      const list = issues.filter(i => i.type === tp);
      if (!list.length) continue;
      content.appendChild(h('section', { class: 'card', style: { marginTop: '12px' } },
        h('h2', null, `${t('tlq_' + tp)} · ${list.length}`), h('p', { class: 'hint' }, t('tlq_' + tp + '_hint')),
        h('div', { class: 'table-wrap' }, h('table', { class: 't' },
          h('thead', null, h('tr', null, [t('f_title'), t('f_release'), t('f_start'), t('f_end'), t('tlq_detail')].map(x => h('th', null, x)))),
          h('tbody', null, list.map(i => h('tr', { class: canWrite ? 'click' : '', tabindex: '0', onclick: () => canWrite && edit(i.rec) },
            h('td', null, i.rec.title), h('td', null, i.rec.data?.release || ''), h('td', { class: 'nowrap' }, fmtDate(i.rec.data?.start)),
            h('td', { class: 'nowrap' }, fmtDate(i.rec.data?.end)),
            h('td', null, tp === 'copied_dates' ? t('tlq_copied_from', { r: i.info }) : i.info))))))));
    }
  }

  // ------------------------------------------------------------ editing
  function edit(r) {
    const releases = [...new Set(all.map(x => x.data.release).filter(Boolean))].sort(cmpVersion);
    const rec = r ? records.find(x => x.id === r.id) : null;
    openEditor({
      ctx, section: 'timeline', record: rec,
      defaults: { kind: 'other', data: { start: iso(new Date()), end: iso(new Date()), show: true } },
      fields: [
        { key: 'kind', label: t('f_type'), type: 'select', options: TIMELINE_KINDS.map(k => [k, t('k_' + k)]) },
        { key: 'title', label: t('f_title') },
        { key: 'data.start', label: t('f_start'), type: 'date' },
        { key: 'data.end', label: t('f_end'), type: 'date' },
        { key: 'data.release', label: t('f_release'), datalist: releases },
        { key: 'data.sprint', label: t('f_sprint') },
        { key: 'data.env', label: t('f_env'), datalist: ENVIRONMENTS },
        { key: 'data.ot', label: t('f_ot') },
        { key: 'data.keyword', label: t('f_keyword'), hint: t('f_keyword_hint') },
        rec?.kind === 'holiday' ? { key: 'data.substitute', label: t('f_substitute') } : { key: 'data.owner', label: t('f_owner') },
        { key: 'data.location', label: t('f_location'), hint: t('tl_location_hint') },
        { key: 'body', label: t('f_notes'), type: 'textarea', rows: 4 },
      ],
      onSaved: () => { ctx.invalidate('timeline'); load(true); },
    });
  }

  function importSharePoint() {
    openImport({
      api: ctx.api, section: 'timeline', title: t('tl_import_sp'), accept: '.xlsx,.xlsm,.csv', hint: t('tl_import_sp_hint'),
      defaultMode: 'replace',
      fields: SP_FIELDS.map(f => ({ ...f, label: t('sp_' + f.key), required: f.key === 'title' || f.key === 'start' })),
      toRecord: m => (String(m.title || '').trim() || String(m.keyword || '').trim() ? m : null),
      collect: rows => fromSharePoint(rows).records,
      summary: recs => {
        const found = checkTimeline(recs);
        const dup = recs.reduce((n, r) => n + Math.max(0, (r.data?.dup_count || 1) - 1), 0);
        const kinds = {}; recs.forEach(r => { kinds[r.kind] = (kinds[r.kind] || 0) + 1; });
        return h('div', { class: 'stack' },
          h('div', { class: 'pill-row' }, Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, n]) => chip(`${t('k_' + k)} · ${n}`, '', colorOf(k)))),
          h('div', { class: 'hint' }, t('tl_import_sp_check', { n: found.length, d: dup, u: recs.filter(r => !r.data?.start).length })));
      },
      previewCols: [['kind', t('f_type')], ['title', t('f_title')], ['data.start', t('f_start')], ['data.end', t('f_end')], ['data.release', t('f_release')], ['data.sprint', t('f_sprint')], ['data.env', t('f_env')]],
      onDone: () => { ctx.invalidate('timeline'); load(true); },
    });
  }

  function openClone() {
    const rels = [...new Set(records.filter(r => !r.data?.product).map(r => r.data?.release).filter(Boolean))].sort(cmpVersion);
    if (!rels.length) { toast(t('tl_clone_none'), 'bad'); return; }
    const withProd = rels.filter(r => records.some(x => x.kind === 'deployment' && x.data?.release === r && x.data?.env === 'PROD'));
    const st2 = Object.assign({ source: withProd[withProd.length - 1] || rels[rels.length - 1], holidays: '' }, store('tl.clone') || {});
    if (!rels.includes(st2.source)) st2.source = rels[rels.length - 1];
    st2.target = nextVersion(st2.source); st2.weeks = releaseGapWeeks(records, st2.source);
    let mode = 'append';
    const out = h('div', { class: 'stack' });
    const field = (key, label, input) => { input.addEventListener('input', () => { st2[key] = input.value; preview(); }); return h('label', { class: 'field' }, label, input); };
    const srcSel = h('select', null, rels.slice().reverse().map(r => h('option', { value: r, selected: r === st2.source }, r)));
    const target = h('input', { type: 'text', value: st2.target });
    const weeks = h('input', { type: 'number', min: 1, value: st2.weeks });
    srcSel.addEventListener('change', () => { st2.source = srcSel.value; st2.target = nextVersion(srcSel.value); st2.weeks = releaseGapWeeks(records, srcSel.value); target.value = st2.target; weeks.value = st2.weeks; preview(); });
    const holidays = () => String(st2.holidays).split(/[\s,;]+/).map(toIsoDate).filter(Boolean);
    const build = () => cloneRelease(records, st2.source, st2.target.trim(), +st2.weeks || 0, holidays());
    function preview() {
      clear(out);
      const ev = build();
      const existing = records.filter(r => r.data?.release === st2.target.trim());
      out.append(h('div', { class: 'card-head' }, h('h3', null, t('tl_clone_preview', { n: ev.length })), orderToggle('timeline.clone', () => preview())),
        existing.length ? h('div', { class: 'chip warn' }, t('tl_clone_existing', { n: existing.length, r: st2.target })) : null,
        ev.some(e => e.data.holiday_warning) ? h('div', { class: 'chip warn' }, t('tl_clone_holiday', { n: ev.filter(e => e.data.holiday_warning).length })) : null,
        h('div', { class: 'table-wrap', style: { maxHeight: '280px' } }, h('table', { class: 't' }, h('tbody', null,
          ev.slice().sort(directed((a, b) => String(a.data.start).localeCompare(String(b.data.start)), listOrder('timeline.clone'))).map(e => h('tr', null, h('td', null, t('k_' + e.kind)), h('td', null, e.title),
            h('td', { class: 'num nowrap' }, fmtDate(e.data.start)), h('td', { class: 'num nowrap' }, fmtDate(e.data.end)),
            h('td', null, e.data.holiday_warning ? chip(t('k_holiday'), 'warn') : null)))))));
    }
    modal({
      title: t('tl_clone'), wide: true,
      body: [h('p', { class: 'hint' }, t('tl_clone_intro')),
        h('div', { class: 'grid-form' }, h('label', { class: 'field' }, t('tl_clone_source'), srcSel), field('target', t('tl_clone_target'), target), field('weeks', t('tl_clone_weeks'), weeks)),
        field('holidays', t('gen_holidays'), h('textarea', { rows: 2, value: st2.holidays })),
        h('div', { class: 'pill-row' }, ['append', 'replace'].map(m => h('label', { class: 'check' },
          h('input', { type: 'radio', name: 'clone-mode', checked: m === mode, onchange: () => { mode = m; } }), t('tl_clone_mode_' + m)))),
        out],
      footer: c => [btn(t('cancel'), c), btn(t('tl_clone_do'), async () => {
        const ev = build(); if (!ev.length) return;
        store('tl.clone', { source: st2.source, holidays: st2.holidays });
        try {
          if (mode === 'replace') {
            const old = records.filter(r => r.data?.release === st2.target.trim());
            if (old.length && !(await confirmBox(t('tl_clone_replace_q', { n: old.length, r: st2.target }), t('delete')))) return;
            for (const r of old) await ctx.api.remove(r.id);
          }
          const res = await ctx.api.importRecords('timeline', t('tl_clone_source_name', { s: st2.source, t: st2.target }), ev, 'append');
          toast(t('import_done', res)); c(); ctx.invalidate('timeline'); load(true);
        } catch (e) { toast(e.message, 'bad'); }
      }, { cls: 'primary', icon: 'wand' })],
    });
    preview();
  }

  function exportSharePoint() {
    const { header, rows } = toSharePointRows(records.filter(r => st.hidden || r.data?.show !== false));
    download(`timeline-sharepoint-${iso(new Date())}.csv`, '﻿' + toCsv(rows.map(r => Object.fromEntries(r.map((v, i) => [i, v]))), header.map((label, i) => ({ label, key: i }))), 'text/csv');
    toast(t('exported', { n: rows.length }));
  }

  function exportIcs() {
    const items = filtered();
    const d = s => s.replace(/-/g, '');
    const escIcs = s => String(s || '').replace(/[\\;,]/g, m => '\\' + m).replace(/\n/g, '\\n');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//regTester//Timeline//EN', 'CALSCALE:GREGORIAN'];
    for (const r of items) {
      lines.push('BEGIN:VEVENT', `UID:${r.id}@regtester`, `DTSTAMP:${d(iso(new Date()))}T000000Z`, `DTSTART;VALUE=DATE:${d(r.data.start)}`,
        `DTEND;VALUE=DATE:${d(iso(addDays(r.e, 1)))}`, `SUMMARY:${escIcs(r.title)}`, `CATEGORIES:${r.kind}`,
        `DESCRIPTION:${escIcs([r.data.release, r.data.sprint, r.data.env, r.body].filter(Boolean).join('\n'))}`, 'END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    download(`timeline-${iso(new Date())}.ics`, lines.join('\r\n'), 'text/calendar');
    toast(t('exported', { n: items.length }));
  }

  await load();
}

export { normalizeKind };
