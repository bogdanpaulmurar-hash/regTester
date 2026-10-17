// Specifications, bugs, issues and procedures: one searchable knowledge base with full history.
import { openEditor } from '../editor.js';
import { historyTab } from '../history-view.js';
import { t } from '../i18n.js';
import { openImport } from '../importer.js';
import { indexDoc, search, similarTo } from '../search.js';
import { btn, chip, clear, debounce, download, emptyState, fmtDate, h, highlight, iso, modal, seg, snippet, store, tabs, toCsv } from '../util.js';

export const SPEC_KINDS = ['spec', 'bug', 'issue', 'procedure', 'note'];
const KIND_CHIP = { spec: 'info', bug: 'bad', issue: 'warn', procedure: 'ok', note: '' };
const STATUS_CHIP = { open: 'warn', 'in progress': 'info', done: 'ok', closed: '', obsolete: '' };

export async function render(root, ctx, params) {
  const st = Object.assign({ tab: 'search', q: '', fuzzy: true, sort: 'score', saved: [] }, store('specs') || {});
  const save = () => store('specs', st);
  const canWrite = ctx.canWriteSection('specs');
  let docs = [];

  root.appendChild(h('div', { class: 'page-head' },
    h('div', null, h('h1', null, t('nav_specs')), h('p', null, t('specs_intro'))),
    h('div', { class: 'actions' }, canWrite ? [btn(t('import'), importDialog, { icon: 'upload' }), btn(t('specs_new'), () => edit(null), { icon: 'plus', cls: 'primary' })] : null)));
  const tabBox = h('div'), body = h('div', { class: 'stack' });
  root.append(tabBox, body);

  async function load(force) {
    docs = (await ctx.records('specs', force)).map(indexDoc);
    paint();
    const open = params?.get('id');
    if (open) { const d = docs.find(x => x.r.id === open); if (d) edit(d.r); }
  }

  function paint() {
    clear(tabBox).appendChild(tabs([['search', t('specs_t_search')], ['table', `${t('specs_t_all')} · ${docs.length}`], ['history', t('tab_history')]], st.tab, v => { st.tab = v; save(); paint(); }));
    clear(body);
    if (st.tab === 'history') historyTab(body, ctx, ['specs'], () => load(true));
    else if (st.tab === 'table') table();
    else searchView();
  }

  // ------------------------------------------------------------- search
  function searchView() {
    const input = h('input', { type: 'search', id: 'spec-q', value: st.q, placeholder: t('specs_q_ph'), 'aria-label': t('specs_t_search'), autocomplete: 'off' });
    const facetBox = h('div', { class: 'stack', style: { flex: '1 1 220px', maxWidth: '300px' } });
    const resBox = h('div', { class: 'stack', style: { flex: '999 1 420px', minWidth: 0 } });
    const savedBox = h('div', { class: 'pill-row' });
    const run = () => { st.q = input.value; save(); results(); };
    input.addEventListener('input', debounce(run, 150));
    body.appendChild(h('div', { class: 'card stack' },
      h('div', { class: 'toolbar' }, h('div', { class: 'grow' }, input),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: st.fuzzy, onchange: e => { st.fuzzy = e.target.checked; save(); results(); } }), t('specs_fuzzy')),
        seg([['score', t('specs_sort_score')], ['updated', t('specs_sort_updated')], ['key', t('specs_sort_key')]], st.sort, v => { st.sort = v; save(); paint(); }),
        btn(t('specs_syntax'), syntaxHelp, { cls: 'ghost sm' }),
        btn(t('specs_save_search'), () => { if (st.q.trim() && !st.saved.includes(st.q.trim())) { st.saved.push(st.q.trim()); save(); paintSaved(); } }, { cls: 'sm' })),
      savedBox));
    body.appendChild(h('div', { class: 'row', style: { alignItems: 'flex-start' } }, facetBox, resBox));

    function paintSaved() {
      clear(savedBox);
      if (!st.saved.length) { savedBox.appendChild(h('span', { class: 'hint' }, t('specs_saved_none'))); return; }
      savedBox.append(h('span', { class: 'hint' }, t('specs_saved') + ':'), ...st.saved.map(q => h('span', { class: 'chip' },
        h('button', { type: 'button', class: 'btn ghost sm', style: { minHeight: '24px', padding: '0 4px' }, onclick: () => { input.value = q; run(); } }, q),
        h('button', { type: 'button', class: 'btn ghost sm', 'aria-label': t('delete'), style: { minHeight: '24px', padding: '0 4px' }, onclick: () => { st.saved = st.saved.filter(x => x !== q); save(); paintSaved(); } }, '×'))));
    }
    paintSaved();

    function addFilter(field, value) {
      const token = `${field}:${/\s/.test(value) ? `"${value}"` : value}`;
      if (!input.value.includes(token)) input.value = (input.value + ' ' + token).trim();
      run();
    }

    function results() {
      const { results: res, terms } = search(docs, st.q, { fuzzy: st.fuzzy });
      if (st.sort === 'updated') res.sort((a, b) => b.doc.r.updated_at - a.doc.r.updated_at);
      if (st.sort === 'key') res.sort((a, b) => String(a.doc.r.key).localeCompare(String(b.doc.r.key), undefined, { numeric: true }));
      clear(facetBox);
      const facet = (label, field, get) => {
        const counts = {};
        for (const { doc } of res) for (const v of [].concat(get(doc.r) || [])) if (v) counts[v] = (counts[v] || 0) + 1;
        const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 12);
        if (!entries.length) return null;
        return h('div', { class: 'card', style: { padding: '12px' } }, h('h3', { style: { marginBottom: '6px' } }, label),
          h('div', { class: 'stack', style: { gap: '2px' } }, entries.map(([v, n]) => h('button', { type: 'button', class: 'btn ghost sm', style: { justifyContent: 'space-between' }, onclick: () => addFilter(field, v) },
            h('span', null, field === 'type' ? t('sk_' + v) : v), h('span', { class: 'num muted' }, n)))));
      };
      facetBox.append(...[facet(t('f_type'), 'type', r => r.kind), facet(t('f_status'), 'status', r => r.data?.status), facet(t('f_module'), 'module', r => r.data?.module),
        facet(t('f_release'), 'release', r => r.data?.release), facet(t('f_tags'), 'tag', r => r.tags)].filter(Boolean));
      clear(resBox);
      resBox.appendChild(h('div', { class: 'toolbar' }, h('span', { class: 'hint' }, t('specs_n_results', { n: res.length, total: docs.length })), h('span', { class: 'sp' }),
        res.length ? btn('CSV', () => download(`specs-${iso(new Date())}.csv`, '﻿' + toCsv(res.map(x => x.doc.r), [
          { label: 'Key', key: 'key' }, { label: 'Type', key: 'kind' }, { label: 'Title', key: 'title' }, { label: 'Status', get: r => r.data?.status },
          { label: 'Module', get: r => r.data?.module }, { label: 'Release', get: r => r.data?.release }, { label: 'Tags', get: r => (r.tags || []).join(', ') }, { label: 'Text', key: 'body' }]), 'text/csv'), { icon: 'download', cls: 'sm' }) : null));
      if (!docs.length) { resBox.appendChild(emptyState(t('specs_empty'), canWrite ? btn(t('import'), importDialog, { icon: 'upload', cls: 'primary' }) : null)); return; }
      if (!res.length) { resBox.appendChild(emptyState(t('specs_no_results'))); return; }
      for (const { doc } of res.slice(0, 200)) {
        const r = doc.r;
        resBox.appendChild(h('article', { class: 'card', style: { padding: '14px 16px', cursor: 'pointer' }, tabindex: '0', onclick: () => edit(r), onkeydown: e => { if (e.key === 'Enter') edit(r); } },
          h('div', { class: 'pill-row' }, chip(t('sk_' + (r.kind || 'note')), KIND_CHIP[r.kind]), r.key ? h('span', { class: 'mono muted' }, highlight(r.key, terms)) : null,
            r.data?.status ? chip(r.data.status, STATUS_CHIP[String(r.data.status).toLowerCase()]) : null,
            h('span', { class: 'sp' }), h('span', { class: 'small muted' }, `${[r.data?.module, r.data?.release].filter(Boolean).join(' · ')} · ${fmtDate(r.updated_at)} · v${r.version}`)),
          h('h3', { style: { margin: '6px 0 4px', fontSize: '15px' } }, highlight(r.title, terms)),
          h('div', { class: 'small', style: { color: 'var(--fg-2)' } }, highlight(snippet(r.body, terms), terms)),
          r.tags?.length ? h('div', { class: 'pill-row', style: { marginTop: '6px' } }, r.tags.map(x => chip('#' + x))) : null));
      }
    }
    results();
  }

  function syntaxHelp() {
    const rows = [['login timeout', t('syn_and')], ['"cost center"', t('syn_phrase')], ['invoice -pdf', t('syn_not')], ['pdf OR export', t('syn_or')],
      ['archiv*', t('syn_prefix')], ['retension~', t('syn_fuzzy')], ['type:bug status:open', t('syn_fields')], ['module:Invoice release:R-2026.4', t('syn_fields2')],
      ['tag:invoice', t('syn_tag')], ['updated>2026-09-01', t('syn_date')], ['FN-1042', t('syn_code')]];
    modal({ title: t('specs_syntax'), body: h('div', { class: 'table-wrap' }, h('table', { class: 't' }, h('tbody', null, rows.map(([q, d]) => h('tr', null, h('td', { class: 'mono nowrap' }, q), h('td', null, d)))))) });
  }

  // -------------------------------------------------------------- table
  function table() {
    const kinds = SPEC_KINDS.filter(k => docs.some(d => d.r.kind === k));
    let kind = 'all';
    const box = h('div');
    const paintT = () => {
      clear(box);
      const list = docs.filter(d => kind === 'all' || d.r.kind === kind).map(d => d.r).sort((a, b) => String(a.key).localeCompare(String(b.key), undefined, { numeric: true }));
      box.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 't' },
        h('thead', null, h('tr', null, [t('f_key'), t('f_type'), t('f_title'), t('f_status'), t('f_module'), t('f_release'), t('f_updated')].map(x => h('th', null, x)))),
        h('tbody', null, list.map(r => h('tr', { class: 'click', tabindex: '0', onclick: () => edit(r) },
          h('td', { class: 'mono nowrap' }, r.key), h('td', null, chip(t('sk_' + (r.kind || 'note')), KIND_CHIP[r.kind])), h('td', null, r.title),
          h('td', null, r.data?.status || ''), h('td', null, r.data?.module || ''), h('td', null, r.data?.release || ''), h('td', { class: 'nowrap' }, fmtDate(r.updated_at))))))));
    };
    const segBox = h('div');
    const paintSeg = () => clear(segBox).appendChild(seg([['all', t('all')], ...kinds.map(k => [k, t('sk_' + k)])], kind, v => { kind = v; paintSeg(); paintT(); }));
    body.append(segBox, box);
    paintSeg();
    paintT();
  }

  // --------------------------------------------------------------- edit
  function edit(r) {
    const modules = [...new Set(docs.map(d => d.r.data?.module).filter(Boolean))];
    const releases = [...new Set(docs.map(d => d.r.data?.release).filter(Boolean))];
    openEditor({
      ctx, section: 'specs', record: r, defaults: { kind: 'spec', data: { status: 'open' } },
      title: r ? `${r.key ? r.key + ' · ' : ''}${r.title}` : t('specs_new'),
      fields: [
        { key: 'kind', label: t('f_type'), type: 'select', options: SPEC_KINDS.map(k => [k, t('sk_' + k)]) },
        { key: 'key', label: t('f_key'), hint: t('specs_key_hint') },
        { key: 'title', label: t('f_title') },
        { key: 'data.status', label: t('f_status'), datalist: ['open', 'in progress', 'done', 'closed', 'obsolete'] },
        { key: 'data.module', label: t('f_module'), datalist: modules },
        { key: 'data.release', label: t('f_release'), datalist: releases },
        { key: 'tags', label: t('f_tags'), type: 'tags', hint: t('specs_tags_hint') },
        { key: 'data.links', label: t('f_links'), hint: t('specs_links_hint') },
        { key: 'body', label: t('f_text'), type: 'textarea', rows: 12 },
      ],
      extra: rec => {
        if (!rec.id) return null;
        const me = docs.find(d => d.r.id === rec.id); if (!me) return null;
        const sim = similarTo(me, docs);
        if (!sim.length) return null;
        return h('div', { class: 'stack' }, h('h3', null, t('specs_similar')), h('div', { class: 'list' }, sim.map(({ doc, score }) => h('div', { class: 'li' },
          chip(t('sk_' + (doc.r.kind || 'note')), KIND_CHIP[doc.r.kind]), h('div', { class: 'grow' }, doc.r.key ? h('span', { class: 'mono muted' }, doc.r.key + ' ') : null, doc.r.title),
          h('span', { class: 'small muted num' }, Math.round(score * 100) + '%')))));
      },
      onSaved: () => { ctx.invalidate('specs'); load(true); },
    });
  }

  // ------------------------------------------------------------- import
  function importDialog() {
    let kind = 'spec', split = 'headings';
    modal({
      title: t('import'),
      body: [h('p', null, t('specs_import_intro')),
        h('label', { class: 'field' }, t('specs_import_kind'), h('select', { onchange: e => { kind = e.target.value; } }, SPEC_KINDS.map(k => h('option', { value: k }, t('sk_' + k))))),
        h('label', { class: 'field' }, t('specs_import_split'), h('select', { onchange: e => { split = e.target.value; } },
          h('option', { value: 'headings' }, t('specs_split_headings')), h('option', { value: 'one' }, t('specs_split_one')))),
        h('p', { class: 'hint' }, t('specs_import_hint'))],
      footer: c => [btn(t('cancel'), c), btn(t('continue'), () => { c(); runImport(kind, split); }, { cls: 'primary' })],
    });
  }

  function runImport(defaultKind, split) {
    const kindOf = v => {
      const s = String(v || '').toLowerCase();
      if (/bug|defect|fehler/.test(s)) return 'bug';
      if (/issue|problem|incident/.test(s)) return 'issue';
      if (/proc|anleitung|procedur|how.?to|sop/.test(s)) return 'procedure';
      if (/spec|requirement|anforderung|cerint/.test(s)) return 'spec';
      if (/note|notiz|nota/.test(s)) return 'note';
      return defaultKind;
    };
    openImport({
      api: ctx.api, section: 'specs', title: t('import') + ' · ' + t('sk_' + defaultKind), accept: '.xlsx,.xlsm,.csv,.docx,.html,.htm,.txt,.md', hint: t('specs_import_files'),
      fields: [
        { key: 'key', label: t('f_key'), aliases: ['id', 'key', 'nr', 'number', 'nummer', 'ticket', 'bug id', 'issue id', 'cod'] },
        { key: 'title', label: t('f_title'), required: true, aliases: ['title', 'titel', 'summary', 'zusammenfassung', 'subject', 'betreff', 'name', 'titlu'] },
        { key: 'kind', label: t('f_type'), aliases: ['type', 'typ', 'tip', 'category', 'kategorie', 'issue type'] },
        { key: 'body', label: t('f_text'), aliases: ['description', 'beschreibung', 'descriere', 'text', 'details', 'content', 'inhalt', 'steps'] },
        { key: 'status', label: t('f_status'), aliases: ['status', 'state', 'zustand', 'stare'] },
        { key: 'module', label: t('f_module'), aliases: ['module', 'modul', 'component', 'komponente', 'area'] },
        { key: 'release', label: t('f_release'), aliases: ['release', 'version', 'fix version', 'versiune'] },
        { key: 'tags', label: t('f_tags'), aliases: ['tags', 'labels', 'etichete', 'schlagworte'] },
      ],
      toRecord: m => String(m.title).trim() ? { key: String(m.key || '').trim(), kind: kindOf(m.kind), title: String(m.title).trim(), body: String(m.body || ''),
        tags: String(m.tags || '').split(/[,;]/).map(x => x.trim()).filter(Boolean), data: { status: String(m.status || ''), module: String(m.module || ''), release: String(m.release || ''), source: 'import' } } : null,
      fromDoc: d => {
        const base = { kind: defaultKind, tags: [], data: { status: '', source: d.name } };
        const blockText = b => b.type === 'table' ? b.rows.map(r => r.join(' | ')).join('\n') : (b.list ? '- ' : '') + b.text;
        if (split === 'one' || !(d.blocks || []).some(b => b.type === 'h')) {
          return [{ ...base, title: d.name.replace(/\.[^.]+$/, ''), body: (d.blocks || []).map(blockText).join('\n') || d.text }];
        }
        const out = []; let cur = null;
        for (const b of d.blocks) {
          if (b.type === 'h' && b.level <= 2) { if (cur) out.push(cur); const code = (b.text.match(/\b[A-Z]{2,6}-\d{1,6}\b/) || [''])[0]; cur = { ...base, key: code, title: b.text, body: '' }; }
          else if (cur) cur.body += (cur.body ? '\n' : '') + (b.type === 'h' ? '## ' + b.text : blockText(b));
          else cur = { ...base, title: d.name.replace(/\.[^.]+$/, ''), body: blockText(b) };
        }
        if (cur) out.push(cur);
        return out;
      },
      previewCols: [['key', t('f_key')], ['kind', t('f_type')], ['title', t('f_title')]],
      onDone: () => { ctx.invalidate('specs'); load(true); },
    });
  }

  await load();
}
