// Offline shell for the installed app. API calls always go to the server (never cached).
const CACHE = 'regtester-shell-v7';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/logo.svg',
  'js/app.js', 'js/api.js', 'js/demo.js', 'js/util.js', 'js/i18n.js', 'js/parsers.js', 'js/importer.js', 'js/editor.js', 'js/history-view.js',
  'js/match.js', 'js/errors.js', 'js/regtool.js', 'js/version.js', 'js/search.js', 'js/timeline-gen.js', 'js/transcript.js', 'js/triage.js',
  'js/zipwrite.js', 'js/docx-spec.js', 'js/richtext.js',
  'js/views/dashboard.js', 'js/views/timeline.js', 'js/views/coverage.js', 'js/views/triage.js', 'js/views/transcripts.js',
  'js/views/docs.js', 'js/views/specs.js', 'js/views/history.js', 'js/views/logs.js', 'js/views/settings.js', 'js/views/admin.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // network first so updates arrive immediately; cache as fallback when the server is unreachable
  e.respondWith(fetch(e.request).then(res => {
    const copy = res.clone();
    caches.open(CACHE).then(c => c.put(e.request, copy));
    return res;
  }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});
