import { ref } from 'vue'

import { inferLocationMode } from '../../utils/locationIntent.js'
import {
  LOCATED_MATCH_RADIUS_DEG,
  placeKey,
  sameLocatedPlace,
} from '../../utils/placeIdentity.js'

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
    upsertCommonCity(place, findExisting(place, { byLocation: false }))
  }

  /**
   * 定位得到的城市也进入收藏。
   *
   * 定位坐标每次都会漂移，WiFi / IP 定位报回来的点甚至可能相差十几公里，
   * 所以「同一个地址」不能用坐标相等来判：先按 2km 半径吃掉 GPS 抖动，
   * 再按展示身份兜住漂移更远的情况 —— 这正是用户报的
   * 「第二次进入地址一样却多出一条收藏」。命中时复用已有条目的坐标作为身份，
   * 只刷新展示字段并置顶，避免同一城市在列表里堆成好几条。
   */
  function rememberLocatedCity(place) {
    if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lon)) return
    upsertCommonCity(place, findExisting(place, { byLocation: true }))
  }

  function removeCommonCity(place) {
    if (!place) return
    const key = placeKey(place)
    commonCities.value = commonCities.value.filter((city) => placeKey(city) !== key)
    persistCommonCities()
  }

  function removeCommonCities(places) {
    if (!Array.isArray(places) || places.length === 0) return
    const keys = new Set(places.map(placeKey))
    commonCities.value = commonCities.value.filter((city) => !keys.has(placeKey(city)))
    persistCommonCities()
  }

  /**
   * 找出这次要复用的收藏条目。
   * 精确坐标命中（手动搜索或点收藏切换）优先，其次 2km 内的定位漂移，
   * 最后才是展示身份匹配（见 sameLocatedPlace）。
   * 只有定位路径参与 2km 判定：搜「杭州」时不该把 1km 外的「西湖」条目吃掉。
   */
  function findExisting(place, { byLocation }) {
    const key = placeKey(place)
    const exact = commonCities.value.find((city) => placeKey(city) === key)
    if (exact) return exact

    if (byLocation && Number.isFinite(place.lat) && Number.isFinite(place.lon)) {
      const cosLat = Math.cos((place.lat * Math.PI) / 180)
      const nearby = commonCities.value.find((city) => {
        if (!Number.isFinite(city.lat) || !Number.isFinite(city.lon)) return false
        const dLat = city.lat - place.lat
        const dLon = (city.lon - place.lon) * cosLat
        return Math.hypot(dLat, dLon) < LOCATED_MATCH_RADIUS_DEG
      })
      if (nearby) return nearby
    }

    return commonCities.value.find((city) => sameLocatedPlace(city, place)) || null
  }

  /**
   * 写入并置顶。命中已有条目时沿用它的坐标作为身份，
   * 顺带把历史遗留的重复条目（同一个地址、坐标不同）一并清掉。
   */
  function upsertCommonCity(place, existing) {
    const item = {
      name: place.name || '未知城市',
      detail: place.detail || '',
      countryCode: place.countryCode || existing?.countryCode || '',
      lat: existing ? existing.lat : place.lat,
      lon: existing ? existing.lon : place.lon,
    }
    const key = placeKey(item)
    commonCities.value = [
      item,
      ...commonCities.value.filter((city) => placeKey(city) !== key && !sameLocatedPlace(city, item)),
    ].slice(0, MAX_COMMON_CITIES)
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
