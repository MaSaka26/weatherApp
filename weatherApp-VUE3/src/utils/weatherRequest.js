/**
 * 主天气请求的竞态与状态编排。依赖通过参数注入，便于在 Node 测试中覆盖并发响应顺序。
 */
export function createWeatherLoader({ request, onStart, onApply, onSuccess, onFailure, onFinish }) {
  let requestId = 0

  async function load(latitude, longitude, { quiet = false, place = null } = {}) {
    const id = ++requestId
    onStart?.(place)
    try {
      const result = await request(latitude, longitude)
      if (id !== requestId) return false
      onApply?.(result, place)
      onSuccess?.(result, place)
      return true
    } catch (error) {
      if (id !== requestId) return false
      if (!quiet) onFailure?.(error)
      return false
    } finally {
      if (id === requestId) onFinish?.()
    }
  }

  return { load }
}
