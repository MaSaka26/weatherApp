const CACHE = 'weather-shell-v1'
const SHELL = ['/', '/favicon.ico']

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE)
    await cache.addAll(SHELL)
    try {
      const manifestResponse = await fetch('/.vite/manifest.json')
      if (manifestResponse.ok) {
        const manifest = await manifestResponse.json()
        const files = new Set()
        for (const entry of Object.values(manifest)) {
          if (entry.file) files.add(`/${entry.file}`)
          for (const file of [...(entry.css || []), ...(entry.assets || [])]) files.add(`/${file}`)
        }
        await cache.addAll([...files])
      }
    } catch { /* Keep the HTML shell available if an asset fails to precache. */ }
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('weather-shell-') && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()))
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then((response) => {
      if (response.ok) caches.open(CACHE).then((cache) => cache.put('/', response.clone()))
      return response
    }).catch(async () => (await caches.match(request)) || (await caches.match('/'))))
    return
  }
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) caches.open(CACHE).then((cache) => cache.put(request, response.clone()))
      return response
    })))
  }
})
