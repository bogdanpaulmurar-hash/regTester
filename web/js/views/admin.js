// Administration: user access, team access, roles and page permissions, login policy, backups, audit, shutdown.
import { renderHistory } from '../history-view.js';
import { t } from '../i18n.js';
import { btn, chip, clear, confirmBox, copyText, fmtDateTime, h, modal, tabs, toast } from '../util.js';

const PAGES = ['timeline', 'coverage', 'triage', 'transcripts', 'docs', 'specs'];

export async function render(root, ctx) {
  if (ctx.user.role !== 'admin') { root.appendChild(h('p', null, t('admin_only'))); return; }
  let tab = 'users';
  root.appendChild(h('div', { class: 'page-head' }, h('div', null, h('h1', null, t('nav_admin')), h('p', null, t('admin_intro')))));
  const tabBox = h('div'), body = h('div', { class: 'stack' });
  root.append(tabBox, body);
  const paint = () => {
    clear(tabBox).appendChild(tabs([['users', t('admin_users')], ['team', t('admin_team')], ['pages', t('admin_pages_tab')], ['security', t('admin_security')], ['backups', t('admin_backups')], ['audit', t('admin_audit')]], tab, v => { tab = v; paint(); }));
    clear(body);
    ({ users, team, pages, security, backups, audit })[tab]();
  };

  // -------------------------------------------------------------- users
  async function users() {
    const list = await ctx.api.users();
    body.appendChild(h('div', { class: 'toolbar' }, h('p', { class: 'hint grow', style: { margin: 0 } }, t('admin_users_hint')), btn(t('admin_user_new'), () => editUser(null), { icon: 'plus', cls: 'primary' })));
    body.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 't' },
      h('thead', null, h('tr', null, [t('username'), t('admin_display'), t('admin_role'), t('admin_pages'), t('admin_state'), t('admin_last_login'), ''].map(x => h('th', null, x)))),
      h('tbody', null, list.map(u => h('tr', null,
        h('td', { class: 'mono' }, u.username), h('td', null, u.display), h('td', null, chip(t('role_' + u.role), u.role === 'admin' ? 'info' : '')),
        h('td', { class: 'small' }, u.role === 'admin' || (u.sections || []).includes('*') ? t('admin_all_pages') : (u.sections || []).map(p => ctx.pageLabel(p)).join(', ')),
        h('td', null, u.active ? chip(t('admin_active'), 'ok') : chip(t('admin_disabled'), 'bad'), u.must_change ? chip(t('admin_must_change'), 'warn') : null),
        h('td', { class: 'nowrap small' }, u.last_login ? fmtDateTime(u.last_login) : '—'),
        h('td', { class: 'nowrap' }, btn(t('edit'), () => editUser(u), { cls: 'sm' }),
          u.username !== ctx.user.username ? btn('', async () => {
            if (!(await confirmBox(t('admin_delete_user', { name: u.username }), t('delete')))) return;
            try { await ctx.api.deleteUser(u.username); toast(t('deleted')); paint(); } catch (e) { toast(e.message, 'bad'); }
          }, { cls: 'sm ghost danger icon-btn', icon: 'trash', aria: t('delete') }) : null)))))));
  }

  function editUser(u) {
    const isNew = !u;
    const name = h('input', { type: 'text', id: 'u-name', value: u?.username || '', disabled: !isNew, autocomplete: 'off' });
    const disp = h('input', { type: 'text', id: 'u-disp', value: u?.display || '' });
    const role = h('select', { id: 'u-role' }, ['viewer', 'editor', 'admin'].map(r => h('option', { value: r, selected: (u?.role || 'editor') === r }, t('role_' + r))));
    const pw = h('input', { type: 'password', id: 'u-pw', autocomplete: 'new-password', placeholder: isNew ? '' : t('admin_pw_keep') });
    const sections = new Set(u?.sections || ['*']);
    const allBox = h('input', { type: 'checkbox', id: 'u-all', checked: sections.has('*') });
    const boxes = PAGES.map(p => h('input', { type: 'checkbox', id: 'u-p-' + p, checked: sections.has('*') || sections.has(p), disabled: sections.has('*') }));
    allBox.addEventListener('change', () => boxes.forEach(b => { b.disabled = allBox.checked; if (allBox.checked) b.checked = true; }));
    const active = h('input', { type: 'checkbox', id: 'u-active', checked: u ? u.active : true });
    const genNote = h('div', { style: { marginTop: '6px' } });
    modal({
      title: isNew ? t('admin_user_new') : `${t('edit')} · ${u.username}`,
      body: [
        h('div', { class: 'grid-form' }, h('label', { class: 'field', for: 'u-name' }, t('username'), name), h('label', { class: 'field', for: 'u-disp' }, t('admin_display'), disp),
          h('label', { class: 'field', for: 'u-role' }, t('admin_role'), role), h('label', { class: 'field', for: 'u-pw' }, isNew ? t('password') : t('admin_pw_reset'), pw)),
        h('div', null, btn(t('admin_pw_generate'), () => {
          const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
          const rnd = crypto.getRandomValues(new Uint32Array(12));
          pw.type = 'text'; pw.value = Array.from(rnd, n => abc[n % abc.length]).join('');
          clear(genNote).appendChild(chip(t('admin_pw_generated', { pw: pw.value }), 'info'));
        }, { cls: 'sm', icon: 'wand' }), genNote),
        h('p', { class: 'hint', style: { margin: 0 } }, t('admin_roles_hint')),
        h('h3', null, t('admin_pages')),
        h('label', { class: 'check', for: 'u-all' }, allBox, t('admin_all_pages')),
        h('div', { class: 'grid-form' }, PAGES.map((p, i) => h('label', { class: 'check', for: 'u-p-' + p }, boxes[i], ctx.pageLabel(p)))),
        h('label', { class: 'check', for: 'u-active' }, active, t('admin_active')),
        isNew || pw.value ? null : h('p', { class: 'hint', style: { margin: 0 } }, t('admin_pw_note'))],
      footer: c => [btn(t('cancel'), c), btn(t('save'), async () => {
        const secs = allBox.checked ? ['*'] : PAGES.filter((p, i) => boxes[i].checked);
        const data = { display: disp.value, role: role.value, sections: secs.length ? secs : ['*'], active: active.checked };
        try {
          if (isNew) await ctx.api.createUser({ username: name.value.trim().toLowerCase(), password: pw.value, must_change: true, ...data });
          else await ctx.api.updateUser(u.username, { ...data, ...(pw.value ? { password: pw.value } : {}) });
          toast(t('saved')); c(); paint();
        } catch (e) { toast(e.message, 'bad'); }
      }, { cls: 'primary' })],
    });
  }

  // --------------------------------------------------------------- team
  // Everyone logged in on this server works on the same data; this tab helps the admin share it.
  async function team() {
    const [s, sys, list] = await Promise.all([ctx.api.settings(), ctx.api.system().catch(() => ({})), ctx.api.users()]);
    const active = sys.host === '0.0.0.0';
    const urls = sys.lan_urls || [];
    const others = list.filter(u => u.active && u.username !== ctx.user.username).length;
    const state = active ? chip(t('team_net_on'), 'ok') : s.lan_access ? chip(t('team_net_pending'), 'warn') : chip(t('team_net_off'), 'bad');
    const net = h('section', { class: 'card stack' },
      h('div', { class: 'card-head' }, h('h2', null, t('team_access')), state),
      h('p', { class: 'hint', style: { margin: 0 } }, t('team_intro')));
    if (ctx.api.demo) net.appendChild(h('p', { class: 'hint', style: { margin: 0 } }, t('team_demo')));
    else if (active && urls.length) net.append(h('b', null, t('team_urls')),
      ...urls.map(u => h('div', { class: 'toolbar' }, h('span', { class: 'mono' }, u), btn(t('copy'), () => copyText(u), { cls: 'sm' }))));
    else if (s.lan_access) net.appendChild(h('p', { class: 'hint', style: { margin: 0 } }, t('set_phone_restart')));
    else net.appendChild(h('div', null, btn(t('team_enable_net'), async () => {
      try { await ctx.api.saveSettings({ lan_access: true }); toast(t('saved')); paint(); } catch (e) { toast(e.message, 'bad'); }
    }, { cls: 'primary' })));
    if (!s.require_login) net.appendChild(chip(t('team_login_off'), 'warn'));
    net.appendChild(h('p', { class: 'hint', style: { margin: 0 } }, t('team_server_note', { port: sys.port || s.port })));
    body.appendChild(net);

    body.appendChild(h('section', { class: 'card stack' },
      h('div', { class: 'card-head' }, h('h2', null, t('team_people')), chip(t('team_users_count', { n: others }), others ? 'info' : 'warn')),
      h('p', { class: 'hint', style: { margin: 0 } }, t('team_people_hint')),
      h('div', null, btn(t('admin_user_new'), () => { tab = 'users'; paint(); editUser(null); }, { icon: 'plus', cls: 'primary' }))));

    const url = urls[0] || t('team_url_placeholder');
    const text = h('textarea', { id: 'team-invite', rows: 7, readonly: true },
      t('team_invite_text', { app: s.app_name || 'regTester', url }));
    body.appendChild(h('section', { class: 'card stack' }, h('h2', null, t('team_invite')),
      h('p', { class: 'hint', style: { margin: 0 } }, t('team_invite_hint')),
      h('label', { class: 'field', for: 'team-invite' }, t('team_invite'), text),
      h('div', null, btn(t('team_copy_invite'), () => copyText(text.value), { cls: 'primary' }))));
  }

  // -------------------------------------------------------------- pages
  async function pages() {
    const s = await ctx.api.settings();
    const hidden = new Set(s.hidden_pages || []);
    const labels = { ...(s.page_labels || {}) };
    const rows = ['dashboard', ...PAGES].map(p => {
      const show = h('input', { type: 'checkbox', id: 'pg-' + p, checked: !hidden.has(p), disabled: p === 'dashboard' });
      const name = h('input', { type: 'text', id: 'pg-n-' + p, value: labels[p] || '', placeholder: t('nav_' + p), 'aria-label': t('admin_page_label') + ' ' + t('nav_' + p) });
      return { p, show, name, el: h('tr', null, h('td', null, h('label', { class: 'check', for: 'pg-' + p }, show, t('nav_' + p))), h('td', null, name)) };
    });
    body.appendChild(h('section', { class: 'card stack' }, h('h2', null, t('admin_pages_tab')),
      h('p', { class: 'hint', style: { margin: 0 } }, t('admin_pages_hint')),
      h('div', { class: 'table-wrap' }, h('table', { class: 't' },
        h('thead', null, h('tr', null, h('th', null, t('admin_page_visible')), h('th', null, t('admin_page_label')))),
        h('tbody', null, rows.map(r => r.el)))),
      h('div', null, btn(t('save'), async () => {
        const hp = rows.filter(r => !r.show.checked).map(r => r.p);
        const pl = Object.fromEntries(rows.filter(r => r.name.value.trim()).map(r => [r.p, r.name.value.trim()]));
        try { await ctx.api.saveSettings({ hidden_pages: hp, page_labels: pl }); await ctx.reloadSettings(); toast(t('saved')); ctx.rebuildShell(); }
        catch (e) { toast(e.message, 'bad'); }
      }, { cls: 'primary' }))));
  }

  // ----------------------------------------------------------- security
  async function security() {
    const s = await ctx.api.settings();
    const req = h('input', { type: 'checkbox', id: 'a-req', checked: s.require_login });
    body.appendChild(h('section', { class: 'card stack' }, h('h2', null, t('admin_login_policy')),
      h('label', { class: 'check', for: 'a-req' }, req, t('admin_require_login')),
      h('p', { class: 'hint', style: { margin: 0 } }, t('admin_require_login_hint')),
      h('div', null, btn(t('save'), async () => { try { await ctx.api.saveSettings({ require_login: req.checked }); toast(t('saved')); } catch (e) { toast(e.message, 'bad'); } }, { cls: 'primary' }))));
    const sso = { provider: 'entra', tenant_id: '', client_id: '', enabled: false, ...(s.sso || {}) };
    const tenant = h('input', { type: 'text', id: 'a-sso-tenant', value: sso.tenant_id, autocomplete: 'off', placeholder: '00000000-0000-0000-0000-000000000000' });
    const client = h('input', { type: 'text', id: 'a-sso-client', value: sso.client_id, autocomplete: 'off', placeholder: '00000000-0000-0000-0000-000000000000' });
    const redirect = `${location.origin}/api/sso/callback`;
    body.appendChild(h('section', { class: 'card stack' },
      h('div', { class: 'card-head' }, h('h2', null, t('admin_sso')), chip(t('admin_sso_soon'), 'warn')),
      h('p', { class: 'hint', style: { margin: 0 } }, t('admin_sso_hint')),
      h('div', { class: 'grid-form' },
        h('label', { class: 'field', for: 'a-sso-prov' }, t('admin_sso_provider'), h('select', { id: 'a-sso-prov' }, h('option', { value: 'entra', selected: true }, 'Microsoft Entra ID'))),
        h('label', { class: 'field', for: 'a-sso-tenant' }, t('admin_sso_tenant'), tenant),
        h('label', { class: 'field', for: 'a-sso-client' }, t('admin_sso_client'), client),
        h('label', { class: 'field', for: 'a-sso-redir' }, t('admin_sso_redirect'), h('input', { type: 'text', id: 'a-sso-redir', value: redirect, readonly: true }))),
      h('label', { class: 'check', for: 'a-sso-on' }, h('input', { type: 'checkbox', id: 'a-sso-on', checked: false, disabled: true }), `${t('admin_sso_enabled')} (${t('admin_sso_soon')})`),
      h('div', null, btn(t('save'), async () => {
        try { await ctx.api.saveSettings({ sso: { provider: 'entra', tenant_id: tenant.value.trim(), client_id: client.value.trim(), enabled: false } }); toast(t('saved')); }
        catch (e) { toast(e.message, 'bad'); }
      }, { cls: 'primary' }))));
    if (!ctx.api.demo) body.appendChild(h('section', { class: 'card stack' }, h('h2', null, t('admin_recovery')),
      h('p', { class: 'hint', style: { margin: 0 } }, t('admin_recovery_hint'))));
    const sys = await ctx.api.system().catch(() => ({}));
    body.appendChild(h('section', { class: 'card stack' }, h('h2', null, t('admin_system')),
      h('div', { class: 'small' }, `${t('set_data_dir')}: `, h('span', { class: 'mono', style: { overflowWrap: 'anywhere' } }, sys.data_dir || '—')),
      h('div', { class: 'small' }, `${t('admin_listen')}: `, h('span', { class: 'mono' }, `${sys.host}:${sys.port}`)),
      h('div', { class: 'pill-row' }, Object.entries(sys.counts || {}).map(([k, v]) => chip(`${t('sec_' + k)} · ${v}`))),
      ctx.api.demo
        ? h('div', null, btn(t('admin_demo_reset'), async () => { if (await confirmBox(t('admin_demo_reset_q'), t('admin_demo_reset'))) { ctx.api.reset(); location.reload(); } }, { cls: 'danger' }))
        : h('div', null, btn(t('admin_quit'), async () => { if (await confirmBox(t('admin_quit_q'), t('admin_quit'))) { await ctx.api.quit(); toast(t('admin_quit_done')); } }, { cls: 'danger' }))));
  }

  // ------------------------------------------------------------ backups
  async function backups() {
    const list = await ctx.api.backups();
    body.appendChild(h('div', { class: 'toolbar' }, h('p', { class: 'hint grow', style: { margin: 0 } }, t('admin_backups_hint')),
      btn(t('admin_backup_now'), async () => { try { const r = await ctx.api.backupNow(); toast(t('admin_backup_done', { name: r.name })); paint(); } catch (e) { toast(e.message, 'bad'); } }, { cls: 'primary', icon: 'download' })));
    if (!list.length) { body.appendChild(h('p', { class: 'hint' }, t('admin_no_backups'))); return; }
    body.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 't' },
      h('thead', null, h('tr', null, [t('f_file'), t('f_date'), t('admin_size'), ''].map(x => h('th', null, x)))),
      h('tbody', null, list.map(b => h('tr', null, h('td', { class: 'mono' }, b.name), h('td', { class: 'nowrap' }, fmtDateTime(b.ts)), h('td', { class: 'num' }, (b.size / 1024 / 1024).toFixed(1) + ' MB'),
        h('td', null, btn(t('admin_restore'), async () => {
          if (!(await confirmBox(t('admin_restore_q', { name: b.name }), t('admin_restore')))) return;
          try { await ctx.api.restoreBackup(b.name); toast(t('admin_restored')); setTimeout(() => location.reload(), 800); } catch (e) { toast(e.message, 'bad'); }
        }, { cls: 'sm' }))))))));
  }

  async function audit() {
    const box = h('div', { class: 'card' });
    body.appendChild(box);
    renderHistory(box, ctx, { sections: ['admin', 'settings'] });
  }

  paint();
}
