import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { fetchWeather, geocodeCity } from '@/api/weather'
import { getSkyClass, nowIsDay } from '@/utils/weatherCodes'
import { readWeatherCache, writeWeatherCache } from '@/utils/weatherCache'
import { buildPlaceholderWeather } from '@/utils/weatherPlaceholder'
import { createWeatherLoader } from '@/utils/weatherRequest'
import { shouldAutoLocate } from '@/utils/locationIntent'
import { resolvePlace } from '@/utils/placeResolver'
import { lookupPlace } from '@/utils/placeLookup'
import { useLocationPreferences } from '@/composables/weather/useLocationPreferences'
import { useLocationSession } from '@/composables/weather/useLocationSession'
import { useAirQuality } from '@/composables/weather/useAirQuality'
import { useWeatherAlerts } from '@/composables/weather/useWeatherAlerts'
import { useWeatherRefresh } from '@/composables/weather/useWeatherRefresh'

const formatUpdatedAt = (value) => new Date(value).toLocaleString('zh-CN')

export const useWeatherStore = defineStore('weather', () => {
  const cached = readWeatherCache()

  const {
    locationMode,
    commonCities,
    setLocationMode,
    rememberCommonCity,
    rememberLocatedCity,
    removeCommonCity,
    removeCommonCities: prefsRemoveCommonCities,
  } = useLocationPreferences({ cachedPlace: cached?.place })

  const lat = ref(cached?.place?.lat ?? null)
  const lon = ref(cached?.place?.lon ?? null)
  const cityName = ref(cached?.place?.cityName ?? '')
  const cityDetail = ref(cached?.place?.cityDetail ?? '')
  const cachedCountryCode = cached?.place?.countryCode || (
    ['county', 'city', 'near'].includes(cached?.place?.locationSource) ||
    (Number.isFinite(cached?.place?.lat) && lookupPlace(cached.place.lat, cached.place.lon)?.level)
      ? 'CN'
      : ''
  )
  const cityCountryCode = ref(cachedCountryCode)
  const locationSource = ref(cached?.place?.locationSource ?? '')

  const data = ref(cached?.data ?? buildPlaceholderWeather())
  const hasWeatherData = ref(Boolean(cached?.data?.current))
  const animationEpoch = ref(null)

  const { air, airStatus, airError, load: loadAir, fail: failAir } = useAirQuality()
  const {
    alerts,
    alertStatus,
    alertError,
    alertRefreshing,
    refresh: refreshAlertsForPlace,
    retry: retryAlertsForPlace,
    fail: failAlerts,
  } = useWeatherAlerts()

  const status = ref('success')
  const errorTitle = ref('')
  const errorDesc = ref('')
  const isFetching = ref(false)
  const lastError = ref('')
  const lastUpdated = ref(cached?.savedAt ? formatUpdatedAt(cached.savedAt) : '')
  const showingCachedWeather = ref(Boolean(cached?.data?.current))
  const lastSuccessAt = ref(cached?.savedAt ?? 0)

  const current = computed(() => data.value?.current ?? null)
  const hourly = computed(() => data.value?.hourly ?? null)
  const daily = computed(() => data.value?.daily ?? null)
  // 当前正在浏览的城市，供收藏列表标记绿点。名字与详情一起带上：
  // 收藏条目存的是首次进入时的代表坐标，定位漂移较大时只能靠展示身份找回那一条。
  // 无缓存时坐标为 null，不会命中任何收藏。
  const activeCity = computed(() => ({
    lat: lat.value,
    lon: lon.value,
    name: cityName.value,
    detail: cityDetail.value,
  }))

  const skyClass = computed(() => {
    const value = current.value
    if (!value) return ''
    const isDay = value.is_day != null ? value.is_day === 1 : nowIsDay()
    return getSkyClass(value.weather_code, isDay, hasWeatherData.value)
  })

  function showError(title, desc) {
    errorTitle.value = title
    errorDesc.value = desc
    status.value = 'error'
  }

  function commitWeather() {
    hasWeatherData.value = true
    lastUpdated.value = new Date().toLocaleString('zh-CN')
    showingCachedWeather.value = false
    status.value = 'success'
    weatherRefresh.markSuccess()
    writeWeatherCache({
      data: data.value,
      place: {
        lat: lat.value,
        lon: lon.value,
        cityName: cityName.value,
        cityDetail: cityDetail.value,
        countryCode: cityCountryCode.value,
        locationSource: locationSource.value,
        locationMode: locationMode.value,
      },
    })
  }

  function inferCountryCode(place) {
    if (!place) return ''
    if (place.countryCode) return place.countryCode
    if (!Number.isFinite(place.lat) || !Number.isFinite(place.lon)) return ''
    return lookupPlace(place.lat, place.lon)?.level ? 'CN' : ''
  }

  function applyPlace(place) {
    if (!place) return
    if (place.lat != null) lat.value = place.lat
    if (place.lon != null) lon.value = place.lon
    if (place.name) cityName.value = place.name
    if (place.detail != null) cityDetail.value = place.detail
    if (place.countryCode != null) cityCountryCode.value = place.countryCode
    if (place.source != null) locationSource.value = place.source
    if (place.mode === 'auto' || place.mode === 'manual') setLocationMode(place.mode)
  }

  let pendingPlace = null

  const weatherLoader = createWeatherLoader({
    request: fetchWeather,
    onStart: (place) => {
      isFetching.value = true
      pendingPlace = place || null
    },
    onApply: (next) => {
      animationEpoch.value = performance.now()
      data.value = next
      if (pendingPlace) {
        applyPlace(pendingPlace)
        pendingPlace = null
      }
    },
    onSuccess: (_result, place) => {
      lastError.value = ''
      // 搜索与定位得到的城市都进收藏；定位坐标会抖动，单独走网格去重避免重复堆积。
      if (place?.source === 'search') {
        rememberCommonCity(place)
      } else if (place?.mode === 'auto') {
        rememberLocatedCity({ ...place, countryCode: place.countryCode || inferCountryCode(place) })
      }
      commitWeather()
      loadAir(lat.value, lon.value, { clear: place != null })
      refreshAlerts()
    },
    onFailure: (error) => {
      pendingPlace = null
      lastError.value = error?.message || '网络请求失败'
      // 这两个接口原本只在主天气成功后才发请求。主链路失败时若不管，
      // alertStatus 会永远停在 idle，界面上就是一个永不停的骨架 —— 用户报的
      // 无限 loading 正是这么来的。有坐标就照常单独发一次（各自带超时和状态），
      // 没坐标才干脆置为失败，绝不让状态停在 idle。
      if (lat.value != null && lon.value != null) {
        loadAir(lat.value, lon.value, { clear: !hasWeatherData.value })
        refreshAlerts()
      } else {
        failAir('缺少城市坐标')
        failAlerts('缺少城市坐标')
      }
    },
    onFinish: () => {
      isFetching.value = false
    },
  })

  const loadMain = (latitude, longitude, options) =>
    weatherLoader.load(latitude, longitude, options)

  const locationSession = useLocationSession({ geocode: geocodeCity, resolve: resolvePlace })

  // 切城市/定位在「还没发出请求」就失败时（城市解析不到、定位被拒），
  // 两条独立链路不会有人去推状态，仍会停在 idle。这里统一补一个失败态。
  function markSecondaryUnavailable(reason) {
    failAir(reason)
    failAlerts(reason)
  }

  async function loadCity(city) {
    weatherLoader.cancel()
    isFetching.value = true
    try {
      const candidate = await locationSession.searchCity(city)
      return await loadMain(candidate.lat, candidate.lon, { place: candidate })
    } catch (error) {
      if (error?.code === 'LOCATION_STALE') return false
      isFetching.value = false
      lastError.value =
        error?.message === 'CITY_NOT_FOUND'
          ? `未找到「${city}」`
          : error?.code === 'LOCATION_INVALID'
            ? '城市定位结果无效，请重试'
            : error?.message || '加载失败'
      markSecondaryUnavailable('城市切换失败')
      return false
    }
  }

  function loadPlace(place) {
    weatherLoader.cancel()
    const enrichedPlace = { ...place, countryCode: inferCountryCode(place) }
    const candidate = locationSession.fromManualPlace(enrichedPlace, 'search')
    if (!candidate) {
      markSecondaryUnavailable('城市定位结果无效')
      return false
    }
    return loadMain(candidate.lat, candidate.lon, { place: candidate })
  }

  function loadCommonCity(place) {
    weatherLoader.cancel()
    const enrichedPlace = { ...place, countryCode: inferCountryCode(place) }
    const candidate = locationSession.fromManualPlace(enrichedPlace, 'common')
    if (!candidate) {
      markSecondaryUnavailable('收藏城市坐标无效')
      return false
    }
    return loadMain(candidate.lat, candidate.lon, { place: candidate })
  }

  function removeCommonCities(places = []) {
    if (!Array.isArray(places) || places.length === 0) return
    const keys = new Set(places.map((p) => `${p.lat},${p.lon}`))
    const wasActive = keys.has(`${lat.value},${lon.value}`)
    prefsRemoveCommonCities(places)
    if (wasActive) {
      const next = commonCities.value[0]
      if (next) loadCommonCity(next)
    }
  }

  async function loadByGeolocation() {
    weatherLoader.cancel()
    isFetching.value = true
    try {
      const candidate = await locationSession.locate()
      return await loadMain(candidate.lat, candidate.lon, { place: candidate })
    } catch (error) {
      if (error?.code === 'LOCATION_STALE') return false
      isFetching.value = false
      const reason =
        error?.code === 1
          ? ['定位已关闭', '请在浏览器设置中允许定位，或手动搜索城市名称。']
          : error?.code === 2
            ? ['定位失败', '无法获取位置信息，请手动搜索城市。']
            : error?.code === 3
              ? ['定位超时', '定位请求超时，请手动搜索城市。']
              : error?.code === 'LOCATION_INVALID'
                ? ['定位结果无效', '无法识别当前位置，请手动搜索城市。']
                : ['数据加载失败', error?.message || '网络请求失败，请稍后重试。']
      if (lat.value == null) showError(reason[0], reason[1])
      else lastError.value = reason[0]
      markSecondaryUnavailable(reason[0])
      return false
    }
  }

  async function loadInitialLocation() {
    if (!shouldAutoLocate(locationMode.value, lat.value, lon.value)) return false
    return loadByGeolocation()
  }

  async function refresh({ quiet = false } = {}) {
    if (lat.value == null || lon.value == null) return false
    return loadMain(lat.value, lon.value, { quiet })
  }

  function refreshAlerts() {
    return refreshAlertsForPlace(cityDetail.value, cityName.value)
  }

  function retryAlerts() {
    return retryAlertsForPlace(cityDetail.value, cityName.value)
  }

  /**
   * 首屏补拉两条独立链路（空气质量 / 城市预警）。
   *
   * 这两路原本只挂在主天气 onSuccess 上。但手动模式 + 24h 内有效的缓存时，
   * loadInitialLocation 会直接返回 false（不需要定位也不用请求），
   * 6 分钟节流又让自动刷新不会立刻跑 —— 于是整个页面一条请求都不发，
   * 预警骨架和空气质量就永远停在 idle。挂载时显式补一次即可。
   */
  function loadSecondary() {
    if (lat.value == null || lon.value == null) return false
    loadAir(lat.value, lon.value, { clear: !hasWeatherData.value })
    refreshAlerts()
    return true
  }

  // 空气质量的重试：只重拉这一路，不重拉整个天气
  function retryAir() {
    if (lat.value == null || lon.value == null) return false
    return loadAir(lat.value, lon.value, { clear: true })
  }

  const weatherRefresh = useWeatherRefresh({
    isFetching,
    lastSuccessAt,
    hasWeatherData,
    canRefresh: () => lat.value != null && lon.value != null,
    refresh,
  })

  const { dataAgeMs, isStale, autoRefreshFailed } = weatherRefresh

  function startAutoRefresh() {
    weatherRefresh.start()
  }

  function stopAutoRefresh() {
    weatherRefresh.stop()
  }

  function retry() {
    if (lat.value != null && lon.value != null) refresh()
    else loadByGeolocation()
  }

  return {
    lat,
    lon,
    activeCity,
    cityName,
    cityDetail,
    cityCountryCode,
    locationSource,
    locationMode,
    commonCities,
    removeCommonCity,
    removeCommonCities,
    data,
    hasWeatherData,
    animationEpoch,
    air,
    airStatus,
    airError,
    alerts,
    alertStatus,
    alertError,
    alertRefreshing,
    status,
    errorTitle,
    errorDesc,
    isFetching,
    lastError,
    lastUpdated,
    showingCachedWeather,
    dataAgeMs,
    isStale,
    autoRefreshFailed,
    current,
    hourly,
    daily,
    skyClass,
    loadCity,
    loadPlace,
    loadCommonCity,
    loadByGeolocation,
    loadInitialLocation,
    refresh,
    retry,
    retryAlerts,
    retryAir,
    loadSecondary,
    startAutoRefresh,
    stopAutoRefresh,
  }
})
