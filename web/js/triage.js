// Regression-test result analysis: group failures by message, classify new / recurring / known / flaky.

export function statusOf(v) {
  const s = String(v || '').toLowerCase();
  if (/fail|error|fehl|nok|abort|esuat|eșuat|broken|red\b/.test(s)) return 'failed';
  if (/pass|^ok|success|erfolg|green|reusit|reușit|bestanden|done/.test(s)) return 'passed';
  return 'skipped';
}

export function signature(msg) {
  return String(msg || '').toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>')
    .replace(/\d{4}-\d{2}-\d{2}([ t]\d{2}:\d{2}(:\d{2})?)?/g, '<date>')
    .replace(/\d+([.,]\d+)?/g, '#')
    .replace(/\s+/g, ' ').trim() || '(no message)';
}

export function knownMatch(msg, known) {
  const low = String(msg || '').toLowerCase();
  for (const k of known) {
    const p = String(k.data?.pattern || k.title || '').trim();
    if (!p) continue;
    if (p.startsWith('re:')) { try { if (new RegExp(p.slice(3), 'i').test(msg)) return k; } catch { /* bad pattern */ } }
    else if (low.includes(p.toLowerCase())) return k;
  }
  return null;
}

/** runs sorted oldest→newest; current & previous are run records. */
export function analyse(runs, current, previous, known, window = 5) {
  const failures = r => (r?.data?.results || []).filter(x => x.status === 'failed');
  const prevSigs = new Set(failures(previous).map(x => signature(x.message)));
  const idx = runs.indexOf(current);
  const recent = runs.slice(Math.max(0, idx - window + 1), idx + 1);
  const history = {};
  for (const run of recent) for (const res of run.data?.results || []) (history[res.test] ||= []).push(res.status);
  const firstSeen = {};
  for (const run of runs) for (const f of failures(run)) { const s = signature(f.message); if (!firstSeen[s]) firstSeen[s] = run.data?.date || run.title; }

  const groups = {};
  for (const f of failures(current)) {
    const sig = signature(f.message);
    (groups[sig] ||= { sig, sample: f.message || '(no message)', tests: [] }).tests.push(f.test);
  }
  const out = Object.values(groups).map(g => {
    const k = knownMatch(g.sample, known);
    const flakyTests = g.tests.filter(tst => {
      const hs = history[tst] || [];
      return hs.length >= 3 && hs.includes('passed') && hs.slice(0, -1).includes('failed');
    });
    let type = 'new';
    if (k) type = 'known';
    else if (flakyTests.length === g.tests.length) type = 'flaky';
    else if (prevSigs.has(g.sig)) type = 'recurring';
    return { ...g, type, known: k, firstSeen: firstSeen[g.sig], flakyTests };
  }).sort((a, b) => ['new', 'recurring', 'flaky', 'known'].indexOf(a.type) - ['new', 'recurring', 'flaky', 'known'].indexOf(b.type) || b.tests.length - a.tests.length);

  const currentSigs = new Set(out.map(g => g.sig));
  const resolved = [...new Map(failures(previous).filter(f => !currentSigs.has(signature(f.message))).map(f => [signature(f.message), f])).values()];
  const results = current?.data?.results || [];
  return {
    groups: out, resolved,
    total: results.length,
    passed: results.filter(r => r.status === 'passed').length,
    failed: results.filter(r => r.status === 'failed').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    count: type => out.filter(g => g.type === type).reduce((n, g) => n + g.tests.length, 0),
  };
}
