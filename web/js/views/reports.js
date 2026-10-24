// Reports: what happened per sprint, release, regtest window, month or a chosen period. One overview row per
// period, and for the selected period the elements behind each number (errors, runs, functions, test cases,
// specifications, documentation), each one clickable. Exports: CSV of the overview, HTML report, text.
import { effStatus, isOpen } from '../errors.js';
import { t } from '../i18n.js';
import { previewRecord, recLabel } from '../links.js';
import { cmpVersion } from '../timeline-gen.js';
import {
  btn, chip, clear, copyText, directed, download, emptyState, esc, fmtDate, h, iso, kpiBox, listOrder, orderToggle, seg, store, toCsv,
} from '../util.js';

const GROUPS = ['sprint', 'release', 'regtest', 'month', 'custom'];
const PAGE = { timeline: 'timeline', features: 'coverage', tests: 'coverage', specs: 'specs', errors: 'triage', errsnaps: 'triage', runs: 'triage', docs: 'docs' };
const STATUS_COLORS = { new: 'var(--bad)', assigned: 'var(--warn)', processing: 'var(--info, #2F6FB0)', solved: 'var(--ok)', closed: '#3B8B3B', cancelled: '#9AA3AE' };

const day = v => String(v || '').slice(0, 10);
const tsDay = ts => (ts ? iso(new Date(ts * 1000)) : '');
const inRange = (d, s, e) => !!d && d >= s && d <= e;

