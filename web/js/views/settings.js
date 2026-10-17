// Settings: language, look, Windows startup and tray, phone access, matching rules, transcripts, log, account.
import { t } from '../i18n.js';
import { TIMELINE_KINDS } from '../timeline-gen.js';
import { btn, chip, copyText, fmtDateTime, h, store, toast } from '../util.js';

export async function render(root, ctx) {
  const s = await ctx.api.settings();
  const sys = await ctx.api.system().catch(() => ({}));
  const admin = ctx.user.role === 'admin';
  const editable = ctx.user.role !== 'viewer';

  root.appendChild(h('div', { class: 'page-head' }, h('div', null, h('h1', null, t('nav_settings')), h('p', null, t('set_intro')))));

  async function saveVals(vals) {
    try {
      const res = await ctx.api.saveSettings(vals);
      await ctx.reloadSettings();
      toast(res.restart_required ? t('set_saved_restart') : t('saved'));
      return res;
    } catch (e) { toast(e.message, 'bad'); return null; }
  }

  const card = (title, intro, rows, onSave, adminOnly) => {
    const disabled = adminOnly ? !admin : !editable;
    const c = h('section', { class: 'card stack' }, h('div', { class: 'card-head' }, h('h2', null, title), adminOnly && !admin ? chip(t('set_admin_only'), 'info') : null),
      intro ? h('p', { class: 'hint', style: { margin: 0 } }, intro) : null, rows,
      onSave && !disabled ? h('div', null, btn(t('save'), onSave, { cls: 'primary' })) : null);
    if (disabled) c.querySelectorAll('input, select, textarea').forEach(i => { i.disabled = true; });
    return c;
  };
  const field = (id, label, el, hint) => h('label', { class: 'field', for: id }, label, el, hint ? h('span', { class: 'hint' }, hint) : null);
  const check = (id, label, val) => { const i = h('input', { type: 'checkbox', id, checked: val }); return [h('label', { class: 'check', for: id }, i, label), i]; };

  // ---- language & look
  const lang = h('select', { id: 's-lang' }, [['ro', 'Română'], ['en', 'English'], ['de', 'Deutsch']].map(([v, l]) => h('option', { value: v, selected: s.language === v }, l)));
  const theme = h('select', { id: 's-theme' }, [['auto', t('theme_auto')], ['light', t('theme_light')], ['dark', t('theme_dark')]].map(([v, l]) => h('option', { value: v, selected: s.theme === v }, l)));
  const appName = h('input', { type: 'text', id: 's-name', value: s.app_name });
  const logoImg = h('img', { src: ctx.api.logoUrl(), alt: t('set_logo'), width: 56, height: 56, style: { borderRadius: '10px', border: '1px solid var(--line)' } });
  const logoInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/svg+xml', hidden: true, onchange: () => uploadLogo(logoInput.files[0]) });
  async function uploadLogo(file) {
    if (!file) return;
    const img = new Image();
    img.onload = async () => {
      const c = document.createElement('canvas'); c.width = c.height = 256;
      const g = c.getContext('2d'); const scale = Math.min(256 / img.width, 256 / img.height);
      g.drawImage(img, (256 - img.width * scale) / 2, (256 - img.height * scale) / 2, img.width * scale, img.height * scale);
      try { await ctx.api.setLogo(c.toDataURL('image/png')); logoImg.src = ctx.api.logoUrl(); document.querySelectorAll('.brand img').forEach(i => { i.src = ctx.api.logoUrl(); }); toast(t('set_logo_saved')); }
      catch (e) { toast(e.message, 'bad'); }
    };
    img.src = URL.createObjectURL(file);
  }
  root.appendChild(card(t('set_general'), t('set_general_intro'), [
    h('div', { class: 'grid-form' }, field('s-lang', t('set_language'), lang, t('set_language_hint')), field('s-theme', t('set_theme'), theme), field('s-name', t('set_app_name'), appName)),
    h('div', { class: 'toolbar' }, logoImg, h('div', { class: 'stack', style: { gap: '4px' } }, h('b', null, t('set_logo')), h('span', { class: 'hint' }, t('set_logo_hint'))),
      editable ? [btn(t('set_logo_upload'), () => logoInput.click(), { icon: 'upload', cls: 'sm' }), btn(t('set_logo_reset'), async () => { await ctx.api.resetLogo(); logoImg.src = ctx.api.logoUrl(); document.querySelectorAll('.brand img').forEach(i => { i.src = ctx.api.logoUrl(); }); }, { cls: 'sm ghost' })] : null, logoInput),
  ], async () => {
    const r = await saveVals({ language: lang.value, theme: theme.value, app_name: appName.value || 'regTester' });
    if (r) { store('lang', null); store('theme', null); location.reload(); }
  }));

  // ---- windows
  const [autoL, auto] = check('s-auto', t('set_autostart'), s.autostart);
  const [minL, min] = check('s-min', t('set_start_tray'), s.start_minimized);
  const [openL, openB] = check('s-open', t('set_open_browser'), s.open_browser_on_start);
  const [bkL, bk] = check('s-bk', t('set_backup_start'), s.backup_on_start);
  const keep = h('input', { type: 'number', id: 's-keep', min: 1, max: 100, value: s.backup_keep });
  root.appendChild(card(t('set_windows'), t('set_windows_intro'), [
    h('div', { class: 'stack', style: { gap: '2px' } }, autoL, minL, openL, bkL),
    h('div', { class: 'grid-form' }, field('s-keep', t('set_backup_keep'), keep)),
    h('div', { class: 'pill-row' }, chip(sys.windows ? t('set_on_windows') : t('set_not_windows'), sys.windows ? 'ok' : 'warn'),
      chip(sys.tray ? t('set_tray_on') : t('set_tray_off'), sys.tray ? 'ok' : 'warn')),
    !sys.tray && !ctx.api.demo ? h('p', { class: 'hint', style: { margin: 0 } }, t('set_tray_install')) : null,
  ], () => saveVals({ autostart: auto.checked, start_minimized: min.checked, open_browser_on_start: openB.checked, backup_on_start: bk.checked, backup_keep: +keep.value || 10 })));

  // ---- phone / network
  const [lanL, lan] = check('s-lan', t('set_lan'), s.lan_access);
  const port = h('input', { type: 'number', id: 's-port', min: 1024, max: 65535, value: s.port });
  root.appendChild(card(t('set_phone'), t('set_phone_intro'), [
    lanL, h('div', { class: 'grid-form' }, field('s-port', t('set_port'), port, t('set_port_hint'))),
    sys.lan_urls?.length ? h('div', { class: 'stack' }, h('b', null, t('set_phone_urls')), sys.lan_urls.map(u => h('div', { class: 'toolbar' }, h('span', { class: 'mono' }, u), btn(t('copy'), () => copyText(u), { cls: 'sm' }))))
      : h('p', { class: 'hint', style: { margin: 0 } }, s.lan_access ? t('set_phone_restart') : t('set_phone_off')),
    h('p', { class: 'hint', style: { margin: 0 } }, t('set_phone_security')),
  ], () => saveVals({ lan_access: lan.checked, port: +port.value || 8765 }), true));

  // ---- matching
  const rx = h('input', { type: 'text', id: 's-rx', value: s.feature_code_regex, class: 'mono' });
  const thr = h('input', { type: 'number', id: 's-thr', min: 0.2, max: 1, step: 0.05, value: s.match_threshold });
  const fw = h('input', { type: 'number', id: 's-fw', min: 3, max: 20, value: s.flaky_window });
  root.appendChild(card(t('set_matching'), t('set_matching_intro'), h('div', { class: 'grid-form' },
    field('s-rx', t('set_code_regex'), rx, t('set_code_regex_hint')), field('s-thr', t('set_threshold'), thr, t('set_threshold_hint')), field('s-fw', t('set_flaky'), fw, t('set_flaky_hint'))),
  () => { try { new RegExp(rx.value); } catch { toast(t('set_bad_regex'), 'bad'); return; } saveVals({ feature_code_regex: rx.value, match_threshold: +thr.value, flaky_window: +fw.value }); }));

  // ---- transcripts
  const fill = h('textarea', { id: 's-fill', rows: 3, value: s.filler_words });
  const prompt = h('textarea', { id: 's-prompt', rows: 7, value: s.ai_prompt });
  root.appendChild(card(t('set_transcripts'), null, [field('s-fill', t('set_fillers'), fill, t('set_fillers_hint')), field('s-prompt', t('set_prompt'), prompt, t('set_prompt_hint'))],
    () => saveVals({ filler_words: fill.value, ai_prompt: prompt.value })));

  // ---- timeline colors
  const colorInputs = {};
  root.appendChild(card(t('set_colors'), null, h('div', { class: 'grid-form' }, TIMELINE_KINDS.map(k => {
    colorInputs[k] = h('input', { type: 'color', id: 's-c-' + k, value: (s.timeline_colors || {})[k] || '#6B7280' });
    return h('label', { class: 'check', for: 's-c-' + k }, colorInputs[k], t('k_' + k));
  })), () => saveVals({ timeline_colors: Object.fromEntries(TIMELINE_KINDS.map(k => [k, colorInputs[k].value])) })));

  // ---- log
  const lvl = h('select', { id: 's-lvl' }, ['DEBUG', 'INFO', 'WARNING', 'ERROR'].map(v => h('option', { value: v, selected: s.log_level === v }, v)));
  const ret = h('input', { type: 'number', id: 's-ret', min: 1, max: 365, value: s.log_retention_days });
  root.appendChild(card(t('set_log'), t('set_log_intro'), [h('div', { class: 'grid-form' }, field('s-lvl', t('set_log_level'), lvl), field('s-ret', t('set_log_days'), ret)),
    sys.log_file ? h('div', { class: 'small muted' }, h('span', null, t('set_log_file') + ': '), h('span', { class: 'mono', style: { overflowWrap: 'anywhere' } }, sys.log_file)) : null],
  () => saveVals({ log_level: lvl.value, log_retention_days: +ret.value || 30 }), true));

  // ---- my account
  if (!ctx.api.demo && ctx.user.username !== 'local') {
    const disp = h('input', { type: 'text', id: 's-disp', value: ctx.user.display || '' });
    const oldp = h('input', { type: 'password', id: 's-oldp', autocomplete: 'current-password' });
    const newp = h('input', { type: 'password', id: 's-newp', autocomplete: 'new-password' });
    const acc = h('section', { class: 'card stack' }, h('h2', null, t('set_account')),
      h('div', { class: 'grid-form' }, field('s-disp', t('set_display'), disp), field('s-oldp', t('pw_current'), oldp), field('s-newp', t('pw_new'), newp)),
      h('div', null, btn(t('save'), async () => {
        try { const r = await ctx.api.updateMe({ display: disp.value, ...(newp.value ? { password: newp.value, old_password: oldp.value } : {}) }); ctx.user = r.user; toast(t('saved')); oldp.value = newp.value = ''; }
        catch (e) { toast(e.message, 'bad'); }
      }, { cls: 'primary' })));
    root.appendChild(acc);
  }

  // ---- about
  root.appendChild(h('section', { class: 'card' }, h('h2', null, t('set_about')), h('div', { class: 'table-wrap', style: { border: 0 } }, h('table', { class: 't' }, h('tbody', null,
    [['regTester', sys.version], ['Python', sys.python], [t('set_platform'), sys.platform], [t('set_data_dir'), sys.data_dir],
      [t('set_uptime'), sys.uptime ? Math.round(sys.uptime / 60) + ' min' : '—'], [t('set_started'), sys.uptime ? fmtDateTime(Date.now() / 1000 - sys.uptime) : '—']]
      .map(([k, v]) => h('tr', null, h('td', { class: 'muted nowrap' }, k), h('td', { class: 'mono', style: { overflowWrap: 'anywhere' } }, v ?? '—'))))))));
}
