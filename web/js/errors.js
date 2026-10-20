// Error items from the regtest tool's Error Management export, and what changed between two exports.
import { normalize } from './util.js';

export const EM_FIELDS = [
  { key: 'id', required: true, aliases: ['error-id', 'error id', 'errorid', 'id', 'ei'] },
  { key: 'title', required: true, aliases: ['title', 'titel', 'titlu', 'error title'] },
  { key: 'status', aliases: ['error status', 'status', 'state'] },
  { key: 'type', aliases: ['error type', 'type', 'typ', 'tip'] },
  { key: 'runs', aliases: ['testruncount', 'test run count', 'testrun count', 'run count'] },
  { key: 'packages', aliases: ['affected testpackages', 'affected test packages', 'affected packages', 'testpackages'] },
  { key: 'responsibles', aliases: ['responsibles', 'responsible', 'verantwortlich', 'responsabili'] },
  { key: 'first', aliases: ['first time stamp', 'first timestamp', 'first seen', 'erstes auftreten'] },
  { key: 'last', aliases: ['last time stamp', 'last timestamp', 'last seen', 'letztes auftreten'] },
  { key: 'app', aliases: ['application name', 'application', 'anwendung', 'aplicatie'] },
];

export const STATUSES = ['New', 'Assigned', 'Processing', 'Solved', 'Closed', 'Cancelled'];
const OPEN = new Set(['new', 'assigned', 'processing', 'open', 'in progress', 'reopened']);
export const isOpen = status => OPEN.has(String(status || '').trim().toLowerCase());

/** "[ 3 / 18 / 99 ]" -> [3, 18, 99]; a single number -> [0, 0, n]. */
export function parseRuns(v) {
  const nums = String(v ?? '').match(/\d+/g)?.map(Number) || [];
  if (nums.length >= 3) return nums.slice(0, 3);
  if (nums.length === 1) return [0, 0, nums[0]];
  return [0, 0, 0];
}

/** "18.03.2021 16:00:16" / "2021-03-18 16:00" / Excel date -> "2021-03-18T16:00:16" ('' when unknown). */
export function parseStamp(v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number' || /^\d{5}(\.\d+)?$/.test(String(v).trim())) {
    const ms = Date.UTC(1899, 11, 30) + Number(v) * 86400000;
    return new Date(ms).toISOString().slice(0, 19);
  }
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${(m[4] || '0').padStart(2, '0')}:${m[5] || '00'}:${m[6] || '00'}`;
  m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}T${(m[4] || '0').padStart(2, '0')}:${m[5] || '00'}:${m[6] || '00'}`;
  return '';
}

const list = v => String(v || '').split(/[;,\n]+/).map(x => x.trim()).filter(Boolean);

/** Mapped export row -> plain error item. */
export function toItem(m) {
  const id = String(m.id || '').trim();
  if (!id || !String(m.title || '').trim()) return null;
  return {
    id, title: String(m.title).trim(), status: String(m.status || '').trim(), type: String(m.type || '').trim(),
    runs: parseRuns(m.runs), packages: Number(String(m.packages || '').match(/\d+/)?.[0] || 0),
    responsibles: list(m.responsibles), first: parseStamp(m.first), last: parseStamp(m.last), app: String(m.app || '').trim(),
  };
}

/** Compare the incoming export with the stored error records. */
export function diffErrors(existing, items) {
  const byKey = new Map(existing.map(r => [r.key, r]));
  const incoming = new Set(items.map(i => i.id));
  const out = { added: [], status: [], runsUp: [], seenAgain: [], gone: [] };
  for (const it of items) {
    const old = byKey.get(it.id);
    if (!old) { out.added.push(it.id); continue; }
    const d = old.data || {};
    if (String(d.status || '').toLowerCase() !== it.status.toLowerCase()) out.status.push({ id: it.id, from: d.status || '', to: it.status });
    const before = (d.runs || [0, 0, 0])[2], now = it.runs[2];
    if (now > before) out.runsUp.push({ id: it.id, from: before, to: now });
    if (it.last && d.last && it.last > d.last) out.seenAgain.push(it.id);
  }
  for (const r of existing) if (!incoming.has(r.key)) out.gone.push(r.key);
  return out;
}

/** Error item -> stored record, keeping when it was first imported and since when its status holds. */
export function toRecord(it, old, importDate) {
  const d = old?.data || {};
  const statusChanged = !old || String(d.status || '').toLowerCase() !== it.status.toLowerCase();
  return {
    key: it.id, kind: it.type, title: it.title, body: '',
    tags: it.responsibles,
    data: {
      status: it.status, type: it.type, runs: it.runs, packages: it.packages, responsibles: it.responsibles,
      first: it.first, last: it.last, app: it.app,
      first_import: d.first_import || importDate,
      status_since: statusChanged ? importDate : d.status_since || importDate,
      prev_status: statusChanged ? d.status || '' : d.prev_status || '',
      prev_runs: d.runs || null, last_import: importDate,
    },
  };
}

/** Compact snapshot of one export, stored for the change history. */
export function snapshot(items, diff, file, importDate) {
  return {
    key: `${importDate}|${file}`, title: file, kind: 'snapshot',
    data: {
      date: importDate, file, total: items.length, open: items.filter(i => isOpen(i.status)).length,
      items: items.map(i => [i.id, i.status, i.runs[2], i.runs[1], i.last]),
      added: diff.added, status: diff.status, runs_up: diff.runsUp, seen_again: diff.seenAgain, gone: diff.gone,
    },
  };
}

/** Is a timestamp inside [from, to] (ISO dates)? */
export const within = (stamp, from, to) => !!stamp && !!from && stamp.slice(0, 10) >= from && stamp.slice(0, 10) <= (to || from);

/** The regtest window of the main product that covers `day`, or the latest one before it. */
export function regtestWindow(timeline, day) {
  const rt = timeline.filter(r => r.kind === 'regtest' && r.data?.start && !r.data?.product && r.data?.show !== false)
    .map(r => ({ r, s: r.data.start, e: r.data.end || r.data.start })).sort((a, b) => a.s.localeCompare(b.s));
  const now = rt.filter(x => x.s <= day && x.e >= day);
  if (now.length) return { ...now[now.length - 1], current: true };
  const past = rt.filter(x => x.e < day);
  return past.length ? { ...past[past.length - 1], current: false } : null;
}

export const matchText = (r, q) => !q || normalize(`${r.key} ${r.title} ${r.data?.type} ${r.data?.app} ${(r.data?.responsibles || []).join(' ')}`).includes(normalize(q));
