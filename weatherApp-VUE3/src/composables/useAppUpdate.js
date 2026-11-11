/**
 * 应用版本更新：检查线上 deploy.json、协调 Service Worker、提供 UI 状态。
 * 单例：设置面板、右下角 toast、WeatherHome 共享同一份状态。
 *
 * - 当前版本由 vite define 注入（__APP_VERSION__ / 本地 buildId 从 deploy.json 同源取不到，
 *   因此以「线上 buildId ≠ 运行时记录的 buildId」判断；运行时 buildId 也由 define 注入）。
 * - SW 采用 waiting 模式：用户确认 → SKIP_WAITING → controllerchange → reload。
 */
import { computed, ref } from 'vue'

import { compareAppUpdate } from '@/utils/appVersion'

/* global __APP_VERSION__, __APP_BUILD_ID__ */
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'
const APP_BUILD_ID = typeof __APP_BUILD_ID__ !== 'undefined' ? __APP_BUILD_ID__ : ''
// dev 模式没有 dist/deploy.json（它由 closeBundle 生成），检查必然 404；
// 此时不联网、不报错，UI 直接标注开发环境。
const IS_DEV = import.meta.env.DEV
const DISPLAY_VERSION = IS_DEV ? `${APP_VERSION} (dev)` : APP_VERSION

const CHECK_THROTTLE_MS = 30 * 60 * 1000
const DEPLOY_URL = new URL('deploy.json', document.baseURI).href

const status = ref('idle') // idle | dev | checking | up-to-date | available | updating | error
const remoteLabel = ref('')
const errorMessage = ref('')
const lastCheckedAt = ref(0)
let applying = false
let initialized = false

async function readRemote() {
  // no-store 绕开 GitHub Pages 的 max-age=600 CDN 缓存
  const res = await fetch(DEPLOY_URL, { cache: 'no-store' })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  return res.json()
}

async function check(force = false) {
  if (IS_DEV) {
    status.value = 'dev'
    errorMessage.value = ''
    return
  }
  if (applying) return
  if (!force && status.value === 'checking') return
  if (!force && Date.now() - lastCheckedAt.value < CHECK_THROTTLE_MS) return
  status.value = 'checking'
  errorMessage.value = ''
  lastCheckedAt.value = Date.now()
  try {
    const remote = await readRemote()
    const result = compareAppUpdate(
      { version: APP_VERSION, buildId: APP_BUILD_ID },
      remote,
    )
    remoteLabel.value = result.remoteLabel || ''
    status.value = result.hasUpdate ? 'available' : 'up-to-date'
  } catch {
    // 离线 / 网络失败静默降级，不打扰用户
    status.value = 'error'
    errorMessage.value = '检查失败，请稍后重试'
  }
}

async function applyUpdate() {
  if (applying) return
  applying = true
  status.value = 'updating'
  try {
    if (!('serviceWorker' in navigator)) {
      location.reload()
      return
    }
    const reg = await navigator.serviceWorker.getRegistration()
    const waiting = reg?.waiting
    if (!waiting) {
      // 没有 waiting SW（例如首次安装后立刻点）：退化为强制刷新
      location.reload()
      return
    }
    waiting.postMessage({ type: 'SKIP_WAITING' })
    // controllerchange 后 reload；加超时兜底避免永久停在 updating
    const timeout = setTimeout(() => location.reload(), 4000)
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      clearTimeout(timeout)
      location.reload()
    }, { once: true })
  } catch {
    status.value = 'error'
    errorMessage.value = '更新失败，请手动刷新页面'
    applying = false
  }
}

function dismiss() {
  if (status.value === 'available') status.value = 'up-to-date'
}

function init() {
  if (initialized) return
  initialized = true
  if (IS_DEV) { status.value = 'dev'; return }
  // 启动不阻塞首屏
  setTimeout(() => check(), 3000)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) check()
  })
  // SW 在后台装好新版本（waiting）时立即确认一次线上清单
  window.addEventListener('app-update-available', () => check(true))
}

const hasUpdate = computed(() => status.value === 'available')
const isChecking = computed(() => status.value === 'checking' || status.value === 'updating')

export function useAppUpdate() {
  init()
  return {
    appVersion: DISPLAY_VERSION,
    isDev: IS_DEV,
    status,
    remoteLabel,
    errorMessage,
    hasUpdate,
    isChecking,
    check,
    applyUpdate,
    dismiss,
  }
}
