/* Shell 1.0.3. Bump this comment and core.VERSION for each release.
 * Cache only the public shell. Private PDFs are read directly from local IndexedDB. */
importScripts('./core.js', './storage.js');
const C = CompanionCore;
const SHELL_CACHE = C.CACHE_PREFIX + C.VERSION;
const BASE = self.registration.scope;
const SHELL_URLS = C.SHELL_FILES.map(path => new URL(path, BASE).href);
const LOCAL_PREFIX = new URL('__local__/document/', BASE).pathname;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    try {
      await cache.addAll(SHELL_URLS.map(url => new Request(url, { cache: 'reload' })));
    } catch (error) {
      await caches.delete(SHELL_CACHE);
      throw error;
    }
    // Updates wait for the reader's explicit "Update app" action.
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(C.CACHE_PREFIX) && key !== SHELL_CACHE) await caches.delete(key);
    }
    // Never clear IndexedDB or unrelated origin caches during a shell update.
    await self.clients.claim();
  })());
});

async function pdfResponse(request, url) {
  const match = /^([a-f0-9-]{36})\.pdf$/i.exec(url.pathname.slice(LOCAL_PREFIX.length));
  if (!match) return new Response('Local document not found. Return to the app and reimport from Files.', { status: 404 });
  try {
    const record = await CompanionStore.readDocument(match[1]);
    if (!record.metadata || !record.file?.blob) return new Response('This local PDF is missing. Return to the app and reimport it from Files.', { status: 404 });
    const blob = record.file.blob;
    const range = C.parseRange(request.headers.get('Range'), blob.size);
    const headers = new Headers({
      'Content-Type': 'application/pdf', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Content-Disposition': `inline; filename="document.pdf"; filename*=UTF-8''${encodeURIComponent(record.metadata.name).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16))}`
    });
    if (range === false) {
      headers.set('Content-Range', `bytes */${blob.size}`);
      return new Response(null, { status: 416, headers });
    }
    const body = range ? blob.slice(range.start, range.end + 1, 'application/pdf') : blob;
    headers.set('Content-Length', String(body.size));
    if (range) headers.set('Content-Range', `bytes ${range.start}-${range.end}/${blob.size}`);
    return new Response(request.method === 'HEAD' ? null : body, { status: range ? 206 : 200, headers });
  } catch {
    return new Response('Local PDF storage could not be read. Use the independent original in Files.', { status: 503 });
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== new URL(BASE).origin || !url.href.startsWith(BASE)) return;
  if (url.pathname.startsWith(LOCAL_PREFIX)) {
    // Never fall through to the host for local-document URLs, even on missing data.
    event.respondWith(['GET', 'HEAD'].includes(request.method) ? pdfResponse(request, url) : Promise.resolve(new Response(null, { status: 405 })));
    return;
  }
  if (request.method !== 'GET') return;
  url.search = ''; url.hash = '';
  if (!SHELL_URLS.includes(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const saved = await cache.match(url.href);
    if (saved) return saved;
    // Repair an individually missing shell asset while online. A complete cache is
    // still required by the app's local-file check; registration alone is insufficient.
    try {
      const response = await fetch(request);
      if (response.ok) await cache.put(url.href, response.clone());
      return response;
    } catch {
      return new Response('This app asset is missing offline. Reconnect to restore the shell. Your originals remain in Files.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'APPLY_UPDATE') { event.waitUntil(self.skipWaiting()); return; }
  if (event.data?.type !== 'AUDIT_SHELL' || !event.ports[0]) return;
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(SHELL_CACHE);
      const present = await Promise.all(SHELL_URLS.map(url => cache.match(url)));
      event.ports[0].postMessage({ version: C.VERSION, total: SHELL_URLS.length, complete: present.every(Boolean) });
    } catch {
      event.ports[0].postMessage({ error: 'The cached app could not be checked. Reconnect and reopen before travelling offline.' });
    }
  })());
});
