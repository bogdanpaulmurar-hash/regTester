// Links between records: errors, test cases, functions (user stories), specifications, documentation,
// timeline entries and known errors. Three kinds, shown together in the side panel:
//  - links set by hand, stored on the record as data.rel = [{ s: section, id, k: key }] (kept through imports)
//  - references found in the text: a key of another record (e.g. a function code in a test case)
//  - backlinks: other records that link to or mention this one
import { t } from './i18n.js';
import { btn, chip, clear, confirmBox, fmtDate, h, modal, normalize, plainText, toast } from './util.js';

export const LINKABLE = ['errors', 'tests', 'features', 'specs', 'docs', 'timeline', 'known'];
export const PAGE_OF_SECTION = { errors: 'triage', known: 'triage', runs: 'triage', tests: 'coverage', features: 'coverage', specs: 'specs', docs: 'docs', timeline: 'timeline' };

const TOKEN_RE = /[A-Za-z0-9][A-Za-z0-9._\-/]*[A-Za-z0-9]/g;
// a key is matched in text only when it is specific enough (short or purely numeric keys give false hits)
const usableKey = k => { const s = String(k || '').trim(); return s.length >= 4 && !/^\d{1,5}$/.test(s) && s.length <= 60; };
const norm = k => String(k || '').trim().toUpperCase();

/** All records the user may see in the linkable sections. */
export async function loadLinkable(ctx) {
  const lists = await Promise.all(LINKABLE.map(s => (ctx.canPage(PAGE_OF_SECTION[s]) ? ctx.records(s).catch(() => []) : Promise.resolve([]))
    .then(rs => rs.map(r => ({ ...r, section: r.section || s })))));
  return lists.flat();
}

/** Text of a record that may mention other records. */
export function recordText(r) {
  const d = r.data || {};
  const parts = [r.title, plainText(r.body), plainText(d.notes), d.feature, d.story, d.code, d.meta?.code, d.meta?.title, d.links, d.pattern];
  if (r.section === 'docs' && d.values) parts.push(...Object.values(d.values).map(v => plainText(Array.isArray(v) ? v.join(' ') : v)));
  return parts.filter(x => typeof x === 'string' && x).join(' \n ');
}

function keyIndex(all) {
  const idx = new Map();
  for (const r of all) {
    for (const k of [r.key, r.section === 'docs' ? r.data?.meta?.code || r.data?.story : null]) {
      if (!usableKey(k)) continue;
      const n = norm(k);
      if (!idx.has(n)) idx.set(n, []);
      idx.get(n).push(r);
    }
  }
  return idx;
}

/** Records whose key appears in the text of `r` (without `r` itself). */
export function mentionsIn(r, all, idx = keyIndex(all)) {
  const found = new Map();
  for (const tok of recordText(r).match(TOKEN_RE) || []) {
    for (const x of idx.get(norm(tok)) || []) if (x.id !== r.id) found.set(x.id, x);
  }
  return [...found.values()];
}

/** Everything linked with `r`: { manual: [{rel, rec|null}], found: [rec], back: [{rec, how}] }. */
export function linksOf(r, all) {
  const byId = new Map(all.map(x => [x.id, x]));
  const idx = keyIndex(all);
  const manual = (r.data?.rel || []).map(rel => ({ rel, rec: byId.get(rel.id) || all.find(x => x.section === rel.s && rel.k && x.key === rel.k) || null }));
  const manualIds = new Set(manual.map(m => m.rec?.id).filter(Boolean));
  const found = mentionsIn(r, all, idx).filter(x => !manualIds.has(x.id));
  const seen = new Set([...manualIds, ...found.map(x => x.id), r.id]);
  const back = [];
  const myKey = usableKey(r.key) ? norm(r.key) : null;
  for (const x of all) {
    if (seen.has(x.id)) continue;
    if ((x.data?.rel || []).some(l => l.id === r.id)) { back.push({ rec: x, how: 'link' }); seen.add(x.id); continue; }
    if (myKey && (recordText(x).match(TOKEN_RE) || []).some(tok => norm(tok) === myKey)) { back.push({ rec: x, how: 'mention' }); seen.add(x.id); }
  }
  return { manual, found, back };
}

