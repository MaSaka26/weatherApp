import { ref } from 'vue'

import { fetchAlerts } from '../../api/weather.js'
import { buildAlerts, provinceOf } from '../../utils/alertParse.js'

const EMPTY_ALERTS = () => ({ list: [], top: 0, total: 0 })

/**
 * 城市预警（中央气象台省级列表，前端按标题匹配本地）
 *
 * status 三态是给 UI 用的：idle 显示骨架、ok 显示结果、error 显示失败+重试。
 * 有个坑要特别防：预警请求只有在主天气请求成功之后才会发出（见 stores/weather）。
 * 主请求超时或整个断网时这一路永远不会被调用，status 会一直停在 idle，
 * 界面上就是一个永远转的骨架 —— 这正是用户报的「无限 loading」。
 * 所以额外提供 fail()：主流程失败时由 store 显式把这一路推到 error。
 */
export function useWeatherAlerts({ fetcher = fetchAlerts } = {}) {
  const alerts = ref(EMPTY_ALERTS())
  const alertStatus = ref('idle')
  const alertError = ref('')
  const alertRefreshing = ref(false)
  let token = 0
  let controller = null

  function cancel() {
    token += 1
    controller?.abort()
    controller = null
    alertRefreshing.value = false
  }

  async function load(province, cityName, { fromRetry = false } = {}) {
    const id = ++token
    controller?.abort()
    controller = new AbortController()
    alerts.value = EMPTY_ALERTS()
    // 首屏（非重试）才回到 idle；重试期间保持 error 或 ok，按钮自己显示「重试中…」
    if (!fromRetry) alertStatus.value = 'idle'
    alertError.value = ''
    alertRefreshing.value = true

    try {
      const list = province
        ? await fetcher(province, { signal: controller.signal })
        : []
      if (id !== token) return
      alerts.value = buildAlerts(list, cityName)
      alertStatus.value = 'ok'
    } catch (error) {
      if (id !== token) return
      alerts.value = EMPTY_ALERTS()
      alertStatus.value = 'error'
      alertError.value = error?.code === 'REQUEST_TIMEOUT'
        ? '请求超时'
        : error?.message || '预警请求失败'
    } finally {
      if (id === token) {
        alertRefreshing.value = false
        controller = null
      }
    }
  }

  /**
   * 主天气流程失败、预警请求根本没发出去时调用：
   * 把还在 idle 的那一路推成 error，让 UI 从「无限骨架」变成「失败 + 重试」。
   * 已经在请求中（refreshing）或已有结果的不要覆盖。
   */
  function fail(reason = '预警请求未发出') {
    if (alertRefreshing.value) return
    if (alertStatus.value !== 'idle') return
    alertStatus.value = 'error'
    alertError.value = reason
  }

  function refresh(cityDetail, cityName) {
    return load(provinceOf(cityDetail), cityName)
  }

  function retry(cityDetail, cityName) {
    return load(provinceOf(cityDetail), cityName, { fromRetry: true })
  }

  return { alerts, alertStatus, alertError, alertRefreshing, refresh, retry, fail, cancel }
}
