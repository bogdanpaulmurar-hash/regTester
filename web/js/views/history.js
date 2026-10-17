// Global history across all sections the user can see.
import { renderHistory } from '../history-view.js';
import { t } from '../i18n.js';
import { clear, h, seg } from '../util.js';

const GROUPS = {
  all: null, timeline: ['timeline'], coverage: ['features', 'tests'], triage: ['runs', 'known'], transcripts: ['transcripts', 'glossary'],
  docs: ['docs', 'templates'], specs: ['specs'], settings: ['settings'], admin: ['admin'],
};

export async function render(root, ctx) {
  root.appendChild(h('div', { class: 'page-head' }, h('div', null, h('h1', null, t('nav_history')), h('p', null, t('hist_intro')))));
  const groups = Object.keys(GROUPS).filter(g => g === 'all' || (['settings', 'admin'].includes(g) ? ctx.user.role === 'admin' : ctx.canPage(g)));
  let current = 'all';
  const segBox = h('div', { style: { overflowX: 'auto' } });
  const box = h('div', { class: 'card' });
  root.append(segBox, box);
  const paint = () => {
    clear(segBox).appendChild(seg(groups.map(g => [g, g === 'all' ? t('all') : t('nav_' + g)]), current, v => { current = v; paint(); }));
    renderHistory(box, ctx, GROUPS[current] ? { sections: GROUPS[current] } : {});
  };
  paint();
}