export const statusOfRec = r => String(r.data?.own_status || r.data?.status || '');

/** Short label: "KEY · title". */
export const recLabel = r => [r.key || r.data?.meta?.code || r.data?.story, r.title].filter(Boolean).join(' · ');

function recChip(ctx, r, onOpen, extra) {
  return h('div', { class: 'lnk-item' },
    chip(t('sec_' + r.section), 'info'),
    h('button', { type: 'button', class: 'lnk-open', onclick: () => onOpen(r), title: t('lnk_preview') }, recLabel(r) || '—'),
    statusOfRec(r) ? chip(statusOfRec(r)) : null,
    extra || null);
}

/** Open a record in its own page (the page registers an opener in ctx.openers). */
export function openRecord(ctx, r) {
  if (!ctx.openRecord) { toast(t('lnk_cannot_open'), 'bad'); return; }
  ctx.openRecord(r);
}

/** Preview of one record, with its links and a button to open it in its page. */
export async function previewRecord(ctx, r, guard) {
  const all = await loadLinkable(ctx);
  const cur = all.find(x => x.id === r.id) || r;
  const d = cur.data || {};
  const text = plainText([cur.body, d.notes].filter(Boolean).join('\n')).trim();
  const L = linksOf(cur, all);
  const list = [...L.manual.map(m => m.rec).filter(Boolean), ...L.found, ...L.back.map(b => b.rec)];
  const close = modal({
    title: recLabel(cur) || t('sec_' + cur.section),
    wide: true,
    body: h('div', { class: 'stack' },
      h('div', { class: 'pill-row' }, chip(t('sec_' + cur.section), 'info'), statusOfRec(cur) ? chip(statusOfRec(cur)) : null,
        d.release ? chip(`${t('f_release')} ${d.release}`) : null, d.sprint ? chip(`${t('f_sprint')} ${d.sprint}`) : null,
        h('span', { class: 'small muted' }, t('meta_line', { v: cur.version, by: cur.updated_by || '-', at: fmtDate(new Date((cur.updated_at || 0) * 1000)) }))),
      text ? h('p', { class: 'small', style: { whiteSpace: 'pre-wrap', maxHeight: '220px', overflow: 'auto', margin: 0 } }, text.slice(0, 1200) + (text.length > 1200 ? ' …' : '')) : null,
      h('div', null, h('h3', null, `${t('lnk_title')} · ${list.length}`),
        list.length ? h('div', { class: 'lnk-list' }, list.map(x => recChip(ctx, x, y => { close(); previewRecord(ctx, y, guard); }))) : h('p', { class: 'small muted' }, t('lnk_none')))),
    footer: c => [btn(t('lnk_open_page', { page: ctx.pageLabel(PAGE_OF_SECTION[cur.section]) }), async () => {
      if (guard && !(await guard())) return;
      c(); openRecord(ctx, cur);
    }, { cls: 'primary', id: 'lnk-go' })],
  });
}

/** Picker: search every linkable record by key or title. */
function pickRecord(ctx, all, exclude, onPick) {
  const input = h('input', { type: 'search', placeholder: t('lnk_search'), 'aria-label': t('lnk_search'), id: 'lnk-q' });
  const secSel = h('select', { 'aria-label': t('lnk_section') }, h('option', { value: '' }, t('lnk_all_sections')),
    LINKABLE.filter(s => all.some(r => r.section === s)).map(s => h('option', { value: s }, t('sec_' + s))));
  const box = h('div', { class: 'lnk-list', style: { maxHeight: '50vh', overflow: 'auto' } });
  const paint = () => {
    const q = normalize(input.value.trim());
    const res = all.filter(r => !exclude.has(r.id) && (!secSel.value || r.section === secSel.value)
      && (!q || normalize(`${r.key} ${r.title} ${r.data?.meta?.code || ''} ${r.data?.story || ''}`).includes(q))).slice(0, 60);
    clear(box).append(...(res.length ? res.map(r => recChip(ctx, r, x => { close(); onPick(x); })) : [h('p', { class: 'small muted' }, t('no_match'))]));
  };
  input.addEventListener('input', paint); secSel.addEventListener('change', paint);
  const close = modal({ title: t('lnk_add'), wide: true, body: h('div', { class: 'stack' }, h('div', { class: 'toolbar', style: { margin: 0 } }, h('div', { class: 'grow' }, input), secSel), h('p', { class: 'hint', style: { margin: 0 } }, t('lnk_pick_hint')), box) });
  paint();
}

