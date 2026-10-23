// Small rich text editor (contenteditable) with screenshots: bold, italic, underline, red text,
// lists, paste/drag images. The stored HTML is cleaned to what the Word export understands.
import { cleanHtml } from './docx-spec.js';
import { t } from './i18n.js';
import { debounce, h } from './util.js';

const MAX_IMG_PX = 1600;

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
  const ed = h('div', { class: 'rt-area', contenteditable: opts.readOnly ? 'false' : 'true', id: opts.id, role: 'textbox', 'aria-multiline': 'true', 'aria-label': opts.label || '' });
  ed.innerHTML = cleanHtml(opts.html || '');
  const emit = debounce(() => opts.onChange && opts.onChange(cleanHtml(ed.innerHTML)), 250);
  const exec = (cmd, val) => { ed.focus(); document.execCommand(cmd, false, val); emit(); };

  async function insertImages(files) {
    for (const f of files) {
      if (!/^image\//.test(f.type)) continue;
      const src = await imageFileToDataUrl(f);
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

  return h('div', { class: 'rt' }, toolbar, ed, sizer, opts.readOnly ? null : h('div', { class: 'hint' }, t('rt_hint')));
}
