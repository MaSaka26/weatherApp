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

  /**
   * 定位得到的城市也进入收藏。GPS 坐标每次会略有抖动，若按精确坐标去重，
   * 同一个地点会反复占满收藏名额；因此按约 2km 半径匹配已有收藏条目，
   * 复用它的精确坐标作为身份，只刷新展示信息并置顶。
   * 用连续的距离阈值而非 toFixed 网格，避免两个相距几十米的点恰好落在网格边界两侧。
   */
  function rememberLocatedCity(place) {
    if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lon)) return
    const radius = 0.02 // 度，约 2km
    const cosLat = Math.cos((place.lat * Math.PI) / 180)
    const matched = commonCities.value.find((city) => {
      const dLat = city.lat - place.lat
      const dLon = (city.lon - place.lon) * cosLat
      return Math.hypot(dLat, dLon) < radius
    })
    const identity = matched || place
    const item = {
      name: place.name || '未知城市',
      detail: place.detail || '',
      countryCode: place.countryCode || '',
      lat: identity.lat,
      lon: identity.lon,
    }
    const key = `${identity.lat},${identity.lon}`
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

  function removeCommonCities(places) {
    if (!Array.isArray(places) || places.length === 0) return
    const keys = new Set(places.map((p) => `${p.lat},${p.lon}`))
    commonCities.value = commonCities.value.filter((city) => !keys.has(`${city.lat},${city.lon}`))
    persistCommonCities()
  }

  return {
    locationMode,
    commonCities,
    setLocationMode,
    rememberCommonCity,
    rememberLocatedCity,
    removeCommonCity,
    removeCommonCities,
  }
}
