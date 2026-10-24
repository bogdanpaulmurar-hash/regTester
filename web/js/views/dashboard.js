// Release cockpit: where the current release stands (sprints → MIG UAT → CORE LT → PROD), the regtest
// window, open errors and what still needs attention.
import { effStatus, isOpen, regtestWindow, within } from '../errors.js';
import { t } from '../i18n.js';
import { buildCoverage, coverCols } from '../match.js';
import { checkTimeline, cmpVersion } from '../timeline-gen.js';
import { addDays, btn, chip, daysBetween, emptyState, fmtDate, fmtDateTime, h, iso, kpiBox, parseIso } from '../util.js';

const PAGE = { timeline: 'timeline', features: 'coverage', tests: 'coverage', specs: 'specs', transcripts: 'transcripts', errors: 'triage', errsnaps: 'triage', docs: 'docs' };

export async function render(root, ctx) {
  const get = s => (ctx.canPage(PAGE[s]) ? ctx.records(s).catch(() => []) : Promise.resolve([]));
  const [timeline, features, tests, specs, transcripts, errors, snapsRaw, docs] = await Promise.all(['timeline', 'features', 'tests', 'specs', 'transcripts', 'errors', 'errsnaps', 'docs'].map(get));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayIso = iso(today);
  const colors = ctx.settings.timeline_colors || {};
  const ev = timeline.filter(r => r.data?.start && r.data?.show !== false)
    .map(r => ({ ...r, s: parseIso(r.data.start), e: parseIso(r.data.end && r.data.end >= r.data.start ? r.data.end : r.data.start) })).filter(r => r.s);

  // current release = the first one whose PROD deployment is still ahead (or the latest one)
  const prods = ev.filter(r => r.kind === 'deployment' && r.data.env === 'PROD' && r.data.release && !r.data.product).sort((a, b) => a.s - b.s);
  const nextProd = prods.find(r => r.e >= today);
  const releases = [...new Set(ev.map(r => r.data.release).filter(Boolean))].sort(cmpVersion);
  const release = nextProd?.data.release || releases[releases.length - 1] || '';
  const relEv = ev.filter(r => r.data.release === release && !r.data.product);
  const sprints = relEv.filter(r => r.kind === 'sprint').sort((a, b) => a.s - b.s);
  const phases = relEv.filter(r => !r.data.sprint && ['deployment', 'regtest', 'performance'].includes(r.kind)).sort((a, b) => a.s - b.s);
  const lastSprint = sprints[sprints.length - 1]?.data.sprint;
  const lastMig = relEv.filter(r => r.kind === 'regtest' && r.data.env === 'MIG UAT' && r.data.sprint === lastSprint)[0];
  const steps = [...sprints.map(s => ({ label: s.title, s: s.s, e: s.e, kind: 'sprint' })),
    ...(lastMig ? [{ label: lastMig.title, s: lastMig.s, e: lastMig.e, kind: 'regtest' }] : []),
    ...phases.map(p => ({ label: p.title, s: p.s, e: p.e, kind: p.kind }))].sort((a, b) => a.s - b.s);
  const win = regtestWindow(timeline, todayIso);

  let headline = t('dash_no_release');
  if (win?.current) headline = t('dash_in_window', { title: win.r.title, n: daysBetween(today, parseIso(win.e)) });
  else if (nextProd) headline = t('dash_prod_in', { n: daysBetween(today, nextProd.s), d: fmtDate(nextProd.s) });

  root.appendChild(h('div', { class: 'page-head' },
    h('div', null, h('div', { class: 'small muted' }, t('dash_current_release')), h('h1', null, release || '—')),
    h('div', { style: { fontSize: '15px' } }, h('b', null, headline))));

  if (steps.length) {
    root.appendChild(h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '8px' } }, steps.map((x, i) => {
      const state = x.e < today ? 'done' : x.s <= today ? 'active' : 'next';
      return h('div', { class: 'card', style: { padding: '12px 14px', borderTop: `4px solid ${state === 'next' ? 'var(--line)' : colors[x.kind] || 'var(--accent)'}` } },
        h('div', { class: 'small muted' }, `${i + 1} · ${t('k_' + x.kind)}`),
        h('div', { style: { fontWeight: 600, marginTop: '4px' } }, x.label),
        h('div', { class: 'small' }, x.s.getTime() === x.e.getTime() ? fmtDate(x.s) : `${fmtDate(x.s, { day: '2-digit', month: 'short' })} – ${fmtDate(x.e, { day: '2-digit', month: 'short' })}`),
        h('div', { style: { marginTop: '6px' } }, chip(t('dash_state_' + state), state === 'done' ? 'ok' : state === 'active' ? 'warn' : '')));
    })));
  } else if (!timeline.length && ctx.canPage('timeline')) {
    root.appendChild(emptyState(t('dash_no_timeline'), btn(ctx.pageLabel('timeline'), () => ctx.navigate('timeline'), { icon: 'calendar', cls: 'primary' })));
  }

  const snaps = snapsRaw.slice().sort((a, b) => String(b.data?.date).localeCompare(String(a.data?.date)) || b.created_at - a.created_at);
  const snap = snaps[0];
  const open = errors.filter(r => isOpen(effStatus(r)));
  const inWin = win ? open.filter(r => within(r.data?.last, win.s, win.e)) : [];
  const COLS = coverCols(ctx);
  const cov = buildCoverage({ features, tests, specs, transcripts, errors, settings: ctx.settings, cols: COLS });
  const gaps = cov.filter(r => r.gaps && (!release || !r.feature.data?.release || r.feature.data.release === release));
  const tlIssues = checkTimeline(timeline).filter(i => i.type !== 'no_dates');
  const uncat = tests.filter(x => !x.data?.main);
  const relDocs = specs.filter(s => s.kind === 'regspec' && s.data?.release === release);

  // every box leads to the elements behind its number, with the same filter applied (see drillHash)
  const kpi = (id, label, v, kind, page, params) => kpiBox(label, v, kind, () => ctx.drill(page, { ...params, from: id }), { id });
  const can = p => ctx.canPage(p);
  root.appendChild(h('div', { class: 'kpis' },
    can('triage') ? kpi('err_k_open', t('err_k_open'), errors.length ? open.length : '—', open.length ? 'warn' : '', 'triage', { tab: 'errors', status: 'open' }) : null,
    can('triage') ? kpi('err_k_new', t('err_k_new'), snap ? snap.data.added.length : '—', snap?.data.added.length ? 'bad' : '', 'triage', { tab: 'errors', status: '', only: 'added' }) : null,
    can('triage') && win ? kpi('err_k_window', t('err_k_window'), inWin.length, inWin.length ? 'warn' : 'ok', 'triage', { tab: 'errors', status: 'open', only: 'window' }) : null,
    can('coverage') ? kpi('cat_k_uncat', t('cat_k_uncat'), tests.length ? uncat.length : '—', uncat.length ? 'warn' : '', 'coverage', { tab: 'catalog', uncat: 1 }) : null,
    can('specs') ? kpi('dash_k_regspecs', t('dash_k_regspecs', { r: release || '—' }), relDocs.length, '', 'specs', { tab: 'table', kind: 'regspec', release }) : null,
    can('timeline') ? kpi('dash_k_tl_issues', t('dash_k_tl_issues'), tlIssues.length, tlIssues.length ? 'warn' : 'ok', 'timeline', { view: 'quality' }) : null,
    can('coverage') ? kpi('dash_k_gaps', t('dash_k_gaps'), gaps.length, gaps.length ? 'bad' : 'ok', 'coverage', { tab: 'matrix', filter: 'gaps', release }) : null));

  const todo = [];
  if (snap?.data.added.length) todo.push(['bad', t('err_k_new'), snap.data.added.slice(0, 6).map(id => `${id} ${errors.find(e => e.key === id)?.title || ''}`).join(' · '), 'triage']);
  if (snap?.data.status.length) todo.push(['info', t('err_k_status'), snap.data.status.slice(0, 6).map(x => `${x.id}: ${x.from || '—'} → ${x.to}`).join(' · '), 'triage']);
  for (const r of inWin.slice(0, 5)) todo.push(['warn', t('err_in_window'), `${r.key} ${r.title} [${r.data.status}]`, 'triage']);
  if (inWin.length > 5) todo.push(['warn', t('err_in_window'), t('dash_todo_more', { n: inWin.length - 5 }), 'triage']);
  if (tlIssues.length) todo.push(['warn', t('tl_v_quality'), t('dash_todo_tl', { n: tlIssues.length }), 'timeline']);
  if (uncat.length) todo.push(['warn', t('cat_k_uncat'), t('dash_todo_uncat', { n: uncat.length }), 'coverage']);
  for (const r of gaps.slice(0, 5)) {
    const miss = COLS.filter(c => r.status[c] === 'gap');
    todo.push([miss.includes('test') ? 'bad' : 'warn', t('dash_todo_gap'), `${r.feature.key ? r.feature.key + ' ' : ''}${r.feature.title} — ${t('cov_missing_list')} ${miss.map(c => t('cov_c_' + c)).join(', ')}`, 'coverage']);
  }
  if (!ctx.isHidden('transcripts')) for (const s of transcripts.filter(x => !x.data?.summary).slice(0, 3)) todo.push(['warn', t('dash_todo_session'), `${s.title} (${fmtDate(s.data?.date)})`, 'transcripts']);
  for (const d of docs.filter(x => !x.data?.complete).slice(0, 3)) todo.push(['warn', t('dash_todo_doc'), d.title, 'docs']);

  const upcoming = ev.filter(r => r.e >= today && r.s <= addDays(today, 28) && r.kind !== 'sprint').sort((a, b) => a.s - b.s).slice(0, 12);
  root.appendChild(h('div', { class: 'row' },
    h('section', { class: 'card', style: { flex: '2 1 420px' } }, h('h2', null, t('dash_todo')),
      todo.length ? h('div', { class: 'list' }, todo.map(([kind, label, text, page]) => h('div', { class: 'li' }, chip(label, kind), h('span', { class: 'grow' }, text),
        btn(t('open'), () => ctx.navigate(page), { cls: 'sm ghost' })))) : emptyState(t('dash_todo_none'))),
    h('section', { class: 'card', style: { flex: '1 1 280px' } }, h('h2', null, t('dash_upcoming')),
      upcoming.length ? h('div', { class: 'list' }, upcoming.map(r => h('div', { class: 'li' },
        h('span', { class: 'chip', style: { background: colors[r.kind] || 'var(--accent)', color: '#FFFFFF' } }, t('k_' + r.kind)),
        h('span', { class: 'grow' }, r.title, r.kind === 'holiday' && r.data.substitute ? h('span', { class: 'small muted' }, ` → ${r.data.substitute}`) : null),
        h('span', { class: 'small muted nowrap' }, fmtDate(r.s, { day: '2-digit', month: 'short' }))))) : h('p', { class: 'hint' }, t('dash_upcoming_none')),
      can('timeline') ? h('div', { style: { marginTop: '10px' } }, btn(ctx.pageLabel('timeline'), () => ctx.navigate('timeline'), { cls: 'sm', icon: 'calendar' })) : null)));

  const imports = await ctx.api.imports().catch(() => []);
  root.appendChild(h('section', { class: 'card' }, h('h2', null, t('dash_sources')),
    imports.length ? h('div', { class: 'list' }, imports.slice(0, 8).map(i => h('div', { class: 'li' }, h('span', { class: 'mono grow', style: { overflowWrap: 'anywhere' } }, i.filename),
      chip(t('sec_' + i.section)), h('span', { class: 'small muted nowrap' }, fmtDateTime(i.ts))))) : h('p', { class: 'hint' }, t('dash_sources_none')),
    h('p', { class: 'hint', style: { marginBottom: 0 } }, ctx.api.demo ? t('dash_local_demo') : t('dash_local'))));
}
