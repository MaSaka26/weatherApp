const CACHE_PREFIX = 'weather-shell-'
const BUILD_ID = '__WEATHER_BUILD_ID__'
const FALLBACK_CACHE = `${CACHE_PREFIX}fallback`
let CACHE = FALLBACK_CACHE

const scopeUrl = new URL(self.registration.scope)
const rootUrl = new URL('./', scopeUrl)
const rootPath = rootUrl.pathname
const assetPrefix = new URL('assets/', rootUrl).pathname
const SHELL = [rootPath, new URL('favicon.ico', rootUrl).pathname]

async function precache() {
  const files = new Set(SHELL)
  try {
    const manifestUrl = new URL('.vite/manifest.json', scopeUrl)
    const manifestResponse = await fetch(manifestUrl)
    if (manifestResponse.ok) {
      const manifest = await manifestResponse.json()
      for (const entry of Object.values(manifest)) {
        if (entry.file) files.add(new URL(entry.file, rootUrl).pathname)
        for (const file of [...(entry.css || []), ...(entry.assets || [])]) {
          files.add(new URL(file, rootUrl).pathname)
        }
      }
    }
  } catch { /* Keep the shell available when the manifest cannot be read. */ }

  const sorted = [...files].sort()
  CACHE = `${CACHE_PREFIX}${BUILD_ID}`
  const cache = await caches.open(CACHE)
  await cache.addAll(SHELL)
  await Promise.allSettled(sorted.map((file) => cache.add(file)))
}

self.addEventListener('install', (event) => {
  // 不自动 skipWaiting：由用户点「立即更新」后发 SKIP_WAITING，
  // 否则旧页面正在引用的动态 chunk 会被新 SW 的 activate 删缓存后 404。
  event.waitUntil(precache())
})

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return
  // 版本清单必须实时，绝不缓存
  if (url.pathname.endsWith('/deploy.json')) return

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cached = (await caches.match(request)) || (await caches.match(rootPath))
      try {
        const response = await fetch(request)
        if (response.ok) {
          const cache = await caches.open(CACHE)
          await cache.put(rootPath, response.clone())
          return response
        }
        return cached || response
      } catch {
        return cached || Response.error()
      }
    })())
    return
  }

  if (url.pathname.startsWith(assetPrefix)) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) {
        caches.open(CACHE).then((cache) => cache.put(request, response.clone()))
      }
      return response
    })))
  }
})
