// Links new functions (release notes) to test cases, specifications, procedures and PO sessions.
import { normalize, plainText, similarity } from './util.js';

export const ALL_COVER_COLS = ['regspec', 'test', 'spec', 'procedure', 'session'];
export const COVER_COLS = ALL_COVER_COLS;
/** Columns shown: the PO-session column only while the PO page is visible. */
export const coverCols = ctx => ALL_COVER_COLS.filter(c => c !== 'session' || !ctx?.isHidden?.('transcripts'));

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

/** Release-note functions plus one row per RegTest document whose user story is not in the release notes. */
export function coverageRows(features, specs) {
  const keys = new Set(features.map(f => String(f.key || '').toUpperCase()).filter(Boolean));
  const extra = [];
  for (const d of specs.filter(s => s.kind === 'regspec')) {
    const ids = d.data?.idents || [];
    if (ids.some(i => keys.has(i.toUpperCase()))) continue;
    const key = ids[0] || d.key;
    keys.add(String(key).toUpperCase());
    extra.push({ id: 'doc:' + d.id, key, title: d.title, virtual: true, doc: d, body: ids.join(' '),
      data: { release: d.data?.release || '', sprint: d.data?.sprint || '', module: '', idents: ids } });
  }
  return [...features, ...extra];
}

export function buildCoverage({ features, tests, specs, transcripts = [], errors = [], settings, cols = ALL_COVER_COLS }) {
  const thr = Number(settings.match_threshold) || 0.5;
  const specOnly = specs.filter(s => s.kind === 'spec');
  const procs = specs.filter(s => s.kind === 'procedure');
  const regspecs = specs.filter(s => s.kind === 'regspec');
  const openErrors = errors.filter(e => /^(new|assigned|processing|open)$/i.test(String(e.data?.status || '').trim()));
  const sessTexts = transcripts.map(tr => ({ ...tr, _text: `${tr.title}\n${tr.data?.cleaned || tr.data?.raw || ''}\n${tr.data?.summary || ''}` }));
  return coverageRows(features, specs).map(f => {
    const ov = f.data?.overrides || {};
    const idsOf = f.data?.idents?.length ? f.data.idents : [f.key].filter(Boolean);
    const m = {
      regspec: f.virtual ? [{ item: f.doc, how: 'code', score: 1 }] : findMatches(f, regspecs, x => `${x.key} ${x.title} ${(x.data?.idents || []).join(' ')}`, thr),
      test: findMatches(f, tests, x => `${x.key} ${x.title} ${plainText(x.body)} ${plainText(x.data?.notes)} ${x.data?.feature || ''} ${x.data?.main || ''} ${x.data?.sub || ''}`, Math.max(thr, 0.55)),
      spec: findMatches(f, specOnly, x => `${x.key} ${x.title} ${plainText(x.body)}`, thr),
      procedure: findMatches(f, procs, x => `${x.key} ${x.title} ${plainText(x.body)}`, thr),
      session: findMatches(f, sessTexts, x => x._text, Math.max(thr, 0.6)),
    };
    const status = {};
    for (const c of ALL_COVER_COLS) {
      status[c] = ov[c] === 'na' ? 'na' : ov[c] === 'ok' ? 'ok' : m[c].length ? (m[c][0].how === 'code' || m[c][0].score >= 0.75 ? 'ok' : 'weak') : 'gap';
    }
    if (status.regspec === 'ok' && m.regspec[0] && !/approved|freigegeben|done|aprobat/i.test(m.regspec[0].item.data?.status || '') && !ov.regspec) status.regspec = 'weak';
    const errs = openErrors.filter(e => idsOf.some(id => hasKey(`${e.title} ${plainText(e.body)} ${plainText(e.data?.notes)}`, id)));
    const gaps = cols.filter(c => status[c] === 'gap').length;
    return { feature: f, m, status, gaps, errors: errs };
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
