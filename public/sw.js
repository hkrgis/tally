const scope = self.registration.scope
const prefix = `tally:${scope}:`
const cacheName = `${prefix}v4`
const indexUrl = new URL('index.html', scope)
const entryPaths = [new URL(scope).pathname, indexUrl.pathname]

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName)
    const response = await fetch(scope, { cache: 'reload' })
    if (!response.ok) throw new Error('Could not cache the app shell.')
    const html = await response.clone().text()
    const assets = [...html.matchAll(/(?:src|href)="(\.\/[^"]+)"/g)]
      .map(([, src]) => new URL(src, scope).href)
    await cache.addAll([...new Set([...assets, new URL('icon-512.png', scope).href])])
    await cache.put(scope, response)
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter(key => key.startsWith(prefix) && key !== cacheName).map(key => caches.delete(key)))
    await self.clients.claim()
  })())
})

async function serve(request) {
  const cache = await caches.open(cacheName)
  const navigation = request.mode === 'navigate'
  const key = navigation ? scope : request.url
  const hashedAsset = request.url.startsWith(new URL('assets/', scope).href)
  if (hashedAsset) {
    const cached = await cache.match(key)
    if (cached) return cached
  }
  try {
    const response = await fetch(request)
    if (response.ok) await cache.put(key, response.clone()).catch(() => {})
    if (response.status < 500) return response
  } catch {
    // Use the most recent successful response when the network is unavailable.
  }
  const cached = await cache.match(key)
  if (!cached) return new Response('Offline', { status: 503 })
  return cached
}

self.addEventListener('fetch', event => {
  const { request } = event
  const appEntry = entryPaths.includes(new URL(request.url).pathname)
  const asset = request.url.startsWith(new URL('assets/', scope).href) ||
    ['manifest.webmanifest', 'icon-192.png', 'icon-512.png'].some(file => request.url === new URL(file, scope).href)
  if (request.method === 'GET' && !request.headers.has('Authorization') &&
      (request.mode === 'navigate' ? request.url.startsWith(scope) && appEntry : asset)) {
    event.respondWith(serve(request))
  }
})
