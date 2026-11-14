import { ref } from 'vue'

import { fetchAirQuality } from '../../api/weather.js'

/**
 * 空气质量（独立接口，失败不能拖垮主流程）
 *
 * 早先这里只有一个 air ref：请求失败、请求超时、接口正常但没有 current，
 * 三种情况在 UI 上都是 null，卡片只能显示「暂无」，用户没法知道是网络问题
 * 还是当地确实没有数据，也没有重试入口。现在补一条状态线：
 *   - idle  → 还在等结果（首屏还没请求到）
 *   - ok    → 接口正常返回；current 为空也算 ok（当地确实没有数据）
 *   - error → 请求失败或超时，卡片据此给出失败提示 + 重试
 */
export function useAirQuality({ fetcher = fetchAirQuality } = {}) {
  const air = ref(null)
  const airStatus = ref('idle')
  const airError = ref('')
  let token = 0
  let controller = null

  function cancel() {
    token += 1
    controller?.abort()
    controller = null
  }

  // 无法发请求时由调用方显式置为失败，避免状态永远停在 idle
  function fail(reason = '空气质量请求失败') {
    airStatus.value = 'error'
    airError.value = reason
  }

  async function load(latitude, longitude, { clear = true } = {}) {
    // 没有坐标就没有可请求的对象：不发请求，也别把状态挂在 idle 上骗 UI
    if (latitude == null || longitude == null) {
      fail('缺少城市坐标')
      return null
    }

    const id = ++token
    controller?.abort()
    controller = new AbortController()
    if (clear) {
      air.value = null
      // 换城市才回到 idle；quiet 刷新保留 ok，卡片不会闪回骨架
      airStatus.value = 'idle'
    }
    airError.value = ''

    try {
      const next = await fetcher(latitude, longitude, { signal: controller.signal })
      if (id !== token) return null
      air.value = next
      // 接口返回 200 但没有 current（境外/海上）不是失败，只是没有数据
      airStatus.value = 'ok'
      return next
    } catch (error) {
      if (id !== token) return null
      // clear=false 表示后台刷新：失败时保留屏上旧值，别让卡片突然变空
      if (clear) air.value = null
      airStatus.value = 'error'
      airError.value = error?.code === 'REQUEST_TIMEOUT'
        ? '请求超时'
        : error?.message || '空气质量请求失败'
      return null
    } finally {
      if (id === token) controller = null
    }
  }

  return { air, airStatus, airError, load, fail, cancel }
}
