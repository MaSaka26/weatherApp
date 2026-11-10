import { ref } from 'vue'

import { fetchAlerts } from '../../api/weather.js'
import { buildAlerts, provinceOf } from '../../utils/alertParse.js'

const EMPTY_ALERTS = () => ({ list: [], top: 0, total: 0 })

export function useWeatherAlerts({ fetcher = fetchAlerts } = {}) {
  const alerts = ref(EMPTY_ALERTS())
  const alertStatus = ref('idle')
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
    if (!fromRetry) alertStatus.value = 'idle'
    alertRefreshing.value = true

    try {
      const list = province
        ? await fetcher(province, { signal: controller.signal })
        : []
      if (id !== token) return
      alerts.value = buildAlerts(list, cityName)
      alertStatus.value = 'ok'
    } catch {
      if (id !== token) return
      alerts.value = EMPTY_ALERTS()
      alertStatus.value = 'error'
    } finally {
      if (id === token) {
        alertRefreshing.value = false
        controller = null
      }
    }
  }

  function refresh(cityDetail, cityName) {
    return load(provinceOf(cityDetail), cityName)
  }

  function retry(cityDetail, cityName) {
    return load(provinceOf(cityDetail), cityName, { fromRetry: true })
  }

  return { alerts, alertStatus, alertRefreshing, refresh, retry, cancel }
}
