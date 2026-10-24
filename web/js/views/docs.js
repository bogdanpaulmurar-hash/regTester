// Documentation generator: fixed templates give every document the same order and style.
import { DEFAULT_TEMPLATE } from '../demo.js';
import { buildSpecDocx, countImages, defaultSections, importSpecDocx, newSpec, SPEC_FORMAT, specFileName, specText, structureOf } from '../docx-spec.js';
import { historyTab } from '../history-view.js';
import { LANGS, t, tIn } from '../i18n.js';
import { richText } from '../richtext.js';
import { pickFile } from '../importer.js';
import {
  btn, chip, clear, confirmBox, copyText, directed, download, emptyState, esc, fmtDateTime, h, listOrder, normalize, orderToggle, similarity, store, tabs, toast,
} from '../util.js';

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
  const st = Object.assign({ tab: 'spec' }, store('docs') || {});
  const save = () => store('docs', st);
  const canWrite = ctx.canWriteSection('docs');
  let templates = [], docs = [], specBase = null;
  let work = null, sw = null, swDirty = false;

  root.appendChild(h('div', { class: 'page-head' }, h('div', null, h('h1', null, ctx.pageLabel('docs')), h('p', null, t('docs_intro')))));
  const tabBox = h('div'), body = h('div', { class: 'stack' });
  root.append(tabBox, body);

  async function load(force) {
    let all = await ctx.records('templates', force);
    if (!all.some(x => x.kind !== 'regspec') && ctx.canWriteSection('templates')) {
      await ctx.api.create('templates', localizedDefault());
      all = await ctx.records('templates', true);
    }
    templates = all.filter(x => x.kind !== 'regspec');
    specBase = all.find(x => x.kind === 'regspec') || null;
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
    clear(tabBox).appendChild(tabs([['spec', t('docs_t_spec')], ['write', t('docs_t_write')], ['list', `${t('docs_t_list')} · ${docs.length}`], ['templates', t('docs_t_templates')], ['history', t('tab_history')]],
      st.tab, v => { st.tab = v; save(); paint(); }));
    clear(body);
    if (st.tab === 'history') historyTab(body, ctx, ['docs', 'templates'], () => load(true));
    else if (st.tab === 'list') docList();
    else if (st.tab === 'templates') templateList();
    else if (st.tab === 'spec') specView();
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
    body.appendChild(h('div', { class: 'toolbar' }, orderToggle('docs', () => paint())));
    body.appendChild(h('div', { class: 'card list' }, docs.slice().sort(directed((a, b) => a.updated_at - b.updated_at, listOrder('docs'))).map(d => d.data?.format === SPEC_FORMAT ? specListItem(d) : h('div', { class: 'li' },
      h('div', { class: 'grow' }, h('b', null, d.title), h('div', { class: 'small muted' }, `${[d.data?.meta?.code, d.data?.meta?.sprint, d.data?.meta?.release].filter(Boolean).join(' · ')} · ${fmtDateTime(d.updated_at)} · v${d.version}`)),
      d.data?.complete ? chip(t('docs_complete'), 'ok') : chip(t('docs_incomplete'), 'warn'),
      btn(t('open'), () => { openDoc(d); st.tab = 'write'; save(); paint(); }, { cls: 'sm' }),
      canWrite ? btn('', async () => { if (await confirmBox(t('confirm_delete', { name: d.title }), t('delete'))) { await ctx.api.remove(d.id); ctx.invalidate('docs'); load(true); } }, { cls: 'sm ghost danger icon-btn', icon: 'trash', aria: t('delete') }) : null))));
  }

  // ------------------------------------------------- word specification
  function specListItem(d) {
    const sp = d.data;
    return h('div', { class: 'li' },
      h('div', { class: 'grow' }, h('b', null, d.title), h('div', { class: 'small muted' },
        `${[sp.story, sp.path, sp.header?.date].filter(Boolean).join(' · ')} · ${fmtDateTime(d.updated_at)} · v${d.version} · ${d.updated_by || ''}`)),
      chip(t('spec_kind'), 'info'),
      btn('.docx', () => downloadSpec(sp), { cls: 'sm', icon: 'download' }),
      btn(t('open'), () => { openSpec(d); st.tab = 'spec'; save(); paint(); }, { cls: 'sm' }),
      canWrite ? btn('', async () => { if (await confirmBox(t('confirm_delete', { name: d.title }), t('delete'))) { await ctx.api.remove(d.id); ctx.invalidate('docs'); if (sw?.id === d.id) sw = null; load(true); } }, { cls: 'sm ghost danger icon-btn', icon: 'trash', aria: t('delete') }) : null);
  }

  function freshSpec() {
    const lang = specBase?.data?.lang || 'de';
    sw = { id: null, version: null, spec: newSpec(lang, specBase?.data || null) };
    swDirty = false;
  }
  function openSpec(d) {
    const spec = { ...newSpec(d.data.lang || 'de'), ...structuredClone(d.data) };
    spec.header = { product: '', name: '', department: '', date: '', ...(d.data.header || {}) };
    sw = { id: d.id, version: d.version, spec };
    swDirty = false;
  }
  async function guardDirty() {
    return !swDirty || confirmBox(t('spec_discard_q'), t('continue'));
  }

  async function downloadSpec(spec) {
    try {
      const bytes = await buildSpecDocx(spec, ctx.user?.display || ctx.user?.username || '');
      const name = specFileName(spec);
      download(name, new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
      toast(t('spec_generated', { name }));
      ctx.api.log('INFO', `Word specification generated: ${name}`);
    } catch (e) { console.error(e); toast(e.message, 'bad'); }
  }

  function specView() {
    if (!sw) freshSpec();
    const sp = sw.spec;
    const mark = () => { swDirty = true; dirtyChip.hidden = false; };
    const dirtyChip = chip(t('spec_unsaved'), 'warn'); dirtyChip.hidden = !swDirty;
    const input = (id, label, get, set, extra = {}) => {
      const el = h('input', { type: 'text', id: 'sp-' + id, value: get() || '', disabled: !canWrite, ...extra });
      el.addEventListener('input', () => { set(el.value); mark(); if (id === 'title' || id === 'story') syncHead(); });
      return h('label', { class: 'field', for: 'sp-' + id }, label, el, extra.hint ? h('span', { class: 'hint' }, extra.hint) : null);
    };
    const langSel = h('select', { id: 'sp-lang', disabled: !canWrite, onchange: () => {
      const old = sp.lang, nl = langSel.value;
      // titles still equal to the defaults of the old language follow the new language
      const oldDef = defaultSections(old).map(x => x.title), newDef = defaultSections(nl).map(x => x.title);
      sp.sections.forEach(s => { const i = oldDef.indexOf(s.title); if (i >= 0) s.title = newDef[i]; });
      if (sp.classification === tIn(old, 'dx_class')) sp.classification = tIn(nl, 'dx_class');
      sp.lang = nl; mark(); paint();
    } }, LANGS.map(l => h('option', { value: l, selected: sp.lang === l }, ({ de: 'Deutsch', en: 'English', ro: 'Română' })[l] || l)));

    const head = h('div', { class: 'toolbar' });
    function syncHead() {
      clear(head).append(
        h('div', { class: 'grow' }, h('b', null, sp.title || t('spec_untitled')), sp.story ? h('span', { class: 'muted' }, ' · ' + sp.story) : null,
          sw.id ? h('span', { class: 'small muted' }, ` · v${sw.version}`) : null),
        dirtyChip);
    }
    syncHead();

    const actions = h('div', { class: 'toolbar' },
      canWrite ? btn(t('spec_new'), async () => { if (await guardDirty()) { freshSpec(); paint(); } }, { icon: 'plus', cls: 'sm' }) : null,
      canWrite ? btn(t('spec_import'), importSpec, { icon: 'upload', cls: 'sm' }) : null,
      h('span', { class: 'sp' }),
      ctx.canWriteSection('templates') ? btn(t('spec_save_default'), saveSpecDefault, { cls: 'sm ghost' }) : null,
      btn(t('spec_docx'), () => downloadSpec(sp), { icon: 'download', cls: 'sm' }),
      canWrite ? btn(sw.id ? t('trs_update') : t('save'), saveSpec, { icon: 'doc', cls: 'primary sm' }) : null);

    const cover = h('details', { class: 'card stack', open: !sw.id },
      h('summary', null, h('b', null, t('spec_cover'))),
      h('div', { class: 'grid-form' },
        input('title', t('spec_title') + ' *', () => sp.title, v => { sp.title = v; }, { hint: t('spec_hint_title') }),
        input('story', t('spec_story'), () => sp.story, v => { sp.story = v; }, { placeholder: 'US-0000' }),
        input('path', t('spec_path'), () => sp.path, v => { sp.path = v; }),
        input('package', t('spec_package'), () => sp.package, v => { sp.package = v; }, { placeholder: t('spec_package_same') }),
        input('product', t('spec_product'), () => sp.header.product, v => { sp.header.product = v; }),
        input('name', t('spec_name'), () => sp.header.name, v => { sp.header.name = v; }, { placeholder: tIn(sp.lang, 'dx_name') }),
        input('department', t('spec_department'), () => sp.header.department, v => { sp.header.department = v; }, { placeholder: tIn(sp.lang, 'dx_department') }),
        input('date', t('spec_date'), () => sp.header.date, v => { sp.header.date = v; }, { placeholder: 'dd.mm.yyyy' }),
        input('class', t('spec_class'), () => sp.classification, v => { sp.classification = v; }),
        h('label', { class: 'field', for: 'sp-lang' }, t('spec_doc_lang'), langSel)));

    const secBox = h('div', { class: 'stack' });
    const paintSections = () => {
      clear(secBox);
      sp.sections.forEach((s, i) => {
        const title = h('input', { type: 'text', value: s.title, disabled: !canWrite, 'aria-label': t('spec_sec_title'), class: 'spec-sec-title' });
        title.addEventListener('input', () => { s.title = title.value; mark(); });
        const level = h('select', { disabled: !canWrite, 'aria-label': t('spec_level'), onchange: e => { s.level = +e.target.value; mark(); paintSections(); } },
          [1, 2, 3].map(n => h('option', { value: n, selected: s.level === n }, t('spec_level_n', { n }))));
        const np = h('input', { type: 'checkbox', checked: s.newPage, disabled: !canWrite, onchange: e => { s.newPage = e.target.checked; mark(); } });
        const move = d => { const j = i + d; if (j < 0 || j >= sp.sections.length) return; [sp.sections[i], sp.sections[j]] = [sp.sections[j], sp.sections[i]]; mark(); paintSections(); };
        secBox.appendChild(h('section', { class: `card stack spec-sec lvl${s.level}` },
          h('div', { class: 'toolbar' },
            h('span', { class: 'mono muted' }, String(i + 1).padStart(2, '0')),
            level, h('div', { class: 'grow' }, title),
            h('label', { class: 'check' }, np, t('spec_newpage')),
            canWrite ? [btn('↑', () => move(-1), { cls: 'sm ghost', aria: t('move_up') }), btn('↓', () => move(1), { cls: 'sm ghost', aria: t('move_down') }),
              btn('+', () => { sp.sections.splice(i + 1, 0, { id: 's' + Date.now().toString(36), level: Math.min(3, s.level + (s.level < 3 ? 1 : 0)), title: '', html: '', newPage: false }); mark(); paintSections(); }, { cls: 'sm ghost', aria: t('spec_add_after'), title: t('spec_add_after') }),
              btn('', async () => { if (await confirmBox(t('confirm_delete', { name: s.title || '#' + (i + 1) }), t('delete'))) { sp.sections.splice(i, 1); mark(); paintSections(); } }, { cls: 'sm ghost danger icon-btn', icon: 'trash', aria: t('delete') })] : null),
          richText({ html: s.html, readOnly: !canWrite, label: s.title, onChange: v => { if (v !== s.html) { s.html = v; mark(); } } })));
      });
      if (canWrite) secBox.appendChild(h('div', null, btn(t('spec_add'), () => { sp.sections.push({ id: 's' + Date.now().toString(36), level: 1, title: '', html: '', newPage: true }); mark(); paintSections(); }, { icon: 'plus' })));
    };
    paintSections();

    const preview = h('div', { class: 'doc-preview spec-preview' });
    const prevBox = h('details', { class: 'card', ontoggle: e => { if (e.target.open) paintPreview(); } },
      h('summary', null, h('b', null, t('spec_preview'))), h('p', { class: 'hint' }, t('spec_toc_note')), preview);
    function paintPreview() {
      const L = k => tIn(sp.lang, k);
      const hd = `<div class="sp-hdr"><div><b>${esc([sp.header.product, L('dx_doctype')].filter(Boolean).join(' '))}</b><br>${esc(sp.header.name || L('dx_name'))}<br>${esc(sp.header.department || L('dx_department'))}</div><b>${esc(sp.header.date || L('dx_date'))}</b></div>`;
      let out = `<div class="sp-page">${hd}<p class="sp-title">${esc(L('dx_title'))} ${esc(sp.title)}</p><p class="sp-label">${esc(L('dx_path'))} ${esc(sp.path)}</p><p class="sp-label">${esc(L('dx_package'))}</p><p class="sp-pkg">${esc(sp.package || sp.title)}</p></div>`;
      out += `<div class="sp-page">${hd}<p class="sp-label">${esc(L('dx_toc'))}</p>${sp.sections.map(s => `<div class="sp-toc lvl${s.level}">${esc(s.title)}</div>`).join('')}</div>`;
      let page = '';
      sp.sections.forEach((s, i) => {
        if (i === 0 || s.newPage) { if (page) out += `<div class="sp-page">${hd}${page}</div>`; page = ''; }
        page += `<h${s.level + 1} class="sp-h">${esc(s.title)}</h${s.level + 1}>${s.html || ''}`;
      });
      if (page) out += `<div class="sp-page">${hd}${page}</div>`;
      preview.innerHTML = out;
    }

    body.append(h('div', { class: 'card stack' }, head, h('p', { class: 'hint', style: { margin: 0 } }, t('spec_intro')), actions), cover,
      h('h2', null, t('spec_sections')), secBox, prevBox);
  }

  async function saveSpec() {
    const sp = sw.spec;
    if (!String(sp.title || '').trim()) { toast(t('err_title_required'), 'bad'); return; }
    if (!sp.story) sp.story = (/\b([A-Z]{2,6}-\d{2,7})\b/.exec(sp.title) || [])[1] || '';
    const record = { kind: 'spec-doc', key: sp.story || '', title: sp.title.trim(), body: specText(sp), data: { ...structuredClone(sp), format: SPEC_FORMAT, images: countImages(sp) } };
    try {
      const saved = sw.id ? await ctx.api.update(sw.id, record, sw.version) : await ctx.api.create('docs', record);
      sw.id = saved.id; sw.version = saved.version; swDirty = false;
      ctx.invalidate('docs'); docs = await ctx.records('docs', true);
      toast(t('saved')); paint();
    } catch (e) { toast(e.status === 409 ? t('err_conflict') : e.message, 'bad'); }
  }

  async function saveSpecDefault() {
    const rec = { kind: 'regspec', key: 'REGSPEC-DEFAULT', title: t('spec_kind'), data: structureOf(sw.spec) };
    try {
      if (specBase) await ctx.api.update(specBase.id, rec, specBase.version); else await ctx.api.create('templates', rec);
      ctx.invalidate('templates');
      const all = await ctx.records('templates', true);
      specBase = all.find(x => x.kind === 'regspec') || null;
      toast(t('spec_default_saved'));
    } catch (e) { toast(e.status === 409 ? t('err_conflict') : e.message, 'bad'); }
  }

  function importSpec() {
    const inp = h('input', { type: 'file', accept: '.docx', hidden: true });
    inp.addEventListener('change', async () => {
      const f = inp.files[0]; inp.remove(); if (!f) return;
      if (!(await guardDirty())) return;
      try {
        const res = await importSpecDocx(await f.arrayBuffer(), sw?.spec?.lang || specBase?.data?.lang || 'de');
        if (!res.spec.title) res.spec.title = f.name.replace(/\.docx$/i, '');
        sw = { id: null, version: null, spec: res.spec }; swDirty = true;
        toast(t('spec_imported', { n: res.spec.sections.length, img: res.images }));
        if (res.skipped) toast(t('spec_img_skipped', { n: res.skipped }), 'warn');
        ctx.api.log('INFO', `Word specification imported: ${f.name} (${res.spec.sections.length} sections, ${res.images} images)`);
        paint();
      } catch (e) { console.error(e); toast(e.message, 'bad'); }
    });
    document.body.appendChild(inp);
    inp.click();
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
