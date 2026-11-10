import { ref } from 'vue'

import { fetchAirQuality } from '../../api/weather.js'

export function useAirQuality({ fetcher = fetchAirQuality } = {}) {
  const air = ref(null)
  let token = 0
  let controller = null

  function cancel() {
    token += 1
    controller?.abort()
    controller = null
  }

  async function load(latitude, longitude, { clear = true } = {}) {
    const id = ++token
    controller?.abort()
    controller = new AbortController()
    if (clear) air.value = null

    try {
      const next = await fetcher(latitude, longitude, { signal: controller.signal })
      if (id !== token) return null
      air.value = next
      return next
    } catch {
      if (id === token) air.value = null
      return null
    } finally {
      if (id === token) controller = null
    }
  }

  return { air, load, cancel }
}
