// Small DOM and formatting helpers shared by every view.
import { t } from './i18n.js';

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const ICONS = {
  sortDesc: 'M7 4v16M3 16l4 4 4-4M13 6h8M13 12h6M13 18h4',
  sortAsc: 'M7 20V4M3 8l4-4 4 4M13 6h4M13 12h6M13 18h8',
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v5M16 3v5',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  chart: 'M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-8',
  bug: 'M8 9h8v7a4 4 0 0 1-8 0zM9 6l1.5 3M15 6l-1.5 3M4 12h4M16 12h4M5 18l3-2M19 18l-3-2',
  mic: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  doc: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7',
  book: 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11',
  clock: 'M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15l1.6 1-2 3.4-1.8-.7a7 7 0 0 1-2.2 1.3L14.8 22h-4l-.3-2a7 7 0 0 1-2.2-1.3l-1.8.7-2-3.4 1.6-1a7 7 0 0 1 0-2.6l-1.6-1 2-3.4 1.8.7a7 7 0 0 1 2.2-1.3l.3-2h4l.3 2a7 7 0 0 1 2.2 1.3l1.8-.7 2 3.4-1.6 1a7 7 0 0 1 0 2.6z',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6L6 18',
  menu: 'M4 7h16M4 12h16M4 17h16',
  copy: 'M8 8h11v12H8zM5 16V4h11',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  history: 'M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4M12 8v4l3 2',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  wand: 'M4 20L16 8M14 4v3M18 6h3M19 10v3M10 4h3',
  refresh: 'M20 11a8 8 0 0 0-14-5L4 8M4 4v4h4M4 13a8 8 0 0 0 14 5l2-2M20 20v-4h-4',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11',
  chevron: 'M9 6l6 6-6 6',
};

export function icon(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', ICONS[name] || ICONS.list);
  svg.appendChild(p);
  return svg;
}

export function btn(label, onClick, opts = {}) {
  return h('button', { type: 'button', class: 'btn ' + (opts.cls || ''), onclick: onClick, title: opts.title, 'aria-label': opts.aria, disabled: opts.disabled, id: opts.id },
    opts.icon ? icon(opts.icon) : null, label);
}

// ---------------------------------------------------------------- dates
export const pad = n => String(n).padStart(2, '0');
export function iso(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function parseIso(s) { if (!s) return null; const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; }
export function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
export function daysBetween(a, b) { return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000); }
export function isoWeek(d) {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = x.getUTCDay() || 7; x.setUTCDate(x.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  return Math.ceil(((x - y0) / 86400000 + 1) / 7);
}
export function fmtDate(v, opts) {
  if (!v) return '';
  const d = typeof v === 'number' ? new Date(v * 1000) : (v instanceof Date ? v : parseIso(v) || new Date(v));
  if (isNaN(d)) return String(v);
  return d.toLocaleDateString(t.locale(), opts || { day: '2-digit', month: 'short', year: 'numeric' });
}
export function fmtDateTime(ts) {
  if (!ts) return '';
  const d = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts);
  return d.toLocaleString(t.locale(), { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
/** Accept 2026-10-27, 27.10.2026, 27/10/2026, 10/27/2026 (US when day>12), Excel serials and Date objects. */
export function toIsoDate(v) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date && !isNaN(v)) return iso(v);
  if (typeof v === 'number' || /^\d{4,5}(\.\d+)?$/.test(String(v).trim())) {
    const n = Number(v);
    if (n > 20000 && n < 80000) return iso(new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000 + new Date().getTimezoneOffset() * 60000));
  }
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/.exec(s);
  if (m) {
    let [, a, b, y] = m; y = y.length === 2 ? '20' + y : y;
    let day = +a, mon = +b;
    if (mon > 12 && day <= 12) [day, mon] = [mon, day];
    return `${y}-${pad(mon)}-${pad(day)}`;
  }
  const d = new Date(s);
  return isNaN(d) ? '' : iso(d);
}

