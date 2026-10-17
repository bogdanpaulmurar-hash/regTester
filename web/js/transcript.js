// Teams transcript parsing and cleaning (VTT, Teams .docx export, "Name: text" plain text).
import { normalize, tokens, words } from './util.js';

const TIME = /(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?)/;

export function parseTranscript(input) {
  const text = typeof input === 'string' ? input : (input.text || '');
  const lines = text.replace(/\r/g, '').split('\n');
  const segs = [];
  const push = (speaker, time, t) => { const s = String(t || '').trim(); if (s) segs.push({ speaker: (speaker || '').trim(), time: time || '', text: s }); };

  if (/^WEBVTT/.test(text.trim()) || lines.some(l => /-->/.test(l))) {
    let time = '';
    for (const l of lines) {
      if (/-->/.test(l)) { time = (l.match(TIME) || [''])[0]; continue; }
      if (!l.trim() || /^WEBVTT|^NOTE|^\d+$/.test(l.trim())) continue;
      const v = /<v\s+([^>]+)>(.*?)(<\/v>)?$/.exec(l.trim());
      if (v) { push(v[1], time, v[2].replace(/<[^>]+>/g, '')); continue; }
      const c = /^([^:]{2,40}):\s+(.*)$/.exec(l.trim());
      if (c) push(c[1], time, c[2]); else if (segs.length && segs[segs.length - 1].time === time) segs[segs.length - 1].text += ' ' + l.trim(); else push('', time, l);
    }
    return segs;
  }
  // Teams docx export: "Speaker Name   0:03" followed by text lines
  const header = /^(.{2,60}?)\s{1,}(\d{1,2}:\d{2}(?::\d{2})?)\s*$/;
  const headerAlt = /^(\d{1,2}:\d{2}(?::\d{2})?)\s+(.{2,60})$/;
  if (lines.filter(l => header.test(l.trim())).length >= 2) {
    let cur = null;
    for (const l of lines) {
      const m = header.exec(l.trim());
      if (m) { if (cur) push(cur.s, cur.t, cur.x); cur = { s: m[1], t: m[2], x: '' }; }
      else if (cur) cur.x += ' ' + l.trim();
    }
    if (cur) push(cur.s, cur.t, cur.x);
    return segs;
  }
  if (lines.filter(l => headerAlt.test(l.trim())).length >= 2) {
    let cur = null;
    for (const l of lines) {
      const m = headerAlt.exec(l.trim());
      if (m && !/[.!?]$/.test(m[2])) { if (cur) push(cur.s, cur.t, cur.x); cur = { s: m[2], t: m[1], x: '' }; }
      else if (cur) cur.x += ' ' + l.trim();
    }
    if (cur) push(cur.s, cur.t, cur.x);
    return segs;
  }
  for (const l of lines) {
    const c = /^([^:]{2,40}):\s+(.*)$/.exec(l.trim());
    if (c) push(c[1], '', c[2]); else push('', '', l);
  }
  return segs;
}

const DE = new Set('der die das und ist nicht ich wir auch geht dann wenn mit auf für aber noch schon sie es ein eine zu im den dem bitte genau'.split(' '));
const EN = new Set('the and is to we you this that it for with on are can will be should have of not'.split(' '));
export function langOf(text) {
  let de = 0, en = 0;
  for (const w of String(text).toLowerCase().split(/[^a-zäöüß]+/)) { if (DE.has(w)) de++; if (EN.has(w)) en++; }
  return de > en && de >= 1 ? 'de' : 'en';
}

const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function cleanTranscript(segs, { fillers = '', glossary = [] } = {}) {
  const fill = String(fillers).split(',').map(s => s.trim()).filter(Boolean).sort((a, b) => b.length - a.length);
  const fillRe = fill.length ? new RegExp(`(^|[^\\p{L}])(?:${fill.map(escRe).join('|')})(?=$|[^\\p{L}])`, 'giu') : null;
  const gl = glossary.filter(g => g.wrong).map(g => ({ ...g, re: new RegExp(`(^|[^\\p{L}])(${escRe(g.wrong)})(?=$|[^\\p{L}])`, 'giu') }));
  let removed = 0, fixed = 0;
  const out = [];
  for (const s of segs) {
    let x = s.text;
    if (fillRe) x = x.replace(fillRe, (m, pre) => { removed++; return pre; });
    x = x.replace(/(^|[^\p{L}])(\p{L}+)((?:[\s,]+\2)+)(?=$|[^\p{L}])/giu, (m, pre, w) => { removed++; return pre + w; });
    for (const g of gl) x = x.replace(g.re, (m, pre) => { fixed++; return pre + '\u0001' + g.right + '\u0002'; });
    x = x.replace(/\s+([,.!?])/g, '$1').replace(/^[\s,.;-]+/, '').replace(/\s{2,}/g, ' ').trim();
    if (!x || /^[\p{P}\s]*$/u.test(x)) continue;
    x = x.charAt(0).toUpperCase() + x.slice(1);
    const prev = out[out.length - 1];
    if (prev && prev.speaker === s.speaker) prev.text += (/[.!?:;]\u0002?$/.test(prev.text) ? ' ' : '. ') + x;
    else out.push({ speaker: s.speaker, time: s.time, text: x });
  }
  for (const o of out) o.lang = langOf(o.text.replace(/[\u0001\u0002]/g, ''));
  const plain = o => o.text.replace(/[\u0001\u0002]/g, '');
  const text = out.map(o => `${o.speaker ? o.speaker + ': ' : ''}${o.lang === 'de' ? '[DE] ' : ''}${plain(o)}`).join('\n');
  const rawText = segs.map(s => s.text).join(' ');
  return { segments: out, text, removed, fixed, wordsBefore: words(rawText), wordsAfter: words(text) };
}

export function detectFeatures(text, features) {
  const n = normalize(text);
  const toks = new Set(tokens(text));
  return features.filter(f => {
    if (f.key && n.includes(normalize(f.key))) return true;
    const ft = tokens(f.title);
    if (!ft.length) return false;
    return ft.filter(x => toks.has(x)).length / ft.length >= 0.6;
  });
}
