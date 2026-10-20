// Timeline model: reads the SharePoint timeline export, derives release / sprint / environment from titles,
// checks data quality and clones a whole release to plan the next one.
import { addDays, iso, parseIso } from './util.js';

export const TIMELINE_KINDS = ['sprint', 'review', 'deployment', 'integration', 'regtest', 'performance', 'documentation', 'protocol',
  'planning', 'qa', 'freeze', 'holiday', 'other'];
export const ENVIRONMENTS = ['DEV', 'MIG UAT', 'UAT', 'CORE LT', 'PROD'];

const fold = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');

// Order matters: the first rule that matches wins. Titles are checked before the keyword column.
const KIND_RULES = [
  ['holiday', /urlaub|holiday|feiertag|vacation|concediu|abwesen|sarbatoare/],
  ['performance', /\blup\b|last.?und.?perf|performance|lasttest/],
  ['deployment', /deploy|go.?live|rollout|livrare/],
  ['protocol', /testprotokoll|test protocol|protocol/],
  ['regtest', /reg.?test|regression|regresie/],
  ['integration', /integrationstest|integration test|integrare/],
  ['documentation', /business view|technical view|regtestrelevant|doku|documenta/],
  ['review', /review|feature prasentation|prasentation|presentation|demo|prezentare/],
  ['planning', /planning|planung|planificare/],
  ['freeze', /freeze|einfrieren|inghet/],
  ['qa', /\bq\s*&\s*a\b|\bqa\b|abnahme|acceptance/],
  ['sprint', /^sprint\b/],
];

/** Map the SharePoint keyword ("Schlagwort") and the title onto one timeline kind. */
export function normalizeKind(keyword, title = '') {
  const k = fold(keyword).trim();
  if (TIMELINE_KINDS.includes(k)) return k;
  for (const [kind, re] of KIND_RULES) if (re.test(fold(title))) return kind;
  for (const [kind, re] of KIND_RULES) if (re.test(k)) return kind;
  return 'other';
}

/** "V4.10" -> [4, 10] for sorting. */
export function versionNum(v) {
  const m = /(\d+)\.(\d+)/.exec(String(v || ''));
  return m ? [+m[1], +m[2]] : [0, 0];
}
export const cmpVersion = (a, b) => { const x = versionNum(a), y = versionNum(b); return x[0] - y[0] || x[1] - y[1]; };

/** Pull release, sprint, environment, OT version and side product out of a title. */
export function parseTitle(title) {
  const s = String(title || '');
  const out = { release: '', sprint: '', env: '', ot: '', product: '' };
  const side = /\bTIMA\b/i.test(s);
  if (side) out.product = 'TIMA';
  const rel = /\bV(\d+\.\d+)\b/i.exec(s);
  if (rel) out[side ? 'product_version' : 'release'] = 'V' + rel[1];
  const sp = /\bS(\d+[a-z]?)(?:\s*(?:&|\+|und|and)\s*S?(\d+[a-z]?))?\b/i.exec(s) || /\bSprint\s+(\d+[a-z]?)(?:\s*&\s*(\d+[a-z]?))?/i.exec(s);
  if (sp) out.sprint = 'S' + sp[1] + (sp[2] ? '&' + sp[2] : '');
  if (/\bMIG[\s_-]*UAT\b/i.test(s)) out.env = 'MIG UAT';
  else if (/\bCORE[\s_-]*LT\b/i.test(s)) out.env = 'CORE LT';
  else if (/\bPROD\b/i.test(s)) out.env = 'PROD';
  else if (/\bUAT\b/i.test(s)) out.env = 'UAT';
  else if (/\bDEV\b/i.test(s)) out.env = 'DEV';
  const ot = /\bOT\s*(\d+(?:\.\d+){1,2})/i.exec(s);
  if (ot) out.ot = ot[1];
  return out;
}

