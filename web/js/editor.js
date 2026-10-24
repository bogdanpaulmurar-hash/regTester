// Side panel editor for one record, with its own history tab.
import { renderHistory } from './history-view.js';
import { t } from './i18n.js';
import { leaveGuard, LINKABLE, linksBlock } from './links.js';
import { richText, storeImages } from './richtext.js';
import { btn, clear, confirmBox, drawer, h, tabs, toast } from './util.js';

const getPath = (rec, key) => key.startsWith('data.') ? rec.data?.[key.slice(5)] : rec[key];

/**
 * opts: { ctx, section, title, record (null = new), fields: [{key, label, type, options, rows, hint, list}],
 *         defaults, onSaved(rec), readOnly, noDelete, beforeSave(out, original) -> adjust the record before it is saved,
 *         info(rec) -> element above the form (e.g. read-only fields that come from an import),
 *         extra(rec) -> element below the form,
 *         nav: { list: [records], open(rec) } -> ‹ › to go through the (filtered) list the panel came from,
 *         links: false -> no links card (shown for saved records of the sections in LINKABLE) }
 * Field type 'rich': text editor with formatting and screenshots, stored as HTML.
 */
export function openEditor(opts) {
  const { ctx } = opts;
  const rec = opts.record ? structuredClone(opts.record) : { kind: '', key: '', title: '', body: '', data: {}, tags: [], ...(opts.defaults || {}) };
  const canWrite = !opts.readOnly && ctx.canWriteSection(opts.section);
  const inputs = {};
  let tab = 'edit';
  const body = h('div', { class: 'stack' });

  const form = h('form', { class: 'stack', onsubmit: e => { e.preventDefault(); save(); } },
    opts.fields.map(f => {
      const id = 'ed-' + f.key.replace('.', '-');
      let v = getPath(rec, f.key);
      if (f.type === 'tags') v = (v || []).join(', ');
      if (f.type === 'rich') {
        const rt = richText({ html: v || '', readOnly: !canWrite, id, label: f.label, list: f.list, compact: true });
        // an untouched field keeps its stored value (older plain text is not rewritten as HTML)
        const initial = rt.getValue();
        inputs[f.key] = { get value() { const cur = rt.getValue(); return cur === initial ? (v ?? '') : cur; } };
        return h('div', { class: 'field' }, h('span', null, f.label), rt, f.hint ? h('span', { class: 'hint' }, f.hint) : null);
      }
      let input;
      if (f.type === 'textarea') input = h('textarea', { id, rows: f.rows || 6, value: v ?? '', disabled: !canWrite });
      else if (f.type === 'select') input = h('select', { id, disabled: !canWrite }, f.options.map(([val, label]) => h('option', { value: val, selected: String(v ?? '') === String(val) }, label)));
      else input = h('input', { id, type: f.type === 'date' ? 'date' : (f.type === 'color' ? 'color' : 'text'), value: v ?? '', disabled: !canWrite, list: f.datalist ? id + '-l' : null });
      inputs[f.key] = input;
      return h('label', { class: 'field', for: id }, f.label, input,
        f.datalist ? h('datalist', { id: id + '-l' }, f.datalist.map(x => h('option', { value: x }))) : null,
        f.hint ? h('span', { class: 'hint' }, f.hint) : null);
    }));

  function collect() {
    const out = { ...rec, data: { ...(rec.data || {}) } };
    for (const f of opts.fields) {
      let v = inputs[f.key].value;
      if (f.type === 'tags') v = v.split(',').map(s => s.trim()).filter(Boolean);
      if (f.key.startsWith('data.')) out.data[f.key.slice(5)] = v; else out[f.key] = v;
    }
    return out;
  }
  const snap = r => JSON.stringify([r.kind, r.key, r.title, r.body, r.data, r.tags]);
  const initialState = snap(collect());
  const dirty = () => canWrite && snap(collect()) !== initialState;

  async function save(after) {
    const out = collect();
    if (opts.beforeSave) opts.beforeSave(out, opts.record);
    if (!String(out.title || '').trim()) { toast(t('err_title_required'), 'bad'); return false; }
    try {
      for (const f of opts.fields) {
        if (f.type !== 'rich') continue;
        if (f.key.startsWith('data.')) { const k = f.key.slice(5); out.data[k] = await storeImages(out.data[k]); }
        else out[f.key] = await storeImages(out[f.key]);
      }
      const payload = { kind: out.kind, key: out.key, title: out.title, body: out.body, data: out.data, tags: out.tags };
      const saved = opts.record ? await ctx.api.update(rec.id, payload, rec.version) : await ctx.api.create(opts.section, payload);
      toast(t('saved'));
      close();
      opts.onSaved && opts.onSaved(saved);
      if (after) after(saved);
      return true;
    } catch (e) {
      toast(e.status === 409 || e.message === 'conflict' ? t('err_conflict') : e.message, 'bad');
      return false;
    }
  }

  async function del() {
    if (!(await confirmBox(t('confirm_delete', { name: rec.title }), t('delete')))) return;
    try { await ctx.api.remove(rec.id); toast(t('deleted')); close(); opts.onSaved && opts.onSaved(null); }
    catch (e) { toast(e.message, 'bad'); }
  }

  // ‹ › through the list the panel was opened from; unsaved changes are saved first (or the move is cancelled)
  const list = opts.nav?.list || [];
  const pos = opts.record ? list.findIndex(x => x.id === rec.id) : -1;
  async function go(d) {
    const next = list[pos + d];
    if (!next) return;
    if (dirty()) {
      if (!(await confirmBox(t('ed_unsaved'), t('save'), false))) return;
      await save(() => opts.nav.open(next));
      return;
    }
    close();
    opts.nav.open(next);
  }
  const navBar = pos >= 0 && list.length > 1 ? h('div', { class: 'ed-nav', role: 'group', 'aria-label': t('ed_nav') },
    btn('‹', () => go(-1), { cls: 'sm', aria: t('ed_prev'), title: t('ed_prev'), disabled: pos <= 0, id: 'ed-prev' }),
    h('span', { class: 'small muted nowrap' }, t('ed_pos', { i: pos + 1, n: list.length })),
    btn('›', () => go(1), { cls: 'sm', aria: t('ed_next'), title: t('ed_next'), disabled: pos >= list.length - 1, id: 'ed-next' })) : null;

  let linksCard = null;
  const paint = () => {
    clear(body);
    if (navBar) body.appendChild(navBar);
    if (opts.record) body.appendChild(tabs([['edit', t('tab_details')], ['history', t('tab_history')]], tab, v => { tab = v; paint(); }));
    if (tab === 'edit') {
      const info = opts.info && opts.info(rec);
      if (info) body.appendChild(info);
      body.appendChild(form);
      const extra = opts.extra && opts.extra(rec);
      if (extra) body.appendChild(extra);
      if (opts.record && opts.links !== false && LINKABLE.includes(opts.section)) {
        if (!linksCard) linksCard = linksBlock(ctx, rec, { canWrite, guard: leaveGuard(dirty) });
        body.appendChild(linksCard);
      }
      if (opts.record) body.appendChild(h('div', { class: 'hint' }, t('meta_line', { v: rec.version, by: rec.updated_by || '-', at: new Date((rec.updated_at || 0) * 1000).toLocaleString(t.locale()) })));
    } else {
      const histBox = h('div');
      body.appendChild(histBox);
      renderHistory(histBox, ctx, { record_id: rec.id, compact: true, onRestored: () => { close(); opts.onSaved && opts.onSaved(); } });
    }
  };
  paint();

  const close = drawer({
    title: opts.title || (opts.record ? rec.title : t('new_item')),
    body,
    footer: canWrite ? [
      btn(t('save'), () => save(), { cls: 'primary', id: 'ed-save' }),
      opts.record && !opts.noDelete ? btn(t('delete'), del, { cls: 'danger', icon: 'trash' }) : null,
    ] : null,
  });
  return close;
}
