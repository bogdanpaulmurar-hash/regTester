// PO sessions: Teams transcript → clean text + glossary fixes → fixed AI prompt → saved summary.
import { openEditor } from '../editor.js';
import { historyTab } from '../history-view.js';
import { t } from '../i18n.js';
import { openImport, pickFile } from '../importer.js';
import { cleanTranscript, detectFeatures, parseTranscript } from '../transcript.js';
import { btn, chip, clear, copyText, emptyState, fmtDate, h, iso, store, tabs, toast, words } from '../util.js';

const LANG_NAME = { ro: 'Romanian', en: 'English', de: 'German' };

export async function render(root, ctx) {
  const st = Object.assign({ tab: 'process' }, store('trs') || {});
  const save = () => store('trs', st);
  const canWrite = ctx.canWriteSection('transcripts');
  let sessions = [], glossary = [], features = [];
  let work = { id: null, version: null, title: '', date: iso(new Date()), source: '', raw: '', summary: '', outLang: ctx.settings.language || 'ro' };

  root.appendChild(h('div', { class: 'page-head' },
    h('div', null, h('h1', null, t('nav_transcripts')), h('p', null, t('trs_intro')))));
  const tabBox = h('div'), body = h('div', { class: 'stack' });
  root.append(tabBox, body);

  async function load(force) {
    [sessions, glossary, features] = await Promise.all([ctx.records('transcripts', force), ctx.records('glossary', force), ctx.records('features').catch(() => [])]);
    if (ctx.api.demo && !work.raw && sessions[0]) openSession(sessions[0]);
    paint();
  }

  function paint() {
    clear(tabBox).appendChild(tabs([['process', t('trs_t_process')], ['sessions', `${t('trs_t_sessions')} · ${sessions.length}`], ['glossary', `${t('trs_t_glossary')} · ${glossary.length}`], ['history', t('tab_history')]],
      st.tab, v => { st.tab = v; save(); paint(); }));
    clear(body);
    if (st.tab === 'history') historyTab(body, ctx, ['transcripts', 'glossary'], () => load(true));
    else if (st.tab === 'sessions') sessionList();
    else if (st.tab === 'glossary') glossaryList();
    else processView();
  }

  // ------------------------------------------------------------ process
  function processView() {
    const title = h('input', { type: 'text', id: 'trs-title', value: work.title, placeholder: t('trs_title_ph') });
    const date = h('input', { type: 'date', id: 'trs-date', value: work.date });
    const raw = h('textarea', { id: 'trs-raw', rows: 14, value: work.raw, placeholder: t('trs_paste_ph') });
    const result = h('div', { class: 'stack' });
    title.addEventListener('input', () => { work.title = title.value; });
    date.addEventListener('input', () => { work.date = date.value; });
    raw.addEventListener('input', () => { work.raw = raw.value; refresh(); });

    body.appendChild(h('div', { class: 'card stack' },
      h('div', { class: 'toolbar' },
        btn(t('trs_upload'), () => pickFile('.vtt,.txt,.docx,.html,.htm,.srt,.md', d => {
          work.raw = d.kind === 'doc' ? d.blocks.map(b => b.type === 'table' ? b.rows.map(r => r.join(' ')).join('\n') : b.text).join('\n') : d.text;
          work.source = d.name; if (!work.title) work.title = d.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
          raw.value = work.raw; title.value = work.title; refresh();
        }), { icon: 'upload', cls: 'primary' }),
        work.id ? chip(t('trs_editing', { name: work.title }), 'info') : null,
        h('span', { class: 'sp' }),
        work.raw ? btn(t('trs_new'), () => { work = { id: null, title: '', date: iso(new Date()), source: '', raw: '', summary: '', outLang: work.outLang }; paint(); }, { cls: 'ghost' }) : null),
      h('div', { class: 'hint' }, t('trs_upload_hint')),
      h('div', { class: 'grid-form' }, h('label', { class: 'field', for: 'trs-title' }, t('f_title'), title), h('label', { class: 'field', for: 'trs-date' }, t('f_date'), date)),
      h('label', { class: 'field', for: 'trs-raw' }, t('trs_raw'), raw)));
    body.appendChild(result);

    function refresh() {
      clear(result);
      if (!work.raw.trim()) { result.appendChild(emptyState(t('trs_empty'))); return; }
      const segs = parseTranscript(work.raw);
      const clean = cleanTranscript(segs, { fillers: ctx.settings.filler_words, glossary: glossary.map(g => g.data || {}) });
      work.cleaned = clean.text;
      const found = detectFeatures(clean.text, features);
      clean.wordsBefore = words(work.raw);
      const pct = clean.wordsBefore ? Math.max(0, Math.round((1 - clean.wordsAfter / clean.wordsBefore) * 100)) : 0;
      const speakers = [...new Set(clean.segments.map(s => s.speaker).filter(Boolean))];

      const cleanBox = h('div', { class: 'prose', style: { display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '420px', overflow: 'auto' } },
        clean.segments.map(s => h('p', { style: { margin: 0 } },
          s.speaker ? h('b', null, s.speaker + ': ') : null, s.lang === 'de' ? h('span', { class: 'chip' }, 'DE') : null, ' ',
          s.text.split(/(\u0001[^\u0002]*\u0002)/).map(part => part.startsWith('\u0001')
            ? h('mark', { title: t('trs_fixed_by_glossary') }, part.slice(1, -1)) : part))));
      result.appendChild(h('div', { class: 'kpis' },
        k(t('trs_k_before'), clean.wordsBefore), k(t('trs_k_after'), clean.wordsAfter), k(t('trs_k_saved'), pct + '%', 'ok'),
        k(t('trs_k_fixed'), clean.fixed), k(t('trs_k_speakers'), speakers.length)));
      result.appendChild(h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, t('trs_clean')),
        btn(t('copy'), () => copyText(clean.text), { icon: 'copy', cls: 'sm' })), cleanBox));
      result.appendChild(h('div', { class: 'card stack' }, h('h2', null, t('trs_detected')),
        found.length ? h('div', { class: 'pill-row' }, found.map(f => chip(`${f.key ? f.key + ' · ' : ''}${f.title}`, 'info'))) : h('div', { class: 'hint' }, t('trs_detected_none'))));

      const langSel = h('select', { 'aria-label': t('trs_out_lang'), onchange: e => { work.outLang = e.target.value; promptBox.textContent = prompt(); } },
        ['ro', 'en', 'de'].map(l => h('option', { value: l, selected: work.outLang === l }, LANG_NAME[l])));
      const prompt = () => `${String(ctx.settings.ai_prompt || '').replace('{language}', LANG_NAME[work.outLang])}\n\n---\n${clean.text}`;
      const promptBox = h('div', { class: 'pre' }, prompt());
      const summary = h('textarea', { id: 'trs-summary', rows: 8, value: work.summary || '', placeholder: t('trs_summary_ph') });
      summary.addEventListener('input', () => { work.summary = summary.value; });
      result.appendChild(h('div', { class: 'card stack' },
        h('div', { class: 'card-head' }, h('h2', null, t('trs_prompt')), h('div', { class: 'actions' }, langSel,
          btn(t('trs_copy_prompt'), () => copyText(prompt()), { icon: 'copy', cls: 'primary' }))),
        h('p', { class: 'hint', style: { margin: 0 } }, t('trs_prompt_hint', { n: clean.wordsAfter })), promptBox,
        h('label', { class: 'field', for: 'trs-summary' }, t('trs_summary'), summary),
        canWrite ? h('div', { class: 'actions' }, btn(work.id ? t('trs_update') : t('trs_save'), () => saveSession(found), { cls: 'primary' }),
          btn(t('trs_to_docs'), () => { store('docs.prefill', { title: work.title, summary: work.summary, cleaned: clean.text }); ctx.navigate('docs'); }, { icon: 'doc' })) : null));
    }
    refresh();
  }

  function k(label, v, kind) { return h('div', { class: 'kpi ' + (kind || '') }, h('div', { class: 'l' }, label), h('div', { class: 'v' }, v)); }

  async function saveSession(found) {
    if (!work.title.trim()) { toast(t('err_title_required'), 'bad'); return; }
    const record = { title: work.title.trim(), data: { date: work.date, source: work.source, raw: work.raw, cleaned: work.cleaned, summary: work.summary, features: found.map(f => f.key || f.title) } };
    try {
      const saved = work.id ? await ctx.api.update(work.id, record, work.version) : await ctx.api.create('transcripts', record);
      work.id = saved.id; work.version = saved.version;
      ctx.invalidate('transcripts', 'features'); toast(t('saved'));
      sessions = await ctx.records('transcripts', true); paint();
    } catch (e) { toast(e.message, 'bad'); }
  }

  // ----------------------------------------------------------- sessions
  function sessionList() {
    if (!sessions.length) { body.appendChild(emptyState(t('trs_no_sessions'))); return; }
    body.appendChild(h('div', { class: 'list card' }, sessions.slice().sort((a, b) => String(b.data?.date).localeCompare(String(a.data?.date))).map(s => h('div', { class: 'li' },
      h('div', { class: 'grow' }, h('b', null, s.title), h('div', { class: 'small muted' }, `${fmtDate(s.data?.date)} · ${s.data?.source || ''} · v${s.version}`),
        s.data?.features?.length ? h('div', { class: 'pill-row', style: { marginTop: '4px' } }, s.data.features.map(f => chip(f, 'info'))) : null),
      s.data?.summary ? chip(t('trs_has_summary'), 'ok') : chip(t('trs_no_summary'), 'warn'),
      btn(t('open'), () => { openSession(s); st.tab = 'process'; save(); paint(); }, { cls: 'sm' })))));
  }

  function openSession(s) {
    work = { id: s.id, version: s.version, title: s.title, date: s.data?.date || '', source: s.data?.source || '', raw: s.data?.raw || '', summary: s.data?.summary || '', outLang: work.outLang };
  }

  // ----------------------------------------------------------- glossary
  function glossaryList() {
    body.appendChild(h('div', { class: 'toolbar' }, h('p', { class: 'hint grow', style: { margin: 0 } }, t('trs_glossary_hint')),
      canWrite ? btn(t('add'), () => editTerm(null), { icon: 'plus' }) : null,
      canWrite ? btn(t('import'), importGlossary, { icon: 'upload' }) : null));
    if (!glossary.length) { body.appendChild(emptyState(t('no_items'))); return; }
    body.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 't' },
      h('thead', null, h('tr', null, h('th', null, t('trs_wrong')), h('th', null, t('trs_right')))),
      h('tbody', null, glossary.map(g => h('tr', { class: 'click', tabindex: '0', onclick: () => editTerm(g) }, h('td', { class: 'mono' }, g.data?.wrong), h('td', null, g.data?.right)))))));
  }

  function editTerm(g) {
    openEditor({
      ctx, section: 'glossary', record: g,
      fields: [{ key: 'data.wrong', label: t('trs_wrong'), hint: t('trs_wrong_hint') }, { key: 'data.right', label: t('trs_right') }],
      defaults: { title: '-' },
      onSaved: async rec => {
        if (rec && rec.data?.wrong && rec.title !== rec.data.wrong) await ctx.api.update(rec.id, { title: rec.data.wrong, key: rec.data.wrong.toLowerCase() });
        ctx.invalidate('glossary'); load(true);
      },
    });
  }

  function importGlossary() {
    openImport({
      api: ctx.api, section: 'glossary', title: t('trs_t_glossary'), accept: '.xlsx,.csv',
      fields: [{ key: 'wrong', label: t('trs_wrong'), required: true, aliases: ['wrong', 'auzit', 'falsch', 'gresit', 'heard', 'recognized'] },
        { key: 'right', label: t('trs_right'), required: true, aliases: ['right', 'correct', 'richtig', 'corect', 'term'] }],
      toRecord: m => String(m.wrong).trim() && String(m.right).trim() ? { key: String(m.wrong).trim().toLowerCase(), title: String(m.wrong).trim(), data: { wrong: String(m.wrong).trim(), right: String(m.right).trim() } } : null,
      previewCols: [['data.wrong', t('trs_wrong')], ['data.right', t('trs_right')]],
      onDone: () => { ctx.invalidate('glossary'); load(true); },
    });
  }

  await load();
}
