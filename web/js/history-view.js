// Change history: who changed what and when, with field-by-field comparison and restore.
import { t } from './i18n.js';
import { attRefs, btn, chip, clear, directed, emptyState, fmtDateTime, h, isHtml, listOrder, orderToggle, plainText, toast } from './util.js';

const ACTION_KIND = { create: 'ok', update: 'info', 'import-update': 'info', delete: 'bad', restore: 'warn', import: '' };

const thumbs = ids => ids.length ? h('div', { class: 'hist-thumbs' }, ids.map(id => h('img', { src: '/api/att/' + id, alt: '', loading: 'lazy' }))) : null;

function show(v, other, side) {
  if (v === undefined || v === null) return '';
  if (isHtml(v) || isHtml(other)) {
    // formatted text: shown as text, with the images it contains; images added or removed are marked
    const mine = attRefs(v), theirs = new Set(attRefs(other));
    const changed = mine.filter(id => !theirs.has(id));
    return h('div', null, h('div', { class: 'pre-wrap' }, plainText(v).slice(0, 1500)),
      changed.length ? h('div', { class: 'small muted' }, t(side === 'b' ? 'hist_img_removed' : 'hist_img_added', { n: changed.length })) : null, thumbs(changed));
  }
  if (typeof v === 'object') return JSON.stringify(v, null, 1).slice(0, 1500);
  return String(v).slice(0, 1500);
}

export function diffView(before, after) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  const rows = [];
  for (const k of keys) {
    if (k === 'id') continue;
    const b = before?.[k], a = after?.[k];
    if (k === 'data' && b && a && typeof b === 'object') {
      for (const dk of new Set([...Object.keys(b), ...Object.keys(a)])) {
        if (JSON.stringify(b[dk]) !== JSON.stringify(a[dk])) rows.push(['data.' + dk, b[dk], a[dk]]);
      }
    } else if (JSON.stringify(b) !== JSON.stringify(a)) rows.push([k, b, a]);
  }
  if (!rows.length) return h('div', { class: 'hint' }, t('hist_no_fields'));
  return h('div', { class: 'diff' },
    h('div', { class: 'k' }), h('div', { class: 'k' }, t('hist_before')), h('div', { class: 'k' }, t('hist_after')),
    rows.map(([k, b, a]) => [h('div', { class: 'k' }, k), h('div', { class: 'b' }, show(b, a, 'b')), h('div', { class: 'a' }, show(a, b, 'a'))]));
}

/** opts: { sections?: string[], record_id?, limit?, compact?, onRestored? } */
export async function renderHistory(container, ctx, opts = {}) {
  clear(container);
  const text = h('input', { type: 'search', placeholder: t('hist_filter'), 'aria-label': t('hist_filter') });
  const list = h('div', { class: 'list' });
  let paint = () => {}; // the order switch can be clicked while the entries are still loading
  container.appendChild(h('div', { class: 'stack' },
    opts.compact ? null : h('div', { class: 'toolbar' }, h('div', { class: 'grow' }, text), orderToggle('history', () => paint())), list));
  let entries = [];
  try {
    if (opts.record_id) entries = await ctx.api.history({ record_id: opts.record_id, limit: opts.limit || 200 });
    else if (opts.sections) {
      const parts = await Promise.all(opts.sections.map(s => ctx.api.history({ section: s, limit: opts.limit || 300 })));
      entries = parts.flat().sort((a, b) => b.ts - a.ts);
    } else entries = await ctx.api.history({ limit: opts.limit || 500 });
  } catch (e) { list.appendChild(h('div', { class: 'chip bad' }, e.message)); return; }

  paint = () => {
    clear(list);
    const q = text.value.trim().toLowerCase();
    // The server sends the latest entries; "oldest first" reverses that window.
    const shown = entries.slice().sort(directed((a, b) => a.ts - b.ts || a.id - b.id, opts.compact ? 'desc' : listOrder('history'))).filter(e => !q || `${e.user} ${e.section} ${e.action} ${e.summary} ${e.after?.title || e.before?.title || ''}`.toLowerCase().includes(q));
    if (!shown.length) { list.appendChild(emptyState(t('hist_empty'))); return; }
    for (const e of shown.slice(0, 400)) {
      const title = e.after?.title || e.before?.title || e.record_id;
      const details = h('div', { hidden: true, class: 'stack', style: { paddingTop: '8px' } });
      let open = false;
      const canRestore = ctx.canWriteSection(e.section) && !['import', 'restore'].includes(e.action) && (e.after || e.before) && !['settings', 'admin'].includes(e.section);
      const row = h('div', { class: 'li', style: { flexWrap: 'wrap' } },
        chip(t('act_' + e.action.replace('-', '_')), ACTION_KIND[e.action]),
        h('div', { class: 'grow' },
          h('div', null, h('b', null, title), e.summary && e.summary !== title ? h('span', { class: 'muted' }, ' · ', e.summary) : null),
          h('div', { class: 'small muted' }, `${fmtDateTime(e.ts)} · ${e.user} · ${t('sec_' + e.section)}`)),
        (e.before || e.after) ? btn(t('hist_details'), () => {
          open = !open; details.hidden = !open;
          if (open && !details.firstChild) {
            details.appendChild(diffView(e.before, e.after));
            if (canRestore) details.appendChild(h('div', null, btn(t('hist_restore'), async () => {
              try { await ctx.api.restore(e.id); toast(t('hist_restored')); opts.onRestored ? opts.onRestored() : renderHistory(container, ctx, opts); }
              catch (err) { toast(err.message, 'bad'); }
            }, { cls: 'sm', icon: 'history' })));
          }
        }, { cls: 'sm ghost' }) : null);
      list.appendChild(h('div', null, row, details));
    }
  };
  text.addEventListener('input', paint);
  paint();
}

export async function renderImports(container, ctx, sections) {
  clear(container);
  const all = (await Promise.all(sections.map(s => ctx.api.imports(s).catch(() => [])))).flat();
  if (!all.length) { container.appendChild(emptyState(t('imports_empty'))); return; }
  const box = h('div');
  container.append(h('div', { class: 'toolbar' }, orderToggle('imports', () => paint())), box);
  const paint = () => clear(box).appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 't' },
    h('thead', null, h('tr', null, [t('f_date'), t('f_file'), t('f_section'), t('import_mode'), t('f_rows'), t('f_user')].map(x => h('th', null, x)))),
    h('tbody', null, all.slice().sort(directed((a, b) => a.ts - b.ts, listOrder('imports'))).map(i => h('tr', null,
      h('td', { class: 'nowrap' }, fmtDateTime(i.ts)), h('td', null, i.filename), h('td', null, t('sec_' + i.section)),
      h('td', null, t('mode_' + i.mode)), h('td', { class: 'num' }, i.count), h('td', null, i.user)))))));
  paint();
}

/** Standard "History" tab body for a section page: imports + change log. */
export function historyTab(container, ctx, sections, onRestored) {
  const imp = h('div'); const hist = h('div');
  container.appendChild(h('div', { class: 'stack' },
    h('div', { class: 'card' }, h('h2', null, t('imports_title')), imp),
    h('div', { class: 'card' }, h('h2', null, t('hist_title')), hist)));
  renderImports(imp, ctx, sections);
  renderHistory(hist, ctx, { sections, onRestored });
}
