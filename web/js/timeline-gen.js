// Builds a whole year of release events from a few rules, replacing manual SharePoint work.
import { addDays, iso, parseIso } from './util.js';

export const TIMELINE_KINDS = ['sprint', 'planning', 'review', 'deployment', 'regtest', 'qa', 'freeze', 'holiday', 'other'];

const KIND_WORDS = [
  ['planning', /plan/],
  ['review', /review|demo|präsentation|prezentare/],
  ['deployment', /deploy|go.?live|rollout|release day|livrare/],
  ['regtest', /reg.?test|regression|regresie/],
  ['qa', /\bq\s*&?\s*a\b|qa|uat|abnahme|acceptance/],
  ['freeze', /freeze|einfrieren|inghet/],
  ['holiday', /holiday|feiertag|urlaub|vacation|concediu|sarbatoare|liber/],
  ['sprint', /sprint/],
];

/** Map any wording from an Excel "Type" column onto one of the timeline kinds. */
export function normalizeKind(text, title = '') {
  const s = String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (TIMELINE_KINDS.includes(s)) return s;
  for (const [kind, re] of KIND_WORDS) if (re.test(s)) return kind;
  const t = String(title || '').toLowerCase();
  for (const [kind, re] of KIND_WORDS) if (re.test(t)) return kind;
  return 'other';
}

/**
 * rules: { start: 'YYYY-MM-DD' (Monday of first sprint), sprints: 26, sprintWeeks: 2, firstNumber: 1,
 *   prefix: 'Sprint', sprintsPerRelease: 3, releasePrefix: 'R', releaseStart: 1, year: 2027,
 *   freezeDays: 1, regtestDays: 7, qaDays: 4, deployGapDays: 1, holidays: ['2027-01-01', ...] }
 */
export function generateYear(rules) {
  const out = [];
  let start = parseIso(rules.start);
  if (!start) return out;
  const weeks = Math.max(1, +rules.sprintWeeks || 2);
  const holidays = new Set((rules.holidays || []).filter(Boolean));
  const workday = d => d.getDay() !== 0 && d.getDay() !== 6 && !holidays.has(iso(d));
  const nextWorkday = d => { let x = new Date(d); while (!workday(x)) x = addDays(x, 1); return x; };
  const addWorkdays = (d, n) => { let x = new Date(d), left = n; while (left > 0) { x = addDays(x, 1); if (workday(x)) left--; } return x; };
  const perRelease = Math.max(1, +rules.sprintsPerRelease || 3);
  const prefix = rules.prefix || 'Sprint';
  let releaseNo = +rules.releaseStart || 1;
  const relName = n => `${rules.releasePrefix || 'R'}-${rules.year || start.getFullYear()}.${n}`;

  for (let i = 0; i < (+rules.sprints || 0); i++) {
    const n = (+rules.firstNumber || 1) + i;
    const sStart = addDays(start, i * weeks * 7);
    const sEnd = addDays(sStart, weeks * 7 - 3); // Monday .. Friday of the last week
    const release = relName(releaseNo);
    const sprintName = `${prefix} ${n}`;
    out.push({ kind: 'sprint', title: sprintName, data: { start: iso(sStart), end: iso(sEnd), release, sprint: sprintName } });
    const pDay = nextWorkday(sStart);
    out.push({ kind: 'planning', title: `${sprintName} Planning`, data: { start: iso(pDay), end: iso(pDay), release, sprint: sprintName } });
    let rDay = new Date(sEnd); while (!workday(rDay)) rDay = addDays(rDay, -1);
    out.push({ kind: 'review', title: `${sprintName} Review`, data: { start: iso(rDay), end: iso(rDay), release, sprint: sprintName } });

    if ((i + 1) % perRelease === 0) {
      let cursor = addDays(sEnd, 3); // following Monday
      cursor = nextWorkday(cursor);
      if (+rules.freezeDays) {
        const fEnd = addWorkdays(cursor, +rules.freezeDays - 1);
        out.push({ kind: 'freeze', title: `${release} Code freeze`, data: { start: iso(cursor), end: iso(fEnd), release } });
        cursor = nextWorkday(addDays(fEnd, 1));
      }
      const rtEnd = addWorkdays(cursor, Math.max(1, +rules.regtestDays || 5) - 1);
      out.push({ kind: 'regtest', title: `${release} Regtest`, data: { start: iso(cursor), end: iso(rtEnd), release } });
      cursor = nextWorkday(addDays(rtEnd, 1));
      if (+rules.qaDays) {
        const qEnd = addWorkdays(cursor, +rules.qaDays - 1);
        out.push({ kind: 'qa', title: `${release} Q&A`, data: { start: iso(cursor), end: iso(qEnd), release } });
        cursor = nextWorkday(addDays(qEnd, 1));
      }
      const dep = addWorkdays(cursor, Math.max(0, (+rules.deployGapDays || 0)));
      out.push({ kind: 'deployment', title: `${release} Deployment`, data: { start: iso(dep), end: iso(dep), release } });
      releaseNo++;
    }
  }
  for (const d of holidays) out.push({ kind: 'holiday', title: d, data: { start: d, end: d } });
  return out;
}