export async function render(root, ctx) {
  const st = Object.assign({ group: 'sprint', sel: '', from: '', to: '' }, store('rep') || {});
  if (!GROUPS.includes(st.group)) st.group = 'sprint';
  const save = () => store('rep', st);
  const get = s => (ctx.canPage(PAGE[s]) ? ctx.records(s).catch(() => []) : Promise.resolve([]));
  const [timeline, features, tests, specs, errors, snaps, runs, docs] =
    await Promise.all(['timeline', 'features', 'tests', 'specs', 'errors', 'errsnaps', 'runs', 'docs'].map(get));
  const withSec = (list, s) => list.map(r => ({ ...r, section: r.section || s }));
  const E = withSec(errors, 'errors'), F = withSec(features, 'features'), T = withSec(tests, 'tests'), S = withSec(specs, 'specs'), D = withSec(docs, 'docs');

  root.appendChild(h('div', { class: 'page-head' },
    h('div', null, h('h1', null, ctx.pageLabel('reports')), h('p', null, t('rep_intro')))));
  const bar = h('div'), body = h('div', { class: 'stack' });
  root.append(bar, body);

  // ----------------------------------------------------------- periods
  const tl = timeline.filter(r => r.data?.start && !r.data?.product && r.data?.show !== false)
    .map(r => ({ r, s: day(r.data.start), e: day(r.data.end && r.data.end >= r.data.start ? r.data.end : r.data.start) }));
  function periods() {
    if (st.group === 'sprint' || st.group === 'regtest') {
      return tl.filter(x => x.r.kind === st.group).map(x => ({
        id: x.r.id, label: x.r.title, s: x.s, e: x.e, release: x.r.data.release || '', sprint: x.r.data.sprint || '',
        sub: [x.r.data.release, x.r.data.sprint, x.r.data.env].filter(Boolean).join(' · '),
      }));
    }
    if (st.group === 'release') {
      const by = new Map();
      for (const x of tl) {
        const rel = x.r.data.release; if (!rel) continue;
        const p = by.get(rel) || { id: 'rel:' + rel, label: rel, release: rel, s: x.s, e: x.e, sub: '' };
        if (x.s < p.s) p.s = x.s; if (x.e > p.e) p.e = x.e;
        by.set(rel, p);
      }
      // a release without timeline dates still gets a row for its functions and specifications
      for (const rel of new Set([...F, ...S].map(r => r.data?.release).filter(Boolean))) if (!by.has(rel)) by.set(rel, { id: 'rel:' + rel, label: rel, release: rel, s: '', e: '', sub: t('rep_no_dates') });
      return [...by.values()].sort((a, b) => cmpVersion(a.release, b.release));
    }
    if (st.group === 'month') {
      const days = [...E.flatMap(r => [day(r.data?.first), day(r.data?.last), day(r.data?.first_import)]), ...runs.map(r => day(r.data?.date)), ...tl.map(x => x.s)].filter(Boolean).sort();
      const today = iso(new Date());
      const last = (days[days.length - 1] || today) > today ? today : days[days.length - 1] || today;
      // at most the last 24 months that have data
      let y = +last.slice(0, 4), m = +last.slice(5, 7);
      const first = days[0] || today;
      const out = [];
      while (out.length < 24) {
        const s = `${y}-${String(m).padStart(2, '0')}-01`, e = iso(new Date(y, m, 0));
        if (e < first) break;
        out.unshift({ id: 'm:' + s.slice(0, 7), label: new Date(y, m - 1, 1).toLocaleDateString(t.locale(), { month: 'long', year: 'numeric' }), s, e, sub: '' });
        m--; if (m < 1) { m = 12; y--; }
      }
      return out;
    }
    const s = st.from || iso(new Date(Date.now() - 30 * 86400000)), e = st.to || iso(new Date());
    return [{ id: 'custom', label: t('rep_custom_label'), s: s <= e ? s : e, e: s <= e ? e : s, sub: '' }];
  }

  // ----------------------------------------------------------- metrics
  const testsOf = f => T.filter(x => (x.data?.feature && String(x.data.feature).toUpperCase() === String(f.key).toUpperCase())
    || (x.data?.rel || []).some(l => l.id === f.id) || (f.data?.rel || []).some(l => l.id === x.id));
  function measure(p) {
    const has = !!(p.s && p.e);
    const errFirst = r => day(r.data?.first) || day(r.data?.first_import);
    const errLast = r => day(r.data?.last) || errFirst(r);
    // seen in the period: first or last time stamp inside it, or an export from the period had its last time stamp inside it
    const seenInSnaps = new Set();
    if (has) for (const sn of snaps) if (inRange(day(sn.data?.date), p.s, p.e)) for (const it of sn.data?.items || []) if (inRange(day(it[4]), p.s, p.e)) seenInSnaps.add(it[0]);
    const active = has ? E.filter(r => inRange(errFirst(r), p.s, p.e) || inRange(errLast(r), p.s, p.e) || seenInSnaps.has(r.key)) : [];
    const added = has ? E.filter(r => inRange(errFirst(r), p.s, p.e)) : [];
    const stillOpen = active.filter(r => isOpen(effStatus(r)));
    const snapsIn = has ? snaps.filter(sn => inRange(day(sn.data?.date), p.s, p.e)) : [];
    const statusChanges = snapsIn.reduce((n, sn) => n + (sn.data?.status || []).length, 0);
    const ownSet = has ? E.filter(r => inRange(day(r.data?.own_status_at), p.s, p.e)) : [];
    const runsIn = has ? runs.filter(r => inRange(day(r.data?.date), p.s, p.e)) : [];
    const failed = runsIn.reduce((n, r) => n + (r.data?.results || []).filter(x => x.status === 'failed').length, 0);
    const total = runsIn.reduce((n, r) => n + (r.data?.results || []).length, 0);
    // functions: by release (and sprint) when the period has them; otherwise those changed in the period
    let feats;
    if (p.release) feats = F.filter(f => f.data?.release === p.release && (!p.sprint || !f.data?.sprint || String(f.data.sprint) === String(p.sprint)));
    else feats = has ? F.filter(f => inRange(tsDay(f.updated_at), p.s, p.e) || inRange(tsDay(f.created_at), p.s, p.e)) : [];
    const featRows = feats.map(f => ({ f, tests: testsOf(f) }));
    const specsIn = S.filter(r => (p.release && r.data?.release === p.release) || (has && inRange(tsDay(r.updated_at), p.s, p.e)));
    const docsIn = has ? D.filter(r => inRange(tsDay(r.updated_at), p.s, p.e)) : D.filter(r => p.release && r.data?.meta?.release === p.release);
    const statusDist = {};
    for (const r of active) { const s = effStatus(r) || '—'; statusDist[s] = (statusDist[s] || 0) + 1; }
    const byApp = {};
    for (const r of active) { const a = r.data?.app || '—'; byApp[a] = (byApp[a] || 0) + 1; }
    return { p, active, added, stillOpen, snapsIn, statusChanges, ownSet, runsIn, failed, total, featRows, noTest: featRows.filter(x => !x.tests.length), specsIn, docsIn, statusDist, byApp };
  }

  const COLS = [
    ['added', 'rep_c_new', m => m.added.length],
    ['active', 'rep_c_active', m => m.active.length],
    ['open', 'rep_c_open', m => m.stillOpen.length],
    ['status', 'rep_c_status', m => m.statusChanges],
    ['runs', 'rep_c_runs', m => m.runsIn.length],
    ['failed', 'rep_c_failed', m => m.failed],
    ['features', 'rep_c_features', m => m.featRows.length],
    ['notest', 'rep_c_notest', m => m.noTest.length],
    ['specs', 'rep_c_specs', m => m.specsIn.length],
    ['docs', 'rep_c_docs', m => m.docsIn.length],
  ];

  function paint() {
    clear(bar).appendChild(h('div', { class: 'toolbar' },
      seg(GROUPS.map(g => [g, t('rep_g_' + g)]), st.group, v => { st.group = v; st.sel = ''; save(); paint(); }),
      st.group === 'custom' ? [
        h('label', { class: 'small' }, t('f_start'), ' ', h('input', { type: 'date', value: st.from, id: 'rep-from', onchange: e => { st.from = e.target.value; save(); paint(); } })),
        h('label', { class: 'small' }, t('f_end'), ' ', h('input', { type: 'date', value: st.to, id: 'rep-to', onchange: e => { st.to = e.target.value; save(); paint(); } }))] : null));
    clear(body);
    const ps = periods();
    if (!ps.length) {
      body.appendChild(emptyState(t(st.group === 'release' ? 'rep_none_release' : 'rep_none_' + (st.group === 'month' ? 'data' : 'timeline')),
        ctx.canPage('timeline') ? btn(ctx.pageLabel('timeline'), () => ctx.navigate('timeline'), { icon: 'calendar' }) : null));
      return;
    }
    const rows = ps.map(measure);
    const today = iso(new Date());
    // default: the period that contains today, else the latest one that started
    let cur = rows.find(m => m.p.id === st.sel);
    if (!cur) cur = rows.find(m => m.p.s && m.p.s <= today && m.p.e >= today) || [...rows].reverse().find(m => !m.p.s || m.p.s <= today) || rows[rows.length - 1];
    const ordered = rows.slice().sort(directed((a, b) => String(a.p.s || '').localeCompare(String(b.p.s || '')) || cmpVersion(a.p.label, b.p.label), listOrder('rep.periods')));

    // overview
    const overview = h('section', { class: 'card stack' },
      h('div', { class: 'row-between' }, h('h2', { style: { margin: 0 } }, `${t('rep_overview')} · ${t('rep_g_' + st.group)}`),
        h('div', { class: 'toolbar', style: { margin: 0 } },
          st.group !== 'custom' ? orderToggle('rep.periods', () => paint()) : null,
          btn('CSV', () => exportCsv(rows), { icon: 'download', id: 'rep-csv' }))),
      h('div', { class: 'table-wrap' }, h('table', { class: 't rep-table', id: 'rep-overview' },
        h('thead', null, h('tr', null, h('th', null, t('rep_period')), h('th', null, t('rep_dates')), COLS.map(([, k]) => h('th', { class: 'num' }, t(k))))),
        h('tbody', null, ordered.map(m => h('tr', {
          class: 'click' + (m === cur ? ' on' : ''), tabindex: '0', 'data-period': m.p.id,
          onclick: () => { st.sel = m.p.id; save(); paint(); }, onkeydown: e => { if (e.key === 'Enter') { st.sel = m.p.id; save(); paint(); } },
        },
          h('td', null, h('b', null, m.p.label), m.p.sub ? h('div', { class: 'small muted' }, m.p.sub) : null),
          h('td', { class: 'nowrap small' }, m.p.s ? `${fmtDate(m.p.s)} – ${fmtDate(m.p.e)}` : '—'),
          COLS.map(([id, , f]) => h('td', { class: 'num' + (id === 'notest' && f(m) ? ' warn-text' : '') }, f(m) || '·'))))))),
      h('p', { class: 'hint', style: { margin: 0 } }, t('rep_overview_hint')));
    body.append(overview, detail(cur));
  }

  // ----------------------------------------------------------- detail of one period
  function detail(m) {
    const card = h('section', { class: 'card stack', id: 'rep-detail' });
    const jump = id => document.getElementById('rep-sec-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const k = (id, label, v, kind) => kpiBox(label, v, kind, v ? () => jump(id) : null, { id: 'rep-k-' + id });
    card.append(
      h('div', { class: 'row-between' },
        h('div', null, h('h2', { style: { margin: 0 } }, m.p.label), h('div', { class: 'small muted' }, [m.p.s ? `${fmtDate(m.p.s)} – ${fmtDate(m.p.e)}` : t('rep_no_dates'), m.p.sub].filter(Boolean).join(' · '))),
        h('div', { class: 'toolbar no-print', style: { margin: 0 } },
          btn(t('rep_copy'), () => copyText(reportText(m)), { icon: 'copy', id: 'rep-copy' }),
          btn(t('rep_html'), () => download(`report-${slug(m.p.label)}-${iso(new Date())}.html`, reportHtml(m), 'text/html'), { icon: 'download', id: 'rep-html' }),
          btn(t('rep_print'), () => window.print(), { icon: 'doc' }))),
      h('div', { class: 'kpis' },
        k('active', t('rep_c_active'), m.active.length, ''),
        k('added', t('rep_c_new'), m.added.length, m.added.length ? 'bad' : ''),
        k('active', t('rep_c_open'), m.stillOpen.length, m.stillOpen.length ? 'warn' : 'ok'),
        k('runs', t('rep_c_failed'), m.total ? `${m.failed} / ${m.total}` : 0, m.failed ? 'warn' : ''),
        k('features', t('rep_c_features'), m.featRows.length, ''),
        k('features', t('rep_c_notest'), m.noTest.length, m.noTest.length ? 'warn' : 'ok')));

    if (m.active.length) {
      const total = m.active.length;
      const dist = Object.entries(m.statusDist).sort((a, b) => b[1] - a[1]);
      card.appendChild(h('div', { class: 'stack', style: { gap: '6px' } },
        h('div', { class: 'small muted' }, t('rep_status_dist')),
        h('div', { class: 'rep-bar', role: 'img', 'aria-label': dist.map(([s, n]) => `${s} ${n}`).join(', ') },
          dist.map(([s, n]) => h('span', { title: `${s}: ${n}`, style: { width: (n / total * 100) + '%', background: STATUS_COLORS[s.toLowerCase()] || 'var(--muted)' } }))),
        h('div', { class: 'pill-row' }, dist.map(([s, n]) => chip(`${s} · ${n}`, null, STATUS_COLORS[s.toLowerCase()] || 'var(--muted)')),
          m.ownSet.length ? h('span', { class: 'small muted' }, t('rep_own_set', { n: m.ownSet.length })) : null)));
    }

    const open = r => previewRecord(ctx, r);
    const item = (r, extra) => h('div', { class: 'lnk-item' },
      h('button', { type: 'button', class: 'lnk-open', onclick: () => open(r) }, recLabel(r) || '—'), ...(extra || []));
    const section = (id, title, items, empty) => h('div', { class: 'stack', id: 'rep-sec-' + id, style: { scrollMarginTop: '12px', gap: '6px' } },
      h('h3', { style: { margin: 0 } }, `${title} · ${items.length}`),
      items.length ? h('div', { class: 'lnk-list' }, items) : h('p', { class: 'small muted', style: { margin: 0 } }, empty || t('rep_nothing')));
    const errItem = r => item(r, [chip((r.data?.own_status ? '✎ ' : '') + (effStatus(r) || '—'), isOpen(effStatus(r)) ? 'warn' : 'ok'),
      h('span', { class: 'small muted' }, [r.data?.app, r.data?.last ? fmtDate(day(r.data.last)) : ''].filter(Boolean).join(' · '))]);
    const sortErr = list => list.slice().sort((a, b) => Number(isOpen(effStatus(b))) - Number(isOpen(effStatus(a))) || String(b.data?.last || '').localeCompare(String(a.data?.last || '')));
    card.append(
      section('active', t('rep_s_active'), sortErr(m.active).map(errItem)),
      section('added', t('rep_s_new'), sortErr(m.added).map(errItem)),
      section('runs', t('rep_s_runs'), m.runsIn.slice().sort((a, b) => String(b.data?.date).localeCompare(String(a.data?.date))).map(r => {
        const res = r.data?.results || [], f = res.filter(x => x.status === 'failed').length;
        return h('div', { class: 'lnk-item' }, h('b', null, r.title || fmtDate(r.data?.date)), chip(`${f} / ${res.length}`, f ? 'warn' : 'ok'),
          ctx.canPage('triage') ? btn(t('rep_to_runs'), () => ctx.navigate('triage'), { cls: 'sm ghost' }) : null);
      })),
      section('features', t('rep_s_features'), m.featRows.slice().sort((a, b) => a.tests.length - b.tests.length || String(a.f.key).localeCompare(String(b.f.key))).map(({ f, tests: ts }) =>
        item(f, [ts.length ? chip(t('rep_n_tests', { n: ts.length }), 'ok') : chip(t('rep_no_test'), 'warn'),
          f.data?.sprint ? h('span', { class: 'small muted' }, `${t('f_sprint')} ${f.data.sprint}`) : null]))),
      section('specs', t('rep_s_specs'), m.specsIn.map(r => item(r, [r.data?.status ? chip(r.data.status) : null, h('span', { class: 'small muted' }, fmtDate(new Date(r.updated_at * 1000)))]))),
      section('docs', t('rep_s_docs'), m.docsIn.map(r => item(r, [h('span', { class: 'small muted' }, `${fmtDate(new Date(r.updated_at * 1000))} · ${r.updated_by || ''}`)]))));
    if (Object.keys(m.byApp).length > 1) {
      card.appendChild(h('details', null, h('summary', null, t('rep_by_app')),
        h('table', { class: 't' }, h('tbody', null, Object.entries(m.byApp).sort((a, b) => b[1] - a[1]).map(([a, n]) => h('tr', null, h('td', null, a), h('td', { class: 'num' }, n)))))));
    }
    card.appendChild(h('p', { class: 'hint', style: { margin: 0 } }, t('rep_detail_hint')));
    return card;
  }

  // ----------------------------------------------------------- exports
  const slug = s => String(s || 'period').replace(/[^\w.-]+/g, '-').slice(0, 40);
  function exportCsv(rows) {
    download(`report-${st.group}-${iso(new Date())}.csv`, '﻿' + toCsv(rows, [
      { label: t('rep_period'), get: m => m.p.label }, { label: t('f_start'), get: m => m.p.s }, { label: t('f_end'), get: m => m.p.e },
      ...COLS.map(([, key, f]) => ({ label: t(key), get: f }))]), 'text/csv');
  }
  function reportText(m) {
    const L = [`${t('rep_title')} · ${m.p.label}${m.p.s ? ` (${fmtDate(m.p.s)} – ${fmtDate(m.p.e)})` : ''}`, ''];
    for (const [, key, f] of COLS) L.push(`${t(key)}: ${f(m)}`);
    if (m.active.length) L.push('', t('rep_status_dist') + ': ' + Object.entries(m.statusDist).map(([s, n]) => `${s} ${n}`).join(', '));
    if (m.stillOpen.length) { L.push('', t('rep_c_open') + ':'); m.stillOpen.forEach(r => L.push(`- ${r.key} ${r.title} [${effStatus(r)}]`)); }
    if (m.noTest.length) { L.push('', t('rep_c_notest') + ':'); m.noTest.forEach(({ f }) => L.push(`- ${f.key} ${f.title}`)); }
    return L.join('\n');
  }
  function reportHtml(m) {
    const tr = cells => `<tr>${cells.map(c => `<td>${esc(String(c ?? ''))}</td>`).join('')}</tr>`;
    const table = (head, rows) => rows.length ? `<table><thead><tr>${head.map(x => `<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>` : `<p class="m">${esc(t('rep_nothing'))}</p>`;
    return `<!doctype html><html lang="${t.lang()}"><head><meta charset="utf-8"><title>${esc(t('rep_title'))} · ${esc(m.p.label)}</title>
<style>body{font:14px/1.45 system-ui,sans-serif;margin:24px;color:#1b1f24}h1{font-size:20px;margin:0}h2{font-size:15px;margin:22px 0 6px}
table{border-collapse:collapse;width:100%;margin:4px 0}td,th{border:1px solid #d5dae0;padding:4px 8px;text-align:left;vertical-align:top}th{background:#f2f4f7}.m{color:#5b6470}
.k{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.k div{border:1px solid #d5dae0;border-radius:8px;padding:8px 12px}.k b{display:block;font-size:20px}</style></head><body>
<h1>${esc(t('rep_title'))} · ${esc(m.p.label)}</h1><p class="m">${esc([m.p.s ? `${fmtDate(m.p.s)} – ${fmtDate(m.p.e)}` : t('rep_no_dates'), m.p.sub].filter(Boolean).join(' · '))} · ${esc(t('rep_generated', { at: new Date().toLocaleString(t.locale()) }))}</p>
<div class="k">${COLS.map(([, key, f]) => `<div>${esc(t(key))}<b>${esc(String(f(m)))}</b></div>`).join('')}</div>
<h2>${esc(t('rep_s_active'))}</h2>${table(['ID', t('f_title'), t('f_status'), t('err_export_status'), t('err_app'), t('err_last')],
      m.active.map(r => tr([r.key, r.title, effStatus(r), r.data?.status, r.data?.app, day(r.data?.last)])))}
<h2>${esc(t('rep_s_runs'))}</h2>${table([t('f_title'), t('f_date'), t('rep_c_failed')], m.runsIn.map(r => tr([r.title, day(r.data?.date), `${(r.data?.results || []).filter(x => x.status === 'failed').length} / ${(r.data?.results || []).length}`])))}
<h2>${esc(t('rep_s_features'))}</h2>${table([t('f_code'), t('f_title'), t('f_sprint'), t('rep_tests')], m.featRows.map(({ f, tests: ts }) => tr([f.key, f.title, f.data?.sprint, ts.map(x => x.key).join(', ') || '—'])))}
<h2>${esc(t('rep_s_specs'))}</h2>${table([t('f_key'), t('f_title'), t('f_status'), t('f_release')], m.specsIn.map(r => tr([r.key, r.title, r.data?.status, r.data?.release])))}
<h2>${esc(t('rep_s_docs'))}</h2>${table([t('f_title'), t('rep_changed')], m.docsIn.map(r => tr([r.title, `${tsDay(r.updated_at)} · ${r.updated_by || ''}`])))}
</body></html>`;
  }

  paint();
}
