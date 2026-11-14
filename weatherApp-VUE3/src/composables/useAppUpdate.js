/**
 * 应用版本更新：主动发现线上新版本、协调 Service Worker、提供 UI 状态。
 * 单例：设置面板、右下角 toast、WeatherHome 共享同一份状态。
 *
 * 为什么改了探测方式：站点自己的 deploy.json 在 GitHub Pages 的 Fastly CDN 上
 * 有 10 分钟缓存，请求头 / 随机 query / Range 全都打不穿，所以「等缓存过期」是唯一
 * 结果。现在改读 GitHub 侧同一份文件（utils/updateProbe.js 的三级源，最快 60 秒新鲜），
 * 页面就能在很短时间内主动发现新版本并提示刷新。
 *
 * 节奏：可见时每 CHECK_INTERVAL_MS 轮询一次（带抖动），切回前台 / 联网 / 聚焦立刻补查。
 * SW 仍采用 waiting 模式：用户确认 → SKIP_WAITING → controllerchange → reload。
 */
import { computed, ref } from 'vue'

import { compareAppUpdate } from '@/utils/appVersion'
import { RATE_LIMIT_COOLDOWN_MS, buildDeployProbeSources, readDeployManifest } from '@/utils/updateProbe'

/* global __APP_VERSION__, __APP_BUILD_ID__ */
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'
const APP_BUILD_ID = typeof __APP_BUILD_ID__ !== 'undefined' ? __APP_BUILD_ID__ : ''
// dev 模式没有 dist/deploy.json（它由 closeBundle 生成），检查必然 404；
// 此时不联网、不报错，UI 直接标注开发环境。
const IS_DEV = import.meta.env.DEV
const DISPLAY_VERSION = IS_DEV ? APP_VERSION + ' (dev)' : APP_VERSION

/** 两次检查之间的最小间隔（force 检查不受此限）。 */
export const CHECK_THROTTLE_MS = 2 * 60 * 1000
/** 后台轮询间隔；仅页面可见时计时，隐藏即停表。 */
export const CHECK_INTERVAL_MS = 2 * 60 * 1000
/** 抖动上限：多标签页同时开着时错开请求，别一起打满 GitHub API 配额。 */
const CHECK_JITTER_MS = 20 * 1000
/** 用户点过「稍后」的版本，刷新页面也不再反复弹。 */
const DISMISS_KEY = 'weather:update-dismissed'
/** 正在等生效的目标版本；刷新后若还是旧版本，说明 CDN 仍在缓存旧页面。 */
const PENDING_KEY = 'weather:update-pending'

const status = ref('idle') // idle | dev | checking | up-to-date | available | updating | error
const remoteLabel = ref('')
const errorMessage = ref('')
const lastCheckedAt = ref(0)
/** 最近一次成功的探测源名称，设置面板里用来交代「版本是从哪查到的」。 */
const lastSourceLabel = ref('')
/** 一次性提示（例如「点过更新但 CDN 还没换版」），由 toast 显示，下次成功检查自动清掉。 */
const notice = ref('')
let applying = false
let initialized = false
let pollTimer = null
/** 最近一次确认到的线上版本身份，供「稍后」记忆与 pending 判定复用。 */
let lastRemoteId = ''
/** 探测源被限流后的冷却截止时间，按 source.id 记。 */
const sourceBlockedUntil = new Map()
/** 各探测源最近一次成功使用的时间，用来给 GitHub API 留配额。 */
const sourceLastUsedAt = new Map()
/** 探测源连续失败次数：某些网络下某个域名长期不通（例如被污染），
 *  不清零的话每一轮都要在那儿等满超时才轮到下一个源。 */
const sourceFailStreak = new Map()
/** 连续失败多少次后暂停该源，以及暂停多久。 */
const FAIL_STREAK_LIMIT = 2
const FAIL_STREAK_COOLDOWN_MS = 10 * 60 * 1000

const sources = buildDeployProbeSources(readBaseHref())

function readBaseHref() {
  try {
    return document.baseURI
  } catch {
    return './'
  }
}

function readStorage(key) {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key, value) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // 隐私模式 / 关闭存储时忽略：只影响「稍后」是否记住，不影响功能
  }
}

function clearStorage(key) {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // 同上
  }
}

function isSourceBlocked(source) {
  if ((sourceBlockedUntil.get(source.id) || 0) > Date.now()) return true
  // 有配额的源（GitHub API）按最小间隔节流：间隔内改走下一个源，别把 60 次/小时打光
  const minInterval = source.minIntervalMs || 0
  if (!minInterval) return false
  const lastUsed = sourceLastUsedAt.get(source.id) || 0
  return Date.now() - lastUsed < minInterval
}

function noteSourceFailure(source, error) {
  if (!error) return
  if (error.code === 'SKIPPED') return
  const streak = (sourceFailStreak.get(source.id) || 0) + 1
  sourceFailStreak.set(source.id, streak)
  // 连续不通就先别试了，把这一轮的时间留给下一个源
  if (streak >= FAIL_STREAK_LIMIT) {
    sourceBlockedUntil.set(source.id, Math.max(
      sourceBlockedUntil.get(source.id) || 0,
      Date.now() + FAIL_STREAK_COOLDOWN_MS,
    ))
  }
  if (error.code !== 'RATE_LIMITED') return
  // 配额恢复时间已知就用它，否则冷却一段时间，期间只走 raw 源
  const until = error.resetAt && error.resetAt > Date.now()
    ? error.resetAt
    : Date.now() + RATE_LIMIT_COOLDOWN_MS
  sourceBlockedUntil.set(source.id, until)
}

