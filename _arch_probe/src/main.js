import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'

// 全局样式（由原 weather.html 抽离，保证视觉一致）
import '@/assets/weather.css'

// 用户设置（描边 / 毛玻璃 / 圆角）：必须在挂载前应用，避免首屏闪一下默认样式
import { initSettings } from '@/composables/useSettings'

initSettings()

const app = createApp(App)

app.use(createPinia())
app.use(router)

app.mount('#app')
