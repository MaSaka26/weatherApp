/**
 * 主天气 + 位置的本地缓存（localStorage）。
 *
 * 存在的理由：进页面就先把上一次的好数据画出来，用户看到的是完整仪表盘，
 * 不是一块空壳在等网络。数据到了再由响应式替换，观众几乎察觉不到。
 *
 * 只缓存「主天气 + 位置」—— 空气质量和预警是独立接口、时效性强，
 * 存下来反而可能显示已经过期的空气质量，所以每次仍然实时拉。
 *
 * 任何异常一律吞掉：隐私模式、配额写满、被人手动改坏，都不该让页面打不开。
 * 读不到/坏了就当没有缓存，退回数值占位骨架。
 */

const CACHE_KEY = 'weather:last-good:v1'

// 超过这个时长就不再拿来当首屏数据：一天的天气早过期了，
// 画出来反而误导（比如显示昨天 28°，今天其实 12°）。过期就退回占位骨架重拉。
const TTL_MS = 24 * 60 * 60 * 1000

export function readWeatherCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const obj = JSON.parse(raw)
    if (!obj || typeof obj !== 'object') return null
    // 没有 current 就画不出主卡，视为无效缓存
    if (!obj.data?.current) return null
    if (!Number.isFinite(obj.savedAt)) return null
    if (Date.now() - obj.savedAt > TTL_MS) return null
    return obj
  } catch {
    return null
  }
}

// payload: { data, place }，place 是 { lat, lon, cityName, cityDetail, locationSource }
export function writeWeatherCache(payload) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ...payload, savedAt: Date.now() }))
  } catch {
    // 写不进去就算了，下次进页面退回占位骨架，功能不受影响
  }
}

export function clearWeatherCache() {
  try {
    localStorage.removeItem(CACHE_KEY)
  } catch {
    // 忽略
  }
}

export { CACHE_KEY as WEATHER_CACHE_KEY, TTL_MS as WEATHER_CACHE_TTL_MS }
