/**
 * 主天气请求的竞态与状态编排。依赖通过参数注入，便于在 Node 测试中覆盖并发响应顺序。
 */
export function createWeatherLoader({ request, onStart, onApply, onSuccess, onFailure, onFinish }) {
  let requestId = 0
  let activeController = null

  async function load(latitude, longitude, { quiet = false, place = null } = {}) {
    const id = ++requestId
    activeController?.abort()
    const controller = new AbortController()
    activeController = controller
    onStart?.(place)
    try {
      const result = await request(latitude, longitude, { signal: controller.signal })
      if (id !== requestId) return false
      onApply?.(result, place)
      onSuccess?.(result, place)
      return true
    } catch (error) {
      if (id !== requestId) return false
      if (!quiet) onFailure?.(error)
      return false
    } finally {
      if (id === requestId) {
        activeController = null
        onFinish?.()
      }
    }
  }

  function cancel() {
    requestId += 1
    activeController?.abort()
    activeController = null
  }

  return { load, cancel }
}
