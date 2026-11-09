/**
 * 首屏占位骨架：结构完整的「全 0」天气对象。
 *
 * 为什么需要它：页面一进来就要把仪表盘画出来，而此时网络还没回来。
 * 直接把 data 留空不行 —— CurrentWeather 与 DetailCards 的 props.current 是
 * required，缺了就不渲染，用户会看到一块空白；给部分字段又会到处出现 NaN。
 *
 * 所以这里造一份字段齐全、数值全为 0、日期数组合法的替身，
 * 让所有组件都能正常跑完自己的渲染逻辑，数字显示 0°，等真数据到了再整体替换。
 *
 * 唯一不设 0 的是 is_day：它不参与数字显示，只决定天空色与图标是太阳还是月亮。
 * 一律给 1 会让半夜打开的人也看到白天配色，所以按此刻钟点粗判。
 */

const HOURLY_STEPS = 24

const pad2 = (n) => String(n).padStart(2, '0')

function fmtDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function fmtHour(d, hour) {
  return `${fmtDate(d)}T${pad2(hour)}:00`
}

export function buildPlaceholderWeather(now = new Date()) {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const hour = now.getHours()

  // 逐小时的起点对齐到当前整点，这样 HourlyForecast 找到的「现在」正好是第一格
  const hourlyTime = []
  for (let i = 0; i < HOURLY_STEPS; i++) {
    const h = (hour + i) % 24
    const dayOffset = Math.floor((hour + i) / 24)
    const d = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() + dayOffset)
    hourlyTime.push(fmtHour(d, h))
  }

  // 16 天预报的日期从今天起，DailyForecast 会把第一格标成「今天」
  const dailyTime = []
  for (let i = 0; i < 16; i++) {
    const d = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() + i)
    dailyTime.push(fmtDate(d))
  }

  const zeros = (n) => Array.from({ length: n }, () => 0)
  const isDay = hour >= 6 && hour < 19 ? 1 : 0

  return {
    timezone: 'auto',
    current: {
      time: fmtHour(dayStart, hour),
      temperature_2m: 0,
      relative_humidity_2m: 0,
      apparent_temperature: 0,
      // 0 是「晴朗」，占位期间天空与文案都是最中性的一种
      weather_code: 0,
      wind_speed_10m: 0,
      wind_direction_10m: 0,
      pressure_msl: 0,
      precipitation: 0,
      visibility: 0,
      uv_index: 0,
      is_day: isDay,
    },
    hourly: {
      time: hourlyTime,
      temperature_2m: zeros(HOURLY_STEPS),
      weather_code: zeros(HOURLY_STEPS),
      precipitation_probability: zeros(HOURLY_STEPS),
      is_day: hourlyTime.map((iso) => (Number(iso.slice(11, 13)) >= 6 && Number(iso.slice(11, 13)) < 19 ? 1 : 0)),
    },
    daily: {
      time: dailyTime,
      temperature_2m_max: zeros(dailyTime.length),
      temperature_2m_min: zeros(dailyTime.length),
      weather_code: zeros(dailyTime.length),
      precipitation_probability_max: zeros(dailyTime.length),
      precipitation_sum: zeros(dailyTime.length),
      // 空串能让 DetailCards 的 toMinutes() 直接得到 null，
      // 日出日落那块自然退回「— / --:--」，不会算出假的 0:00 白昼
      sunrise: dailyTime.map(() => ''),
      sunset: dailyTime.map(() => ''),
      uv_index_max: zeros(dailyTime.length),
    },
  }
}
