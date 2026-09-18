// AirRelay streaming-download & PWA Service Worker.
//
// 1. Streaming downloads:
// The page registers a transfer by posting `{ type: 'register', id, name, size, mime, port }`
// where `port` is one end of a MessageChannel. The page then navigates (or anchor-clicks)
// to `/__download/{id}`; this SW intercepts that fetch and returns a Response whose body
// is a ReadableStream fed by chunks pushed through the port.
//
// 2. Web Share Target API:
// Native OS shares (Photos, Files) target POST /share-target with multipart/form-data.
// Files are persisted to IndexedDB and the user is redirected to the active AirRelay session.
//
// 3. Offline Shell Cache:
// Pre-caches application shell assets so AirRelay launches instantly as an installable PWA.

const CACHE_NAME = 'airrelay-shell-v1';
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/css/bootstrap.min.css',
  '/css/style.css',
  '/js/theme.js',
  '/js/vendors/bootstrap.bundle.min.js',
  '/js/vendors/qrious.min.js',
  '/js/vendors/client-zip.min.js',
  '/js/modules/script.js',
  '/js/modules/dom.js',
  '/js/modules/sink.js',
  '/js/modules/devBadge.js',
  '/js/modules/webrtc/turn.js',
  '/js/modules/webrtc/mode.js',
  '/js/modules/webrtc/peer.js',
  '/js/modules/webrtc/user.js',
  '/js/modules/webrtc/file.js',
  '/assets/icon.png',
  '/assets/comic.png',
  '/assets/comic-dark.png',
  '/assets/fonts/inter-latin.woff2'
];

const DB_NAME = 'airrelay_pwa_db';
const STORE_NAME = 'shared_target_files';
const transfers = new Map();
const KEEPALIVE_MS = 15_000;

function openSharedDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveSharedFiles(files) {
  const db = await openSharedDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const f of files) {
      store.add({
        name: f.name,
        type: f.type,
        size: f.size,
        file: f,
        timestamp: Date.now()
      });
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
    ])
  );
});

self.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg || msg.type !== 'register') return;

  const { id, name, size, mime, port } = msg;
  if (!id || !port) return;

  let controller;
  const stream = new ReadableStream({
    start(c) { controller = c; },
    cancel() {
      // User cancelled the download in the browser UI.
      try { port.postMessage({ type: 'cancel' }); } catch {}
      transfers.delete(id);
    },
  });

  port.onmessage = (ev) => {
    const data = ev.data;
    if (data instanceof ArrayBuffer) {
      controller.enqueue(new Uint8Array(data));
      return;
    }
    if (ArrayBuffer.isView(data)) {
      controller.enqueue(data);
      return;
    }
    if (data && data.type === 'end') {
      try { controller.close(); } catch {}
      transfers.delete(id);
      return;
    }
    if (data && data.type === 'abort') {
      try { controller.error(new Error(data.reason || 'aborted')); } catch {}
      transfers.delete(id);
    }
  };

  transfers.set(id, { name, size, mime: mime || 'application/octet-stream', stream, createdAt: Date.now() });

  // Tell the page we're ready to receive bytes.
  port.postMessage({ type: 'ready' });
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. Web Share Target POST handler
  if (event.request.method === 'POST' && url.pathname === '/share-target') {
    event.respondWith((async () => {
      try {
        const formData = await event.request.formData();
        const files = formData.getAll('files');
        if (files && files.length > 0) {
          await saveSharedFiles(files);
        }
      } catch (err) {
        console.error('Failed to process shared target files in SW:', err);
      }
      return Response.redirect('/?shared=1', 303);
    })());
    return;
  }

  // 2. Streaming download handler
  const match = url.pathname.match(/^\/__download\/([A-Za-z0-9._-]+)$/);
  if (match) {
    const id = match[1];
    const entry = transfers.get(id);
    if (!entry) {
      event.respondWith(new Response('Transfer not found or expired.', { status: 404 }));
      return;
    }

    const headers = new Headers({
      'Content-Type': entry.mime,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(entry.name)}`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    if (Number.isFinite(entry.size) && entry.size > 0) {
      headers.set('Content-Length', String(entry.size));
    }

    event.respondWith(new Response(entry.stream, { headers }));
    return;
  }

  // 3. Static shell caching (network-first for app updates, cache fallback for offline)
  if (event.request.method === 'GET' && !url.pathname.startsWith('/api') && !url.pathname.startsWith('/ws')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.match(event.request).then((res) => {
          if (res) return res;
          if (event.request.mode === 'navigate') {
            return caches.match('/');
          }
          return null;
        })
      )
    );
  }
});

// Garbage-collect transfers that registered but never had their /__download/{id} fetched.
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of transfers) {
    if (now - entry.createdAt > 5 * 60_000) transfers.delete(id);
  }
}, KEEPALIVE_MS);
