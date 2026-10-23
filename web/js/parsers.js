// File readers for uploads: .xlsx/.xlsm, .csv/.tsv, .docx, .vtt, .txt/.md, .html/.htm.
// No external libraries: Office files are ZIP archives of XML, unpacked with the browser's DecompressionStream.
import { iso } from './util.js';

// ------------------------------------------------------------------- zip
async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot unpack Office files (DecompressionStream missing). Use a current Edge/Chrome/Firefox or save as CSV.');
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function unzip(buffer) {
  const u8 = new Uint8Array(buffer);
  const dv = new DataView(buffer);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a valid Office file (zip directory not found).');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = {};
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    files[name] = { method, csize, local };
    p += 46 + nlen + xlen + clen;
  }
  return {
    names: Object.keys(files),
    async bytes(name) {
      const f = files[name] || files[Object.keys(files).find(k => k.toLowerCase() === name.toLowerCase())];
      if (!f) return null;
      const lnlen = dv.getUint16(f.local + 26, true), lxlen = dv.getUint16(f.local + 28, true);
      const start = f.local + 30 + lnlen + lxlen;
      const data = u8.subarray(start, start + f.csize);
      return f.method === 0 ? data.slice() : inflateRaw(data);
    },
    async text(name) {
      const raw = await this.bytes(name);
      return raw === null ? null : new TextDecoder('utf-8').decode(raw);
    },
  };
}

const xml = s => new DOMParser().parseFromString(s, 'application/xml');
const byTag = (node, tag) => Array.from(node.getElementsByTagName(tag));
const local = (node, name) => Array.from(node.getElementsByTagNameNS('*', name));

// ------------------------------------------------------------------ xlsx
const DATE_FMT_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

