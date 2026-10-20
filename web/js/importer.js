// Generic upload dialog: pick file → map columns → preview → import (append / update by key / replace).
import { t } from './i18n.js';
import { guessColumn, readFile, sheetToObjects } from './parsers.js';
import { btn, clear, h, modal, toast } from './util.js';

/**
 * opts: { title, section, accept, hint, fields: [{key, label, aliases, required}],
 *         toRecord(mapped, raw) -> record|null, fromDoc(fileData) -> records[], collect(records, file) -> records[],
 *         summary(records) -> Node, modes, defaultMode, api, onDone(result, records) }
 */
export function openImport(opts) {
  let fileData = null, sheetIdx = 0, mapping = {}, mode = opts.defaultMode || 'upsert', table = null;
  const status = h('div', { class: 'hint' });
  const work = h('div', { class: 'stack' });
  const input = h('input', { type: 'file', accept: opts.accept, hidden: true, onchange: () => input.files[0] && load(input.files[0]) });
  const drop = h('div', { class: 'drop', tabindex: '0', role: 'button', onclick: () => input.click(),
    onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } } },
    h('div', null, h('b', null, t('import_choose'))), h('div', { class: 'hint' }, opts.hint || opts.accept));
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) load(e.dataTransfer.files[0]); });
  const importBtn = btn(t('import_do'), doImport, { cls: 'primary', icon: 'upload', disabled: true });

  async function load(file) {
    status.textContent = t('reading') + ' ' + file.name + '…';
    try {
      fileData = await readFile(file);
      sheetIdx = 0;
      if (fileData.kind === 'table') {
        const best = fileData.sheets.findIndex(s => s.rows.length > 1);
        sheetIdx = best < 0 ? 0 : best;
        prepareTable();
      } else if (!opts.fromDoc) {
        throw new Error(t('import_need_table'));
      }
      status.textContent = file.name;
      render();
    } catch (e) {
      status.textContent = '';
      toast(e.message, 'bad');
    }
  }

  function prepareTable() {
    table = sheetToObjects(fileData.sheets[sheetIdx]?.rows || []);
    mapping = {};
    for (const f of opts.fields) mapping[f.key] = guessColumn(table.headers, [f.label, f.key, ...(f.aliases || [])]);
  }

  function mapped() {
    if (fileData?.kind !== 'table') return opts.fromDoc ? opts.fromDoc(fileData) : [];
    return table.rows.map(raw => {
      const m = {};
      for (const f of opts.fields) m[f.key] = mapping[f.key] ? raw[mapping[f.key]] : '';
      return opts.toRecord(m, raw);
    }).filter(Boolean);
  }

  const finalRecords = () => (opts.collect ? opts.collect(mapped(), fileData) : mapped());

  function render() {
    clear(work);
    if (!fileData) return;
    if (fileData.kind === 'table') {
      if (fileData.sheets.length > 1) {
        work.appendChild(h('label', { class: 'field' }, t('import_sheet'),
          h('select', { onchange: e => { sheetIdx = +e.target.value; prepareTable(); render(); } },
            fileData.sheets.map((s, i) => h('option', { value: i, selected: i === sheetIdx }, `${s.name} (${s.rows.length})`)))));
      }
      work.appendChild(h('h3', null, t('import_mapping')));
      work.appendChild(h('div', { class: 'map-grid' }, opts.fields.map(f =>
        h('label', { class: 'field' }, f.label + (f.required ? ' *' : ''),
          h('select', { onchange: e => { mapping[f.key] = e.target.value; renderPreview(); } },
            h('option', { value: '' }, '—'),
            table.headers.map(hd => h('option', { value: hd, selected: mapping[f.key] === hd }, hd)))))));
    }
    const modes = opts.modes || ['upsert', 'append', 'replace'];
    work.appendChild(h('div', { class: 'stack' }, h('h3', null, t('import_mode')),
      h('div', { class: 'pill-row' }, modes.map(m => h('label', { class: 'check' },
        h('input', { type: 'radio', name: 'imp-mode', value: m, checked: m === mode, onchange: () => { mode = m; } }), t('mode_' + m)))),
      h('div', { class: 'hint' }, t('import_mode_hint'))));
    work.appendChild(previewBox);
    renderPreview();
  }

  const previewBox = h('div', { class: 'stack' });
  function renderPreview() {
    clear(previewBox);
    const recs = finalRecords();
    const missing = opts.fields.filter(f => f.required && fileData?.kind === 'table' && !mapping[f.key]);
    importBtn.disabled = !recs.length || missing.length > 0;
    previewBox.appendChild(h('h3', null, t('import_preview', { n: recs.length })));
    if (missing.length) previewBox.appendChild(h('div', { class: 'chip warn' }, t('import_missing') + ': ' + missing.map(f => f.label).join(', ')));
    if (!recs.length) { previewBox.appendChild(h('div', { class: 'hint' }, t('import_nothing'))); return; }
    if (opts.summary) previewBox.appendChild(opts.summary(recs));
    const cols = opts.previewCols || [['key', t('f_key')], ['title', t('f_title')], ['kind', t('f_type')]];
    previewBox.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 't' },
      h('thead', null, h('tr', null, cols.map(([, l]) => h('th', null, l)))),
      h('tbody', null, recs.slice(0, 8).map(r => h('tr', null, cols.map(([k]) => {
        const v = k.startsWith('data.') ? r.data?.[k.slice(5)] : r[k];
        return h('td', null, String(v ?? '').slice(0, 120));
      })))))));
    if (recs.length > 8) previewBox.appendChild(h('div', { class: 'hint' }, t('import_more', { n: recs.length - 8 })));
  }

  async function doImport() {
    const recs = finalRecords();
    importBtn.disabled = true;
    try {
      const res = await opts.api.importRecords(opts.section, fileData.name, recs, mode);
      toast(t('import_done', res));
      close();
      opts.onDone && opts.onDone(res, recs, fileData);
    } catch (e) {
      toast(e.message, 'bad');
      importBtn.disabled = false;
    }
  }

  const close = modal({
    title: opts.title, wide: true,
    body: [drop, input, status, work],
    footer: c => [btn(t('cancel'), c), importBtn],
  });
}

/** Ask for one file and hand back its parsed content (for flows that are not record imports). */
export function pickFile(accept, onData) {
  const input = h('input', { type: 'file', accept, hidden: true });
  input.addEventListener('change', async () => {
    const f = input.files[0]; if (!f) return;
    try { onData(await readFile(f)); } catch (e) { toast(e.message, 'bad'); }
    input.remove();
  });
  document.body.appendChild(input);
  input.click();
}
