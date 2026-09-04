// Offline-first service worker.
//
// The whole point of this app is working in a trench with no signal, so the
// app shell is fully precached on install — not left to the HTTP cache, which
// is evictable and gives no guarantee. The build emits hashed asset names, so
// rather than maintaining a generated manifest the worker reads index.html on
// install and precaches exactly what that page references.
//
// Lazily-loaded chunks (the PDF reader, which is over a megabyte) are
// deliberately NOT precached; they are cached the first time they are used.
//
// Every cache lookup passes `ignoreVary`. Hosts commonly send `Vary: Origin` or
// `Vary: Accept-Encoding`, and the app's own script tags carry `crossorigin`, so
// the page's requests do not byte-match the ones used to fill the cache. Without
// this the shell is cached and then never found — the app looks fine online and
// renders a blank page on site.
const CACHE = 'itp-shell-v2'

const STATIC_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
]

/**
 * Pulls the startup asset URLs out of index.html — the entry script, the
 * modulepreload chunks and the stylesheet.
 */
async function shellAssetsFrom(html) {
  const urls = new Set()
  const pattern = /(?:src|href)\s*=\s*["']([^"']+)["']/g
  let match
  while ((match = pattern.exec(html)) !== null) {
    const url = match[1]
    if (url.includes('/assets/')) urls.add(new URL(url, self.registration.scope).href)
  }
  return [...urls]
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      await cache.addAll(STATIC_SHELL)

      // Precache the hashed bundle so a cold offline start actually renders.
      try {
        const res = await fetch('./index.html', { cache: 'no-cache' })
        if (res.ok) {
          const assets = await shellAssetsFrom(await res.clone().text())
          await cache.put('./index.html', res)
          await Promise.all(
            assets.map((url) =>
              // One missing asset must not fail the whole install.
              cache.add(new Request(url, { credentials: 'same-origin' })).catch(() => undefined),
            ),
          )
        }
      } catch {
        // No network at install time: the runtime handler below still fills the
        // cache once the app is opened with signal.
      }

      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return

  // Navigations: network first so a new deploy is picked up, falling back to the
  // cached shell.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put('./index.html', copy))
          return res
        })
        .catch(() =>
          caches
            .match('./index.html', { ignoreVary: true })
            .then((r) => r || Response.error()),
        ),
    )
    return
  }

  // Everything else: cache first, then fill the cache in the background. This is
  // what picks up the lazily-loaded PDF reader on its first use.
  e.respondWith(
    caches.match(req, { ignoreVary: true }).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(req, copy))
          }
          return res
        }),
    ),
  )
})
