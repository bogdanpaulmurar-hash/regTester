// Search over specifications, bugs, issues and procedures.
// Syntax: words (all must match) · "exact phrase" · -exclude · a OR b · prefix* · fuzzy~
//         field:value  (type, status, module, release, tag, key, title, body, by)
//         updated>2026-01-01  created<2026-06-30
import { normalize, tokens } from './util.js';

const FIELD_ALIAS = { type: 'kind', kind: 'kind', typ: 'kind', tip: 'kind', status: 'status', stare: 'status', module: 'module', modul: 'module',
  release: 'release', tag: 'tag', tags: 'tag', key: 'key', id: 'key', title: 'title', titel: 'title', body: 'body', text: 'body', by: 'by', author: 'by',
  updated: 'updated', created: 'created' };

export function parseQuery(q) {
  const parts = [];
  const re = /(-?)(?:(\w+)(:|>=|<=|>|<))?(?:"([^"]*)"|(\S+))/g;
  let m;
  while ((m = re.exec(q))) {
    const [, neg, field, op, phrase, word] = m;
    if (!field && word === 'OR') { parts.push({ or: true }); continue; }
    const f = field ? FIELD_ALIAS[field.toLowerCase()] : null;
    let value = phrase !== undefined ? phrase : word;
    if (field && !f) value = `${field}${op}${value}`; // unknown field: treat as plain text
    const c = { neg: !!neg, field: f, op: f ? op : null, value, phrase: phrase !== undefined };
    if (!c.phrase && /\*$/.test(value)) { c.prefix = true; c.value = value.slice(0, -1); }
    if (!c.phrase && /~$/.test(value)) { c.fuzzy = true; c.value = value.slice(0, -1); }
    if (c.value) parts.push(c);
  }
  // combine "a OR b" into groups
  const groups = [];
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].or) continue;
    if (parts[i + 1]?.or && parts[i + 2] && !parts[i + 2].or) {
      const g = [parts[i]];
      while (parts[i + 1]?.or && parts[i + 2] && !parts[i + 2].or) { g.push(parts[i + 2]); i += 2; }
      groups.push(g);
    } else groups.push([parts[i]]);
  }
  return groups;
}

function lev(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let cur = [i], best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev.splice(0, prev.length, ...cur);
  }
  return prev[b.length];
}

export function indexDoc(r) {
  const d = r.data || {};
  const f = {
    key: normalize(r.key), title: normalize(r.title), body: normalize(r.body), tag: normalize((r.tags || []).join(' ')),
    kind: normalize(r.kind), status: normalize(d.status), module: normalize(d.module), release: normalize(d.release),
    by: normalize(`${r.created_by} ${r.updated_by}`), extra: normalize(Object.entries(d).filter(([k]) => !['status', 'module', 'release'].includes(k)).map(([, v]) => typeof v === 'string' ? v : '').join(' ')),
  };
  return { r, f, words: new Set(tokens(`${r.key} ${r.title} ${r.body} ${(r.tags || []).join(' ')}`)) };
}

const WEIGHT = { key: 6, title: 5, tag: 3, module: 2, release: 2, status: 2, kind: 2, body: 1, extra: 1, by: 1 };

function clauseScore(doc, c, fuzzyAll) {
  const v = normalize(c.value);
  if (c.field === 'updated' || c.field === 'created') {
    const ts = (c.field === 'updated' ? doc.r.updated_at : doc.r.created_at) * 1000;
    const d = Date.parse(c.value); if (isNaN(d)) return 0;
    const ok = { '>': ts > d, '>=': ts >= d, '<': ts < d, '<=': ts <= d, ':': new Date(ts).toISOString().startsWith(c.value) }[c.op];
    return ok ? 0.01 : 0;
  }
  const fields = c.field ? [c.field] : ['key', 'title', 'tag', 'module', 'release', 'status', 'kind', 'body', 'extra'];
  let score = 0;
  for (const fn of fields) {
    const text = doc.f[fn] || '';
    if (!text) continue;
    if (c.field && ['kind', 'status', 'module', 'release'].includes(c.field)) { if (text === v || text.startsWith(v)) score += WEIGHT[fn]; continue; }
    if (c.prefix) { if (new RegExp('(^|[^a-z0-9])' + v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(text)) score += WEIGHT[fn]; continue; }
    const i = text.indexOf(v);
    if (i !== -1) {
      let n = 0, p = i; while (p !== -1 && n < 5) { n++; p = text.indexOf(v, p + v.length); }
      score += WEIGHT[fn] * (1 + Math.log2(n)) * (c.phrase ? 1.5 : 1);
    }
  }
  if (!score && (c.fuzzy || fuzzyAll) && !c.phrase && v.length >= 4 && (!c.field || ['title', 'body', 'tag'].includes(c.field))) {
    const max = v.length >= 7 ? 2 : 1;
    for (const w of doc.words) if (lev(v, w, max) <= max) { score += 0.6; break; }
  }
  return score;
}

export function search(docs, query, { fuzzy = false } = {}) {
  const groups = parseQuery(query || '');
  const terms = groups.flat().filter(c => !c.neg && !['updated', 'created'].includes(c.field)).map(c => c.value);
  if (!groups.length) return { results: docs.map(d => ({ doc: d, score: 0 })), terms };
  const results = [];
  for (const doc of docs) {
    let total = 0, ok = true;
    for (const g of groups) {
      if (g.length === 1 && g[0].neg) { if (clauseScore(doc, { ...g[0], neg: false }, false) > 0) { ok = false; break; } continue; }
      const s = Math.max(...g.map(c => (c.neg ? 0 : clauseScore(doc, c, fuzzy))));
      if (s <= 0) { ok = false; break; }
      total += s;
    }
    if (ok) results.push({ doc, score: total });
  }
  results.sort((a, b) => b.score - a.score);
  return { results, terms };
}

export function similarTo(doc, docs, n = 5) {
  const A = doc.words;
  return docs.filter(d => d !== doc).map(d => {
    let inter = 0; for (const w of d.words) if (A.has(w)) inter++;
    return { doc: d, score: inter / (A.size + d.words.size - inter || 1) };
  }).filter(x => x.score > 0.08).sort((a, b) => b.score - a.score).slice(0, n);
}
