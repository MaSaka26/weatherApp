import { computed, ref, unref } from 'vue'

import { isWeatherStale } from '../../utils/weatherFreshness.js'

export const REFRESH_MIN_MS = 6 * 60 * 1000
export const TICK_MS = 60 * 1000
export const STALE_AFTER_MS = 15 * 60 * 1000

export function useWeatherRefresh({
  isFetching,
  lastSuccessAt,
  hasWeatherData,
  canRefresh,
  refresh,
  now = () => Date.now(),
  documentRef = typeof document === 'undefined' ? null : document,
  setTimer = (callback, delay) => setInterval(callback, delay),
  clearTimer = (timer) => clearInterval(timer),
} = {}) {
  const ageTick = ref(now())
  const autoRefreshFailed = ref(false)
  let timer = null

  const dataAgeMs = computed(() =>
    lastSuccessAt.value ? Math.max(0, ageTick.value - lastSuccessAt.value) : null,
  )
  const isStale = computed(() =>
    isWeatherStale(hasWeatherData.value, lastSuccessAt.value, ageTick.value, STALE_AFTER_MS),
  )

  function markSuccess(at = now()) {
    lastSuccessAt.value = at
    ageTick.value = at
    autoRefreshFailed.value = false
  }

  async function maybeAutoRefresh() {
    ageTick.value = now()
    if (!canRefresh?.()) return false
    if (unref(isFetching)) return false
    if (documentRef?.hidden) return false
    if (now() - lastSuccessAt.value < REFRESH_MIN_MS) return false

    try {
      const success = await refresh({ quiet: true })
      if (!success && hasWeatherData.value) autoRefreshFailed.value = true
      return success
    } catch {
      if (hasWeatherData.value) autoRefreshFailed.value = true
      return false
    }
  }

  function onVisibilityChange() {
    ageTick.value = now()
    if (!documentRef?.hidden) maybeAutoRefresh()
  }

  function start() {
    if (timer != null) return
    timer = setTimer(maybeAutoRefresh, TICK_MS)
    documentRef?.addEventListener('visibilitychange', onVisibilityChange)
    maybeAutoRefresh()
  }

  function stop() {
    if (timer != null) {
      clearTimer(timer)
      timer = null
    }
    documentRef?.removeEventListener('visibilitychange', onVisibilityChange)
  }

  return {
    dataAgeMs,
    isStale,
    autoRefreshFailed,
    markSuccess,
    maybeAutoRefresh,
    start,
    stop,
  }
}
