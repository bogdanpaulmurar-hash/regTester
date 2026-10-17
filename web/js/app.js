// Application shell: navigation, routing, login, theme and language.
import { connect } from './api.js';
import { setLang, t } from './i18n.js';
import { btn, clear, h, icon, modal, store, toast } from './util.js';

const PAGES = [
  ['dashboard', 'home', () => import('./views/dashboard.js')],
  ['timeline', 'calendar', () => import('./views/timeline.js')],
  ['coverage', 'grid', () => import('./views/coverage.js')],
  ['triage', 'bug', () => import('./views/triage.js')],
  ['transcripts', 'mic', () => import('./views/transcripts.js')],
  ['docs', 'doc', () => import('./views/docs.js')],
  ['specs', 'book', () => import('./views/specs.js')],
];
const SYSTEM = [
  ['history', 'history', () => import('./views/history.js')],
  ['logs', 'list', () => import('./views/logs.js')],
  ['settings', 'gear', () => import('./views/settings.js')],
  ['admin', 'shield', () => import('./views/admin.js')],
];
export const PAGE_OF = {
  timeline: 'timeline', features: 'coverage', tests: 'coverage', runs: 'triage', known: 'triage',
  transcripts: 'transcripts', glossary: 'transcripts', docs: 'docs', templates: 'docs', specs: 'specs',
};

const app = document.getElementById('app');
const ctx = { cache: {} };

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme); else root.removeAttribute('data-theme');
}

ctx.canPage = p => {
  const u = ctx.user; if (!u) return false;
  if (['history', 'logs', 'settings'].includes(p)) return true;
  if (p === 'admin') return u.role === 'admin';
  return (ctx.pages || []).includes(p);
};
ctx.canWriteSection = section => {
  const u = ctx.user; if (!u) return false;
  if (u.role === 'admin') return true;
  if (u.role === 'viewer') return false;
  const page = PAGE_OF[section] || section;
  return (u.sections || ['*']).includes('*') || (u.sections || []).includes(page);
};
ctx.navigate = page => { if (location.hash !== '#' + page) location.hash = page; else route(); };
ctx.reloadSettings = async () => { ctx.settings = await ctx.api.settings(); applyTheme(ctx.settings.theme); };
ctx.records = async (section, force) => {
  if (force || !ctx.cache[section]) ctx.cache[section] = await ctx.api.list(section);
  return ctx.cache[section];
};
ctx.invalidate = (...sections) => { for (const s of sections) delete ctx.cache[s]; };

let navEl, mainEl, pageEl;

function shell() {
  clear(app);
  const lang = h('select', { 'aria-label': t('language'), onchange: e => { store('lang', e.target.value); setLang(e.target.value); shell(); route(); } },
    [['ro', 'Română'], ['en', 'English'], ['de', 'Deutsch']].map(([v, l]) => h('option', { value: v, selected: t.lang() === v }, l)));
  const theme = h('select', { 'aria-label': t('theme'), onchange: e => { store('theme', e.target.value); applyTheme(e.target.value); } },
    [['auto', t('theme_auto')], ['light', t('theme_light')], ['dark', t('theme_dark')]].map(([v, l]) => h('option', { value: v, selected: (store('theme') || ctx.settings.theme) === v }, l)));
  const link = ([id, ic]) => h('a', { href: '#' + id, 'data-page': id, onclick: () => closeNav() }, icon(ic), t('nav_' + id));
  navEl = h('nav', { class: 'nav', 'aria-label': t('nav_main') },
    h('div', { class: 'brand' }, h('img', { src: ctx.api.logoUrl(), alt: '' }),
      h('div', null, h('b', null, ctx.settings.app_name || 'regTester'), h('small', null, ctx.api.demo ? t('demo_short') : t('tagline')))),
    PAGES.filter(([id]) => ctx.canPage(id)).map(link),
    h('div', { class: 'nav-group' }, t('nav_system')),
    SYSTEM.filter(([id]) => ctx.canPage(id)).map(link),
    h('div', { class: 'grow' }),
    h('div', { class: 'nav-user' },
      h('div', null, `${ctx.user.display || ctx.user.username} · ${t('role_' + ctx.user.role)}`),
      h('div', { class: 'row' }, lang, theme),
      !ctx.api.demo && ctx.user.username !== 'local'
        ? h('div', { class: 'row' }, h('button', { type: 'button', onclick: logout }, t('logout'))) : null));
  const scrim = h('div', { class: 'scrim', hidden: true, onclick: () => closeNav() });
  function closeNav() { navEl.classList.remove('open'); scrim.hidden = true; }
  const topbar = h('div', { class: 'topbar' },
    h('button', { type: 'button', 'aria-label': t('menu'), onclick: () => { navEl.classList.add('open'); scrim.hidden = false; } }, icon('menu')),
    h('b', null, ctx.settings.app_name || 'regTester'), h('span', { id: 'topbar-page' }));
  pageEl = h('div', { class: 'page', id: 'page' });
  mainEl = h('main', { class: 'main' }, topbar,
    ctx.api.demo ? h('div', { class: 'demo-band' }, t('demo_band')) : null, pageEl);
  app.appendChild(h('div', { class: 'shell' }, navEl, scrim, mainEl));
}