// --------------------------------------------------------------- text
export function normalize(s) {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');
}
const STOP = new Set('the a an and or of to in on for with by is are be as at from this that it new neu neue der die das und oder mit fur von im in zu ein eine si sau cu de la pe in din un o al ale lui pentru este'.split(' '));
export function tokens(s) { return normalize(s).split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOP.has(w)); }
export function similarity(a, b) {
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const x of A) if (B.has(x)) inter++;
  return inter / Math.min(A.size, B.size);
}
export function words(s) { return (String(s || '').match(/\S+/g) || []).length; }
export function debounce(fn, ms = 200) { let id; return (...a) => { clearTimeout(id); id = setTimeout(() => fn(...a), ms); }; }
export function uid() { return Math.random().toString(16).slice(2, 14); }

// ---------------------------------------------------------- ui feedback
let toastHost;
export function toast(msg, kind) {
  if (!toastHost) { toastHost = h('div', { class: 'toast-host', role: 'status', 'aria-live': 'polite' }); document.body.appendChild(toastHost); }
  const el = h('div', { class: 'toast ' + (kind || '') }, msg);
  toastHost.appendChild(el);
  setTimeout(() => el.remove(), kind === 'bad' ? 6000 : 3200);
}

export function modal({ title, body, footer, wide, onClose }) {
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); onClose && onClose(); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  const ov = h('div', { class: 'overlay', onclick: e => { if (e.target === ov) close(); } },
    h('div', { class: 'dialog' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('header', null, h('h2', null, title), btn('', close, { cls: 'ghost icon-btn', icon: 'x', aria: t('close') })),
      h('div', { class: 'body' }, body),
      footer ? h('footer', null, typeof footer === 'function' ? footer(close) : footer) : null));
  document.body.appendChild(ov);
  document.addEventListener('keydown', onKey);
  const first = ov.querySelector('input, select, textarea');
  if (first) setTimeout(() => first.focus(), 30);
  return close;
}

export function drawer({ title, body, footer, onClose }) {
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); onClose && onClose(); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  const ov = h('div', { class: 'overlay drawer-overlay', onclick: e => { if (e.target === ov) close(); } },
    h('aside', { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('header', null, h('h2', null, title), btn('', close, { cls: 'ghost icon-btn', icon: 'x', aria: t('close') })),
      h('div', { class: 'body' }, body),
      footer ? h('footer', null, typeof footer === 'function' ? footer(close) : footer) : null));
  document.body.appendChild(ov);
  document.addEventListener('keydown', onKey);
  return close;
}

/** In-page confirmation (the artifact viewer blocks window.confirm). */
export function confirmBox(message, okLabel, danger = true) {
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    const close = modal({
      title: t('confirm'), body: h('p', null, message), onClose: () => finish(false),
      footer: c => [btn(t('cancel'), () => { finish(false); c(); }), btn(okLabel || t('ok'), () => { finish(true); c(); }, { cls: danger ? 'primary' : 'primary' })],
    });
    return close;
  });
}

export async function copyText(text, html) {
  try {
    if (html && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
    } else {
      await navigator.clipboard.writeText(text);
    }
    toast(t('copied'));
    return true;
  } catch {
    const ta = h('textarea', { style: { position: 'fixed', top: '-1000px' } }); ta.value = text;
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
    if (ok) toast(t('copied')); else showText(t('copy_manually'), text);
    return ok;
  }
}

export function showText(title, text) {
  const ta = h('textarea', { rows: 14, readonly: true }); ta.value = text;
  modal({ title, body: ta, wide: true });
  setTimeout(() => ta.select(), 50);
}

