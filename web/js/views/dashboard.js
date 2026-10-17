// Release cockpit: where the current release stands and what is still open before regtest.
import { t } from '../i18n.js';
import { buildCoverage, COVER_COLS } from '../match.js';
import { analyse } from '../triage.js';
import { addDays, btn, chip, daysBetween, emptyState, fmtDate, fmtDateTime, h, parseIso } from '../util.js';

export async function render(root, ctx) {
  const get = s => (ctx.canPage(({ timeline: 'timeline', features: 'coverage', tests: 'coverage', specs: 'specs', transcripts: 'transcripts', runs: 'triage', known: 'triage', docs: 'docs' })[s]) ? ctx.records(s).catch(() => []) : Promise.resolve([]));
  const [timeline, features, tests, specs, transcripts, runs, known, docs] = await Promise.all(['timeline', 'features', 'tests', 'specs', 'transcripts', 'runs', 'known', 'docs'].map(get));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const colors = ctx.settings.timeline_colors || {};

  const ev = timeline.map(r => ({ ...r, s: parseIso(r.data?.start), e: parseIso(r.data?.end || r.data?.start) })).filter(r => r.s);
  const milestones = ev.filter(r => ['freeze', 'regtest', 'qa', 'deployment'].includes(r.kind) && r.data?.release).sort((a, b) => a.s - b.s);
  const nextDep = milestones.find(r => r.kind === 'deployment' && r.e >= today);
  const release = nextDep?.data.release || milestones[milestones.length - 1]?.data.release || '';
  const phases = ['freeze', 'regtest', 'qa', 'deployment'].map(k => milestones.find(r => r.kind === k && r.data.release === release)).filter(Boolean);
  const relSprints = ev.filter(r => r.kind === 'sprint' && r.data?.release === release).sort((a, b) => a.s - b.s);
  const regtest = phases.find(p => p.kind === 'regtest');

  const cov = buildCoverage({ features, tests, specs, transcripts, settings: ctx.settings });
  const gaps = cov.filter(r => r.gaps);
  const sortedRuns = runs.slice().sort((a, b) => String(a.data?.date).localeCompare(String(b.data?.date)));
  const lastRun = sortedRuns[sortedRuns.length - 1];
  const tri = lastRun ? analyse(sortedRuns, lastRun, sortedRuns[sortedRuns.length - 2], known, +ctx.settings.flaky_window || 5) : null;
  const openBugs = specs.filter(s => s.kind === 'bug' && !/done|closed|obsolete|fixed/i.test(s.data?.status || ''));
  const noSummary = transcripts.filter(s => !s.data?.summary);
  const incompleteDocs = docs.filter(d => !d.data?.complete);

  let headline = t('dash_no_release');
  if (regtest) {
    const d = daysBetween(today, regtest.s);
    headline = d > 0 ? t('dash_regtest_in', { n: d }) : regtest.e >= today ? t('dash_regtest_now') : t('dash_regtest_done');
  }

  root.appendChild(h('div', { class: 'page-head' },
    h('div', null, h('div', { class: 'small muted' }, t('dash_current_release')), h('h1', null, release || '—')),
    h('div', { style: { fontSize: '15px' } }, h('b', null, headline), nextDep ? h('span', { class: 'muted' }, ` · ${t('k_deployment')} ${fmtDate(nextDep.s)}`) : null)));

  // phase strip
  if (relSprints.length || phases.length) {
    const steps = [];
    if (relSprints.length) steps.push({ label: t('dash_sprints'), s: relSprints[0].s, e: relSprints[relSprints.length - 1].e, kind: 'sprint', sub: relSprints.map(x => x.title.replace(/\D+/g, '')).join(', ') });
    for (const p of phases) steps.push({ label: t('k_' + p.kind), s: p.s, e: p.e, kind: p.kind });
    root.appendChild(h('div', { style: { display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(150px, 1fr))`, gap: '8px' } }, steps.map((x, i) => {
      const state = x.e < today ? 'done' : x.s <= today ? 'active' : 'next';
      return h('div', { class: 'card', style: { padding: '12px 14px', borderTop: `4px solid ${state === 'next' ? 'var(--line)' : colors[x.kind] || 'var(--accent)'}` } },
        h('div', { class: 'small muted' }, `${i + 1} · ${x.label}`),
        h('div', { style: { fontWeight: 600, marginTop: '4px' } }, x.s.getTime() === x.e.getTime() ? fmtDate(x.s) : `${fmtDate(x.s, { day: '2-digit', month: 'short' })} – ${fmtDate(x.e, { day: '2-digit', month: 'short' })}`),
        x.sub ? h('div', { class: 'small muted' }, x.sub) : null,
        h('div', { style: { marginTop: '6px' } }, chip(t('dash_state_' + state), state === 'done' ? 'ok' : state === 'active' ? 'warn' : '')));
    })));
  }

  const kpi = (label, v, kind, page) => h('button', { type: 'button', class: 'kpi ' + (kind || ''), style: { textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit' }, onclick: () => ctx.navigate(page) },
    h('div', { class: 'l' }, label), h('div', { class: 'v' }, v));
  root.appendChild(h('div', { class: 'kpis' },
    kpi(t('dash_k_features'), features.length, '', 'coverage'),
    kpi(t('dash_k_gaps'), gaps.length, gaps.length ? 'bad' : 'ok', 'coverage'),
    kpi(t('dash_k_new_errors'), tri ? tri.count('new') : '—', tri?.count('new') ? 'bad' : '', 'triage'),
    kpi(t('dash_k_open_bugs'), openBugs.length, openBugs.length ? 'warn' : '', 'specs'),
    kpi(t('dash_k_sessions'), noSummary.length, noSummary.length ? 'warn' : 'ok', 'transcripts')));

  // to-do list
  const todo = [];
  for (const r of gaps.slice(0, 8)) {
    const miss = COVER_COLS.filter(c => r.status[c] === 'gap');
    todo.push([miss.includes('test') ? 'bad' : 'warn', t('dash_todo_gap'), `${r.feature.key ? r.feature.key + ' ' : ''}${r.feature.title} — ${t('cov_missing_list')} ${miss.map(c => t('cov_c_' + c)).join(', ')}`, 'coverage']);
  }
  if (gaps.length > 8) todo.push(['warn', t('dash_todo_gap'), t('dash_todo_more', { n: gaps.length - 8 }), 'coverage']);
  for (const s of noSummary.slice(0, 4)) todo.push(['warn', t('dash_todo_session'), `${s.title} (${fmtDate(s.data?.date)})`, 'transcripts']);
  if (tri?.count('new')) todo.push(['bad', t('dash_todo_errors'), t('dash_todo_errors_text', { n: tri.count('new'), g: tri.groups.filter(g => g.type === 'new').length }), 'triage']);
  for (const d of incompleteDocs.slice(0, 4)) todo.push(['warn', t('dash_todo_doc'), d.title, 'docs']);

  const upcoming = ev.filter(r => r.e >= today && r.s <= addDays(today, 21) && r.kind !== 'sprint').sort((a, b) => a.s - b.s).slice(0, 10);

  root.appendChild(h('div', { class: 'row' },
    h('section', { class: 'card', style: { flex: '2 1 420px' } }, h('h2', null, t('dash_todo')),
      todo.length ? h('div', { class: 'list' }, todo.map(([kind, label, text, page]) => h('div', { class: 'li' }, chip(label, kind), h('span', { class: 'grow' }, text),
        btn(t('open'), () => ctx.navigate(page), { cls: 'sm ghost' })))) : emptyState(t('dash_todo_none'))),
    h('section', { class: 'card', style: { flex: '1 1 280px' } }, h('h2', null, t('dash_upcoming')),
      upcoming.length ? h('div', { class: 'list' }, upcoming.map(r => h('div', { class: 'li' },
        h('span', { class: 'chip', style: { background: colors[r.kind] || 'var(--accent)', color: '#FFFFFF' } }, t('k_' + r.kind)),
        h('span', { class: 'grow' }, r.title), h('span', { class: 'small muted nowrap' }, fmtDate(r.s, { day: '2-digit', month: 'short' }))))) : h('p', { class: 'hint' }, t('dash_upcoming_none')),
      h('div', { style: { marginTop: '10px' } }, btn(t('nav_timeline'), () => ctx.navigate('timeline'), { cls: 'sm', icon: 'calendar' })))));

  const imports = await ctx.api.imports().catch(() => []);
  root.appendChild(h('section', { class: 'card' }, h('h2', null, t('dash_sources')),
    imports.length ? h('div', { class: 'list' }, imports.slice(0, 8).map(i => h('div', { class: 'li' }, h('span', { class: 'mono grow', style: { overflowWrap: 'anywhere' } }, i.filename),
      chip(t('sec_' + i.section)), h('span', { class: 'small muted nowrap' }, fmtDateTime(i.ts))))) : h('p', { class: 'hint' }, t('dash_sources_none')),
    h('p', { class: 'hint', style: { marginBottom: 0 } }, ctx.api.demo ? t('dash_local_demo') : t('dash_local'))));
}
