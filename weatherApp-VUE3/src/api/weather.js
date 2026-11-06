/**
 * 天气与地点 API 封装（均为免费、无需 API Key）
 * - 地理编码：城市名 -> 经纬度（Open-Meteo）
 * - 天气预报：当前 + 逐小时 + 16 天（Open-Meteo）
 * - 反向地理编码：本地行政区表优先（见 utils/placeLookup），网络接口仅作境外兜底
 */

const GEO_API = 'https://geocoding-api.open-meteo.com/v1/search'
const WEATHER_API = 'https://api.open-meteo.com/v1/forecast'
// 空气质量是独立接口（同一家、同样免 Key），风速湿度那套 forecast 里没有 AQI
const AIR_QUALITY_API = 'https://air-quality-api.open-meteo.com/v1/air-quality'
const REVERSE_GEO_API = 'https://api.bigdatacloud.net/data/reverse-geocode-client'

export async function geocodeCity(city) {
  const url = `${GEO_API}?name=${encodeURIComponent(city)}&count=5&language=zh&format=json`
  const res = await fetch(url)
  if (!res.ok) throw new Error('Geocoding API 请求失败')
  const data = await res.json()
  if (!data.results || data.results.length === 0) throw new Error('CITY_NOT_FOUND')
  const r = data.results[0]
  return {
    lat: r.latitude,
    lon: r.longitude,
    name: r.name,
    country: r.country || '',
    admin1: r.admin1 || '',
  }
}

/**
 * 真实反向地理编码：坐标 -> 地名
 * BigDataCloud 客户端接口，免费、无需 Key、支持 CORS
 * 带本地缓存：同一网格 24h 内只请求一次，重复访问可瞬时出结果
 */
const PLACE_CACHE_KEY = 'weather:place-cache:v1'
const PLACE_CACHE_TTL = 24 * 60 * 60 * 1000

function placeCacheKey(lat, lon) {
  // 约 1km 网格，避免 GPS 抖动造成缓存不命中
  return `${lat.toFixed(2)},${lon.toFixed(2)}`
}

function readPlaceCache(lat, lon) {
  try {
    const map = JSON.parse(localStorage.getItem(PLACE_CACHE_KEY) || '{}')
    const item = map[placeCacheKey(lat, lon)]
    if (!item || Date.now() - item.t > PLACE_CACHE_TTL) return null
    return item.v
  } catch {
    return null
  }
}

function writePlaceCache(lat, lon, value) {
  try {
    const map = JSON.parse(localStorage.getItem(PLACE_CACHE_KEY) || '{}')
    map[placeCacheKey(lat, lon)] = { v: value, t: Date.now() }

    // 只保留最近 50 条
    const keys = Object.keys(map)
    if (keys.length > 50) {
      keys
        .sort((a, b) => map[a].t - map[b].t)
        .slice(0, keys.length - 50)
        .forEach((k) => delete map[k])
    }
    localStorage.setItem(PLACE_CACHE_KEY, JSON.stringify(map))
  } catch {
    // 隐私模式 / 存储已满：忽略缓存即可
  }
}

export async function reverseGeocode(lat, lon, timeoutMs = 5000) {
  const cached = readPlaceCache(lat, lon)
  if (cached) return cached

  // 注意：这里不 abort 请求。即使本次等待超时，请求仍会跑完并写入缓存，
  // 下次打开就能命中，避免每次都从头等。
  const task = requestReverseGeocode(lat, lon)
  task.catch(() => {})

  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('REVERSE_GEO_TIMEOUT')), timeoutMs)
  })

  try {
    return await Promise.race([task, timeout])
  } finally {
    clearTimeout(timer)
  }
}

async function requestReverseGeocode(lat, lon) {
  const url = `${REVERSE_GEO_API}?latitude=${lat}&longitude=${lon}&localityLanguage=zh`
  const res = await fetch(url)
  if (!res.ok) throw new Error('反向地理编码请求失败')
  const data = await res.json()

  // city 最贴近“城市”层级；locality 是区/镇（偶有繁体），最后才退回省份
  const name = data.city || data.locality || data.principalSubdivision || ''
  if (!name) throw new Error('NO_PLACE_NAME')

  const result = {
    name,
    city: data.city || '',
    locality: data.locality || '',
    province: data.principalSubdivision || '',
    country: data.countryName || '',
  }
  writePlaceCache(lat, lon, result)
  return result
}

export async function fetchWeather(lat, lon) {
  const url =
    `${WEATHER_API}?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,pressure_msl,precipitation,visibility,uv_index,is_day` +
    `&hourly=temperature_2m,weather_code,precipitation_probability,is_day` +
    `&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max,precipitation_sum,sunrise,sunset,uv_index_max` +
    `&timezone=auto&forecast_days=16`
  const res = await fetch(url)
  if (!res.ok) throw new Error('Forecast API 请求失败')
  return res.json()
}

/**
 * 空气质量：us_aqi 用美国 EPA 的 0–500 刻度，分段（50/100/150/200/300）
 * 正好对应国内「优 / 良 / 轻度 / 中度 / 重度 / 严重」六级，标签沿用中文习惯
 * 独立接口有失败风险，调用方需自行兜底，不要让它拖垮主流程
 *
 * 超时给 8 秒而不是 2.5 秒：这个接口实测单次要 2.0–2.7 秒，
 * 2.5 秒卡在同一量级上，网络稍抖就整块数据丢失（曾一直显示「暂无」）。
 * 它已经不在首屏链路上，等久一点不会拖慢页面，只是卡片晚一点填数。
 */
export async function fetchAirQuality(lat, lon, timeoutMs = 8000) {
  const url =
    `${AIR_QUALITY_API}?latitude=${lat}&longitude=${lon}` +
    `&current=us_aqi,pm2_5,pm10&timezone=auto`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) throw new Error('Air Quality API 请求失败')
    const data = await res.json()
    return data.current ?? null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 坐标兜底展示，按半球输出正确方向
 */
export function formatCoords(lat, lon) {
  const ns = lat >= 0 ? 'N' : 'S'
  const ew = lon >= 0 ? 'E' : 'W'
  return `${Math.abs(lat).toFixed(1)}°${ns}, ${Math.abs(lon).toFixed(1)}°${ew}`
}
