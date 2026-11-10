import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { fetchWeather, geocodeCity } from '@/api/weather'
import { getSkyClass, nowIsDay } from '@/utils/weatherCodes'
import { readWeatherCache, writeWeatherCache } from '@/utils/weatherCache'
import { buildPlaceholderWeather } from '@/utils/weatherPlaceholder'
import { createWeatherLoader } from '@/utils/weatherRequest'
import { shouldAutoLocate } from '@/utils/locationIntent'
import { resolvePlace } from '@/utils/placeResolver'
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
    removeCommonCity,
  } = useLocationPreferences({ cachedPlace: cached?.place })

  const lat = ref(cached?.place?.lat ?? null)
  const lon = ref(cached?.place?.lon ?? null)
  const cityName = ref(cached?.place?.cityName ?? '')
  const cityDetail = ref(cached?.place?.cityDetail ?? '')
  const locationSource = ref(cached?.place?.locationSource ?? '')

  const data = ref(cached?.data ?? buildPlaceholderWeather())
  const hasWeatherData = ref(Boolean(cached?.data?.current))
  const animationEpoch = ref(null)

  const { air, load: loadAir } = useAirQuality()
  const {
    alerts,
    alertStatus,
    alertRefreshing,
    refresh: refreshAlertsForPlace,
    retry: retryAlertsForPlace,
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
        locationSource: locationSource.value,
        locationMode: locationMode.value,
      },
    })
  }

  function applyPlace(place) {
    if (!place) return
    if (place.lat != null) lat.value = place.lat
    if (place.lon != null) lon.value = place.lon
    if (place.name) cityName.value = place.name
    if (place.detail != null) cityDetail.value = place.detail
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
      if (place?.source === 'search') rememberCommonCity(place)
      commitWeather()
      loadAir(lat.value, lon.value, { clear: place != null })
      refreshAlerts()
    },
    onFailure: (error) => {
      pendingPlace = null
      lastError.value = error?.message || '网络请求失败'
    },
    onFinish: () => {
      isFetching.value = false
    },
  })

  const loadMain = (latitude, longitude, options) =>
    weatherLoader.load(latitude, longitude, options)

  const locationSession = useLocationSession({ geocode: geocodeCity, resolve: resolvePlace })

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
      return false
    }
  }

  function loadPlace(place) {
    weatherLoader.cancel()
    const candidate = locationSession.fromManualPlace(place, 'search')
    if (!candidate) return false
    return loadMain(candidate.lat, candidate.lon, { place: candidate })
  }

  function loadCommonCity(place) {
    weatherLoader.cancel()
    const candidate = locationSession.fromManualPlace(place, 'common')
    if (!candidate) return false
    return loadMain(candidate.lat, candidate.lon, { place: candidate })
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
    cityName,
    cityDetail,
    locationSource,
    locationMode,
    commonCities,
    removeCommonCity,
    data,
    hasWeatherData,
    animationEpoch,
    air,
    alerts,
    alertStatus,
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
    startAutoRefresh,
    stopAutoRefresh,
  }
})
