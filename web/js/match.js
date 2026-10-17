// Links new functions (release notes) to test cases, specifications, procedures and PO sessions.
import { normalize, similarity } from './util.js';

export const COVER_COLS = ['session', 'test', 'spec', 'procedure'];

export function codeRegex(settings) {
  try { return new RegExp(settings.feature_code_regex || '\\b[A-Z]{2,5}-\\d{2,6}\\b', 'g'); }
  catch { return /\b[A-Z]{2,5}-\d{2,6}\b/g; }
}

function hasKey(text, key) {
  if (!key) return false;
  const re = new RegExp('(^|[^A-Za-z0-9])' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^A-Za-z0-9])', 'i');
  return re.test(text);
}

/** Returns [{item, how:'code'|'title', score}] best first. */
export function findMatches(feature, items, textOf, threshold) {
  const out = [];
  for (const it of items) {
    const text = textOf(it);
    if (hasKey(text, feature.key)) { out.push({ item: it, how: 'code', score: 1 }); continue; }
    const s = Math.max(similarity(feature.title, it.title || ''), similarity(feature.title, text.slice(0, 400)) * 0.9);
    if (s >= threshold) out.push({ item: it, how: 'title', score: s });
  }
  return out.sort((a, b) => b.score - a.score);
}

export function buildCoverage({ features, tests, specs, transcripts, settings }) {
  const thr = Number(settings.match_threshold) || 0.5;
  const specOnly = specs.filter(s => s.kind === 'spec');
  const procs = specs.filter(s => s.kind === 'procedure');
  const sessTexts = transcripts.map(tr => ({ ...tr, _text: `${tr.title}\n${tr.data?.cleaned || tr.data?.raw || ''}\n${tr.data?.summary || ''}` }));
  return features.map(f => {
    const ov = f.data?.overrides || {};
    const m = {
      test: findMatches(f, tests, x => `${x.key} ${x.title} ${x.body} ${x.data?.feature || ''}`, thr),
      spec: findMatches(f, specOnly, x => `${x.key} ${x.title} ${x.body}`, thr),
      procedure: findMatches(f, procs, x => `${x.key} ${x.title} ${x.body}`, thr),
      session: findMatches(f, sessTexts, x => x._text, Math.max(thr, 0.6)),
    };
    const status = {};
    for (const c of COVER_COLS) status[c] = ov[c] === 'na' ? 'na' : ov[c] === 'ok' ? 'ok' : m[c].length ? (m[c][0].how === 'code' || m[c][0].score >= 0.75 ? 'ok' : 'weak') : 'gap';
    const gaps = COVER_COLS.filter(c => status[c] === 'gap').length;
    return { feature: f, m, status, gaps };
  });
}

export function featuresFromDoc(doc, settings) {
  const re = codeRegex(settings);
  const reTest = new RegExp(re.source);
  const out = [];
  let cur = null;
  const push = () => { if (cur && cur.title) out.push(cur); };
  for (const b of doc.blocks || [{ type: 'p', text: doc.text || '' }]) {
    if (b.type === 'table') {
      const [head, ...rows] = b.rows;
      const ti = head.findIndex(x => /title|titel|name|function|funktion|func|feature/i.test(normalize(x)));
      for (const r of rows) {
        const text = r.join(' ');
        const key = (text.match(re) || [''])[0];
        const title = (ti >= 0 ? r[ti] : r.find(c => c && !reTest.test(c)) || r[0] || '').trim();
        if (title) out.push({ key, title, body: text, data: {} });
      }
      continue;
    }
    const lines = b.type === 'h' ? [b.text] : String(b.text).split('\n');
    for (const line of lines) {
      const code = line.match(re)?.[0] || '';
      if (b.type === 'h' || (code && line.trim().length < 160)) {
        push();
        cur = { key: code, title: line.replace(code, '').replace(/^[\s:–\-]+|[\s:–\-]+$/g, '').trim() || line.trim(), body: '', data: {} };
      } else if (cur) cur.body += (cur.body ? '\n' : '') + line;
    }
  }
  push();
  // when the document uses function codes, headings without a code are chapter titles, not functions
  return out.some(f => f.key) ? out.filter(f => f.key) : out;
}
