// Small rich text editor (contenteditable) with screenshots: bold, italic, underline, red text,
// lists, paste/drag images. The stored HTML is cleaned to what the Word export understands.
// With the server, images are stored once in the database (/api/att/<id>) and the text keeps only the
// reference; in the demo (no server) they stay inside the text as data URLs.
import { cleanHtml, fetchDataUrl } from './docx-spec.js';
import { t } from './i18n.js';
import { debounce, h, isHtml, textToHtml, toast } from './util.js';

const MAX_IMG_PX = 1600;
let imageApi = null;

/** Called once at start-up with the API; only the server API stores images. */
export function setImageApi(api) { imageApi = api && typeof api.uploadImage === 'function' ? api : null; }

async function storeOne(src) {
  if (!imageApi || !/^data:image\//.test(src)) return src;
  const r = await imageApi.uploadImage(src);
  return r.url;
}

/** Moves images still kept inside the text (data URLs, e.g. older Word specifications) to the image store. */
export async function storeImages(html) {
  if (!imageApi || !/<img[^>]+src="data:image\//i.test(html || '')) return html;
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  for (const img of doc.querySelectorAll('img[src^="data:image/"]')) img.setAttribute('src', await storeOne(img.getAttribute('src')));
  return doc.body.firstChild.innerHTML;
}

/** The opposite, for copying to other programs or saving a standalone .html: images inside the text. */
export async function inlineImages(html) {
  if (!/\/api\/att\//.test(html || '')) return html;
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  for (const img of doc.querySelectorAll('img[src^="/api/att/"]')) {
    try { img.setAttribute('src', await fetchDataUrl(img.getAttribute('src'))); } catch { img.remove(); }
  }
  return doc.body.firstChild.innerHTML;
}

/** Read-only display of a text field (HTML or older plain text); click on an image opens it full size. */
export function richView(value, opts = {}) {
  const el = h('div', { class: 'rt-view' + (opts.cls ? ' ' + opts.cls : '') });
  el.innerHTML = cleanHtml(isHtml(value) ? value : textToHtml(value, opts.list));
  el.querySelectorAll('img').forEach(img => { img.title = t('rt_img_open'); img.addEventListener('click', () => window.open(img.src, '_blank', 'noopener')); });
  return el;
}

/** Reads an image file into a data URL, scaled down when it is very large. */
export function imageFileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(fr.error);
    fr.onload = async () => {
      const src = fr.result;
      try {
        const img = new Image(); img.src = src; await img.decode();
        if (img.naturalWidth <= MAX_IMG_PX && /^data:image\/(png|jpe?g|gif)/.test(src)) { resolve(src); return; }
        const scale = Math.min(1, MAX_IMG_PX / img.naturalWidth);
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL(file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.9));
      } catch { resolve(src); }
    };
    fr.readAsDataURL(file);
  });
}

/**
 * richText({ html, onChange, readOnly, id, label }) -> element
 * onChange(html) is called (debounced) with cleaned HTML.
 */
export function richText(opts) {
  const ed = h('div', { class: 'rt-area' + (opts.compact ? ' compact' : ''), contenteditable: opts.readOnly ? 'false' : 'true', id: opts.id, role: 'textbox', 'aria-multiline': 'true', 'aria-label': opts.label || '' });
  ed.innerHTML = cleanHtml(isHtml(opts.html) ? opts.html : textToHtml(opts.html || '', opts.list));
  const emit = debounce(() => opts.onChange && opts.onChange(cleanHtml(ed.innerHTML)), 250);
  const exec = (cmd, val) => { ed.focus(); document.execCommand(cmd, false, val); emit(); };

  async function insertImages(files) {
    for (const f of files) {
      if (!/^image\//.test(f.type)) continue;
      let src;
      try { src = await storeOne(await imageFileToDataUrl(f)); }
      catch (e) { toast(t('rt_img_failed') + (e?.message ? ': ' + e.message : ''), 'bad'); continue; }
      ed.focus();
      document.execCommand('insertHTML', false, `<img src="${src}"><br>`);
    }
    emit();
  }

  const picker = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: e => { insertImages(Array.from(e.target.files || [])); e.target.value = ''; } });
  const tb = (label, title, fn, cls = '') => h('button', { type: 'button', class: 'rt-btn ' + cls, title, 'aria-label': title, onmousedown: e => e.preventDefault(), onclick: fn }, label);
  const toolbar = opts.readOnly ? null : h('div', { class: 'rt-toolbar', role: 'toolbar' },
    tb('B', t('rt_bold'), () => exec('bold'), 'b'),
    tb('I', t('rt_italic'), () => exec('italic'), 'i'),
    tb('U', t('rt_underline'), () => exec('underline'), 'u'),
    tb('A', t('rt_red'), () => { document.execCommand('styleWithCSS', false, true); exec('foreColor', '#E00000'); document.execCommand('styleWithCSS', false, false); }, 'red'),
    tb('•', t('rt_ul'), () => exec('insertUnorderedList')),
    tb('1.', t('rt_ol'), () => exec('insertOrderedList')),
    tb('🖼', t('rt_image'), () => picker.click()),
    tb('⌫', t('rt_clear'), () => exec('removeFormat')),
    picker);

  // image sizing: click an image to get a width slider
  const sizer = h('div', { class: 'rt-sizer', hidden: true });
  let selImg = null;
  function showSizer(img) {
    selImg = img;
    const max = Math.max(200, Math.min(620, img.naturalWidth || 620));
    const range = h('input', { type: 'range', min: 60, max, value: +img.getAttribute('width') || Math.min(img.naturalWidth || max, max), 'aria-label': t('rt_img_size') });
    range.addEventListener('input', () => { img.setAttribute('width', range.value); emit(); });
    sizer.replaceChildren(h('span', { class: 'small' }, t('rt_img_size')), range,
      h('button', { type: 'button', class: 'btn sm ghost danger', onclick: () => { img.remove(); sizer.hidden = true; emit(); } }, t('rt_img_remove')));
    sizer.hidden = false;
  }
  ed.addEventListener('click', e => { if (e.target.tagName === 'IMG' && !opts.readOnly) showSizer(e.target); else if (selImg) { sizer.hidden = true; selImg = null; } });

  ed.addEventListener('input', emit);
  ed.addEventListener('paste', e => {
    const cd = e.clipboardData; if (!cd) return;
    const files = Array.from(cd.files || []).filter(f => /^image\//.test(f.type));
    if (files.length) { e.preventDefault(); insertImages(files); return; }
    const html = cd.getData('text/html');
    if (html) { e.preventDefault(); document.execCommand('insertHTML', false, cleanHtml(html.replace(/^[\s\S]*<!--StartFragment-->|<!--EndFragment-->[\s\S]*$/g, ''))); emit(); }
  });
  ed.addEventListener('dragover', e => { if (Array.from(e.dataTransfer?.items || []).some(i => i.kind === 'file')) e.preventDefault(); });
  ed.addEventListener('drop', e => {
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.some(f => /^image\//.test(f.type))) { e.preventDefault(); insertImages(files); }
  });

  const wrap = h('div', { class: 'rt' }, toolbar, ed, sizer, opts.readOnly || opts.noHint ? null : h('div', { class: 'hint' }, t('rt_hint')));
  wrap.getValue = () => cleanHtml(ed.innerHTML);
  wrap.editable = ed;
  return wrap;
}