function colIndex(ref) {
  const letters = /^[A-Z]+/.exec(ref)?.[0] || 'A';
  let n = 0; for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

function serialToIso(n) {
  const ms = Date.UTC(1899, 11, 30) + Math.round(n * 86400000);
  const d = new Date(ms);
  return iso(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export async function readXlsx(buffer) {
  const zip = await unzip(buffer);
  const wb = xml(await zip.text('xl/workbook.xml'));
  const rels = xml((await zip.text('xl/_rels/workbook.xml.rels')) || '<r/>');
  const relMap = {};
  for (const r of local(rels, 'Relationship')) relMap[r.getAttribute('Id')] = r.getAttribute('Target');
  const shared = [];
  const ssText = await zip.text('xl/sharedStrings.xml');
  if (ssText) for (const si of local(xml(ssText), 'si')) shared.push(local(si, 't').map(t => t.textContent).join(''));
  const dateStyles = new Set();
  const stText = await zip.text('xl/styles.xml');
  if (stText) {
    const st = xml(stText);
    const custom = {};
    for (const f of local(st, 'numFmt')) custom[+f.getAttribute('numFmtId')] = f.getAttribute('formatCode') || '';
    const cellXfs = local(st, 'cellXfs')[0];
    if (cellXfs) local(cellXfs, 'xf').forEach((xf, i) => {
      const id = +xf.getAttribute('numFmtId');
      const code = (custom[id] || '').replace(/"[^"]*"|\[[^\]]*\]/g, '');
      if (DATE_FMT_IDS.has(id) || (code && /[dy]/i.test(code) && !/0\.0/.test(code))) dateStyles.add(i);
    });
  }
  const sheets = [];
  for (const s of local(wb, 'sheet')) {
    const rid = s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    let target = relMap[rid] || '';
    target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    const txt = await zip.text(target);
    if (!txt) continue;
    const doc = xml(txt);
    const rows = [];
    for (const row of local(doc, 'row')) {
      const r = +row.getAttribute('r') - 1;
      const arr = [];
      for (const c of local(row, 'c')) {
        const ci = colIndex(c.getAttribute('r') || 'A');
        const type = c.getAttribute('t');
        const v = local(c, 'v')[0]?.textContent;
        let val = '';
        if (type === 's') val = shared[+v] ?? '';
        else if (type === 'inlineStr') val = local(c, 't').map(t => t.textContent).join('');
        else if (type === 'b') val = v === '1';
        else if (type === 'str' || type === 'e') val = v ?? '';
        else if (v !== undefined) {
          const num = Number(v);
          val = dateStyles.has(+c.getAttribute('s')) && !isNaN(num) ? serialToIso(num) : num;
        }
        arr[ci] = val;
      }
      rows[isNaN(r) ? rows.length : r] = Array.from(arr, x => x ?? '');
    }
    sheets.push({ name: s.getAttribute('name'), rows: rows.filter(Boolean) });
  }
  return sheets;
}

// ------------------------------------------------------------------- csv
export function parseCsv(text) {
  const first = text.split(/\r?\n/, 1)[0] || '';
  const delim = [';', '\t', ',', '|'].map(d => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += ch;
    } else if (ch === '"' && field === '') q = true;
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ''));
}

// ------------------------------------------------------------------ docx
export async function readDocx(buffer) {
  const zip = await unzip(buffer);
  const doc = xml(await zip.text('word/document.xml'));
  const stylesTxt = await zip.text('word/styles.xml');
  const styleNames = {};
  if (stylesTxt) for (const s of local(xml(stylesTxt), 'style')) {
    const id = s.getAttribute('w:styleId'); const name = local(s, 'name')[0]?.getAttribute('w:val');
    if (id) styleNames[id] = name || id;
  }
  const body = local(doc, 'body')[0];
  const blocks = [];
  const paraText = p => {
    let out = '';
    const walk = n => {
      for (const c of n.childNodes) {
        if (c.nodeType !== 1) continue;
        const ln = c.localName;
        if (ln === 't') out += c.textContent;
        else if (ln === 'tab') out += '\t';
        else if (ln === 'br' || ln === 'cr') out += '\n';
        else if (ln !== 'instrText' && ln !== 'delText') walk(c);
      }
    };
    walk(p); return out;
  };
  for (const node of Array.from(body?.childNodes || [])) {
    if (node.nodeType !== 1) continue;
    if (node.localName === 'p') {
      const text = paraText(node);
      const styleId = local(node, 'pStyle')[0]?.getAttribute('w:val') || '';
      const styleName = styleNames[styleId] || styleId;
      const hm = /(heading|berschrift|titlu|title|titre)\s*(\d)?/i.exec(styleName) || /(heading|berschrift|titlu)(\d)/i.exec(styleId);
      const isList = local(node, 'numPr').length > 0 || /list/i.test(styleName);
      if (!text.trim()) continue;
      if (hm) blocks.push({ type: 'h', level: +(hm[2] || 1) || 1, text: text.trim() });
      else blocks.push({ type: 'p', text, list: isList });
    } else if (node.localName === 'tbl') {
      const rows = local(node, 'tr').map(tr => local(tr, 'tc').map(tc => local(tc, 'p').map(paraText).join('\n').trim()));
      blocks.push({ type: 'table', rows });
    }
  }
  const text = blocks.map(b => b.type === 'table' ? b.rows.map(r => r.join('\t')).join('\n') : (b.list ? '- ' : '') + b.text).join('\n');
  return { blocks, text };
}

// ------------------------------------------------------------ html / text
export function readHtml(text) {
  const d = new DOMParser().parseFromString(text, 'text/html');
  const blocks = [];
  d.body.querySelectorAll('h1,h2,h3,h4,p,li,table,pre').forEach(el => {
    if (el.closest('table') && el.tagName !== 'TABLE') return;
    const tag = el.tagName.toLowerCase();
    if (tag === 'table') blocks.push({ type: 'table', rows: Array.from(el.rows).map(r => Array.from(r.cells).map(c => c.innerText.trim())) });
    else if (/h\d/.test(tag)) blocks.push({ type: 'h', level: +tag[1], text: el.textContent.trim() });
    else if (el.textContent.trim()) blocks.push({ type: 'p', text: el.textContent.trim(), list: tag === 'li' });
  });
  if (!blocks.length) blocks.push({ type: 'p', text: d.body.innerText || '' });
  return { blocks, text: blocks.map(b => b.type === 'table' ? b.rows.map(r => r.join('\t')).join('\n') : b.text).join('\n') };
}

async function decodeText(buffer) {
  const utf = new TextDecoder('utf-8').decode(buffer);
  if (!utf.includes(String.fromCharCode(0xFFFD))) return utf.replace(/^\uFEFF/, '');
  return new TextDecoder('windows-1252').decode(buffer);
}

/** Read any supported upload into one of: {kind:'table', sheets}, {kind:'doc', blocks, text}, {kind:'text', text}. */
export async function readFile(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const buffer = await file.arrayBuffer();
  if (['xlsx', 'xlsm'].includes(ext)) return { name: file.name, ext, kind: 'table', sheets: await readXlsx(buffer) };
  if (ext === 'xls') throw new Error('Old .xls format: open it in Excel and save as .xlsx or .csv.');
  if (['csv', 'tsv'].includes(ext)) return { name: file.name, ext, kind: 'table', sheets: [{ name: file.name, rows: parseCsv(await decodeText(buffer)) }] };
  if (ext === 'docx') return { name: file.name, ext, kind: 'doc', ...(await readDocx(buffer)) };
  if (ext === 'doc') throw new Error('Old .doc format: open it in Word and save as .docx.');
  if (['html', 'htm'].includes(ext)) return { name: file.name, ext, kind: 'doc', ...readHtml(await decodeText(buffer)) };
  if (['txt', 'md', 'vtt', 'srt', 'log', 'json'].includes(ext)) return { name: file.name, ext, kind: 'text', text: await decodeText(buffer) };
  throw new Error(`Unsupported file type .${ext}`);
}

/** First non-empty row becomes the header; returns {headers, rows:[{header: value}]} */
export function sheetToObjects(rows) {
  // Exports often carry a title line ("Error Report") above the real header: take the first row that is
  // nearly as wide as the widest of the first rows.
  const filled = r => (r || []).filter(c => String(c ?? '').trim() !== '').length;
  const widest = Math.max(0, ...rows.slice(0, 15).map(filled));
  const start = rows.findIndex(r => filled(r) >= Math.max(Math.min(2, widest), Math.ceil(widest * 0.6)));
  if (start < 0) return { headers: [], rows: [] };
  const headers = rows[start].map((h, i) => String(h).trim() || `Col ${i + 1}`);
  const out = rows.slice(start + 1).map(r => Object.fromEntries(headers.map((hd, i) => [hd, r[i] ?? ''])))
    .filter(o => Object.values(o).some(v => String(v).trim() !== ''));
  return { headers, rows: out };
}

/** Pick the header that best matches a list of aliases (case and accent insensitive). */
export function guessColumn(headers, aliases) {
  const n = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  const hs = headers.map(h => [h, n(h)]);
  for (const a of aliases) { const x = hs.find(([, nh]) => nh === n(a)); if (x) return x[0]; }
  for (const a of aliases) { const x = hs.find(([, nh]) => n(a).length > 2 && nh.includes(n(a))); if (x) return x[0]; }
  return '';
}
