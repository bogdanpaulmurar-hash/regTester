// Exports of the regtest tool: test case catalogue (list and tree) and RegTest specification documents.
import { normalize } from './util.js';

const cell = v => String(v ?? '').trim();
const isTestId = v => /^[A-Za-z][A-Za-z0-9]*-[A-Z]{1,4}-\d{2,7}$/.test(cell(v));
const QUALITY = /^(high|hight|medium|low|hoch|mittel|niedrig)$/i;
const APP = /client|app\b|application|cockpit|mobile|web|erp|sap/i;
const share = (vals, test) => { const f = vals.filter(v => cell(v) !== ''); return f.length ? f.filter(test).length / f.length : 0; };

/**
 * Test case list export -> records. The header of this export is shifted by one column (the application
 * column has no header, "Quality Comment" is extra), so columns are recognised by their content.
 * rows: array of arrays (whole sheet). Returns { records, columns, warnings }.
 */
export function catalogFromList(rows) {
  const width = Math.max(0, ...rows.map(r => r.length));
  const idIdx = [...Array(width).keys()].find(i => share(rows.slice(0, 400).map(r => r[i]), isTestId) > 0.3) ?? -1;
  if (idIdx < 0) return { records: [], columns: {}, warnings: ['no-id'] };
  const data = rows.filter(r => isTestId(r[idIdx]));
  const col = i => data.map(r => r[i]);
  const idx = { id: idIdx, title: idIdx + 1 };
  const rest = [...Array(width).keys()].filter(i => i > idx.title);
  idx.quality = rest.find(i => share(col(i), v => QUALITY.test(cell(v))) > 0.6) ?? -1;
  idx.app = rest.find(i => i !== idx.quality && share(col(i), v => APP.test(cell(v))) > 0.6) ?? -1;
  idx.count = rest.find(i => i !== idx.quality && i !== idx.app && share(col(i), v => /^\d+$/.test(cell(v))) > 0.8) ?? -1;
  const after = Math.max(idx.quality, idx.app, idx.count);
  const cats = rest.filter(i => i > after).slice(0, 3);
  [idx.main, idx.sub, idx.secondary] = [cats[0] ?? -1, cats[1] ?? -1, cats[2] ?? -1];
  const g = (r, i) => (i >= 0 ? cell(r[i]) : '');
  const records = data.map(r => ({
    key: cell(r[idx.id]), title: g(r, idx.title) || cell(r[idx.id]), kind: 'testcase', body: '',
    data: { app: g(r, idx.app), quality: g(r, idx.quality).replace(/^hight$/i, 'High'), count: Number(g(r, idx.count)) || 0,
      main: g(r, idx.main), sub: g(r, idx.sub), secondary: g(r, idx.secondary), source: 'list' },
  }));
  const warnings = [];
  const noCat = records.filter(r => !r.data.main).length;
  if (noCat) warnings.push('uncategorised:' + noCat);
  return { records, columns: idx, warnings };
}

/**
 * Tree export -> [{main, sub, secondary, title}]. Each row has one filled cell; its column is the level
 * (0 main category, 1 sub category, 2 secondary category, 3 test case title).
 */
export function catalogFromTree(rows) {
  const out = [];
  const path = ['', '', ''];
  for (const r of rows) {
    const i = r.findIndex(c => cell(c) !== '');
    if (i < 0) continue;
    if (r.filter(c => cell(c) !== '').length > 1) continue; // a title or header line
    const v = cell(r[i]);
    if (i < 3) { path[i] = v; for (let j = i + 1; j < 3; j++) path[j] = ''; } else out.push({ main: path[0], sub: path[1], secondary: path[2], title: v });
  }
  return out;
}

/** Does a sheet look like the tree export (one value per row, at different depths)? */
export function looksLikeTree(rows) {
  const filled = rows.filter(r => r.some(c => cell(c) !== ''));
  if (filled.length < 4) return false;
  const single = filled.filter(r => r.filter(c => cell(c) !== '').length === 1).length;
  const deep = filled.filter(r => r.findIndex(c => cell(c) !== '') >= 2).length;
  return single / filled.length > 0.9 && deep > 0;
}

/** Merge tree categories into existing / list records by title. */
export function mergeTree(existing, tree) {
  const byTitle = new Map(existing.map(r => [normalize(r.title), r]));
  const out = [];
  let matched = 0;
  for (const tnode of tree) {
    const r = byTitle.get(normalize(tnode.title));
    if (r) {
      matched++;
      out.push({ key: r.key, title: r.title, kind: 'testcase', data: { ...r.data, main: tnode.main, sub: tnode.sub, secondary: tnode.secondary } });
    } else {
      out.push({ key: 'TREE:' + tnode.title, title: tnode.title, kind: 'testcase', data: { main: tnode.main, sub: tnode.sub, secondary: tnode.secondary, source: 'tree' } });
    }
  }
  return { records: out, matched, added: out.length - matched };
}

export const DM_FIELDS = [
  { key: 'title', required: true, aliases: ['title', 'titel', 'titlu'] },
  { key: 'id', required: true, aliases: ['id', 'doc id', 'document id'] },
  { key: 'milestone', aliases: ['milestone', 'meilenstein'] },
  { key: 'idents', aliases: ['idents', 'ident', 'user stories', 'stories'] },
  { key: 'status', aliases: ['status', 'state'] },
  { key: 'created', aliases: ['created', 'erstellt', 'creat'] },
  { key: 'related', aliases: ['related items', 'related', 'verknupft'] },
  { key: 'checkedout', aliases: ['checkedout', 'checked out', 'ausgecheckt'] },
  { key: 'hint', aliases: ['hint', 'hinweis', 'note'] },
];

/** "V4.16 Sprint 3" -> { release: 'V4.16', sprint: 'S3' } */
export function parseMilestone(v) {
  const s = cell(v);
  const rel = /\bV\d+\.\d+\b/i.exec(s)?.[0]?.toUpperCase() || '';
  const sp = /\b(?:Sprint\s*|S)(\d+)\b/i.exec(s);
  return { release: rel, sprint: sp ? 'S' + sp[1] : '' };
}

const dmy = v => { const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(cell(v)); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : cell(v).slice(0, 10); };

/** Document Management row -> specification record (kind regspec). */
export function regspecRecord(m) {
  const id = cell(m.id), title = cell(m.title);
  if (!id || !title) return null;
  const idents = cell(m.idents).split(/[;,\s]+/).filter(x => /^[A-Z]{1,5}-\d+/i.test(x));
  const ms = parseMilestone(m.milestone);
  return {
    key: 'DOC-' + id, kind: 'regspec', title, body: [cell(m.milestone), idents.join(', '), cell(m.hint)].filter(Boolean).join('\n'),
    tags: idents,
    data: { doc_id: id, milestone: cell(m.milestone), release: ms.release, sprint: ms.sprint, idents, status: cell(m.status),
      created: dmy(m.created), related: Number(cell(m.related)) || 0, checked_out: cell(m.checkedout), hint: cell(m.hint), source: 'document-management' },
  };
}
