// Regression test specification: data model, HTML clean-up, Word (.docx) export and import.
// The layout follows the team's specification documents: header (product + document type, name,
// department, date), title page, table of contents, numbered heading levels with text and
// screenshots, footer with classification and "page X of Y". No external libraries.
import { tIn } from './i18n.js';
import { unzip } from './parsers.js';
import { zip } from './zipwrite.js';

export const SPEC_FORMAT = 'regspec';
const EMU_PER_PX = 9525;              // 96 dpi
const TEXT_WIDTH_TW = 9355;           // A4 minus 2.5 cm left / 2 cm right margins, in twips
const TEXT_WIDTH_PX = Math.round(TEXT_WIDTH_TW / 15);

const uidS = () => 's' + Math.random().toString(36).slice(2, 9);

// ----------------------------------------------------------------- model
export function defaultSections(lang) {
  const L = k => tIn(lang, k);
  const login = `<p>${esc(L('dx_login'))} <b><span style="color:#E00000">&lt;user&gt;</span></b></p>`;
  return [
    { id: uidS(), level: 1, title: L('dx_s_short'), html: '', newPage: true },
    { id: uidS(), level: 2, title: L('dx_s_source'), html: '', newPage: false },
    { id: uidS(), level: 1, title: L('dx_s_prep'), html: login, newPage: true },
    { id: uidS(), level: 2, title: L('dx_s_prep_item'), html: '', newPage: false },
    { id: uidS(), level: 1, title: L('dx_s_spec'), html: login, newPage: true },
    { id: uidS(), level: 2, title: L('dx_s_check'), html: '', newPage: false },
    { id: uidS(), level: 3, title: L('dx_s_check_sub'), html: '', newPage: false },
  ];
}

/** A new specification; `base` is a saved default structure (header values + section titles). */
export function newSpec(lang = 'de', base = null) {
  const spec = {
    format: SPEC_FORMAT, lang,
    header: { product: '', name: '', department: '', date: '' },
    story: '', title: '', path: '', package: '', classification: tIn(lang, 'dx_class'),
    sections: defaultSections(lang),
  };
  if (base) {
    spec.lang = base.lang || lang;
    spec.header = { ...spec.header, product: base.header?.product || '', department: base.header?.department || '' };
    spec.path = base.path || '';
    spec.classification = base.classification || tIn(spec.lang, 'dx_class');
    if (Array.isArray(base.sections) && base.sections.length)
      spec.sections = base.sections.map(s => ({ id: uidS(), level: s.level || 1, title: s.title || '', html: s.html || '', newPage: !!s.newPage }));
  }
  return spec;
}

/** The structure kept as default for new documents: no user story specific text. */
export function structureOf(spec) {
  return {
    lang: spec.lang, header: { product: spec.header.product, department: spec.header.department },
    path: spec.path, classification: spec.classification,
    sections: spec.sections.map(s => ({ level: s.level, title: s.title, newPage: s.newPage, html: '' })),
  };
}

export function specFileName(spec) {
  const base = [spec.title || 'specification', spec.story && !String(spec.title).includes(spec.story) ? spec.story : ''].filter(Boolean).join(' -');
  return base.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 150) + '.docx';
}

export function specText(spec) {
  const out = [spec.title, spec.story, spec.path, ''];
  for (const s of spec.sections) {
    out.push(`${'#'.repeat(s.level)} ${s.title}`);
    const d = document.createElement('div'); d.innerHTML = s.html || '';
    out.push(d.innerText || d.textContent || '', '');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function countImages(spec) {
  return spec.sections.reduce((n, s) => n + ((s.html || '').match(/<img\b/gi) || []).length, 0);
}

// ------------------------------------------------------------ html clean
function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

const KEEP = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'SPAN', 'UL', 'OL', 'LI', 'IMG', 'TABLE', 'TBODY', 'THEAD', 'TR', 'TD', 'TH', 'A']);
const BLOCKISH = new Set(['DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'BLOCKQUOTE', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER']);

function cssColor(v) {
  const m = /^\s*rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i.exec(v || '');
  if (m) return '#' + [m[1], m[2], m[3]].map(x => (+x).toString(16).padStart(2, '0')).join('').toUpperCase();
  const h = /^\s*#([0-9a-f]{3}|[0-9a-f]{6})\s*$/i.exec(v || '');
  if (!h) return '';
  const x = h[1].length === 3 ? h[1].split('').map(c => c + c).join('') : h[1];
  return '#' + x.toUpperCase();
}

