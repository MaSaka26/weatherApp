/**
 * WMO Weather interpretation codes 映射
 * https://open-meteo.com/en/docs
 */

const CONDITION_TEXT = {
  0: '晴朗',
  1: '大部晴朗',
  2: '多云',
  3: '阴天',
  45: '雾',
  48: '霜雾',
  51: '小毛毛雨',
  53: '毛毛雨',
  55: '大毛毛雨',
  56: '冻毛毛雨',
  57: '冻毛毛雨',
  61: '小雨',
  63: '中雨',
  65: '大雨',
  66: '冻雨',
  67: '冻雨',
  71: '小雪',
  73: '中雪',
  75: '大雪',
  77: '雪粒',
  80: '阵雨',
  81: '中阵雨',
  82: '大阵雨',
  85: '小阵雪',
  86: '大阵雪',
  95: '雷暴',
  96: '雷暴加冰雹',
  99: '雷暴加冰雹',
}

export function getWeatherIcon(code, isDay = true) {
  if (code === 0) return isDay ? '☀️' : '🌙'
  if (code === 1) return isDay ? '🌤️' : '🌙'
  if (code === 2) return isDay ? '⛅' : '☁️'
  if (code === 3) return '☁️'
  if (code >= 45 && code <= 48) return '🌫️'
  if (code >= 51 && code <= 55) return '🌦️'
  if (code >= 56 && code <= 57) return '🌨️'
  if (code >= 61 && code <= 65) return '🌧️'
  if (code >= 66 && code <= 67) return '🌧️'
  if (code >= 71 && code <= 77) return '❄️'
  if (code >= 80 && code <= 82) return '🌦️'
  if (code >= 85 && code <= 86) return '🌨️'
  if (code >= 95) return '⛈️'
  return '🌤️'
}

export function getConditionText(code) {
  return CONDITION_TEXT[code] || '未知'
}

export function getSkyClass(code, isDay, dataReady = true) {
  if (!dataReady) return 'weather-unknown'
  if (code === 0) return isDay ? 'clear-day' : 'clear-night'
  if (code <= 2) return isDay ? 'clear-day' : 'clear-night'
  if (code === 3 || (code >= 45 && code <= 48)) return 'cloudy'
  if (code >= 51 && code <= 67) return 'rainy'
  if (code >= 71 && code <= 77) return 'snowy'
  if (code >= 80 && code <= 82) return 'rainy'
  if (code >= 85 && code <= 86) return 'snowy'
  if (code >= 95) return 'thunderstorm'
  return 'clear-day'
}

/**
 * 兜底用的昼夜判断（6:00 - 18:59 视为白天）。
 * 正常路径应该用接口返回的 is_day —— 它按太阳高度算，且用的是城市当地时间；
 * 这里的钟点判断既跟不上真实日照（冬季傍晚会多亮两小时），也比的是浏览器时区。
 * 仅在 is_day 缺失时调用。
 */
export function nowIsDay() {
  const h = new Date().getHours()
  return h >= 6 && h < 19
}
