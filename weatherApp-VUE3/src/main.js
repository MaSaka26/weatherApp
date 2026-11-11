import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'

// 全局样式（由原 weather.html 抽离，保证视觉一致）
import '@/assets/weather.css'

// 用户设置（描边 / 毛玻璃 / 圆角）：必须在挂载前应用，避免首屏闪一下默认样式
import { initSettings } from '@/composables/useSettings'
import { reveal } from '@/directives/index'

initSettings()

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const serviceWorkerUrl = new URL('sw.js', document.baseURI).href
    navigator.serviceWorker.register(serviceWorkerUrl).then((reg) => {
      // waiting 模式：新 SW 装好但等待用户确认；有 waiting 就说明远端版本已变。
      if (reg.waiting) window.dispatchEvent(new Event('app-update-available'))
      reg.addEventListener('updatefound', () => {
        const installing = reg.installing
        if (!installing) return
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            window.dispatchEvent(new Event('app-update-available'))
          }
        })
      })
    }).catch((error) => {
      console.warn('Service worker registration failed', error)
    })
  })
}

const app = createApp(App)

app.directive('reveal', reveal)
app.use(createPinia())

app.mount('#app')
