// Documentation generator: fixed templates give every document the same order and style.
import { DEFAULT_TEMPLATE } from '../demo.js';
import { historyTab } from '../history-view.js';
import { t } from '../i18n.js';
import { pickFile } from '../importer.js';
import { btn, chip, clear, confirmBox, copyText, download, emptyState, esc, fmtDateTime, h, normalize, similarity, store, tabs, toast } from '../util.js';

function localizedDefault() {
  const d = structuredClone(DEFAULT_TEMPLATE);
  d.title = t('tpl_name');
  d.data.sections = d.data.sections.map(s => ({ ...s, label: t('tpl_' + s.id), hint: t('tpl_' + s.id + '_hint') }));
  return d;
}

const HINTS = {
  purpose: /what it does|purpose|scop|zweck|ce face|beschreibung/i,
  users: /who|role|rol|benutzer|users|utilizator/i,
  pre: /precond|vorbed|precondi/i,
  steps: /steps|pasi|pași|schritte|tested|testat|getestet/i,
  expected: /expected|erwart|rezultat|result/i,
  risk: /risk|risiko|open question|intrebari|fragen/i,
};

export async function render(root, ctx) {
  const st = Object.assign({ tab: 'write' }, store('docs') || {});
  const save = () => store('docs', st);
  const canWrite = ctx.canWriteSection('docs');
  let templates = [], docs = [];
  let work = null;

  root.appendChild(h('div', { class: 'page-head' }, h('div', null, h('h1', null, t('nav_docs')), h('p', null, t('docs_intro')))));
  const tabBox = h('div'), body = h('div', { class: 'stack' });
  root.append(tabBox, body);

  async function load(force) {
    templates = await ctx.records('templates', force);
    if (!templates.length && ctx.canWriteSection('templates')) {
      await ctx.api.create('templates', localizedDefault());
      templates = await ctx.records('templates', true);
    }
    docs = await ctx.records('docs', force);
    if (!work) newWork();
    if (ctx.api.demo && !work.id && !work.meta.title && docs[0]) openDoc(docs[0]);
    const pre = store('docs.prefill');
    if (pre) { store('docs.prefill', null); newWork(); work.meta.title = pre.title || ''; work.source = pre.summary || pre.cleaned || ''; autofill(work.source); st.tab = 'write'; }
    paint();
  }

  function tpl() { return templates.find(x => x.id === work?.templateId) || templates[0]; }
  function newWork(templateId) {
    work = { id: null, version: null, templateId: templateId || templates[0]?.id, meta: { title: '', code: '', sprint: '', release: '', module: '' }, values: {}, source: '' };
  }

  function paint() {
    clear(tabBox).appendChild(tabs([['write', t('docs_t_write')], ['list', `${t('docs_t_list')} · ${docs.length}`], ['templates', t('docs_t_templates')], ['history', t('tab_history')]],
      st.tab, v => { st.tab = v; save(); paint(); }));
    clear(body);
    if (st.tab === 'history') historyTab(body, ctx, ['docs', 'templates'], () => load(true));
    else if (st.tab === 'list') docList();
    else if (st.tab === 'templates') templateList();
    else writeView();
  }

  function missing() { return (tpl()?.data?.sections || []).filter(s => s.required && !String(work.values[s.id] || '').trim()); }

  // ------------------------------------------------------------ write
  function writeView() {
    const T = tpl();
    if (!T) { body.appendChild(emptyState(t('docs_no_template'))); return; }
    const preview = h('div', { class: 'doc-preview' });
    const issues = h('div');
    const metaInput = (k, label) => {
      const i = h('input', { type: 'text', id: 'doc-' + k, value: work.meta[k] || '' });
      i.addEventListener('input', () => { work.meta[k] = i.value; update(); });
      return h('label', { class: 'field', for: 'doc-' + k }, label, i);
    };
    const secInputs = T.data.sections.map(s => {
      const id = 'doc-s-' + s.id;
      const el = s.type === 'text' ? h('input', { type: 'text', id, value: work.values[s.id] || '' }) : h('textarea', { id, rows: s.type === 'list' ? 5 : 3, value: work.values[s.id] || '' });
      el.addEventListener('input', () => { work.values[s.id] = el.value; update(); });
      return h('label', { class: 'field', for: id }, s.label + (s.required ? ' *' : ''), el, s.hint ? h('span', { class: 'hint' }, s.hint) : null);
    });
    const form = h('form', { class: 'card stack', onsubmit: e => e.preventDefault() },
      h('div', { class: 'toolbar' },
        h('label', { class: 'field' }, t('docs_template'), h('select', { onchange: e => { work.templateId = e.target.value; paint(); } },
          templates.map(x => h('option', { value: x.id, selected: x.id === T.id }, x.title)))),
        h('span', { class: 'sp' }),
        btn(t('docs_import_docx'), importDocx, { icon: 'upload', cls: 'sm' }),
        btn(t('docs_new'), () => { newWork(T.id); paint(); }, { cls: 'sm ghost' })),
      work.id ? chip(t('trs_editing', { name: work.meta.title }), 'info') : null,
      h('div', { class: 'grid-form' }, metaInput('title', t('docs_function')), metaInput('code', t('f_code')), metaInput('sprint', t('f_sprint')),
        metaInput('release', t('f_release')), metaInput('module', t('f_module'))),
      secInputs);
    const side = h('div', { class: 'stack' },
      work.source ? h('details', { class: 'card' }, h('summary', null, t('docs_source')),
        h('div', { class: 'pre', style: { marginTop: '8px' } }, work.source),
        h('div', { style: { marginTop: '8px' } }, btn(t('docs_autofill'), () => { autofill(work.source); paint(); }, { cls: 'sm', icon: 'wand' }))) : null,
      h('div', { class: 'card stack' },
        h('div', { class: 'card-head' }, h('span', { class: 'hint' }, t('docs_preview_of', { name: T.title })), issues),
        preview,
        h('div', { class: 'actions' },
          btn(t('docs_copy_onenote'), () => copyText(asText(), asHtml()), { cls: 'primary', icon: 'copy' }),
          btn(t('docs_copy_tool'), () => copyText(asText()), { icon: 'copy' }),
          btn('.html', () => download(fileName('html'), `<!doctype html><meta charset="utf-8"><title>${esc(work.meta.title)}</title>${asHtml()}`, 'text/html'), { icon: 'download', cls: 'sm' }),
          btn('.md', () => download(fileName('md'), asMarkdown(), 'text/markdown'), { icon: 'download', cls: 'sm' }),
          canWrite ? btn(work.id ? t('trs_update') : t('save'), saveDoc, { icon: 'doc' }) : null)));
    body.appendChild(h('div', { class: 'row' }, form, side));

    function update() {
      clear(preview).innerHTML = asHtml(true);
      const miss = missing();
      clear(issues).appendChild(miss.length ? chip(t('docs_n_missing', { n: miss.length, total: T.data.sections.length }), 'warn') : chip(t('docs_complete'), 'ok'));
    }
    update();
  }

  const fileName = ext => `${(work.meta.code ? work.meta.code + '-' : '') + (work.meta.title || 'document')}`.replace(/[^\p{L}\p{N}_-]+/gu, '_') + '.' + ext;
  const lines = v => String(v || '').split('\n').map(x => x.replace(/^\s*(\d+[.)]|[-*•])\s*/, '').trim()).filter(Boolean);

  function metaLine() { return [work.meta.code, work.meta.module, work.meta.sprint, work.meta.release].filter(Boolean).join(' · '); }

  function asHtml(forPreview) {
    const T = tpl();
    let out = `<h2>${esc(work.meta.title || (forPreview ? t('docs_untitled') : ''))}</h2>`;
    if (metaLine()) out += `<p style="color:#5B6670">${esc(metaLine())}</p>`;
    T.data.sections.forEach((s, i) => {
      const v = work.values[s.id];
      out += `<h3>${i + 1}. ${esc(s.label)}</h3>`;
      if (!String(v || '').trim()) out += forPreview ? `<p class="missing">[${esc(t('docs_to_fill'))}]</p>` : '<p></p>';
      else if (s.type === 'list') out += `<ol>${lines(v).map(x => `<li>${esc(x)}</li>`).join('')}</ol>`;
      else out += String(v).split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
    });
    return out;
  }
  function asText() {
    const T = tpl();
    const out = [work.meta.title, metaLine(), ''];
    T.data.sections.forEach((s, i) => {
      out.push(`${i + 1}. ${s.label}`);
      if (s.type === 'list') lines(work.values[s.id]).forEach((x, j) => out.push(`   ${j + 1}) ${x}`));
      else out.push(String(work.values[s.id] || '').trim());
      out.push('');
    });
    return out.join('\n').trim();
  }
  function asMarkdown() {
    const T = tpl();
    const out = [`# ${work.meta.title}`, metaLine() ? `_${metaLine()}_` : '', ''];
    T.data.sections.forEach((s, i) => {
      out.push(`## ${i + 1}. ${s.label}`, '');
      if (s.type === 'list') lines(work.values[s.id]).forEach((x, j) => out.push(`${j + 1}. ${x}`));
      else out.push(String(work.values[s.id] || ''));
      out.push('');
    });
    return out.join('\n');
  }

  function autofill(text) {
    const T = tpl(); if (!T || !text) return;
    const parts = {}; let cur = null;
    for (const line of String(text).split('\n')) {
      const label = /^\s*(?:\d+[.)]\s*)?([^:]{3,60}):\s*(.*)$/.exec(line) || /^\s*\d+[.)]\s*(.{3,60})$/.exec(line);
      const sec = label && T.data.sections.find(s => (HINTS[s.id] || new RegExp(normalize(s.label).slice(0, 6), 'i')).test(normalize(label[1])) || similarity(s.label, label[1]) >= 0.6);
      if (sec) { cur = sec.id; parts[cur] = (label[2] || '').trim(); continue; }
      if (/^\s*(?:\d+[.)]\s*)?(function name|nume functie|funktionsname)/i.test(normalize(line))) { cur = null; const v = line.split(':')[1]; if (v && !work.meta.title) work.meta.title = v.trim(); continue; }
      if (cur && line.trim()) parts[cur] = (parts[cur] ? parts[cur] + '\n' : '') + line.trim();
    }
    let n = 0;
    for (const [k, v] of Object.entries(parts)) if (v && !String(work.values[k] || '').trim()) { work.values[k] = v; n++; }
    toast(t('docs_autofilled', { n }));
  }

  function importDocx() {
    pickFile('.docx,.html,.htm,.txt,.md', d => {
      const T = tpl();
      const blocks = d.blocks || String(d.text).split('\n').map(x => ({ type: /^#+\s/.test(x) ? 'h' : 'p', text: x.replace(/^#+\s*/, '') }));
      let cur = null, n = 0;
      for (const b of blocks) {
        if (b.type === 'h') {
          const label = b.text.replace(/^\d+[.)]\s*/, '');
          const sec = T.data.sections.map(s => [s, Math.max(similarity(s.label, label), (HINTS[s.id] || /$^/).test(normalize(label)) ? 0.8 : 0)]).sort((a, c) => c[1] - a[1])[0];
          if (sec && sec[1] >= 0.5) { cur = sec[0].id; work.values[cur] = ''; n++; }
          else if (!work.meta.title) { work.meta.title = b.text; cur = null; }
          else cur = null;
        } else if (cur) {
          const txt = b.type === 'table' ? b.rows.map(r => r.join(' | ')).join('\n') : b.text;
          work.values[cur] = (work.values[cur] ? work.values[cur] + '\n' : '') + txt;
        }
      }
      toast(t('docs_imported', { n }));
      paint();
    });
  }

  async function saveDoc() {
    if (!work.meta.title.trim()) { toast(t('err_title_required'), 'bad'); return; }
    const record = { kind: 'doc', key: work.meta.code, title: work.meta.title.trim(),
      body: asText(), data: { templateId: work.templateId, meta: work.meta, values: work.values, complete: !missing().length, source: work.source } };
    try {
      const saved = work.id ? await ctx.api.update(work.id, record, work.version) : await ctx.api.create('docs', record);
      work.id = saved.id; work.version = saved.version; ctx.invalidate('docs'); docs = await ctx.records('docs', true);
      toast(t('saved')); paint();
    } catch (e) { toast(e.status === 409 ? t('err_conflict') : e.message, 'bad'); }
  }

  function openDoc(d) {
    work = { id: d.id, version: d.version, templateId: templates.some(x => x.id === d.data?.templateId) ? d.data.templateId : templates[0]?.id,
      meta: { title: '', code: '', sprint: '', release: '', module: '', ...d.data?.meta }, values: { ...d.data?.values }, source: d.data?.source || '' };
  }

  // ------------------------------------------------------------- list
  function docList() {
    if (!docs.length) { body.appendChild(emptyState(t('docs_none'))); return; }
    body.appendChild(h('div', { class: 'card list' }, docs.slice().sort((a, b) => b.updated_at - a.updated_at).map(d => h('div', { class: 'li' },
      h('div', { class: 'grow' }, h('b', null, d.title), h('div', { class: 'small muted' }, `${[d.data?.meta?.code, d.data?.meta?.sprint, d.data?.meta?.release].filter(Boolean).join(' · ')} · ${fmtDateTime(d.updated_at)} · v${d.version}`)),
      d.data?.complete ? chip(t('docs_complete'), 'ok') : chip(t('docs_incomplete'), 'warn'),
      btn(t('open'), () => { openDoc(d); st.tab = 'write'; save(); paint(); }, { cls: 'sm' }),
      canWrite ? btn('', async () => { if (await confirmBox(t('confirm_delete', { name: d.title }), t('delete'))) { await ctx.api.remove(d.id); ctx.invalidate('docs'); load(true); } }, { cls: 'sm ghost danger icon-btn', icon: 'trash', aria: t('delete') }) : null))));
  }

  // -------------------------------------------------------- templates
  function templateList() {
    const canT = ctx.canWriteSection('templates');
    body.appendChild(h('p', { class: 'hint', style: { margin: 0 } }, t('docs_tpl_hint')));
    for (const T of templates) body.appendChild(templateEditor(T, canT));
    if (canT) body.appendChild(h('div', null, btn(t('docs_tpl_new'), async () => {
      await ctx.api.create('templates', { ...localizedDefault(), key: '', title: t('docs_tpl_copy_name') });
      ctx.invalidate('templates'); load(true);
    }, { icon: 'plus' })));
  }

  function templateEditor(T, canT) {
    const secs = structuredClone(T.data.sections);
    const name = h('input', { type: 'text', value: T.title, disabled: !canT, 'aria-label': t('f_title') });
    const list = h('div', { class: 'stack' });
    const paintSecs = () => {
      clear(list);
      secs.forEach((s, i) => {
        const label = h('input', { type: 'text', value: s.label, disabled: !canT, 'aria-label': t('docs_sec_label') });
        label.addEventListener('input', () => { s.label = label.value; });
        const hint = h('input', { type: 'text', value: s.hint || '', disabled: !canT, placeholder: t('docs_sec_hint'), 'aria-label': t('docs_sec_hint') });
        hint.addEventListener('input', () => { s.hint = hint.value; });
        list.appendChild(h('div', { class: 'toolbar', style: { borderBottom: '1px solid var(--line-soft)', paddingBottom: '8px' } },
          h('span', { class: 'mono muted' }, String(i + 1).padStart(2, '0')),
          h('div', { class: 'grow' }, label), h('div', { class: 'grow' }, hint),
          h('select', { disabled: !canT, 'aria-label': t('f_type'), onchange: e => { s.type = e.target.value; } },
            [['text', t('docs_type_text')], ['textarea', t('docs_type_textarea')], ['list', t('docs_type_list')]].map(([v, l]) => h('option', { value: v, selected: s.type === v }, l))),
          h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: s.required, disabled: !canT, onchange: e => { s.required = e.target.checked; } }), t('docs_required')),
          canT ? [btn('↑', () => { if (i) { [secs[i - 1], secs[i]] = [secs[i], secs[i - 1]]; paintSecs(); } }, { cls: 'sm ghost', aria: t('move_up') }),
            btn('↓', () => { if (i < secs.length - 1) { [secs[i + 1], secs[i]] = [secs[i], secs[i + 1]]; paintSecs(); } }, { cls: 'sm ghost', aria: t('move_down') }),
            btn('', () => { secs.splice(i, 1); paintSecs(); }, { cls: 'sm ghost danger icon-btn', icon: 'trash', aria: t('delete') })] : null));
      });
    };
    paintSecs();
    return h('div', { class: 'card stack' }, h('div', { class: 'toolbar' }, h('div', { class: 'grow' }, name), chip(`v${T.version}`)),
      list,
      canT ? h('div', { class: 'actions' },
        btn(t('docs_sec_add'), () => { secs.push({ id: 's' + Date.now().toString(36), label: t('docs_sec_new'), type: 'textarea', required: false, hint: '' }); paintSecs(); }, { icon: 'plus', cls: 'sm' }),
        btn(t('save'), async () => {
          try { await ctx.api.update(T.id, { title: name.value, data: { ...T.data, sections: secs } }, T.version); ctx.invalidate('templates'); toast(t('saved')); load(true); }
          catch (e) { toast(e.status === 409 ? t('err_conflict') : e.message, 'bad'); }
        }, { cls: 'primary sm' })) : null);
  }

  await load();
}