export function download(filename, content, type = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: type + ';charset=utf-8' });
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export function toCsv(rows, cols) {
  const q = v => { const s = String(v ?? ''); return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return [cols.map(c => q(c.label)).join(';'), ...rows.map(r => cols.map(c => q(typeof c.get === 'function' ? c.get(r) : r[c.key])).join(';'))].join('\r\n');
}

export function chip(text, kind, dotColor) {
  return h('span', { class: 'chip ' + (kind || '') }, dotColor ? h('span', { class: 'dot', style: { background: dotColor } }) : null, text);
}

export function emptyState(text, ...actions) {
  return h('div', { class: 'empty' }, h('div', null, text), actions.length ? h('div', { class: 'actions' }, actions) : null);
}

export function tabs(items, active, onChange) {
  return h('div', { class: 'tabs', role: 'tablist' }, items.map(([id, label]) =>
    h('button', { type: 'button', role: 'tab', 'aria-selected': String(id === active), class: id === active ? 'on' : '', onclick: () => onChange(id) }, label)));
}

export function seg(items, active, onChange) {
  return h('div', { class: 'seg', role: 'group' }, items.map(([id, label]) =>
    h('button', { type: 'button', class: id === active ? 'on' : '', 'aria-pressed': String(id === active), onclick: () => onChange(id) }, label)));
}

export function store(key, value) {
  try {
    if (value === undefined) { const v = localStorage.getItem('rt.' + key); return v ? JSON.parse(v) : undefined; }
    localStorage.setItem('rt.' + key, JSON.stringify(value));
  } catch { /* storage unavailable */ }
  return value;
}

// ---------------------------------------------------------------- list order
/** Chronological direction of one list, kept in this browser only (rt.order.<list>). Newest first by default. */
export function listOrder(list) { return store('order.' + list) === 'asc' ? 'asc' : 'desc'; }

/** Turn a comparator written oldest-first into one that follows the given direction. */
export function directed(cmp, dir) { return dir === 'asc' ? cmp : (a, b) => cmp(b, a); }

/** Newest/oldest first switch for one list; saves the choice and calls onChange(dir). */
export function orderToggle(list, onChange) {
  const b = h('button', { type: 'button', class: 'btn sm order-toggle', title: t('sort_toggle') });
  const paint = dir => {
    clear(b).append(icon(dir === 'asc' ? 'sortAsc' : 'sortDesc'), dir === 'asc' ? t('sort_oldest') : t('sort_newest'));
    b.dataset.order = dir;
    b.setAttribute('aria-label', `${t('sort_toggle')}: ${dir === 'asc' ? t('sort_oldest') : t('sort_newest')}`);
  };
  paint(listOrder(list));
  b.addEventListener('click', () => {
    const dir = listOrder(list) === 'asc' ? 'desc' : 'asc';
    store('order.' + list, dir);
    paint(dir);
    onChange(dir);
  });
  return b;
}

/** Highlight query terms inside text, returning a fragment. */
export function highlight(text, terms) {
  const s = String(text ?? '');
  if (!terms || !terms.length) return document.createTextNode(s);
  const norm = normalize(s);
  const ranges = [];
  for (const term of terms) {
    const nt = normalize(term); if (nt.length < 2) continue;
    let i = norm.indexOf(nt);
    while (i !== -1) { ranges.push([i, i + nt.length]); i = norm.indexOf(nt, i + nt.length); }
  }
  if (!ranges.length) return document.createTextNode(s);
  ranges.sort((a, b) => a[0] - b[0]);
  const frag = document.createDocumentFragment(); let pos = 0;
  for (const [a, b] of ranges) {
    if (a < pos) continue;
    frag.appendChild(document.createTextNode(s.slice(pos, a)));
    frag.appendChild(h('mark', null, s.slice(a, b)));
    pos = b;
  }
  frag.appendChild(document.createTextNode(s.slice(pos)));
  return frag;
}

export function snippet(text, terms, len = 220) {
  const s = String(text || '').replace(/\s+/g, ' ');
  if (!terms || !terms.length || s.length <= len) return s.slice(0, len);
  const n = normalize(s);
  let best = -1;
  for (const term of terms) { const i = n.indexOf(normalize(term)); if (i !== -1 && (best === -1 || i < best)) best = i; }
  if (best === -1) return s.slice(0, len) + '…';
  const start = Math.max(0, best - 60);
  return (start ? '…' : '') + s.slice(start, start + len) + (start + len < s.length ? '…' : '');
}

// ------------------------------------------------------------ rich text helpers
// Text fields can hold HTML (with screenshots) or, for older records, plain text.
const HTML_RE = /<\/?(p|br|b|i|u|ul|ol|li|img|span|div|table|tr|td|a|strong|em)\b[^>]*>/i;
export function isHtml(s) { return typeof s === 'string' && HTML_RE.test(s); }

/** Plain text of a field (HTML or text): for search, CSV, reports and snippets. */
export function plainText(s) {
  if (!isHtml(s)) return String(s ?? '');
  const doc = new DOMParser().parseFromString(`<div>${s}</div>`, 'text/html');
  const root = doc.body.firstChild;
  root.querySelectorAll('br').forEach(b => b.replaceWith('\n'));
  root.querySelectorAll('p, li, div, tr, h1, h2, h3').forEach(b => b.append('\n'));
  return root.textContent.replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Old plain text shown in the rich editor: paragraphs and line breaks kept, or a numbered list. */
export function textToHtml(s, asList) {
  const v = String(s ?? '');
  if (!v.trim() || isHtml(v)) return v;
  if (asList) {
    const items = v.split('\n').map(x => x.replace(/^\s*(\d+[.)]|[-*•])\s*/, '').trim()).filter(Boolean);
    return `<ol>${items.map(x => `<li>${esc(x)}</li>`).join('')}</ol>`;
  }
  return v.split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
}

/** Ids of the stored images a text refers to (/api/att/<id>). */
export function attRefs(s) { return [...new Set(String(s ?? '').match(/\/api\/att\/[0-9a-f]{64}/g) || [])].map(x => x.slice(9)); }
/** True when a field has text or at least one image. */
export function hasContent(s) { return !!plainText(s).trim() || /<img\b/i.test(String(s ?? '')); }

// --------------------------------------------------------------- KPI boxes
/** A KPI box; with onClick it is a button that leads to the elements behind the number. */
export function kpiBox(label, value, kind, onClick, opts = {}) {
  const inner = [h('div', { class: 'l' }, label), h('div', { class: 'v' }, value)];
  if (!onClick) return h('div', { class: 'kpi ' + (kind || '') }, inner);
  return h('button', { type: 'button', class: `kpi click ${kind || ''}${opts.active ? ' on' : ''}`, onclick: onClick, title: opts.title || t('kpi_open'),
    'aria-pressed': opts.active === undefined ? null : String(!!opts.active), 'data-kpi': opts.id }, inner);
}

/** Notice above a list opened from a KPI: which filter is applied, with a button to show everything. */
export function drillBand(label, onClear) {
  return h('div', { class: 'drill-band', role: 'status', id: 'drill-band' }, h('span', { class: 'small muted' }, t('drill_applied')), h('b', null, label),
    h('span', { class: 'sp' }), btn(t('drill_clear'), onClear, { cls: 'sm ghost', icon: 'x', id: 'drill-clear' }));
}

/** Link to a page with a filter (read by the page from the URL): #page?a=1&from=<i18n key of the KPI>. */
export function drillHash(page, params) {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  return '#' + page + (q.toString() ? '?' + q : '');
}
/** Removes the filter from the URL without reloading the page. */
export function dropDrill() { const page = location.hash.replace(/^#\/?/, '').split('?')[0]; history.replaceState(null, '', '#' + page); }

/**
 * Filters opened from a KPI, kept in the page state `st`: the filters the user had are remembered and come back
 * when the notice is closed. `keys` are the filter fields of the list, `defaults` their neutral values.
 */
export function drillApply(st, keys, defaults, values, from) {
  if (!st.drill) st.preDrill = Object.fromEntries(keys.map(k => [k, st[k]]));
  for (const k of keys) st[k] = values[k] !== undefined ? values[k] : defaults[k];
  st.drill = from;
}
export function drillFromParams(st, keys, defaults, params, extra = []) {
  if (!params?.get('from')) return false;
  const values = {};
  for (const k of [...keys, ...extra]) if (params.has(k)) values[k] = params.get(k);
  drillApply(st, keys, defaults, values, params.get('from'));
  for (const k of extra) if (params.has(k)) st[k] = params.get(k);
  dropDrill();
  return true;
}
export function drillClear(st) {
  if (st.preDrill) Object.assign(st, st.preDrill);
  delete st.preDrill; st.drill = null;
}
