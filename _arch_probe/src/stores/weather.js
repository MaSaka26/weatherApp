import { ref, computed } from 'vue'
import { defineStore } from 'pinia'

import { geocodeCity, fetchWeather, fetchAirQuality, reverseGeocode, formatCoords } from '@/api/weather'
import { lookupPlace } from '@/utils/placeLookup'
import { getSkyClass, nowIsDay } from '@/utils/weatherCodes'

export const useWeatherStore = defineStore('weather', () => {
  // ─── 位置 ───────────────────────────────────────────────
  const lat = ref(null)
  const lon = ref(null)
  const cityName = ref('')
  // 城市名下方的行政归属（省 · 市），让“松滋”这类县级地名有坐标感
  const cityDetail = ref('')
  // 地名来源：county（区县）| city（地级市）| near（就近估算）| search（用户搜索）| reverse（境外反查）| coord（坐标）
  const locationSource = ref('')
  // 地名请求令牌：新的定位/搜索会让旧的异步结果失效，避免互相覆盖
  let placeToken = 0

  // ─── 数据 ───────────────────────────────────────────────
  const data = ref(null)
  // 空气质量是独立接口，可能拿不到，单独存放、不阻塞主流程
  const air = ref(null)

  // ─── UI 状态：loading | error | success ─────────────────
  const status = ref('loading')
  const errorTitle = ref('')
  const errorDesc = ref('')

  // 每次成功渲染自增，用于重建 DOM 以重放 fadeUp 动画
  const renderKey = ref(0)
  // 底部“数据来源”提示中的更新时间
  const lastUpdated = ref('')

  const current = computed(() => data.value?.current ?? null)
  const hourly = computed(() => data.value?.hourly ?? null)
  const daily = computed(() => data.value?.daily ?? null)

  const skyClass = computed(() => {
    const c = current.value
    if (!c) return ''
    // 城市当地昼夜：优先用接口按太阳高度算的 is_day，缺失时才退回钟点判断
    const isDay = c.is_day != null ? c.is_day === 1 : nowIsDay()
    return getSkyClass(c.weather_code, isDay)
  })

  // ─── 状态切换 ───────────────────────────────────────────
  function showLoading() {
    status.value = 'loading'
  }

  function showError(title, desc) {
    errorTitle.value = title
    errorDesc.value = desc
    status.value = 'error'
  }

  function showContent() {
    renderKey.value += 1
    lastUpdated.value = new Date().toLocaleString('zh-CN')
    status.value = 'success'
  }

  // 空气质量拿不到不该影响整页：超时/网络错误一律降级为 null，由卡片显示「暂无数据」
  async function fetchAirSafe(latitude, longitude) {
    try {
      return await fetchAirQuality(latitude, longitude)
    } catch {
      return null
    }
  }

  // ─── 按城市名加载（本地候选之外的兜底，走地理编码） ─────
  async function loadCity(city) {
    placeToken += 1 // 让尚未返回的定位反查结果失效
    showLoading()
    try {
      const geo = await geocodeCity(city)
      lat.value = geo.lat
      lon.value = geo.lon
      cityName.value = geo.name
      cityDetail.value = formatSearchDetail(geo)
      locationSource.value = 'search'
      const [weather, airData] = await Promise.all([
        fetchWeather(geo.lat, geo.lon),
        fetchAirSafe(geo.lat, geo.lon),
      ])
      data.value = weather
      air.value = airData
      showContent()
    } catch (err) {
      if (err.message === 'CITY_NOT_FOUND') {
        showError('未找到城市', `未找到「${city}」，请检查城市名称是否正确。`)
      } else {
        showError('加载失败', err.message)
      }
    }
  }

  // ─── 按候选地名加载（本地表自带坐标，跳过地理编码） ─────
  // place: placeSearch 的候选条目 { name, detail, lat, lon }
  async function loadPlace(place) {
    placeToken += 1
    showLoading()
    try {
      lat.value = place.lat
      lon.value = place.lon
      cityName.value = place.name
      cityDetail.value = place.detail
      locationSource.value = 'search'
      const [weather, airData] = await Promise.all([
        fetchWeather(place.lat, place.lon),
        fetchAirSafe(place.lat, place.lon),
      ])
      data.value = weather
      air.value = airData
      showContent()
    } catch (err) {
      showError('加载失败', err.message)
    }
  }

  // ─── 地点名解析 ─────────────────────────────────────────
  // 本地行政区表优先（区县 → 地级市 → 附近），零网络、即时；
  // 只在境外等本地表完全无覆盖的位置才联网反查。
  // 返回 { text, detail, source }，且永不 reject（超时由内部兜住）。

  // 搜索结果只有国家/一级行政区，拼成副标题；国内只显示省份，避免“上海市 · 中国”
  function formatSearchDetail(geo) {
    const admin1 = geo.admin1 || ''
    const country = geo.country || ''
    if (!country || country === '中国' || country === 'China') return admin1
    return [admin1, country].filter(Boolean).join(' · ')
  }

  async function resolvePlace(latitude, longitude) {
    const local = lookupPlace(latitude, longitude)
    if (local) {
      return { text: local.name, detail: local.detail, source: local.level }
    }

    // 境外 / 远海：联网反查，失败就退回坐标
    try {
      const place = await reverseGeocode(latitude, longitude, 3000)
      if (place.name) {
        const detail = [place.province, place.country].filter(Boolean).join(' · ')
        return { text: place.name, detail, source: 'reverse' }
      }
    } catch {
      // 网络不可用，继续降级
    }

    return { text: formatCoords(latitude, longitude), detail: '', source: 'coord' }
  }

  // ─── 浏览器定位加载 ─────────────────────────────────────
  async function loadByGeolocation() {
    showLoading()
    const token = ++placeToken
    try {
      const pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false,
          timeout: 8000,
          maximumAge: 60000,
        })
      })

      lat.value = pos.coords.latitude
      lon.value = pos.coords.longitude

      // 天气、地名、空气质量同时请求，全部就绪后一次性渲染，避免先坐标后地名的闪烁
      const [weather, place, airData] = await Promise.all([
        fetchWeather(lat.value, lon.value),
        resolvePlace(lat.value, lon.value),
        fetchAirSafe(lat.value, lon.value),
      ])

      // 等待期间若已切换到别的城市，丢弃这次结果
      if (token !== placeToken) return

      data.value = weather
      air.value = airData
      cityName.value = place.text
      cityDetail.value = place.detail
      locationSource.value = place.source
      showContent()
    } catch (err) {
      if (token !== placeToken) return
      if (err.code === 1) {
        showError('定位已关闭', '请在浏览器设置中允许定位，或手动搜索城市名称。')
      } else if (err.code === 2) {
        showError('定位失败', '无法获取位置信息，请手动搜索城市。')
      } else if (err.code === 3) {
        showError('定位超时', '定位请求超时，请手动搜索城市。')
      } else {
        showError('数据加载失败', err.message || '网络请求失败，请稍后重试。')
      }
    }
  }

  // ─── 刷新 ───────────────────────────────────────────────
  async function refresh() {
    if (lat.value == null || lon.value == null) return
    showLoading()
    try {
      const [weather, airData] = await Promise.all([
        fetchWeather(lat.value, lon.value),
        fetchAirSafe(lat.value, lon.value),
      ])
      data.value = weather
      air.value = airData
      showContent()
    } catch (err) {
      showError('数据加载失败', err.message + '。请下拉刷新重试。')
    }
  }

  // ─── 错误页重试 ─────────────────────────────────────────
  function retry() {
    if (lat.value != null && lon.value != null) {
      refresh()
    } else {
      loadByGeolocation()
    }
  }

  return {
    lat,
    lon,
    cityName,
    cityDetail,
    locationSource,
    data,
    air,
    status,
    errorTitle,
    errorDesc,
    renderKey,
    lastUpdated,
    current,
    hourly,
    daily,
    skyClass,
    loadCity,
    loadPlace,
    loadByGeolocation,
    refresh,
    retry,
  }
})
