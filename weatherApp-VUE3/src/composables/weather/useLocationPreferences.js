import { ref } from 'vue'

import { inferLocationMode } from '../../utils/locationIntent.js'

export const LOCATION_MODE_KEY = 'weather:location-mode:v1'
export const COMMON_CITIES_KEY = 'weather:common-cities:v1'
export const LEGACY_FAVORITES_KEY = 'weather:favorites:v1'
export const MAX_COMMON_CITIES = 12

function readStorage(key) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // 隐私模式或配额已满时只影响下一次启动，不影响本次会话。
  }
}

export function useLocationPreferences({ cachedPlace = null } = {}) {
  const locationMode = ref(inferLocationMode(
    readStorage(LOCATION_MODE_KEY) || cachedPlace?.locationMode,
    cachedPlace?.locationSource,
  ))
  const commonCities = ref(readCommonCities())

  function setLocationMode(mode) {
    if (mode !== 'auto' && mode !== 'manual') return
    locationMode.value = mode
    writeStorage(LOCATION_MODE_KEY, mode)
  }

  function readCommonCities() {
    const saved = readStorage(COMMON_CITIES_KEY)
    const legacy = saved == null ? readStorage(LEGACY_FAVORITES_KEY) : null
    try {
      const list = JSON.parse(saved ?? legacy ?? '[]')
      const valid = Array.isArray(list)
        ? list.filter((item) => item && Number.isFinite(item.lat) && Number.isFinite(item.lon))
        : []
      if (saved == null && legacy != null) {
        writeStorage(COMMON_CITIES_KEY, JSON.stringify(valid.slice(0, MAX_COMMON_CITIES)))
      }
      return valid.slice(0, MAX_COMMON_CITIES)
    } catch {
      return []
    }
  }

  function persistCommonCities() {
    writeStorage(COMMON_CITIES_KEY, JSON.stringify(commonCities.value))
  }

  function rememberCommonCity(place) {
    if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lon)) return
    const key = `${place.lat},${place.lon}`
    const item = {
      name: place.name || '未知城市',
      detail: place.detail || '',
      countryCode: place.countryCode || '',
      lat: place.lat,
      lon: place.lon,
    }
    commonCities.value = [
      item,
      ...commonCities.value.filter((city) => `${city.lat},${city.lon}` !== key),
    ].slice(0, MAX_COMMON_CITIES)
    persistCommonCities()
  }

  function removeCommonCity(place) {
    if (!place) return
    const key = `${place.lat},${place.lon}`
    commonCities.value = commonCities.value.filter((city) => `${city.lat},${city.lon}` !== key)
    persistCommonCities()
  }

  return {
    locationMode,
    commonCities,
    setLocationMode,
    rememberCommonCity,
    removeCommonCity,
  }
}
