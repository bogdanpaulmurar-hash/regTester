// Administration: user access, roles and page permissions, login policy, backups, audit, shutdown.
import { renderHistory } from '../history-view.js';
import { t } from '../i18n.js';
import { btn, chip, clear, confirmBox, fmtDateTime, h, modal, tabs, toast } from '../util.js';

const PAGES = ['timeline', 'coverage', 'triage', 'transcripts', 'docs', 'specs'];

export async function render(root, ctx) {
  if (ctx.user.role !== 'admin') { root.appendChild(h('p', null, t('admin_only'))); return; }
  let tab = 'users';
  root.appendChild(h('div', { class: 'page-head' }, h('div', null, h('h1', null, t('nav_admin')), h('p', null, t('admin_intro')))));
  const tabBox = h('div'), body = h('div', { class: 'stack' });
  root.append(tabBox, body);
  const paint = () => {
    clear(tabBox).appendChild(tabs([['users', t('admin_users')], ['security', t('admin_security')], ['backups', t('admin_backups')], ['audit', t('admin_audit')]], tab, v => { tab = v; paint(); }));
    clear(body);
    ({ users, security, backups, audit })[tab]();
  };

  // -------------------------------------------------------------- users
  async function users() {
    const list = await ctx.api.users();
    body.appendChild(h('div', { class: 'toolbar' }, h('p', { class: 'hint grow', style: { margin: 0 } }, t('admin_users_hint')), btn(t('admin_user_new'), () => editUser(null), { icon: 'plus', cls: 'primary' })));
    body.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 't' },
      h('thead', null, h('tr', null, [t('username'), t('admin_display'), t('admin_role'), t('admin_pages'), t('admin_state'), t('admin_last_login'), ''].map(x => h('th', null, x)))),
      h('tbody', null, list.map(u => h('tr', null,
        h('td', { class: 'mono' }, u.username), h('td', null, u.display), h('td', null, chip(t('role_' + u.role), u.role === 'admin' ? 'info' : '')),
        h('td', { class: 'small' }, u.role === 'admin' || (u.sections || []).includes('*') ? t('admin_all_pages') : (u.sections || []).map(p => t('nav_' + p)).join(', ')),
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
    modal({
      title: isNew ? t('admin_user_new') : `${t('edit')} · ${u.username}`,
      body: [
        h('div', { class: 'grid-form' }, h('label', { class: 'field', for: 'u-name' }, t('username'), name), h('label', { class: 'field', for: 'u-disp' }, t('admin_display'), disp),
          h('label', { class: 'field', for: 'u-role' }, t('admin_role'), role), h('label', { class: 'field', for: 'u-pw' }, isNew ? t('password') : t('admin_pw_reset'), pw)),
        h('p', { class: 'hint', style: { margin: 0 } }, t('admin_roles_hint')),
        h('h3', null, t('admin_pages')),
        h('label', { class: 'check', for: 'u-all' }, allBox, t('admin_all_pages')),
        h('div', { class: 'grid-form' }, PAGES.map((p, i) => h('label', { class: 'check', for: 'u-p-' + p }, boxes[i], t('nav_' + p)))),
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

  // ----------------------------------------------------------- security
  async function security() {
    const s = await ctx.api.settings();
    const req = h('input', { type: 'checkbox', id: 'a-req', checked: s.require_login });
    body.appendChild(h('section', { class: 'card stack' }, h('h2', null, t('admin_login_policy')),
      h('label', { class: 'check', for: 'a-req' }, req, t('admin_require_login')),
      h('p', { class: 'hint', style: { margin: 0 } }, t('admin_require_login_hint')),
      h('div', null, btn(t('save'), async () => { try { await ctx.api.saveSettings({ require_login: req.checked }); toast(t('saved')); } catch (e) { toast(e.message, 'bad'); } }, { cls: 'primary' }))));
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