async function readRemote() {
  try {
    const { manifest, source } = await readDeployManifest(sources, { isSourceBlocked })
    lastSourceLabel.value = source.label
    sourceLastUsedAt.set(source.id, Date.now())
    sourceFailStreak.delete(source.id)
    return manifest
  } catch (error) {
    const failures = error && error.failures ? error.failures : []
    for (const failure of failures) noteSourceFailure(failure.source, failure.error)
    throw error
  }
}

function remoteIdentity(remote) {
  return remote.appBuildId || remote.sourceTag || remote.latestTag || ''
}

/**
 * @param {boolean} force 跳过 2 分钟节流（联网恢复 / SW 就绪 / 设置面板点按钮时用）
 * @param {{manual?: boolean}} options manual=true 表示用户主动点「检查更新」，
 *   此时连「稍后」的记忆也一并忽略，否则用户点了按钮却看不到已知的新版本会困惑。
 */
async function check(force = false, options = {}) {
  const manual = options.manual === true
  if (IS_DEV) {
    status.value = 'dev'
    errorMessage.value = ''
    return
  }
  if (applying) return
  if (!force && status.value === 'checking') return
  if (!force && Date.now() - lastCheckedAt.value < CHECK_THROTTLE_MS) return
  // 已经在提示新版本时不要退回 checking：toast 的 v-if 会因此闪一下消失再出现
  if (status.value !== 'available') status.value = 'checking'
  errorMessage.value = ''
  lastCheckedAt.value = Date.now()
  try {
    const remote = await readRemote()
    const result = compareAppUpdate(
      { version: APP_VERSION, buildId: APP_BUILD_ID },
      remote,
    )
    remoteLabel.value = result.remoteLabel || ''
    const remoteId = remoteIdentity(remote)
    lastRemoteId = remoteId
    // PENDING 记的是「点更新那一刻本地跑的构建」。刷新后如果还是这个构建，
    // 说明浏览器拿到的仍是 CDN 缓存的旧页面 —— 提示用户强刷，而不是静默重弹。
    const pending = readStorage(PENDING_KEY)
    const stillOnPending = Boolean(pending) && pending === APP_BUILD_ID
    if (stillOnPending && result.hasUpdate) {
      notice.value = '浏览器仍在用缓存的旧页面，可稍后再试或按 Ctrl+F5 强制刷新'
      status.value = 'available'
      return
    }
    clearStorage(PENDING_KEY)
    notice.value = ''
    if (!result.hasUpdate) {
      clearStorage(PENDING_KEY)
      status.value = 'up-to-date'
      return
    }
    // 用户点过「稍后」的同一版本，后台探测就不要反复打扰；
    // 只有他主动点「检查更新」时才重新亮出来
    if (!manual && remoteId && readStorage(DISMISS_KEY) === remoteId) {
      status.value = 'up-to-date'
      return
    }
    status.value = 'available'
  } catch {
    // 离线 / 网络失败静默降级，不打扰用户；
    // 但若已经亮着「发现新版本」，保持提示，不要因为一次探测失败就消失
    if (status.value === 'available') return
    notice.value = ''
    status.value = 'error'
    errorMessage.value = '检查失败，请稍后重试'
  }
}

/** 设置面板「检查更新」按钮专用：忽略节流与「稍后」记忆。 */
function checkManually() {
  return check(true, { manual: true })
}

async function applyUpdate() {
  if (applying) return
  applying = true
  notice.value = ''
  status.value = 'updating'
  if (APP_BUILD_ID) writeStorage(PENDING_KEY, APP_BUILD_ID)
  try {
    if (!('serviceWorker' in navigator)) {
      location.reload()
      return
    }
    const reg = await navigator.serviceWorker.getRegistration()
    if (reg) {
      // 主动问一次/更新一次 SW；失败也继续刷新，别卡在 updating
      try {
        await reg.update()
      } catch {
        // 忽略
      }
    }
    const waiting = reg && reg.waiting
    if (!waiting) {
      // 没有 waiting SW（首个版本就收到提示 / SW 未接管）：直接刷新
      setTimeout(() => location.reload(), 300)
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
  if (status.value !== 'available') return
  // 记住用户跳过的是哪个版本：同一版本不再反复弹，直到线上出现更新的构建
  if (lastRemoteId) writeStorage(DISMISS_KEY, lastRemoteId)
  notice.value = ''
  status.value = 'up-to-date'
}

function stopPolling() {
  if (pollTimer) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
}

function scheduleNext() {
  if (typeof window === 'undefined') return
  const delay = CHECK_INTERVAL_MS + Math.random() * CHECK_JITTER_MS
  pollTimer = setTimeout(() => {
    pollTimer = null
    if (typeof document !== 'undefined' && document.hidden) return
    check()
    scheduleNext()
  }, delay)
}

function startPolling() {
  if (pollTimer) return
  scheduleNext()
}

function init() {
  if (initialized) return
  initialized = true
  if (IS_DEV) { status.value = 'dev'; return }
  // 启动不阻塞首屏
  setTimeout(() => check(), 3000)
  startPolling()
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopPolling()
      return
    }
    startPolling()
    check()
  })
  // 断网恢复 / 重新聚焦：立刻补查一次，不必等下一个轮询周期
  window.addEventListener('online', () => check(true))
  window.addEventListener('focus', () => check())
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
    lastSourceLabel,
    notice,
    hasUpdate,
    isChecking,
    check,
    checkManually,
    applyUpdate,
    dismiss,
  }
}