let routeToken = 0;
async function route() {
  if (!ctx.user || !navEl) return;
  const [page, query] = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('?');
  const all = [...PAGES, ...SYSTEM];
  const def = all.find(([id]) => id === page && ctx.canPage(id)) || all[0];
  navEl.querySelectorAll('a[data-page]').forEach(a => a.classList.toggle('on', a.dataset.page === def[0]));
  const tp = document.getElementById('topbar-page'); if (tp) tp.textContent = t('nav_' + def[0]);
  document.title = `${t('nav_' + def[0])} · ${ctx.settings.app_name || 'regTester'}`;
  const my = ++routeToken;
  clear(pageEl);
  pageEl.appendChild(h('div', { class: 'hint' }, t('loading')));
  try {
    const mod = await def[2]();
    if (my !== routeToken) return;
    clear(pageEl);
    await mod.render(pageEl, ctx, new URLSearchParams(query || ''));
  } catch (e) {
    console.error(e);
    clear(pageEl);
    pageEl.appendChild(h('div', { class: 'card' }, h('h2', null, t('err_page')), h('pre', { class: 'pre' }, String(e.stack || e))));
    ctx.api.log('ERROR', `Page ${def[0]} failed: ${e.message}`);
  }
}

async function logout() {
  await ctx.api.logout();
  ctx.user = null; ctx.cache = {};
  showLogin();
}

function showLogin(message) {
  clear(app);
  const user = h('input', { type: 'text', id: 'login-user', autocomplete: 'username', required: true });
  const pass = h('input', { type: 'password', id: 'login-pass', autocomplete: 'current-password', required: true });
  const err = h('div', { class: 'chip bad', hidden: !message }, message || '');
  app.appendChild(h('div', { class: 'login' }, h('form', { class: 'card', onsubmit: async e => {
    e.preventDefault();
    try { await ctx.api.login(user.value, pass.value); await start(); }
    catch (ex) { err.textContent = ex.status === 401 ? t('login_wrong') : ex.message; err.hidden = false; }
  } },
  h('div', { class: 'brand', style: { padding: 0 } }, h('img', { src: ctx.api.logoUrl(), alt: '', width: 36, height: 36 }), h('h1', null, ctx.settings?.app_name || 'regTester')),
  h('label', { class: 'field', for: 'login-user' }, t('username'), user),
  h('label', { class: 'field', for: 'login-pass' }, t('password'), pass),
  err, h('button', { type: 'submit', class: 'btn primary' }, t('login')),
  h('div', { class: 'hint' }, t('login_hint')))));
}

function forcePasswordChange() {
  const oldp = h('input', { type: 'password', id: 'pw-old', autocomplete: 'current-password' });
  const newp = h('input', { type: 'password', id: 'pw-new', autocomplete: 'new-password' });
  const rep = h('input', { type: 'password', id: 'pw-rep', autocomplete: 'new-password' });
  modal({
    title: t('pw_change_title'),
    body: [h('p', null, t('pw_change_text')),
      h('label', { class: 'field', for: 'pw-old' }, t('pw_current'), oldp),
      h('label', { class: 'field', for: 'pw-new' }, t('pw_new'), newp),
      h('label', { class: 'field', for: 'pw-rep' }, t('pw_repeat'), rep)],
    footer: c => [btn(t('save'), async () => {
      if (newp.value.length < 4 || newp.value !== rep.value) { toast(t('pw_mismatch'), 'bad'); return; }
      try { await ctx.api.updateMe({ old_password: oldp.value, password: newp.value }); toast(t('saved')); c(); }
      catch (e) { toast(e.message, 'bad'); }
    }, { cls: 'primary' })],
  });
}

async function start() {
  let me;
  try { me = await ctx.api.me(); }
  catch (e) { if (e.status === 401) { showLogin(); return; } throw e; }
  ctx.user = me.user; ctx.pages = me.pages;
  ctx.settings = await ctx.api.settings();
  applyTheme(store('theme') || ctx.settings.theme);
  setLang(store('lang') || ctx.settings.language);
  shell();
  route();
  if (ctx.user.must_change && !ctx.api.demo) forcePasswordChange();
  ctx.api.log('INFO', `UI opened by ${ctx.user.username} (${navigator.userAgent.slice(0, 80)})`);
}

async function boot() {
  ctx.api = await connect();
  try { ctx.settings = await ctx.api.publicSettings(); } catch { ctx.settings = { language: 'ro', theme: 'auto', app_name: 'regTester' }; }
  setLang(store('lang') || ctx.settings.language || 'ro');
  applyTheme(store('theme') || ctx.settings.theme);
  window.addEventListener('hashchange', route);
  window.addEventListener('rt-auth', () => { if (ctx.user) { ctx.user = null; showLogin(t('session_expired')); } });
  window.addEventListener('error', e => ctx.api.log('ERROR', `${e.message} @ ${e.filename}:${e.lineno}`));
  window.addEventListener('unhandledrejection', e => ctx.api.log('ERROR', `Unhandled: ${e.reason?.message || e.reason}`));
  if (!ctx.api.demo && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  await start();
}

boot().catch(e => {
  clear(app);
  app.appendChild(h('div', { class: 'login' }, h('div', { class: 'card' }, h('h1', null, 'regTester'), h('pre', { class: 'pre' }, String(e.stack || e)))));
});
