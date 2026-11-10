import { ref, computed } from 'vue'
import { defineStore } from 'pinia'

import { geocodeCity, fetchWeather, fetchAirQuality, fetchAlerts, reverseGeocode, formatCoords } from '@/api/weather'
import { buildAlerts, provinceOf } from '@/utils/alertParse'
import { lookupPlace } from '@/utils/placeLookup'
import { getSkyClass, nowIsDay } from '@/utils/weatherCodes'
import { readWeatherCache, writeWeatherCache } from '@/utils/weatherCache'
import { buildPlaceholderWeather } from '@/utils/weatherPlaceholder'
import { createWeatherLoader } from '@/utils/weatherRequest'

export const useWeatherStore = defineStore('weather', () => {
  // 上一次成功的主天气 + 位置。有就直接拿来当首屏，没有就是 0 占位骨架 ——
  // 两条路都能立刻画出完整仪表盘，不再有整页 loading。
  const cached = readWeatherCache()

  // ─── 位置 ───────────────────────────────────────────────
  const lat = ref(cached?.place?.lat ?? null)
  const lon = ref(cached?.place?.lon ?? null)
  const cityName = ref(cached?.place?.cityName ?? '')
  // 城市名下方的行政归属（省 · 市），让“松滋”这类县级地名有坐标感
  const cityDetail = ref(cached?.place?.cityDetail ?? '')
  // 地名来源：county（区县）| city（地级市）| near（就近估算）| search（用户搜索）| common（常用城市）| reverse（境外反查）| coord（坐标）
  const locationSource = ref(cached?.place?.locationSource ?? '')
  const COMMON_CITIES_KEY = 'weather:common-cities:v1'
  const LEGACY_FAVORITES_KEY = 'weather:favorites:v1'
  const MAX_COMMON_CITIES = 12
  const commonCities = ref(readCommonCities())
  function readCommonCities() {
    try {
      const saved = localStorage.getItem(COMMON_CITIES_KEY)
      const legacy = saved == null ? localStorage.getItem(LEGACY_FAVORITES_KEY) : null
      const list = JSON.parse(saved ?? legacy ?? '[]')
      const valid = Array.isArray(list)
        ? list.filter((item) => item && Number.isFinite(item.lat) && Number.isFinite(item.lon))
        : []
      if (saved == null && legacy != null) {
        localStorage.setItem(COMMON_CITIES_KEY, JSON.stringify(valid.slice(0, MAX_COMMON_CITIES)))
      }
      return valid.slice(0, MAX_COMMON_CITIES)
    } catch { return [] }
  }
  function persistCommonCities() {
    try { localStorage.setItem(COMMON_CITIES_KEY, JSON.stringify(commonCities.value)) } catch { /* Storage may be disabled. */ }
  }
  function rememberCommonCity(place = {
    name: cityName.value,
    detail: cityDetail.value,
    lat: lat.value,
    lon: lon.value,
  }) {
    if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lon)) return
    const key = `${place.lat},${place.lon}`
    const item = {
      name: place.name || '未知城市',
      detail: place.detail || '',
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
  // 地名请求令牌：新的定位/搜索会让旧的异步结果失效，避免互相覆盖
  let placeToken = 0
  let placeController = null
  function cancelPlaceLookup() {
    placeController?.abort()
    placeController = null
  }

  // ─── 数据 ───────────────────────────────────────────────
  const data = ref(cached?.data ?? buildPlaceholderWeather())
  const hasWeatherData = ref(Boolean(cached?.data?.current))
  const animationEpoch = ref(null)
  // 空气质量是独立接口，可能拿不到，单独存放、不阻塞主流程
  const air = ref(null)
  // 本地天气预警：{ list, top, total }。没有预警时 list 为空，界面整块隐藏
  const alerts = ref({ list: [], top: 0, total: 0 })
  // 预警请求结果单独存：idle（还没请求）| ok（成功，可能 0 条）| error（超时/非 200/解析失败/网络被拦）
  // 必须和 alerts 分开 —— ok + 0 条要整块隐藏（空态是常态），只有 error 才显示「获取失败 + 刷新」
  const alertStatus = ref('idle')
  const alertRefreshing = ref(false)

  // ─── UI 状态：loading | error | success ─────────────────
  // 一进页面就是 success：有缓存画缓存，没缓存画 0 占位骨架，
  // 两种情况都必须立刻出完整仪表盘。整页 loading 只在真的无从显示时才会出现，
  // 而那种情况现在被占位骨架兜住了，所以 status 的 loading 分支基本不再触发。
  const status = ref('success')
  const errorTitle = ref('')
  const errorDesc = ref('')

  // 后台是否正在拉数据。右上角刷新按钮的旋转绑定这个值 ——
  // 首屏自动拉、定时拉、手动点，三种来源共用一个旋转动画，
  // 而不是各自维护一份「我在转」的局部状态。
  const isFetching = ref(false)

  // 底部“数据来源”提示中的更新时间
  const formatUpdatedAt = (value) => new Date(value).toLocaleString('zh-CN')
  const lastUpdated = ref(cached?.savedAt ? formatUpdatedAt(cached.savedAt) : '')
  const showingCachedWeather = ref(Boolean(cached?.data?.current))

  // 上次成功拉到天气的时刻（毫秒）。定时刷新用它做节流判断。
  // 有缓存时从缓存的 savedAt 起算 —— 刚打开页面、数据是 30 秒前的，
  // 不该因为「距上次成功已 6 分钟」的误判而立刻再拉一遍。
  let lastSuccessAt = cached?.savedAt ?? 0

  const current = computed(() => data.value?.current ?? null)
  const hourly = computed(() => data.value?.hourly ?? null)
  const daily = computed(() => data.value?.daily ?? null)

  const skyClass = computed(() => {
    const c = current.value
    if (!c) return ''
    // 城市当地昼夜：优先用接口按太阳高度算的 is_day，缺失时才退回钟点判断
    const isDay = c.is_day != null ? c.is_day === 1 : nowIsDay()
    // 占位天气的 weather_code 固定为 0，只为让卡片能完整渲染；不能据此显示晴天天空。
    return getSkyClass(c.weather_code, isDay, hasWeatherData.value)
  })

  // ─── 状态切换 ───────────────────────────────────────────
  // 没有 showLoading 了：页面一进来就是完整仪表盘，不存在「整页 loading」这个态。
  // showError 只留给「连坐标都拿不到、屏幕上真的一无所有」那一种情况。
  function showError(title, desc) {
    errorTitle.value = title
    errorDesc.value = desc
    status.value = 'error'
  }

  // 成功落地的统一出口：刷时间戳、记下这次成功的时刻并落盘。
  // 不再负责切 status —— 页面始终是 success，注入数据即可。
  // 也不动 DOM：数据只通过 current/hourly/daily 这些 computed 传下去，
  // 由各组件用 useTween 平滑扫到新值。
  function commitWeather() {
    hasWeatherData.value = true
    lastUpdated.value = new Date().toLocaleString('zh-CN')
    showingCachedWeather.value = false
    lastSuccessAt = Date.now()
    status.value = 'success'
    writeWeatherCache({
      data: data.value,
      place: {
        lat: lat.value,
        lon: lon.value,
        cityName: cityName.value,
        cityDetail: cityDetail.value,
        locationSource: locationSource.value,
      },
    })
  }

  // 空气质量拿不到不该影响整页：超时/网络错误一律降级为 null，由卡片显示「暂无数据」
  async function fetchAirSafe(latitude, longitude) {
    try {
      return await fetchAirQuality(latitude, longitude)
    } catch {
      return null
    }
  }

  // 空气质量单独加载，不进首屏的 Promise.all。
  // 实测该接口一次要 2.0–2.7 秒，而主天气接口 0.5 秒就回来了：
  // 放一起等，等于让首屏白等两秒多；放超时短一点，又会整块数据丢失（曾因此一直显示「暂无」）。
  // 现在先渲染天气，AQI 到了再由响应式补上，用户感知是「卡片稍后填数」，不是「页面卡住」。
  let airToken = 0
  async function loadAir(latitude, longitude, { clear = true } = {}) {
    const token = ++airToken
    if (clear) air.value = null // 切城市时清空；同城刷新保留旧值，避免表盘先退回 0
    const next = await fetchAirSafe(latitude, longitude)
    if (token !== airToken) return // 期间又切了城市，这次结果作废
    air.value = next
  }

  // 天气预警同样不进首屏：接口要按省拉一整个列表（890+ 条、约 200 KB），
  // 和空气质量一起在主天气渲染之后再补，没有预警时界面什么都不显示。
  // 返回 { ok, list } 而不是直接返回数组：ok=false 才是「接口失败」，
  // ok=true 且 list 为空是「今天确实没有本地预警」—— 两者界面必须区分，
  // 否则会把正常的空态误报成加载失败。无省名（境外城市）算 ok，不报错。
  async function fetchAlertsSafe(province) {
    if (!province) return { ok: true, list: [] }
    try {
      return { ok: true, list: await fetchAlerts(province) }
    } catch {
      return { ok: false, list: [] }
    }
  }

  let alertToken = 0
  // fromRetry：失败提示条上的「刷新」触发的重试。此时保留 error 状态让提示条留在原地
  // （按钮变成「重试中…」）；切城市时 fromRetry=false，要清掉上一座城市残留的错误。
  async function loadAlerts(province, name, fromRetry = false) {
    const token = ++alertToken
    alerts.value = { list: [], top: 0, total: 0 } // 先清空，避免上一座城市的预警留在新城市下
    if (!fromRetry) alertStatus.value = 'idle'
    alertRefreshing.value = true
    const result = await fetchAlertsSafe(province)
    if (token !== alertToken) return // 期间又切了城市或又点了一次刷新，这次结果作废
    alertRefreshing.value = false
    alerts.value = buildAlerts(result.list, name)
    alertStatus.value = result.ok ? 'ok' : 'error'
  }

  // 按当前 cityDetail（「湖北省 · 荆州市」）推出省级全名，再拉该省预警
  function refreshAlerts() {
    loadAlerts(provinceOf(cityDetail.value), cityName.value)
  }

  // 失败提示条上的刷新：只重试预警这一路，不重拉整个天气
  function retryAlerts() {
    loadAlerts(provinceOf(cityDetail.value), cityName.value, true)
  }

  // ─── 主天气统一落地 ─────────────────────────────────────
  // 只有这一处碰 data 与 isFetching，四条入口（定位 / 搜索 / 候选 / 刷新）都走它，
  // 免得每加一个入口就要重复一遍「开旋转 → 拉数据 → 关旋转 → 清错误」。
  // 失败绝不切整页错误态：仪表盘已经在屏幕上（缓存或占位骨架），
  // 把它抹掉换成一张错误卡，比保留上一份数据更糟。错误只记进 lastError，
  // 由底部那行小字提示「数据更新失败」。
  const lastError = ref('')

  // 地名统一落地：只在 loadMain 拿到数据之后调用一次。
  // 有缓存时屏幕上正显示着「松滋 19°」，这时若先把标题改成「荆州」，
  // 就会出现「城市名和数字不是一座城」的错配窗口。
  function applyPlace(place) {
    if (!place) return
    if (place.lat != null) lat.value = place.lat
    if (place.lon != null) lon.value = place.lon
    if (place.name) cityName.value = place.name
    if (place.detail != null) cityDetail.value = place.detail
    if (place.source != null) locationSource.value = place.source
  }

  // 解析出来、但因为天气请求失败而没能落地的地名。
  // 场景：首屏拿到定位坐标并解析出「松滋」，但天气接口超时 → 地名不能落地
  // （否则会出现「松滋 + 缓存里荆州的数字」）。等下一次请求成功时再补上，
  // 否则用户会一直看到缓存里的旧城市名，而地图/数字已经是新位置的了。
  let pendingPlace = null

  const weatherLoader = createWeatherLoader({
    request: fetchWeather,
    onStart: (place) => {
      isFetching.value = true
      if (place) pendingPlace = place
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
      if (place?.source === 'search') rememberCommonCity()
      commitWeather()
      // 主天气刷新时保留当前 AQI；换地点才先清空，避免旧城市空气质量短暂挂在新城市下。
      loadAir(lat.value, lon.value, { clear: place != null })
      refreshAlerts()
    },
    onFailure: (error) => {
      lastError.value = error?.message || '网络请求失败'
    },
    onFinish: () => { isFetching.value = false },
  })
  const loadMain = (latitude, longitude, options) => weatherLoader.load(latitude, longitude, options)

  // ─── 按城市名加载（本地候选之外的兜底，走地理编码） ─────
  async function loadCity(city) {
    placeToken += 1 // 让尚未返回的定位反查结果失效
    const token = placeToken
    cancelPlaceLookup()
    weatherLoader.cancel()
    const controller = new AbortController()
    placeController = controller
    isFetching.value = true
    try {
      const geo = await geocodeCity(city, { signal: controller.signal })
      if (token !== placeToken) return
      placeController = null
      // 地名不在这里写，交给 loadMain 和数据一起落地
      lat.value = geo.lat
      lon.value = geo.lon
      isFetching.value = false
      await loadMain(geo.lat, geo.lon, {
        place: {
          name: geo.name,
          detail: formatSearchDetail(geo),
          source: 'search',
        },
      })
    } catch (err) {
      isFetching.value = false
      if (token !== placeToken) return
      // 城市名打错是用户输入问题，不是「页面挂了」：仪表盘留着，只在最后一行小字说明
      lastError.value =
        err.message === 'CITY_NOT_FOUND' ? `未找到「${city}」` : err.message || '加载失败'
    }
  }

  // ─── 按候选地名加载（本地表自带坐标，跳过地理编码） ─────
  // place: placeSearch 的候选条目 { name, detail, lat, lon }
  async function loadPlace(place) {
    placeToken += 1
    cancelPlaceLookup()
    weatherLoader.cancel()
    lat.value = place.lat
    lon.value = place.lon
    // 地名同样交给 loadMain：切城市时先把标题换掉，会有一瞬间标题是B、数字还是A
    await loadMain(place.lat, place.lon, {
      place: { name: place.name, detail: place.detail, source: 'search' },
    })
  }

  function loadCommonCity(place) {
    placeToken += 1
    cancelPlaceLookup()
    weatherLoader.cancel()
    return loadMain(place.lat, place.lon, {
      place: { name: place.name, detail: place.detail, source: 'common' },
    })
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
    const token = ++placeToken
    cancelPlaceLookup()
    weatherLoader.cancel()
    isFetching.value = true
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

      // 地名走本地行政区表，基本 0 毫秒；与天气并行没有意义，先拿地名再拉天气
      const place = await resolvePlace(lat.value, lon.value)
      if (token !== placeToken) return

      // 地名先挂起、不写入 —— 有缓存时屏幕上正显示着「松滋 19°」，
      // 这时把标题改成「荆州」而数字还是松滋的，会出现「城市名和数字不是一座城」。
      // 交给 loadMain：数据与地名在同一拍落地。
      isFetching.value = false
      await loadMain(lat.value, lon.value, {
        place: { name: place.text, detail: place.detail, source: place.source },
      })
    } catch (err) {
      isFetching.value = false
      if (token !== placeToken) return
      const reason =
        err.code === 1
          ? ['定位已关闭', '请在浏览器设置中允许定位，或手动搜索城市名称。']
          : err.code === 2
            ? ['定位失败', '无法获取位置信息，请手动搜索城市。']
            : err.code === 3
              ? ['定位超时', '定位请求超时，请手动搜索城市。']
              : ['数据加载失败', err.message || '网络请求失败，请稍后重试。']
      // 只有连坐标都没拿到、屏幕上又没有任何可画的东西时才整页报错；
      // 否则仪表盘已经有缓存或占位骨架，错误降到小字位置即可
      if (lat.value == null) {
        showError(reason[0], reason[1])
      } else {
        lastError.value = reason[0]
      }
    }
  }

  // ─── 刷新（手动 / 定时共用） ─────────────────────────────
  // 不再切整页 loading：数据原地替换，用户只看到数字自己变了。
  async function refresh({ quiet = false } = {}) {
    if (lat.value == null || lon.value == null) return false
    return loadMain(lat.value, lon.value, { quiet })
  }

  // ─── 6 分钟自动刷新（节流） ─────────────────────────────
  // 规则：距上次成功满 6 分钟才真正请求。每分钟醒一次做判断，
  // 所以是「数据超过 6 分钟就补一枪」，不是「每 6 分钟硬拉一次」。
  // 页面在后台不请求；切回前台那一拍会立刻补上（此时差值早已超过阈值）。
  const REFRESH_MIN_MS = 6 * 60 * 1000
  const TICK_MS = 60 * 1000
  let autoTimer = null

  function maybeAutoRefresh() {
    if (lat.value == null || lon.value == null) return
    if (isFetching.value) return
    if (typeof document !== 'undefined' && document.hidden) return
    if (Date.now() - lastSuccessAt < REFRESH_MIN_MS) return
    refresh({ quiet: true })
  }

  function startAutoRefresh() {
    if (autoTimer != null) return
    autoTimer = setInterval(maybeAutoRefresh, TICK_MS)
  }

  function stopAutoRefresh() {
    if (autoTimer == null) return
    clearInterval(autoTimer)
    autoTimer = null
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
    commonCities,
    removeCommonCity,
    loadCommonCity,
    cityDetail,
    locationSource,
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
    current,
    hourly,
    daily,
    skyClass,
    loadCity,
    loadPlace,
    loadByGeolocation,
    refresh,
    retry,
    retryAlerts,
    startAutoRefresh,
    stopAutoRefresh,
  }
})
