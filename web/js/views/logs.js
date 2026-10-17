// Application log viewer (server log file + events from the interface).
import { t } from '../i18n.js';
import { btn, clear, copyText, debounce, emptyState, h, seg, store } from '../util.js';

export async function render(root, ctx) {
  const st = Object.assign({ level: 'INFO', q: '', auto: false }, store('logs') || {});
  const save = () => store('logs', st);
  const list = h('div', { class: 'card', style: { padding: 0, overflow: 'hidden' } });
  const search = h('input', { type: 'search', value: st.q, placeholder: t('logs_search'), 'aria-label': t('logs_search') });
  search.addEventListener('input', debounce(() => { st.q = search.value; save(); load(); }, 250));
  let lines = [];
  root.append(
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, t('nav_logs')), h('p', null, t('logs_intro'))),
      h('div', { class: 'actions' }, btn(t('refresh'), load, { icon: 'refresh' }), btn(t('copy'), () => copyText(lines.map(l => `${l.ts} | ${l.level} | ${l.source} | ${l.message}`).join('\n')), { icon: 'copy' }))),
    h('div', { class: 'toolbar' },
      seg([['DEBUG', 'Debug'], ['INFO', 'Info'], ['WARNING', t('logs_warn')], ['ERROR', t('logs_err')]], st.level, v => { st.level = v; save(); root.innerHTML = ''; render(root, ctx); }),
      h('div', { class: 'grow' }, search),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: st.auto, onchange: e => { st.auto = e.target.checked; save(); } }), t('logs_auto'))),
    list);

  async function load() {
    try { lines = await ctx.api.logs({ level: st.level, q: st.q, limit: 800 }); }
    catch (e) { clear(list).appendChild(h('div', { class: 'chip bad' }, e.message)); return; }
    clear(list);
    if (!lines.length) { list.appendChild(emptyState(t('logs_empty'))); return; }
    for (const l of lines) list.appendChild(h('div', { class: 'log-line' }, h('span', { class: 'muted' }, l.ts), h('span', { class: 'lvl-' + l.level }, l.level),
      h('span', { class: 'msg' }, h('span', { class: 'muted' }, l.source.replace('regtester.', '') + ' · '), l.message)));
  }
  await load();
  const timer = setInterval(() => { if (!document.body.contains(list)) { clearInterval(timer); return; } if (st.auto) load(); }, 5000);
}