/** Day/month order of a date column given as text ("12/11/2023"): 'mdy', 'dmy' or '' when it cannot be told. */
export function detectDateOrder(values) {
  let mdy = 0, dmy = 0;
  for (const v of values) {
    const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/.exec(String(v || '').trim());
    if (!m) continue;
    if (+m[1] > 12) dmy++;
    if (+m[2] > 12) mdy++;
    if (String(v).includes('.')) dmy += 0.1; // German style dots
  }
  return mdy > dmy ? 'mdy' : dmy > mdy ? 'dmy' : '';
}

/** Text or Excel value -> ISO date, honouring the detected day/month order. */
export function toIso(v, order) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date && !isNaN(v)) return iso(v);
  const s = String(v).trim();
  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(s)) { const [y, mo, d] = s.slice(0, 10).split('-'); return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`; }
  if (/^\d{4,5}(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 20000 && n < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000); return iso(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); }
  }
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/.exec(s);
  if (!m) return '';
  let [, a, b, y] = m; if (y.length === 2) y = '20' + y;
  let day = +a, mon = +b;
  if (order === 'mdy' || (!order && mon > 12)) [day, mon] = [mon, day];
  if (mon > 12 || day > 31 || !mon || !day) return '';
  return `${y}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const yes = v => !/^(nein|no|nu|false|0|n)$/i.test(String(v ?? '').trim());
const sprintNums = s => String(s || '').replace(/^S/i, '').split('&').map(x => parseInt(x, 10)).filter(n => !isNaN(n));
const titleKey = s => fold(s).replace(/\s+/g, ' ').trim();
export const stripVersion = s => titleKey(String(s || '').replace(/\bV\d+\.\d+\b/gi, ''));

export const SP_FIELDS = [
  { key: 'version', aliases: ['timeline version', 'version', 'release', 'versiune'] },
  { key: 'keyword', aliases: ['schlagwort', 'keyword', 'category', 'kategorie', 'categorie', 'type', 'typ', 'tip'] },
  { key: 'title', aliases: ['vorgangsname', 'task name', 'title', 'titel', 'name', 'titlu', 'denumire'] },
  { key: 'start', aliases: ['anfangsdatum', 'start date', 'start', 'beginn', 'begin', 'data start', 'inceput'] },
  { key: 'end', aliases: ['falligkeitsdatum', 'fälligkeitsdatum', 'due date', 'end date', 'end', 'ende', 'sfarsit', 'data sfarsit'] },
  { key: 'assigned', aliases: ['zugewiesen an', 'assigned to', 'owner', 'verantwortlich', 'responsabil'] },
  { key: 'show', aliases: ['anzeigen', 'show', 'visible', 'sichtbar', 'afisare'] },
  { key: 'notes', aliases: ['notes', 'notizen', 'beschreibung', 'note', 'comentariu'] },
];

/**
 * rows: [{version, keyword, title, start, end, assigned, show}] in file order (already mapped).
 * Returns { records, stats } — records ready for import; group rows ("V5.6 S1 Regressionstest" without
 * a name or dates) become sprint bars spanning their events.
 */
export function fromSharePoint(rows) {
  const order = detectDateOrder(rows.flatMap(r => [r.start, r.end]));
  const out = [], seen = new Map(), groups = [];
  let group = null, file = 0;
  const stats = { rows: rows.length, groups: 0, duplicates: 0, undated: 0, order };
  for (const r of rows) {
    file++;
    const title = String(r.title || '').trim();
    const keyword = String(r.keyword || '').trim();
    const start = toIso(r.start, order), end = toIso(r.end, order) || start;
    if (!title && !start && /\bS\d/i.test(keyword)) { // group header row
      const p = parseTitle(keyword);
      group = { release: p.release || String(r.version || '').trim(), sprint: p.sprint, label: keyword, events: [], order: file };
      groups.push(group); stats.groups++;
      continue;
    }
    if (!title && !keyword) continue;
    const name = title || keyword;
    const p = parseTitle(name);
    const col = String(r.version || '').trim();
    const colRel = /^V\d/i.test(col) ? col.toUpperCase() : '';
    const kind = normalizeKind(keyword, name);
    const inherits = !p.release && !p.product && group && kind !== 'holiday';
    const release = p.product ? '' : (p.release || (inherits ? group.release : colRel));
    const sprint = p.sprint || (inherits ? group.sprint : '');
    const data = {
      start, end, release, sprint, env: p.env, ot: p.ot, product: p.product || '', product_version: p.product_version || '',
      keyword, release_col: colRel, group: inherits || (group && p.sprint && p.release === group.release) ? `${group.release} ${group.sprint}` : '',
      show: yes(r.show === undefined || r.show === '' ? 'ja' : r.show), order: file, source: 'sharepoint',
    };
    const who = String(r.assigned || '').trim();
    if (kind === 'holiday') data.substitute = who; else data.owner = who;
    if (!start) stats.undated++;
    const dupKey = `${titleKey(name)}|${start}|${end}`;
    if (seen.has(dupKey)) { const prev = seen.get(dupKey); prev.data.dup_count = (prev.data.dup_count || 1) + 1; stats.duplicates++; continue; }
    const rec = { kind, key: dupKey, title: name, body: String(r.notes || ''), data };
    seen.set(dupKey, rec);
    out.push(rec);
    if (group && data.group) group.events.push(rec);
  }
  for (const g of groups) {
    const dated = g.events.filter(e => e.data.start);
    const label = `${g.release} ${g.sprint}`.trim();
    if (!dated.length || out.some(x => x.kind === 'sprint' && x.title === label)) continue;
    const s = dated.map(e => e.data.start).sort()[0];
    const e = dated.map(x => x.data.end || x.data.start).sort().pop();
    out.push({ kind: 'sprint', key: `grp|${titleKey(label)}`, title: label, body: '',
      data: { start: s, end: e, release: g.release, sprint: g.sprint, env: '', ot: '', product: '', keyword: g.label, group: label, show: true, order: g.order, source: 'sharepoint' } });
  }
  return { records: out, stats };
}

export const ISSUE_TYPES = ['end_before_start', 'copied_dates', 'duplicate', 'release_mismatch', 'sprint_mismatch', 'no_dates'];

/** Data-quality findings on timeline records: [{type, rec, info}] */
export function checkTimeline(records) {
  const out = [];
  const add = (type, rec, info = '') => out.push({ type, rec, info });
  const live = new Map();
  for (const r of records) {
    const d = r.data || {};
    if (r.kind === 'sprint') continue;
    if (!d.start) { add('no_dates', r); continue; }
    if (d.end && d.end < d.start) add('end_before_start', r, `${d.start} → ${d.end}`);
    if (d.dup_count > 1) add('duplicate', r, `${d.dup_count}×`);
    const k = `${titleKey(r.title)}|${d.start}|${d.end}`;
    if (live.has(k)) add('duplicate', r, '2×'); else live.set(k, r);
    if (d.release_col && d.release && d.release_col !== d.release) add('release_mismatch', r, `${d.release_col} ≠ ${d.release}`);
    if (d.group && d.sprint && !sprintNums(d.sprint).includes(sprintNums(d.group.split(' ').pop())[0])) add('sprint_mismatch', r, `${d.group} ↔ ${d.sprint}`);
  }
  // same step with the same dates in an earlier release -> dates were copied and never adjusted
  const bySig = new Map();
  for (const r of records) {
    const d = r.data || {};
    if (!d.start || !d.release || r.kind === 'sprint') continue;
    const sig = `${stripVersion(r.title)}|${d.start}|${d.end}`;
    (bySig.get(sig) || bySig.set(sig, []).get(sig)).push(r);
  }
  for (const list of bySig.values()) {
    const rels = [...new Set(list.map(r => r.data.release))].sort(cmpVersion);
    if (rels.length < 2) continue;
    for (const r of list) if (r.data.release !== rels[0]) add('copied_dates', r, rels[0]);
  }
  return out;
}

/** The PROD deployment of a release, if any. */
export function prodOf(records, release) {
  return records.filter(r => r.kind === 'deployment' && r.data?.release === release && r.data?.env === 'PROD' && r.data?.start)
    .sort((a, b) => a.data.start.localeCompare(b.data.start))[0] || null;
}

/** Suggested next version: V5.6 -> V5.7. */
export function nextVersion(v) { const [a, b] = versionNum(v); return a ? `V${a}.${b + 1}` : ''; }

/** Default shift in weeks between two consecutive releases, measured from PROD to PROD. */
export function releaseGapWeeks(records, release) {
  const rels = [...new Set(records.map(r => r.data?.release).filter(Boolean))].sort(cmpVersion);
  const i = rels.indexOf(release);
  const cur = prodOf(records, release), prev = i > 0 ? prodOf(records, rels[i - 1]) : null;
  if (cur && prev) return Math.max(1, Math.round((parseIso(cur.data.start) - parseIso(prev.data.start)) / (7 * 86400000)));
  return 17;
}

/** Copy every event of `source` as release `target`, moved by `weeks` (weekdays stay the same). */
export function cloneRelease(records, source, target, weeks, holidays = []) {
  const hol = new Set(holidays);
  const shift = s => (s ? iso(addDays(parseIso(s), weeks * 7)) : '');
  const ren = s => String(s || '').replace(new RegExp(`\\b${source.replace('.', '\\.')}\\b`, 'gi'), target);
  return records.filter(r => r.data?.release === source && r.kind !== 'holiday' && !r.data?.product).map(r => {
    const data = { ...r.data, start: shift(r.data.start), end: shift(r.data.end), release: target, release_col: target,
      group: r.data.group ? ren(r.data.group) : '', dup_count: undefined, source: 'clone', cloned_from: source };
    const title = ren(r.title);
    const onHoliday = [data.start, data.end].filter(d => d && hol.has(d));
    if (onHoliday.length) data.holiday_warning = onHoliday.join(', ');
    return { kind: r.kind, key: r.kind === 'sprint' ? `grp|${titleKey(title)}` : `${titleKey(title)}|${data.start}|${data.end}`, title, body: r.body || '', data };
  });
}

const p2 = n => String(n).padStart(2, '0');
const us = s => { const d = parseIso(s); return d ? `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}` : ''; };

/** Rows in the SharePoint column layout (group rows included), for exporting back. */
export function toSharePointRows(records) {
  const header = ['Timeline Version', 'Schlagwort', 'Vorgangsname', 'Anfangsdatum', 'Fälligkeitsdatum', 'Zugewiesen an', 'Anzeigen'];
  const rels = [...new Set(records.map(r => r.data?.release || ''))].sort((a, b) => (a ? 0 : 1) - (b ? 0 : 1) || cmpVersion(a, b));
  const rows = [];
  const line = r => [r.data?.release_col || r.data?.release || '-', r.data?.keyword || r.kind, r.title, us(r.data?.start), us(r.data?.end),
    r.kind === 'holiday' ? r.data?.substitute || '' : r.data?.owner || '', r.data?.show === false ? 'Nein' : 'Ja'];
  const byStart = (a, b) => (a.data?.order || 0) - (b.data?.order || 0) || String(a.data?.start).localeCompare(String(b.data?.start));
  for (const rel of rels) {
    const items = records.filter(r => (r.data?.release || '') === rel && r.kind !== 'sprint').sort(byStart);
    const sprints = records.filter(r => r.kind === 'sprint' && r.data?.release === rel).sort(byStart);
    const used = new Set();
    for (const s of sprints) {
      rows.push([rel, `${rel} ${s.data.sprint} Regressionstest`, '', '', '', '', 'Ja']);
      for (const r of items.filter(x => x.data?.group === s.title)) { rows.push(line(r)); used.add(r); }
    }
    for (const r of items) if (!used.has(r)) rows.push(line(r));
  }
  return { header, rows };
}

export { p2 };
