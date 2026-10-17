// Side panel editor for one record, with its own history tab.
import { renderHistory } from './history-view.js';
import { t } from './i18n.js';
import { btn, clear, confirmBox, drawer, h, tabs, toast } from './util.js';

const getPath = (rec, key) => key.startsWith('data.') ? rec.data?.[key.slice(5)] : rec[key];

/**
 * opts: { ctx, section, title, record (null = new), fields: [{key, label, type, options, rows, hint}],
 *         defaults, onSaved(rec), readOnly }
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

  async function save() {
    const out = collect();
    if (!String(out.title || '').trim()) { toast(t('err_title_required'), 'bad'); return; }
    try {
      const payload = { kind: out.kind, key: out.key, title: out.title, body: out.body, data: out.data, tags: out.tags };
      const saved = opts.record ? await ctx.api.update(rec.id, payload, rec.version) : await ctx.api.create(opts.section, payload);
      toast(t('saved'));
      close();
      opts.onSaved && opts.onSaved(saved);
    } catch (e) {
      toast(e.status === 409 || e.message === 'conflict' ? t('err_conflict') : e.message, 'bad');
    }
  }

  async function del() {
    if (!(await confirmBox(t('confirm_delete', { name: rec.title }), t('delete')))) return;
    try { await ctx.api.remove(rec.id); toast(t('deleted')); close(); opts.onSaved && opts.onSaved(null); }
    catch (e) { toast(e.message, 'bad'); }
  }

  const histBox = h('div');
  const paint = () => {
    clear(body);
    if (opts.record) body.appendChild(tabs([['edit', t('tab_details')], ['history', t('tab_history')]], tab, v => { tab = v; paint(); }));
    if (tab === 'edit') {
      body.appendChild(form);
      const extra = opts.extra && opts.extra(rec);
      if (extra) body.appendChild(extra);
      if (opts.record) body.appendChild(h('div', { class: 'hint' }, t('meta_line', { v: rec.version, by: rec.updated_by || '-', at: new Date((rec.updated_at || 0) * 1000).toLocaleString(t.locale()) })));
    } else {
      body.appendChild(histBox);
      renderHistory(histBox, ctx, { record_id: rec.id, compact: true, onRestored: () => { close(); opts.onSaved && opts.onSaved(); } });
    }
  };
  paint();

  const close = drawer({
    title: opts.title || (opts.record ? rec.title : t('new_item')),
    body,
    footer: canWrite ? [
      btn(t('save'), save, { cls: 'primary' }),
      opts.record ? btn(t('delete'), del, { cls: 'danger', icon: 'trash' }) : null,
    ] : null,
  });
  return close;
}