/** Keeps only what the Word export understands; everything else is unwrapped to its text. */
export function cleanHtml(html) {
  const doc = new DOMParser().parseFromString(`<div>${html || ''}</div>`, 'text/html');
  const out = document.createElement('div');
  const walk = (src, dst) => {
    for (const n of Array.from(src.childNodes)) {
      if (n.nodeType === 3) { dst.appendChild(document.createTextNode(n.nodeValue.replace(/ /g, ' '))); continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'META' || tag === 'LINK' || tag === 'TITLE') continue;
      const fw = n.style?.fontWeight, fs = n.style?.fontStyle, td = n.style?.textDecoration || n.style?.textDecorationLine || '';
      const color = cssColor(n.style?.color || n.getAttribute('color'));
      if (tag === 'IMG') {
        const src = n.getAttribute('src') || '';
        if (!/^data:image\/(png|jpe?g|gif|webp|bmp);base64,/i.test(src) && !/^\/api\/att\/[0-9a-f]{64}$/.test(src)) continue;
        const img = document.createElement('img');
        img.setAttribute('src', src);
        const w = parseInt(n.getAttribute('width') || n.style?.width, 10);
        if (w > 0) img.setAttribute('width', String(Math.min(w, TEXT_WIDTH_PX)));
        dst.appendChild(img);
        continue;
      }
      let el;
      if (KEEP.has(tag)) {
        el = document.createElement(tag === 'STRONG' ? 'b' : tag === 'EM' ? 'i' : tag === 'TH' ? 'td' : tag.toLowerCase());
        if (tag === 'A') { const href = n.getAttribute('href') || ''; if (/^(https?:|mailto:|file:)/i.test(href)) el.setAttribute('href', href); }
        if (tag === 'SPAN' || tag === 'TD' || tag === 'P' || tag === 'LI') { /* style handled below */ }
      } else if (BLOCKISH.has(tag)) {
        el = document.createElement('p');
        if (/^H\d$/.test(tag)) { const b = document.createElement('b'); el.appendChild(b); walk(n, b); dst.appendChild(el); continue; }
      } else if (tag === 'FONT') {
        el = document.createElement('span');
      } else { walk(n, dst); continue; }
      // inline formatting coming from pasted Word/Outlook html
      let target = el;
      const wrap = t => { const w = document.createElement(t); target.appendChild(w); target = w; };
      if ((fw === 'bold' || +fw >= 600) && !['B'].includes(tag)) wrap('b');
      if (fs === 'italic' && tag !== 'I' && tag !== 'EM') wrap('i');
      if (/underline/.test(td) && tag !== 'U') wrap('u');
      if (color && color !== '#000000') {
        if (el.tagName === 'SPAN' && target === el) el.setAttribute('style', `color:${color}`);
        else { const sp = document.createElement('span'); sp.setAttribute('style', `color:${color}`); target.appendChild(sp); target = sp; }
      }
      walk(n, target);
      if (el.tagName === 'SPAN' && !el.getAttribute('style') && target === el) { while (el.firstChild) dst.appendChild(el.firstChild); continue; }
      dst.appendChild(el);
    }
  };
  walk(doc.body.firstElementChild, out);
  // drop empty trailing paragraphs that contenteditable leaves behind
  while (out.lastChild && out.lastChild.nodeType === 1 && out.lastChild.tagName === 'P' && !out.lastChild.textContent.trim() && !out.lastChild.querySelector('img')) out.lastChild.remove();
  return out.innerHTML;
}

// ------------------------------------------------------------- docx out
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
  + 'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
  + 'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

// strip characters XML 1.0 does not allow
const x = s => esc(String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, ''));

function run(text, f = {}) {
  const props = [
    f.font ? `<w:rFonts w:ascii="${f.font}" w:hAnsi="${f.font}" w:cs="${f.font}"/>` : '',
    f.b ? '<w:b/><w:bCs/>' : '', f.i ? '<w:i/><w:iCs/>' : '',
    f.color ? `<w:color w:val="${f.color.replace('#', '')}"/>` : '',
    f.sz ? `<w:sz w:val="${f.sz}"/><w:szCs w:val="${f.sz}"/>` : '',
    f.u ? '<w:u w:val="single"/>' : '',
  ].join('');
  const parts = String(text).split('\n');
  return parts.map((p, i) => `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${x(p)}</w:t></w:r>`).join('');
}

