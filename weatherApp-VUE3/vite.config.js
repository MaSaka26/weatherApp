import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'


function injectServiceWorkerBuildId() {
  return {
    name: 'inject-service-worker-build-id',
    apply: 'build',
    closeBundle() {
      const manifest = readFileSync(new URL('./dist/.vite/manifest.json', import.meta.url))
      const index = readFileSync(new URL('./dist/index.html', import.meta.url))
      const buildId = createHash('sha256')
        .update(manifest)
        .update(index)
        .digest('hex')
        .slice(0, 12)
      const swUrl = new URL('./dist/sw.js', import.meta.url)
      const sw = readFileSync(swUrl, 'utf8')
      if (!sw.includes('__WEATHER_BUILD_ID__')) {
        throw new Error('Service worker build placeholder is missing')
      }
      writeFileSync(swUrl, sw.replaceAll('__WEATHER_BUILD_ID__', buildId), 'utf8')
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  build: { manifest: true },
  plugins: [
    vue(),
    vueDevTools(),
    injectServiceWorkerBuildId(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
