// Release timeline: Excel import, generator, Gantt / calendar / year / list views with filters.
import { openEditor } from '../editor.js';
import { historyTab } from '../history-view.js';
import { t } from '../i18n.js';
import { openImport } from '../importer.js';
import { generateYear, normalizeKind, TIMELINE_KINDS } from '../timeline-gen.js';
import {
  addDays, btn, chip, clear, daysBetween, download, emptyState, fmtDate, h, iso, isoWeek, modal, normalize, parseIso,
  seg, store, tabs, toast, toCsv, toIsoDate,
} from '../util.js';

const PRIORITY = ['deployment', 'regtest', 'qa', 'freeze', 'review', 'planning', 'holiday', 'other', 'sprint'];

export async function render(root, ctx) {
  const st = Object.assign({ view: 'gantt', zoom: 'month', q: '', release: '', kinds: [...TIMELINE_KINDS], from: '', to: '', year: new Date().getFullYear() }, store('tl') || {});
  const save = () => store('tl', st);
  const colors = ctx.settings.timeline_colors || {};
  const colorOf = k => colors[k] || colors.other || '#6B7280';
  let all = [];

  const head = h('div', { class: 'page-head' },
    h('div', null, h('h1', null, t('nav_timeline')), h('p', null, t('tl_intro'))),
    h('div', { class: 'actions' },
      ctx.canWriteSection('timeline') ? [
        btn(t('tl_import'), importExcel, { icon: 'upload' }),
        btn(t('tl_generate'), openGenerator, { icon: 'wand' }),
        btn(t('tl_add'), () => edit(null), { icon: 'plus', cls: 'primary' }),
      ] : null,
      btn('CSV', exportCsv, { icon: 'download', title: t('tl_export_csv') }),
      btn('ICS', exportIcs, { icon: 'download', title: t('tl_export_ics') })));
  const tabBox = h('div');
  const filterBox = h('div', { class: 'stack' });
  const content = h('div');
  root.append(head, tabBox, filterBox, content);

  async function load(force) {
    all = (await ctx.records('timeline', force)).filter(r => r.data?.start)
      .map(r => ({ ...r, s: parseIso(r.data.start), e: parseIso(r.data.end || r.data.start) || parseIso(r.data.start) }))
      .filter(r => r.s).sort((a, b) => a.s - b.s || PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind));
    paint();
  }

  function filtered() {
    const q = normalize(st.q);
    const from = parseIso(st.from), to = parseIso(st.to);
    return all.filter(r => st.kinds.includes(r.kind || 'other')
      && (!st.release || r.data.release === st.release)
      && (!q || normalize(`${r.title} ${r.data.release} ${r.data.sprint} ${r.data.owner} ${r.body}`).includes(q))
      && (!from || r.e >= from) && (!to || r.s <= to));
  }

  function paint() {
    clear(tabBox).appendChild(tabs([['gantt', t('tl_v_gantt')], ['calendar', t('tl_v_calendar')], ['year', t('tl_v_year')], ['list', t('tl_v_list')], ['history', t('tab_history')]],
      st.view, v => { st.view = v; save(); paint(); }));
    clear(filterBox); clear(content);
    if (st.view === 'history') { historyTab(content, ctx, ['timeline'], () => load(true)); return; }
    paintFilters();
    const items = filtered();
    if (!all.length) {
      content.appendChild(emptyState(t('tl_empty'), ctx.canWriteSection('timeline') ? [btn(t('tl_import'), importExcel, { icon: 'upload' }), btn(t('tl_generate'), openGenerator, { icon: 'wand', cls: 'primary' })] : null));
      return;
    }
    if (!items.length) { content.appendChild(emptyState(t('no_match'))); return; }
    if (st.view === 'gantt') gantt(items);
    if (st.view === 'calendar') calendar(items);
    if (st.view === 'year') year(items);
    if (st.view === 'list') list(items);
  }

  function paintFilters() {
    const releases = [...new Set(all.map(r => r.data.release).filter(Boolean))].sort();
    const search = h('input', { type: 'search', placeholder: t('tl_search'), value: st.q, 'aria-label': t('tl_search') });
    search.addEventListener('input', () => { st.q = search.value; save(); clear(content); const it = filtered(); if (!it.length) content.appendChild(emptyState(t('no_match'))); else ({ gantt, calendar, year, list })[st.view](it); });
    filterBox.appendChild(h('div', { class: 'toolbar' },
      h('div', { class: 'grow' }, search),
      h('select', { 'aria-label': t('f_release'), onchange: e => { st.release = e.target.value; save(); paint(); } },
        h('option', { value: '' }, t('tl_all_releases')), releases.map(r => h('option', { value: r, selected: st.release === r }, r))),
      h('label', { class: 'field', style: { flexDirection: 'row', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' } }, t('from'),
        h('input', { type: 'date', value: st.from, onchange: e => { st.from = e.target.value; save(); paint(); } })),
      h('label', { class: 'field', style: { flexDirection: 'row', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' } }, t('to'),
        h('input', { type: 'date', value: st.to, onchange: e => { st.to = e.target.value; save(); paint(); } })),
      (st.from || st.to || st.q || st.release || st.kinds.length !== TIMELINE_KINDS.length)
        ? btn(t('reset_filters'), () => { Object.assign(st, { q: '', release: '', from: '', to: '', kinds: [...TIMELINE_KINDS] }); save(); paint(); }, { cls: 'ghost sm' }) : null,
      st.view === 'gantt' ? seg([['week', t('zoom_week')], ['month', t('zoom_month')], ['quarter', t('zoom_quarter')]], st.zoom, z => { st.zoom = z; save(); paint(); }) : null,
      st.view !== 'list' ? btn(t('today'), scrollToday, { cls: 'sm' }) : null));
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

  // ---------------------------------------------------------------- Gantt
  function gantt(items) {
    const dayW = { week: 34, month: 11, quarter: 4 }[st.zoom];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let min = parseIso(st.from) || items[0].s, max = parseIso(st.to) || items.reduce((m, r) => r.e > m ? r.e : m, items[0].e);
    min = addDays(new Date(min.getFullYear(), min.getMonth(), 1), 0);
    max = addDays(new Date(max.getFullYear(), max.getMonth() + 1, 0), 1);
    const days = daysBetween(min, max);
    const width = days * dayW;
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
    const lanes = [];
    for (const k of PRIORITY.slice().sort((a, b) => TIMELINE_KINDS.indexOf(a) - TIMELINE_KINDS.indexOf(b))) {
      const ev = items.filter(r => (r.kind || 'other') === k);
      if (!ev.length) continue;
      const rows = []; // greedy packing so overlapping bars get their own row
      const placed = ev.map(r => {
        const left = x(r.s), w = Math.max(dayW * (daysBetween(r.s, r.e) + 1), 6);
        let row = rows.findIndex(end => end <= left - 2);
        if (row < 0) { row = rows.length; rows.push(0); }
        rows[row] = left + Math.max(w, 60);
        return { r, left, w, row };
      });
      lanes.push(h('div', { class: 'g-lane', style: { height: (rows.length * 28 + 30) + 'px', width: width + 'px' } },
        weekend.map(n => n.cloneNode()),
        h('span', { class: 'g-lane-label' }, t('k_' + k)),
        placed.map(({ r, left, w, row }) => h('button', { type: 'button', class: 'g-bar', title: `${r.title}\n${fmtDate(r.s)} – ${fmtDate(r.e)}${r.data.release ? '\n' + r.data.release : ''}`,
          style: { left: left + 'px', width: w + 'px', top: (26 + row * 28) + 'px', background: colorOf(k) }, onclick: () => edit(r) }, w > 30 ? r.title : ''))));
    }
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
          ev.slice(0, 3).map(r => h('button', { type: 'button', class: 'ev', style: { background: colorOf(r.kind) }, title: r.title, onclick: () => edit(r) }, r.title)),
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
    if (!years.includes(+st.year)) st.year = years.includes(new Date().getFullYear()) ? new Date().getFullYear() : years[0];
    const y = +st.year;
    const grid = h('div', { class: 'year' });
    const dows = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(t.locale(), { weekday: 'narrow' }));
    for (let mo = 0; mo < 12; mo++) {
      const m = new Date(y, mo, 1);
      const lead = (m.getDay() + 6) % 7;
      const cells = dows.map(d => h('div', { class: 'c blank small muted' }, d));
      for (let i = 0; i < lead; i++) cells.push(h('div', { class: 'c blank' }));
      for (let d = new Date(m); d.getMonth() === mo; d = addDays(d, 1)) {
        const ev = eventsOn(items, d).filter(r => r.kind !== 'sprint' || true);
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
    const rows = [];
    let month = '';
    for (const r of items) {
      const mk = r.s.toLocaleDateString(t.locale(), { month: 'long', year: 'numeric' });
      if (mk !== month) { month = mk; rows.push(h('tr', null, h('td', { colspan: 8, style: { background: 'var(--surface-2)', fontWeight: 600 } }, mk))); }
      rows.push(h('tr', { class: 'click', onclick: () => edit(r), tabindex: '0', onkeydown: e => { if (e.key === 'Enter') edit(r); } },
        h('td', null, chip(t('k_' + r.kind), '', colorOf(r.kind))), h('td', null, r.title),
        h('td', { class: 'nowrap num' }, fmtDate(r.s)), h('td', { class: 'nowrap num' }, fmtDate(r.e)),
        h('td', { class: 'num right' }, daysBetween(r.s, r.e) + 1), h('td', null, r.data.release || ''), h('td', null, r.data.sprint || ''), h('td', null, r.data.owner || '')));
    }
    content.appendChild(h('div', { class: 'hint' }, t('n_items', { n: items.length })));
    content.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 't' },
      h('thead', null, h('tr', null, [t('f_type'), t('f_title'), t('f_start'), t('f_end'), t('f_days'), t('f_release'), t('f_sprint'), t('f_owner')].map(x => h('th', null, x)))),
      h('tbody', null, rows))));
  }

  function legend() {
    const present = new Set(all.map(r => r.kind));
    return h('div', { class: 'legend', style: { marginTop: '10px' } }, TIMELINE_KINDS.filter(k => present.has(k)).map(k => chip(t('k_' + k), '', colorOf(k))));
  }

  // ------------------------------------------------------------ editing
  function edit(r) {
    const releases = [...new Set(all.map(x => x.data.release).filter(Boolean))];
    openEditor({
      ctx, section: 'timeline', record: r ? all.find(x => x.id === r.id) : null,
      defaults: { kind: 'other', data: { start: iso(new Date()), end: iso(new Date()) } },
      fields: [
        { key: 'kind', label: t('f_type'), type: 'select', options: TIMELINE_KINDS.map(k => [k, t('k_' + k)]) },
        { key: 'title', label: t('f_title') },
        { key: 'data.start', label: t('f_start'), type: 'date' },
        { key: 'data.end', label: t('f_end'), type: 'date' },
        { key: 'data.release', label: t('f_release'), datalist: releases },
        { key: 'data.sprint', label: t('f_sprint') },
        { key: 'data.owner', label: t('f_owner') },
        { key: 'data.location', label: t('f_location'), hint: t('tl_location_hint') },
        { key: 'body', label: t('f_notes'), type: 'textarea', rows: 4 },
      ],
      onSaved: () => { ctx.invalidate('timeline'); load(true); },
    });
  }

  function importExcel() {
    openImport({
      api: ctx.api, section: 'timeline', title: t('tl_import'), accept: '.xlsx,.xlsm,.csv', hint: t('tl_import_hint'),
      fields: [
        { key: 'kind', label: t('f_type'), aliases: ['type', 'typ', 'tip', 'category', 'kategorie', 'categorie', 'art', 'event type'] },
        { key: 'title', label: t('f_title'), required: true, aliases: ['title', 'titlu', 'name', 'titel', 'denumire', 'eveniment', 'event', 'subject', 'betreff', 'description'] },
        { key: 'start', label: t('f_start'), required: true, aliases: ['start', 'start date', 'begin', 'beginn', 'von', 'from', 'data start', 'data inceput', 'inceput', 'date', 'datum', 'data'] },
        { key: 'end', label: t('f_end'), aliases: ['end', 'end date', 'ende', 'bis', 'to', 'data sfarsit', 'sfarsit', 'finish'] },
        { key: 'release', label: t('f_release'), aliases: ['release', 'version', 'versiune'] },
        { key: 'sprint', label: t('f_sprint'), aliases: ['sprint', 'iteration'] },
        { key: 'owner', label: t('f_owner'), aliases: ['owner', 'verantwortlich', 'responsabil', 'assigned to'] },
        { key: 'notes', label: t('f_notes'), aliases: ['notes', 'notizen', 'note', 'comment', 'kommentar', 'comentariu'] },
        { key: 'key', label: t('f_key'), aliases: ['id', 'key', 'nr', 'cod'] },
      ],
      previewCols: [['kind', t('f_type')], ['title', t('f_title')], ['data.start', t('f_start')], ['data.end', t('f_end')], ['data.release', t('f_release')]],
      toRecord: m => {
        const start = toIsoDate(m.start); if (!start || !String(m.title).trim()) return null;
        const title = String(m.title).trim();
        return { kind: normalizeKind(m.kind, title), key: String(m.key || title).trim(), title, body: String(m.notes || ''),
          data: { start, end: toIsoDate(m.end) || start, release: String(m.release || ''), sprint: String(m.sprint || ''), owner: String(m.owner || '') } };
      },
      onDone: () => { ctx.invalidate('timeline'); load(true); },
    });
  }

  function openGenerator() {
    const nextYear = new Date().getFullYear() + 1;
    const firstMonday = y => { let d = new Date(y, 0, 1); while (d.getDay() !== 1) d = addDays(d, 1); return iso(d); };
    const r = Object.assign({ year: nextYear, start: firstMonday(nextYear), sprints: 26, sprintWeeks: 2, firstNumber: 1, prefix: 'Sprint', sprintsPerRelease: 3,
      releasePrefix: 'R', releaseStart: 1, freezeDays: 1, regtestDays: 7, qaDays: 4, deployGapDays: 1, holidays: '' }, store('tl.gen') || {});
    const f = (key, label, type = 'number') => {
      const input = h(type === 'textarea' ? 'textarea' : 'input', { id: 'gen-' + key, type: type === 'textarea' ? undefined : type, value: r[key], rows: 3 });
      input.addEventListener('input', () => { r[key] = input.value; preview(); });
      return h('label', { class: 'field', for: 'gen-' + key }, label, input);
    };
    const out = h('div', { class: 'stack' });
    let mode = 'append';
    const rules = () => ({ ...r, holidays: String(r.holidays).split(/[\s,;]+/).map(toIsoDate).filter(Boolean) });
    function preview() {
      clear(out);
      const ev = generateYear(rules());
      const counts = {}; ev.forEach(e => counts[e.kind] = (counts[e.kind] || 0) + 1);
      out.append(h('h3', null, t('gen_preview', { n: ev.length })),
        h('div', { class: 'pill-row' }, Object.entries(counts).map(([k, n]) => chip(`${t('k_' + k)} · ${n}`, '', colorOf(k)))),
        h('div', { class: 'table-wrap', style: { maxHeight: '260px' } }, h('table', { class: 't' }, h('tbody', null,
          ev.filter(e => e.kind !== 'holiday').slice(0, 30).map(e => h('tr', null, h('td', null, t('k_' + e.kind)), h('td', null, e.title), h('td', { class: 'num nowrap' }, fmtDate(e.data.start)), h('td', { class: 'num nowrap' }, fmtDate(e.data.end))))))));
    }
    modal({
      title: t('tl_generate'), wide: true,
      body: [h('p', { class: 'hint' }, t('gen_intro')),
        h('div', { class: 'grid-form' }, f('year', t('gen_year')), f('start', t('gen_start'), 'date'), f('sprints', t('gen_sprints')), f('sprintWeeks', t('gen_weeks')),
          f('firstNumber', t('gen_first')), f('prefix', t('gen_prefix'), 'text'), f('sprintsPerRelease', t('gen_per_release')), f('releasePrefix', t('gen_rel_prefix'), 'text'),
          f('releaseStart', t('gen_rel_start')), f('freezeDays', t('gen_freeze')), f('regtestDays', t('gen_regtest')), f('qaDays', t('gen_qa')), f('deployGapDays', t('gen_deploy_gap'))),
        f('holidays', t('gen_holidays'), 'textarea'),
        h('div', { class: 'pill-row' }, ['append', 'replace'].map(m => h('label', { class: 'check' },
          h('input', { type: 'radio', name: 'gen-mode', checked: m === mode, onchange: () => { mode = m; } }), t('mode_' + m)))),
        out],
      footer: c => [btn(t('cancel'), c), btn(t('gen_do'), async () => {
        store('tl.gen', r);
        const ev = generateYear(rules()).map(e => ({ ...e, key: e.title }));
        try { const res = await ctx.api.importRecords('timeline', t('gen_source', { y: r.year }), ev, mode); toast(t('import_done', res)); c(); ctx.invalidate('timeline'); load(true); }
        catch (e) { toast(e.message, 'bad'); }
      }, { cls: 'primary', icon: 'wand' })],
    });
    preview();
  }

  function exportCsv() {
    const items = filtered();
    download(`timeline-${iso(new Date())}.csv`, '\uFEFF' + toCsv(items, [
      { label: 'Type', get: r => r.kind }, { label: 'Title', key: 'title' }, { label: 'Start', get: r => r.data.start }, { label: 'End', get: r => r.data.end },
      { label: 'Release', get: r => r.data.release }, { label: 'Sprint', get: r => r.data.sprint }, { label: 'Owner', get: r => r.data.owner }, { label: 'Notes', key: 'body' }]), 'text/csv');
    toast(t('exported', { n: items.length }));
  }

  function exportIcs() {
    const items = filtered();
    const d = s => s.replace(/-/g, '');
    const escIcs = s => String(s || '').replace(/[\\;,]/g, m => '\\' + m).replace(/\n/g, '\\n');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//regTester//Timeline//EN', 'CALSCALE:GREGORIAN'];
    for (const r of items) {
      lines.push('BEGIN:VEVENT', `UID:${r.id}@regtester`, `DTSTAMP:${d(iso(new Date()))}T000000Z`, `DTSTART;VALUE=DATE:${d(r.data.start)}`,
        `DTEND;VALUE=DATE:${d(iso(addDays(r.e, 1)))}`, `SUMMARY:${escIcs(r.title)}`, `CATEGORIES:${r.kind}`,
        `DESCRIPTION:${escIcs([r.data.release, r.data.sprint, r.body].filter(Boolean).join('\n'))}`, 'END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    download(`timeline-${iso(new Date())}.ics`, lines.join('\r\n'), 'text/calendar');
    toast(t('exported', { n: items.length }));
  }

  await load();
}