/**
 * Links card for the side panel. `rec` is the panel's working copy: links set here are written into rec.data.rel
 * and saved (with an entry in the history) when the panel is saved. onChange() is called after each change.
 */
export function linksBlock(ctx, rec, { canWrite, onChange, guard }) {
  const card = h('div', { class: 'card stack lnk-card', id: 'lnk-card' });
  let all = null;
  const paint = () => {
    clear(card);
    card.appendChild(h('div', { class: 'row-between' }, h('h3', { style: { margin: 0 } }, t('lnk_title')),
      canWrite && all ? btn(t('lnk_add'), () => pickRecord(ctx, all, new Set([rec.id, ...(rec.data?.rel || []).map(l => l.id)]), x => {
        rec.data = { ...(rec.data || {}), rel: [...(rec.data?.rel || []), { s: x.section, id: x.id, k: x.key || '' }] };
        paint(); onChange && onChange();
      }), { cls: 'sm', icon: 'plus', id: 'lnk-add' }) : null));
    if (!all) { card.appendChild(h('p', { class: 'small muted' }, t('loading'))); return; }
    const L = linksOf(rec, all);
    const open = x => previewRecord(ctx, x, guard);
    const group = (label, hint, items) => items.length ? h('div', { class: 'stack', style: { gap: '4px' } },
      h('div', { class: 'small muted' }, label, hint ? h('span', { title: hint }, ' ⓘ') : null), h('div', { class: 'lnk-list' }, items)) : null;
    const manual = L.manual.map(({ rel, rec: x }) => x
      ? recChip(ctx, x, open, canWrite ? btn('', () => { rec.data = { ...rec.data, rel: rec.data.rel.filter(l => l !== rel) }; paint(); onChange && onChange(); }, { cls: 'sm ghost icon-btn', icon: 'x', aria: t('lnk_remove'), title: t('lnk_remove') }) : null)
      : h('div', { class: 'lnk-item' }, chip(t('sec_' + rel.s)), h('span', { class: 'small muted' }, `${rel.k || rel.id} · ${t('lnk_missing')}`),
        canWrite ? btn('', () => { rec.data = { ...rec.data, rel: rec.data.rel.filter(l => l !== rel) }; paint(); onChange && onChange(); }, { cls: 'sm ghost icon-btn', icon: 'x', aria: t('lnk_remove') }) : null));
    const parts = [
      group(t('lnk_manual'), '', manual),
      group(t('lnk_found'), t('lnk_found_hint'), L.found.map(x => recChip(ctx, x, open))),
      group(t('lnk_back'), t('lnk_back_hint'), L.back.map(b => recChip(ctx, b.rec, open, h('span', { class: 'small muted' }, t(b.how === 'link' ? 'lnk_how_link' : 'lnk_how_mention'))))),
    ].filter(Boolean);
    if (!parts.length) card.appendChild(h('p', { class: 'small muted', style: { margin: 0 } }, t(canWrite ? 'lnk_none_add' : 'lnk_none')));
    card.append(...parts);
  };
  paint();
  loadLinkable(ctx).then(x => { all = x; paint(); }).catch(() => { all = []; paint(); });
  return card;
}

/** Ask before leaving a panel with unsaved changes. */
export const leaveGuard = dirty => async () => !dirty() || confirmBox(t('lnk_unsaved'), t('lnk_leave'));