function para(inner, p = {}) {
  const props = [
    p.style ? `<w:pStyle w:val="${p.style}"/>` : '',
    p.keepNext ? '<w:keepNext/>' : '',
    p.pageBreakBefore ? '<w:pageBreakBefore/>' : '',
    p.num ? `<w:numPr><w:ilvl w:val="${p.num.lvl}"/><w:numId w:val="${p.num.id}"/></w:numPr>` : '',
    p.spacing || '',
    p.jc ? `<w:jc w:val="${p.jc}"/>` : '',
  ].join('');
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${inner}</w:p>`;
}

/** A stored image (/api/att/<id>, sent with the session cookie) as a data URL. */
export async function fetchDataUrl(src) {
  const res = await fetch(src, { credentials: 'same-origin' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const blob = await res.blob();
  return new Promise((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.onerror = () => reject(fr.error); fr.readAsDataURL(blob); });
}

function dataUrlBytes(src) {
  const m = /^data:image\/([a-z+]+);base64,(.*)$/i.exec(src || '');
  if (!m) return null;
  const bin = atob(m[2]);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return { ext: m[1].toLowerCase().replace('jpeg', 'jpg'), bytes: u8 };
}

async function imageSize(src) {
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    return { w: img.naturalWidth || 400, h: img.naturalHeight || 300 };
  } catch { return { w: 400, h: 300 }; }
}

// Word accepts png, jpeg, gif, bmp directly; anything else is converted to png first
async function toWordImage(src) {
  if (/^\/api\/att\//.test(src)) { try { src = await fetchDataUrl(src); } catch { return null; } }
  let d = dataUrlBytes(src);
  if (!d) return null;
  if (!['png', 'jpg', 'gif', 'bmp'].includes(d.ext)) {
    try {
      const img = new Image(); img.src = src; await img.decode();
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      d = dataUrlBytes(c.toDataURL('image/png'));
    } catch { return null; }
  }
  return d;
}

class DocxBuilder {
  constructor() { this.media = []; this.rels = []; this.nums = []; this.docPr = 1; }

  rel(type, target) {
    const id = 'rId' + (100 + this.rels.length);
    this.rels.push({ id, type, target });
    return id;
  }

  async image(src, widthAttr) {
    const d = await toWordImage(src);
    if (!d) return '';
    const size = await imageSize(src);
    let w = widthAttr > 0 ? widthAttr : size.w;
    w = Math.min(w, TEXT_WIDTH_PX);
    const h = Math.round(w * size.h / size.w);
    const n = this.media.length + 1;
    const name = `media/image${n}.${d.ext}`;
    this.media.push({ name: 'word/' + name, bytes: d.bytes, ext: d.ext });
    const rid = this.rel('http://schemas.openxmlformats.org/officeDocument/2006/relationships/image', name);
    const cx = w * EMU_PER_PX, cy = h * EMU_PER_PX, id = this.docPr++;
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Picture ${id}"/>`
      + '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>'
      + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>'
      + `<pic:nvPicPr><pic:cNvPr id="${id}" name="image${n}.${d.ext}"/><pic:cNvPicPr/></pic:nvPicPr>`
      + `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
      + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>`
      + '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  }

  newList(ordered) {
    const id = this.nums.length + 1;
    this.nums.push({ id, ordered });
    return id;
  }

  // inline content of one block element -> runs
  async inline(node, f = {}) {
    let out = '';
    for (const n of Array.from(node.childNodes)) {
      if (n.nodeType === 3) { if (n.nodeValue) out += run(n.nodeValue.replace(/\s+/g, ' '), f); continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName;
      if (tag === 'BR') out += '<w:r><w:br/></w:r>';
      else if (tag === 'IMG') out += await this.image(n.getAttribute('src'), parseInt(n.getAttribute('width'), 10));
      else if (tag === 'B' || tag === 'STRONG') out += await this.inline(n, { ...f, b: true });
      else if (tag === 'I' || tag === 'EM') out += await this.inline(n, { ...f, i: true });
      else if (tag === 'U') out += await this.inline(n, { ...f, u: true });
      else if (tag === 'A') out += await this.inline(n, { ...f, u: true, color: f.color || '#0563C1' });
      else if (tag === 'SPAN') out += await this.inline(n, { ...f, color: cssColor(n.style.color) || f.color });
      else out += await this.inline(n, f);
    }
    return out;
  }

  async list(el, lvl, numId) {
    let out = '';
    for (const li of Array.from(el.children)) {
      if (li.tagName !== 'LI') continue;
      const nested = Array.from(li.children).filter(c => c.tagName === 'UL' || c.tagName === 'OL');
      const clone = li.cloneNode(true);
      clone.querySelectorAll(':scope > ul, :scope > ol').forEach(c => c.remove());
      out += para(await this.inline(clone), { style: 'ListParagraph', num: { id: numId, lvl: Math.min(lvl, 8) } });
      for (const sub of nested) out += await this.list(sub, lvl + 1, this.newList(sub.tagName === 'OL'));
    }
    return out;
  }

  async table(el) {
    const rows = Array.from(el.querySelectorAll(':scope > tr, :scope > tbody > tr, :scope > thead > tr'));
    const cols = Math.max(1, ...rows.map(r => r.children.length));
    const cw = Math.floor(TEXT_WIDTH_TW / cols);
    const b = 'w:val="single" w:sz="4" w:space="0" w:color="808080"';
    let out = `<w:tbl><w:tblPr><w:tblW w:w="${cw * cols}" w:type="dxa"/><w:tblBorders><w:top ${b}/><w:left ${b}/><w:bottom ${b}/><w:right ${b}/><w:insideH ${b}/><w:insideV ${b}/></w:tblBorders><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>`;
    for (let i = 0; i < cols; i++) out += `<w:gridCol w:w="${cw}"/>`;
    out += '</w:tblGrid>';
    for (const r of rows) {
      out += '<w:tr>';
      const cells = Array.from(r.children);
      for (let i = 0; i < cols; i++) {
        const c = cells[i];
        const inner = c ? await this.blocks(c) : '';
        out += `<w:tc><w:tcPr><w:tcW w:w="${cw}" w:type="dxa"/></w:tcPr>${inner || '<w:p/>'}</w:tc>`;
      }
      out += '</w:tr>';
    }
    return out + '</w:tbl><w:p/>';
  }

  // block content (section body or table cell) -> paragraphs
  async blocks(container) {
    let out = '', loose = document.createElement('p');
    const flush = async () => {
      if (loose.childNodes.length && (loose.textContent.trim() || loose.querySelector('img'))) out += para(await this.inline(loose));
      loose = document.createElement('p');
    };
    for (const n of Array.from(container.childNodes)) {
      const tag = n.nodeType === 1 ? n.tagName : '';
      if (tag === 'P' || tag === 'DIV') { await flush(); out += para(await this.inline(n)); }
      else if (tag === 'UL' || tag === 'OL') { await flush(); out += await this.list(n, 0, this.newList(tag === 'OL')); }
      else if (tag === 'TABLE') { await flush(); out += await this.table(n); }
      else loose.appendChild(n.cloneNode(true));
    }
    await flush();
    return out;
  }
}

function stylesXml() {
  const heading = (lvl, sz) => `<w:style w:type="paragraph" w:styleId="Heading${lvl}"><w:name w:val="heading ${lvl}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/>`
    + `<w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${lvl === 1 ? 120 : 240}" w:after="120"/><w:outlineLvl w:val="${lvl - 1}"/></w:pPr>`
    + `<w:rPr><w:rFonts w:ascii="Arial Black" w:hAnsi="Arial Black" w:cs="Arial"/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr></w:style>`;
  const toc = (lvl) => `<w:style w:type="paragraph" w:styleId="TOC${lvl}"><w:name w:val="toc ${lvl}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="39"/>`
    + `<w:pPr><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="${TEXT_WIDTH_TW}"/></w:tabs><w:spacing w:after="60"/><w:ind w:left="${(lvl - 1) * 220}"/></w:pPr></w:style>`;
  return XML_HEAD + `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">`
    + '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="de-DE" w:eastAsia="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>'
    + '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
    + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
    + '<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/></w:style>'
    + heading(1, 28) + heading(2, 24) + heading(3, 20)
    + '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="240" w:after="480"/><w:jc w:val="center"/></w:pPr><w:rPr><w:rFonts w:ascii="Cambria" w:hAnsi="Cambria" w:cs="Cambria"/><w:sz w:val="48"/><w:szCs w:val="48"/></w:rPr></w:style>'
    + '<w:style w:type="paragraph" w:styleId="CoverLabel"><w:name w:val="Cover Label"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="360" w:after="240"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial Black" w:hAnsi="Arial Black" w:cs="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style>'
    + '<w:style w:type="paragraph" w:styleId="PackageTitle"><w:name w:val="Package Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="360" w:after="240"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:b/><w:bCs/><w:sz w:val="56"/><w:szCs w:val="56"/></w:rPr></w:style>'
    + '<w:style w:type="paragraph" w:styleId="TOCHeading"><w:name w:val="TOC Heading"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial Black" w:hAnsi="Arial Black" w:cs="Arial"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>'
    + toc(1) + toc(2) + toc(3)
    + '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="34"/><w:qFormat/><w:pPr><w:spacing w:after="60"/><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>'
    + '<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/><w:pPr><w:tabs><w:tab w:val="right" w:pos="' + TEXT_WIDTH_TW + '"/></w:tabs><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr></w:style>'
    + '<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr><w:rPr><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr></w:style>'
    + '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:semiHidden/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>'
    + '</w:styles>';
}

function numberingXml(nums) {
  const lvls = ordered => Array.from({ length: 9 }, (_, i) => {
    const fmt = ordered ? ['decimal', 'lowerLetter', 'lowerRoman'][i % 3] : 'bullet';
    const text = ordered ? `%${i + 1}.` : ['•', '◦', '▪'][i % 3];
    return `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 + i * 360}" w:hanging="360"/></w:pPr>`
      + (ordered ? '' : '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/></w:rPr>') + '</w:lvl>';
  }).join('');
  return XML_HEAD + '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + `<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${lvls(false)}</w:abstractNum>`
    + `<w:abstractNum w:abstractNumId="2"><w:multiLevelType w:val="hybridMultilevel"/>${lvls(true)}</w:abstractNum>`
    + nums.map(n => `<w:num w:numId="${n.id}"><w:abstractNumId w:val="${n.ordered ? 2 : 1}"/>`
      + (n.ordered ? '<w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride>' : '') + '</w:num>').join('')
    + '</w:numbering>';
}

function headerXml(spec, L) {
  const h = spec.header;
  const first = [h.product, L('dx_doctype')].filter(Boolean).join(' ');
  const line = 'w:val="single" w:sz="6" w:space="1" w:color="000000"';
  return XML_HEAD + `<w:hdr ${NS}>`
    + para(run(first, { b: true, sz: 18 }) + '<w:r><w:tab/></w:r>' + run(h.date || L('dx_date'), { b: true, sz: 18 }), { style: 'Header' })
    + para(run(h.name || L('dx_name')), { style: 'Header' })
    + `<w:p><w:pPr><w:pStyle w:val="Header"/><w:pBdr><w:bottom ${line}/></w:pBdr></w:pPr>${run(h.department || L('dx_department'))}</w:p>`
    + '</w:hdr>';
}

function footerXml(spec, L) {
  const field = code => `<w:r><w:rPr><w:b/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:rPr><w:b/></w:rPr><w:instrText xml:space="preserve"> ${code} </w:instrText></w:r>`
    + `<w:r><w:rPr><w:b/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>1</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:fldChar w:fldCharType="end"/></w:r>`;
  const parts = L('dx_page').split(/(\{p\}|\{n\})/);
  const inner = parts.map(p => p === '{p}' ? field('PAGE') : p === '{n}' ? field('NUMPAGES') : (p ? run(p) : '')).join('');
  const line = 'w:val="single" w:sz="6" w:space="1" w:color="000000"';
  return XML_HEAD + `<w:ftr ${NS}>`
    + para(run(spec.classification || ''), { style: 'Footer', spacing: '<w:spacing w:after="120"/>' })
    + `<w:p><w:pPr><w:pStyle w:val="Footer"/><w:pBdr><w:top ${line}/></w:pBdr></w:pPr>${inner}</w:p>`
    + '</w:ftr>';
}

/** Builds the .docx for a specification. Returns the file bytes. */
export async function buildSpecDocx(spec, author = '') {
  const L = k => tIn(spec.lang || 'de', k);
  const b = new DocxBuilder();
  let body = '';
  // title page
  body += para(run(`${L('dx_title')} ${spec.title || ''}`.trim()), { style: 'Title' });
  body += para(run(`${L('dx_path')} ${spec.path || ''}`.trim()), { style: 'CoverLabel' });
  body += para(run(L('dx_package')), { style: 'CoverLabel' });
  body += para(run(spec.package || spec.title || ''), { style: 'PackageTitle' });
  // table of contents: Word fills the page numbers (updateFields); entries are prefilled so it is never empty
  body += para(run(L('dx_toc')), { style: 'TOCHeading', pageBreakBefore: true });
  const tocEntries = spec.sections.filter(s => (s.title || '').trim() && s.level <= 3);
  body += '<w:p><w:pPr><w:pStyle w:val="TOC1"/><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="' + TEXT_WIDTH_TW + '"/></w:tabs></w:pPr>'
    + '<w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>'
    + (tocEntries.length ? run(tocEntries[0].title) + '<w:r><w:tab/></w:r>' : '') + '</w:p>';
  for (const s of tocEntries.slice(1)) body += para(run(s.title) + '<w:r><w:tab/></w:r>', { style: 'TOC' + s.level });
  body += '<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';
  // sections
  spec.sections.forEach((s, i) => { s._first = i === 0; });
  for (const s of spec.sections) {
    const lvl = Math.min(Math.max(+s.level || 1, 1), 3);
    body += para(run(s.title || ''), { style: 'Heading' + lvl, pageBreakBefore: s._first || s.newPage });
    const holder = document.createElement('div');
    holder.innerHTML = cleanHtml(s.html || '');
    body += await b.blocks(holder);
    delete s._first;
  }
  const hdrId = b.rel('http://schemas.openxmlformats.org/officeDocument/2006/relationships/header', 'header1.xml');
  const ftrId = b.rel('http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer', 'footer1.xml');
  body += `<w:sectPr><w:headerReference w:type="default" r:id="${hdrId}"/><w:footerReference w:type="default" r:id="${ftrId}"/>`
    + '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1134" w:bottom="1134" w:left="1417" w:header="567" w:footer="454" w:gutter="0"/></w:sectPr>';

  const docXml = XML_HEAD + `<w:document ${NS}><w:body>${body}</w:body></w:document>`;
  const rels = [
    { id: 'rId1', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles', target: 'styles.xml' },
    { id: 'rId2', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings', target: 'settings.xml' },
    { id: 'rId3', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering', target: 'numbering.xml' },
    ...b.rels,
  ];
  const relsXml = XML_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + rels.map(r => `<Relationship Id="${r.id}" Type="${r.type}" Target="${r.target}"/>`).join('') + '</Relationships>';
  const exts = [...new Set(b.media.map(m => m.ext))];
  const mime = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp' };
  const types = XML_HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
    + exts.map(e => `<Default Extension="${e}" ContentType="${mime[e]}"/>`).join('')
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
    + '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>'
    + '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>'
    + '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>'
    + '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>'
    + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
    + '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
    + '</Types>';
  const nowIso = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const core = XML_HEAD + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
    + `<dc:title>${x(spec.title)}</dc:title><dc:subject>${x(spec.story)}</dc:subject><dc:creator>${x(author)}</dc:creator><cp:lastModifiedBy>${x(author)}</cp:lastModifiedBy>`
    + `<dcterms:created xsi:type="dcterms:W3CDTF">${nowIso}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${nowIso}</dcterms:modified></cp:coreProperties>`;
  const app = XML_HEAD + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>regTester</Application></Properties>';
  const settings = XML_HEAD + '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:updateFields w:val="true"/><w:defaultTabStop w:val="708"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>';

  return zip([
    { name: '[Content_Types].xml', data: types },
    { name: '_rels/.rels', data: XML_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>' },
    { name: 'docProps/core.xml', data: core },
    { name: 'docProps/app.xml', data: app },
    { name: 'word/document.xml', data: docXml },
    { name: 'word/_rels/document.xml.rels', data: relsXml },
    { name: 'word/styles.xml', data: stylesXml() },
    { name: 'word/settings.xml', data: settings },
    { name: 'word/numbering.xml', data: numberingXml(b.nums) },
    { name: 'word/header1.xml', data: headerXml(spec, L) },
    { name: 'word/footer1.xml', data: footerXml(spec, L) },
    ...b.media.map(m => ({ name: m.name, data: m.bytes })),
  ]);
}

// -------------------------------------------------------------- docx in
const xmlDoc = s => new DOMParser().parseFromString(s, 'application/xml');
const els = (node, name) => Array.from(node.getElementsByTagNameNS('*', name));
const attr = (node, name) => node?.getAttribute('w:' + name) ?? node?.getAttribute(name);
const kids = (node, name) => Array.from(node.childNodes).filter(c => c.nodeType === 1 && c.localName === name);

const IMG_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp' };

function toDataUrl(bytes, mime) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(bin)}`;
}

/**
 * Reads a specification .docx back into the editor structure: title page fields, header values,
 * heading levels as sections, text with bold/italic/underline/colour, lists, tables and images.
 * Table-of-contents paragraphs are skipped.
 */
export async function importSpecDocx(buffer, lang = 'de') {
  const z = await unzip(buffer);
  const doc = xmlDoc(await z.text('word/document.xml'));
  const relsDoc = xmlDoc((await z.text('word/_rels/document.xml.rels')) || '<r/>');
  const rel = {};
  for (const r of els(relsDoc, 'Relationship')) rel[r.getAttribute('Id')] = r.getAttribute('Target');
  const styleName = {};
  const st = await z.text('word/styles.xml');
  if (st) for (const s of els(xmlDoc(st), 'style')) {
    const id = s.getAttribute('w:styleId'); const nm = els(s, 'name')[0]?.getAttribute('w:val');
    if (id) styleName[id] = (nm || id).toLowerCase();
  }
  const numFmt = {};
  const nb = await z.text('word/numbering.xml');
  if (nb) {
    const nd = xmlDoc(nb); const abs = {};
    for (const a of els(nd, 'abstractNum')) abs[a.getAttribute('w:abstractNumId')] = Object.fromEntries(els(a, 'lvl').map(l => [l.getAttribute('w:ilvl'), attr(els(l, 'numFmt')[0], 'val')]));
    for (const n of els(nd, 'num')) numFmt[n.getAttribute('w:numId')] = abs[attr(els(n, 'abstractNumId')[0], 'val')] || {};
  }

  const spec = newSpec(lang);
  spec.sections = [];
  spec.classification = '';
  let images = 0, skipped = 0;

  // header: "<product> Regressionstest-Spezifikation ... <date>", then name and department lines
  const hdrTargets = Object.values(rel).filter(t => /header\d*\.xml$/i.test(t));
  for (const t of hdrTargets) {
    const hx = await z.text('word/' + t.replace(/^\/?word\//, ''));
    if (!hx) continue;
    const lines = els(xmlDoc(hx), 'p').map(p => els(p, 't').map(n => n.textContent).join('').trim()).filter(Boolean);
    for (const line of lines) {
      const date = /(\d{1,2}\.\d{1,2}\.\d{4}|\d{4}-\d{2}-\d{2})/.exec(line);
      if (date && !spec.header.date) spec.header.date = date[1];
      const m = /^(.*?)\s*(Regressionstest-Spezifikation|Regression test specification|Specificație de test de regresie)/i.exec(line);
      if (m && m[1] && !spec.header.product) spec.header.product = m[1].trim();
    }
    const labels = /^(name|nume|abteilung|department|departament|datum|date|data)$/i;
    const rest = lines.filter(l => !/spezifikation|specification|specificație/i.test(l) && !labels.test(l));
    if (rest[0] && !spec.header.name) spec.header.name = rest[0];
    if (rest[1] && !spec.header.department) spec.header.department = rest[1];
  }
  for (const t of Object.values(rel).filter(t => /footer\d*\.xml$/i.test(t))) {
    const fx = await z.text('word/' + t.replace(/^\/?word\//, ''));
    if (!fx) continue;
    const lines = els(xmlDoc(fx), 'p').map(p => els(p, 't').map(n => n.textContent).join('').trim()).filter(Boolean);
    const cls = lines.find(l => !/\d/.test(l) && l.length < 40);
    if (cls && !spec.classification) spec.classification = cls;
  }

  async function runsHtml(p) {
    let out = '';
    const walk = async node => {
      for (const c of Array.from(node.childNodes)) {
        if (c.nodeType !== 1) continue;
        const ln = c.localName;
        if (ln === 'r') {
          const rp = kids(c, 'rPr')[0];
          const on = n => { const e = rp && kids(rp, n)[0]; return !!e && !/^(0|false|none)$/i.test(attr(e, 'val') || ''); };
          const col = rp && kids(rp, 'color')[0] ? attr(kids(rp, 'color')[0], 'val') : '';
          let text = '';
          for (const k of Array.from(c.childNodes)) {
            if (k.nodeType !== 1) continue;
            if (k.localName === 't') text += esc(k.textContent);
            else if (k.localName === 'tab') text += ' ';
            else if (k.localName === 'br' || k.localName === 'cr') text += '<br>';
            else if (k.localName === 'drawing' || k.localName === 'pict') {
              const blip = els(k, 'blip')[0] || els(k, 'imagedata')[0];
              const rid = blip && (blip.getAttribute('r:embed') || blip.getAttribute('r:id'));
              const target = rid && rel[rid];
              const ext = target && target.split('.').pop().toLowerCase();
              if (target && IMG_MIME[ext]) {
                const bytes = await z.bytes('word/' + target.replace(/^\/?word\//, ''));
                if (bytes) {
                  const cx = +(els(k, 'extent')[0]?.getAttribute('cx') || 0);
                  const w = cx ? Math.min(Math.round(cx / EMU_PER_PX), TEXT_WIDTH_PX) : 0;
                  text += `<img src="${toDataUrl(bytes, IMG_MIME[ext])}"${w ? ` width="${w}"` : ''}>`;
                  images++;
                }
              } else if (target) skipped++;
            }
          }
          if (!text) continue;
          let html = text;
          if (col && !/^(auto|000000)$/i.test(col)) html = `<span style="color:#${col.toUpperCase()}">${html}</span>`;
          if (on('u')) html = `<u>${html}</u>`;
          if (on('i')) html = `<i>${html}</i>`;
          if (on('b')) html = `<b>${html}</b>`;
          out += html;
        } else if (ln === 'hyperlink' || ln === 'smartTag' || ln === 'ins' || ln === 'fldSimple' || ln === 'sdtContent' || ln === 'sdt') await walk(c);
      }
    };
    await walk(p);
    return out.replace(/<\/b><b>/g, '').replace(/<\/i><i>/g, '').replace(/<\/u><u>/g, '');
  }

  const pText = p => els(p, 't').map(n => n.textContent).join('').replace(/\s+/g, ' ').trim();
  const pStyle = p => { const id = attr(els(p, 'pStyle')[0], 'val') || ''; return styleName[id] || id.toLowerCase(); };
  const headingLevel = p => {
    const s = pStyle(p);
    const m = /(heading|überschrift|berschrift|titlu)\s*(\d)/.exec(s);
    if (m) return +m[2];
    const ol = els(p, 'outlineLvl')[0];
    return ol ? +attr(ol, 'val') + 1 : 0;
  };
  const isToc = p => /^(toc|verzeichnis|inhaltsverz|cuprins)/.test(pStyle(p)) || /^toc\s*heading|inhaltsverzeichnisüberschrift/.test(pStyle(p));
  const isTocTitle = txt => /^(inhaltsverzeichnis|table of contents|contents|cuprins)$/i.test(txt);

  let cur = null, cover = true, wantPackage = false, listOpen = null;
  const closeList = () => { if (listOpen && cur) cur.html += `</${listOpen}>`; listOpen = null; };
  const addHtml = h => { if (!cur) { cur = { id: uidS(), level: 1, title: '', html: '', newPage: true }; spec.sections.push(cur); } cur.html += h; };

  async function paragraphHtml(p) {
    const inner = await runsHtml(p);
    return inner.replace(/(<br>)+$/, '');
  }

  async function tableHtml(tbl) {
    let out = '<table>';
    for (const tr of kids(tbl, 'tr')) {
      out += '<tr>';
      for (const tc of kids(tr, 'tc')) {
        const ps = [];
        for (const p of kids(tc, 'p')) { const h = await paragraphHtml(p); if (h.replace(/<br>/g, '').trim()) ps.push(`<p>${h}</p>`); }
        out += `<td>${ps.join('')}</td>`;
      }
      out += '</tr>';
    }
    return out + '</table>';
  }

  const bodyNodes = [];
  const collect = node => {
    for (const c of Array.from(node.childNodes)) {
      if (c.nodeType !== 1) continue;
      if (c.localName === 'sdt') {
        const gallery = els(c, 'docPartGallery')[0];
        if (gallery && /table of contents/i.test(attr(gallery, 'val') || '')) continue; // the generated TOC block
        const content = kids(c, 'sdtContent')[0];
        if (content) collect(content);
      } else if (c.localName === 'p' || c.localName === 'tbl') bodyNodes.push(c);
    }
  };
  collect(els(doc, 'body')[0]);

  for (const node of bodyNodes) {
    if (node.localName === 'tbl') {
      if (cover) cover = false;
      closeList(); addHtml(await tableHtml(node)); continue;
    }
    const txt = pText(node);
    if (isToc(node)) continue;
    if (isTocTitle(txt)) { cover = false; continue; }
    const lvl = headingLevel(node);
    if (cover) {
      let m;
      if ((m = /^(titel|title|titlu)\s*:\s*(.*)$/i.exec(txt))) { spec.title = m[2].trim(); continue; }
      if ((m = /^(pfad|path|cale)\s*:\s*(.*)$/i.exec(txt))) { spec.path = m[2].replace(/\s+/g, ' ').trim(); continue; }
      if (/regtest\s*package\s*title|pachete regtest/i.test(txt)) { wantPackage = true; continue; }
      if (wantPackage && txt) { spec.package = txt; wantPackage = false; cover = false; continue; }
      if (!txt && !els(node, 'drawing').length) continue;
      if (lvl && !spec.title && !spec.sections.length) { spec.title = txt; continue; }
      cover = false;
    }
    const numPr = els(node, 'numPr')[0];
    if (lvl >= 1 && lvl <= 3 && txt) {
      closeList();
      const pbb = els(node, 'pageBreakBefore').length > 0 || lvl === 1;
      cur = { id: uidS(), level: lvl, title: txt, html: '', newPage: pbb };
      spec.sections.push(cur);
      continue;
    }
    const html = await paragraphHtml(node);
    if (!html.replace(/<br>/g, '').trim()) { closeList(); continue; }
    if (numPr) {
      const nid = attr(els(numPr, 'numId')[0], 'val'), il = attr(els(numPr, 'ilvl')[0], 'val') || '0';
      const fmt = (numFmt[nid] || {})[il] || 'bullet';
      const tag = fmt === 'bullet' || fmt === 'none' ? 'ul' : 'ol';
      if (listOpen !== tag) { closeList(); addHtml(`<${tag}>`); listOpen = tag; }
      addHtml(`<li>${html}</li>`);
    } else { closeList(); addHtml(`<p>${html}</p>`); }
  }
  closeList();
  if (!spec.classification) spec.classification = tIn(lang, 'dx_class');
  if (!spec.title && spec.package) spec.title = spec.package;
  const story = /\b([A-Z]{2,6}-\d{2,7})\b/.exec(`${spec.title} ${spec.package}`);
  if (story) spec.story = story[1];
  for (const s of spec.sections) s.html = cleanHtml(s.html);
  if (!spec.sections.length) spec.sections = defaultSections(lang);
  return { spec, images, skipped };
}
