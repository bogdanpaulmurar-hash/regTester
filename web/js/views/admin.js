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
  // The common data lives in a folder on a network share; every colleague's regTester opens it.
  async function team() {
    const [s, st, list] = await Promise.all([ctx.api.settings(), ctx.api.shared(), ctx.api.users()]);
    const shared = st.mode === 'shared' || st.mode === 'offline' || st.mode === 'unavailable';
    const when = ts => ts ? fmtDateTime(ts) : '—';
    const modeChip = {
      local: chip(t('team_mode_local'), 'info'), shared: chip(t('team_mode_shared'), 'ok'),
      offline: chip(t('team_mode_offline'), 'warn'), unavailable: chip(t('team_mode_unavailable'), 'bad'),
    }[st.mode] || null;

    // ---- shared folder
    const path = h('input', { type: 'text', id: 'team-path', value: st.path || s.shared_path || '', placeholder: '\\\\server\\regTester', autocomplete: 'off' });
    const result = h('div', { class: 'pill-row' });
    const showCheck = r => clear(result).append(
      !r.exists ? chip(t('err_shared_not_found'), 'bad') : !r.writable ? chip(t('err_shared_not_writable'), 'bad')
        : r.has_db ? chip(t('team_has_db'), 'ok') : chip(t('team_empty_folder'), 'info'));
    const check = async () => { const r = await ctx.api.sharedCheck(path.value.trim()); showCheck(r); return r; };
    const connect = async () => {
      let r;
      try { r = await check(); } catch (e) { toast(e.message, 'bad'); return; }
      if (!r.exists || !r.writable) return;
      const go = async init => {
        try { await ctx.api.sharedConnect(path.value.trim(), init); toast(t('team_connected_login'), 'ok'); setTimeout(() => location.reload(), 900); }
        catch (e) { toast(e.message, 'bad'); }
      };
      if (r.has_db) {
        if (await confirmBox(t('team_join_q', { path: r.path }), t('team_connect'))) go(null);
        return;
      }
      modal({
        title: t('team_init_title'),
        body: [h('p', null, t('team_init_text', { path: r.path })), h('p', { class: 'hint' }, t('team_relogin_note'))],
        footer: c => [btn(t('cancel'), c),
          btn(t('team_init_empty'), () => { c(); go('empty'); }),
          btn(t('team_init_copy'), () => { c(); go('copy'); }, { cls: 'primary' })],
      });
    };
    const folder = h('section', { class: 'card stack' },
      h('div', { class: 'card-head' }, h('h2', null, t('team_shared')), modeChip),
      h('p', { class: 'hint', style: { margin: 0 } }, t('team_shared_intro')),
      h('label', { class: 'field', for: 'team-path' }, t('team_path'), path),
      result,
      h('div', { class: 'toolbar' },
        btn(t('team_check'), () => check().catch(e => toast(e.message, 'bad'))),
        btn(st.mode === 'local' ? t('team_connect') : t('team_switch'), connect, { cls: 'primary' }),
        shared ? btn(t('team_disconnect'), async () => {
          if (!(await confirmBox(t('team_disconnect_q'), t('team_disconnect')))) return;
          try { await ctx.api.sharedDisconnect(); toast(t('team_connected_login'), 'ok'); setTimeout(() => location.reload(), 900); }
          catch (e) { toast(e.message, 'bad'); }
        }, { cls: 'ghost' }) : null));
    if (st.mode === 'offline') folder.appendChild(h('p', { class: 'hint', style: { margin: 0 } }, t('team_offline_since', { when: when(st.copy_ts) })));
    if (st.error && st.mode !== 'shared') folder.appendChild(h('div', { class: 'small mono', style: { overflowWrap: 'anywhere' } }, st.error));
    if (shared) folder.appendChild(h('p', { class: 'hint', style: { margin: 0 } }, t('team_copy_note', { when: when(st.copy_ts) })));
    body.appendChild(folder);

    // ---- activity: who saves right now, which computers are connected, admin unlock
    if (st.mode === 'shared') {
      const w = st.writer;
      const act = h('section', { class: 'card stack' },
        h('div', { class: 'card-head' }, h('h2', null, t('team_activity')), btn(t('refresh'), () => paint(), { cls: 'sm' })),
        h('p', { class: 'hint', style: { margin: 0 } }, t('team_activity_hint')),
        h('div', null, w
          ? chip(t(w.stale ? 'team_writer_stale' : 'team_writer', { user: w.user || '?', host: w.host || '?', age: Math.round(w.age) }), w.stale ? 'bad' : 'warn')
          : chip(t('team_writer_none'), 'ok')),
        h('div', null, btn(t('team_unlock'), async () => {
          if (!(await confirmBox(t('team_unlock_q'), t('team_unlock')))) return;
          try { const r = await ctx.api.sharedUnlock(); toast(r.held ? t('team_unlocked', { user: r.held.user || '?' }) : t('team_writer_none'), 'ok'); paint(); }
          catch (e) { toast(e.message, 'bad'); }
        }, { cls: 'danger', disabled: !w })),
        h('h3', null, t('team_machines')),
        (st.machines || []).length
          ? h('div', { class: 'table-wrap' }, h('table', { class: 't' },
            h('thead', null, h('tr', null, [t('team_machine'), t('team_machine_users'), t('team_machine_seen')].map(x => h('th', null, x)))),
            h('tbody', null, st.machines.map(m => h('tr', null, h('td', { class: 'mono' }, m.host + (m.host === st.host ? ` (${t('team_this_pc')})` : '')),
              h('td', null, (m.users || []).join(', ') || '—'), h('td', { class: 'nowrap small' }, fmtDateTime(m.ts)))))))
          : h('p', { class: 'hint', style: { margin: 0 } }, t('team_machines_none')));
      body.appendChild(act);
    }

    // ---- colleagues
    const others = list.filter(u => u.active && u.username !== ctx.user.username).length;
    body.appendChild(h('section', { class: 'card stack' },
      h('div', { class: 'card-head' }, h('h2', null, t('team_people')), chip(t('team_users_count', { n: others }), others ? 'info' : 'warn')),
      h('p', { class: 'hint', style: { margin: 0 } }, t('team_people_hint')),
      h('div', null, btn(t('admin_user_new'), () => { tab = 'users'; paint(); editUser(null); }, { icon: 'plus', cls: 'primary' }))));

    // ---- invitation
    const inv = h('section', { class: 'card stack' }, h('h2', null, t('team_invite')));
    if (st.mode === 'local') inv.appendChild(h('p', { class: 'hint', style: { margin: 0 } }, t('team_invite_first')));
    else {
      const text = h('textarea', { id: 'team-invite', rows: 8, readonly: true },
        t('team_invite_text', { app: s.app_name || 'regTester', path: st.path || '' }));
      inv.append(h('p', { class: 'hint', style: { margin: 0 } }, t('team_invite_hint')),
        h('label', { class: 'field', for: 'team-invite' }, t('team_invite'), text),
        h('div', null, btn(t('team_copy_invite'), () => copyText(text.value), { cls: 'primary' })));
    }
    body.appendChild(inv);
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
    const idle = h('input', { type: 'number', id: 'a-idle', min: 5, max: 1440, step: 5, value: s.session_idle_minutes ?? 30 });
    body.appendChild(h('section', { class: 'card stack' }, h('h2', null, t('admin_login_policy')),
      h('label', { class: 'check', for: 'a-req' }, req, t('admin_require_login')),
      h('p', { class: 'hint', style: { margin: 0 } }, t('admin_require_login_hint')),
      h('div', { class: 'grid-form' }, h('label', { class: 'field', for: 'a-idle' }, t('admin_idle'), idle, h('small', { class: 'hint' }, t('admin_idle_hint')))),
      h('div', null, btn(t('save'), async () => {
        const minutes = Math.min(1440, Math.max(5, Math.round(+idle.value || 30)));
        try { await ctx.api.saveSettings({ require_login: req.checked, session_idle_minutes: minutes }); toast(t('saved')); } catch (e) { toast(e.message, 'bad'); }
      }, { cls: 'primary' }))));
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
