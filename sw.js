/**
 * sw.js — offline support for FrigProp (static site, no build step).
 *
 * - Same-origin requests: network-first, so a fresh deploy always wins when
 *   online; the cache answers when offline.
 * - CDN requests (Chart.js, Google Fonts — immutable versioned URLs):
 *   cache-first.
 * - Install caches the app shell by reading index.html and following its
 *   `?v=`-stamped stylesheet/script and module imports (so no version
 *   stamps are duplicated here), then every fluid table listed in
 *   tables/manifest.json (~1.6 MB) so any refrigerant works offline after
 *   the first visit.
 *
 * Bump CACHE only when this caching scheme changes; content freshness
 * comes from network-first, not from the cache name.
 */

const CACHE = "frigprop-v1";
const CDN_HOSTS = ["cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"];
const STATIC = ["./", "./index.html", "./manifest.webmanifest", "./favicon.ico",
                "./data/refrigerants.json", "./tables/manifest.json",
                "./assets/img/icon-192.png", "./assets/img/icon-512.png"];

// ---------------------------------------------------------------------------
// Install — app shell + all fluid tables
// ---------------------------------------------------------------------------

/** Same-origin assets referenced by a page or module (relative to `base`). */
function _refs(text, base, pattern) {
  return [...text.matchAll(pattern)].map(m => new URL(m[1], base).href)
    .filter(u => new URL(u).origin === location.origin);
}

/** index.html's stylesheet/scripts plus the module import graph beneath them. */
async function _shellURLs() {
  const index = new URL("./index.html", location).href;
  const html = await (await fetch(index, { cache: "no-cache" })).text();
  const cdn = [...html.matchAll(/(?:href|src)="(https:\/\/[^"]+)"/g)].map(m => m[1])
    .filter(u => CDN_HOSTS.includes(new URL(u).host));
  const seen = new Set();
  const queue = _refs(html, index, /(?:href|src)="(\.\/assets\/[^"]+)"/g);
  while (queue.length) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    if (new URL(url).pathname.endsWith(".js")) {
      const js = await (await fetch(url)).text();
      queue.push(..._refs(js, url, /from\s+"(\.\/[^"]+)"/g));
    }
  }
  return { same: [...seen], cdn };
}

async function _tableURLs() {
  const manifest = await (await fetch("./tables/manifest.json", { cache: "no-cache" })).json();
  return Object.entries(manifest.fluids)
    .flatMap(([key, f]) => f.files.map(file => `./tables/${key}/${file}`));
}

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const { same, cdn } = await _shellURLs();
    // the shell must be complete; addAll rejects duplicate requests, so dedupe
    const shell = new Set([...STATIC.map(u => new URL(u, location).href), ...same]);
    await cache.addAll([...shell]);
    // tables and CDN files are best-effort: one failure must not block install
    await Promise.allSettled((await _tableURLs()).map(u => cache.add(u)));
    await Promise.allSettled(cdn.map(async u => cache.put(u, await fetch(u, { mode: "no-cors" }))));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const name of await caches.keys()) if (name !== CACHE) await caches.delete(name);
    await self.clients.claim();
  })());
});

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === location.origin) e.respondWith(_networkFirst(req, url));
  else if (CDN_HOSTS.includes(url.host)) e.respondWith(_cacheFirst(req));
});

async function _networkFirst(req, url) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) {
      await cache.put(req, res.clone());
      // a new ?v= stamp supersedes the old copy of the same asset
      if (url.search) {
        for (const k of await cache.keys()) {
          const ku = new URL(k.url);
          if (ku.pathname === url.pathname && ku.search !== url.search) await cache.delete(k);
        }
      }
    }
    return res;
  } catch (err) {
    // offline: exact match, or for page loads (?f=… share links) the app page
    const hit = await cache.match(req) ||
                (req.mode === "navigate" && await cache.match("./index.html"));
    if (hit) return hit;
    throw err;
  }
}

async function _cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === "opaque") await cache.put(req, res.clone());
  return res;
}
