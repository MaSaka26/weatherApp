/**
 * 生活指数：把「当前实况 + 今日 / 明日预报 + 空气质量」折算成六句日常结论。
 *
 * 每项只给三个字段：结论短语 + 依据小字 + 一个 Tabler 图标名。
 *   穿衣  ——  适宜长袖            jacket
 *   户外  ——  适合户外运动          run
 *   洗车  ——  不宜洗车             car-off
 *   带伞  ——  不用带伞             umbrella-off
 *   疾病  ——  少发感冒             thermometer
 *
 * 图标的取法：用「正向图标 / 否定变体」直接表达结论，不再用颜色区分好坏——
 * 适合洗车就是 car，不宜洗车就是 car-off；跑得动是 run，出不了门是 ban。
 * 这样即使配色主题变化，结论本身也不会读错。
 *
 * 设计原则
 * 1. 每一步都能溯源：先算出 facts（体感、温差、降水概率…），再各自打分/查表，
 *    不直接读 props，方便调阈值时不影响模板。
 * 2. 阈值全部集中在文件顶部的常量里，改口径只改常量。
 * 3. 数据缺失时降级为「暂无 XX 数据」，不猜、不把 0 当真实值。
 * 4. 措辞统一成「结果 + 动作」的短句：适宜 / 适合 / 不宜 / 需要 / 不用，句子本身能独立读懂。
 */

// WMO 天气码分组，与 utils/weatherCodes 的图标分组保持一致
const RAIN_CODES = [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]
const SNOW_CODES = [71, 73, 75, 77, 85, 86]
const HEAVY_CODES = [65, 67, 75, 82, 86, 96, 99]
const THUNDER_CODES = [95, 96, 99]

const isIn = (list, code) => list.includes(code)
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const r0 = (v) => Math.round(v)

/* ===== 阈值表 ===== */

// 穿衣：按「全天平均体感温度」分档，20℃ 上下最舒适
// 图标按「越冷穿越厚」换：短袖 → 长袖外套 → 羽绒 → 别出门
const CLOTHING = [
  { min: 32, item: '适宜短袖短裤', icon: 'shirt' },
  { min: 28, item: '适宜短袖', icon: 'shirt' },
  { min: 24, item: '适宜薄长袖', icon: 'shirt' },
  { min: 20, item: '适宜长袖', icon: 'shirt' },
  { min: 16, item: '适宜卫衣或外套', icon: 'jacket' },
  { min: 12, item: '适宜夹克或毛衣', icon: 'jacket' },
  { min: 8, item: '适宜风衣或毛衣', icon: 'jacket' },
  { min: 4, item: '适宜棉服或大衣', icon: 'jacket' },
  { min: 0, item: '适宜羽绒加围巾', icon: 'snowflake' },
  { min: -6, item: '适宜厚羽绒', icon: 'snowflake' },
  { min: -Infinity, item: '不宜出门', icon: 'door-off' },
]

// 防晒：按当日紫外线峰值（比瞬时值有指导意义，傍晚瞬时值总是接近 0）
// 分档边界用国际通行口径：<3 低、3–5 中等、6–7 高、8–10 很高、11+ 极高
// 越强图标越「晒」：温和的太阳 → 小太阳 → 强太阳 → 太阳被划掉（别晒）
const SUNSCREEN = [
  { max: 3, action: '无需防晒', icon: 'sun' },
  { max: 6, action: '建议防晒', icon: 'sun-low' },
  { max: 8, action: '需要防晒', icon: 'sun-high' },
  { max: 11, action: '加强防晒', icon: 'sun-high' },
  { max: Infinity, action: '避免暴晒', icon: 'sun-off' },
]

/* ===== 基础事实 ===== */

function readFacts(current, daily, air) {
  const temp = num(current?.temperature_2m)
  const feels = num(current?.apparent_temperature)
  const high = num(daily?.temperature_2m_max?.[0])
  const low = num(daily?.temperature_2m_min?.[0])
  const highNext = num(daily?.temperature_2m_max?.[1])

  // 体感与气温的偏差是「此刻」的：直接加在高低温上会把温差放大一倍
  // （风大体感 -5°，5 / -2 的一天会推成 -7），所以减半并限幅
  const drift =
    temp != null && feels != null ? Math.max(-6, Math.min(6, feels - temp)) * 0.5 : 0
  const feelsLow = low == null ? null : low + drift

  const code = num(current?.weather_code) ?? num(daily?.weather_code?.[0]) ?? 0

  return {
    temp,
    feels,
    feelsLow,
    // 全天平均体感：(今日高低温均值) + 半数体感偏差；高低温缺失时退回瞬时体感
    feelsMean: high != null && low != null ? (high + low) / 2 + drift : (feels ?? temp),
    high,
    low,
    highNext,
    swing: high != null && low != null ? high - low : null,
    code,
    codeToday: num(daily?.weather_code?.[0]) ?? code,
    pop: num(daily?.precipitation_probability_max?.[0]),
    popNext: num(daily?.precipitation_probability_max?.[1]),
    rainSum: num(daily?.precipitation_sum?.[0]),
    uv: num(daily?.uv_index_max?.[0]),
    wind: num(current?.wind_speed_10m),
    humidity: num(current?.relative_humidity_2m),
    visKm: num(current?.visibility) == null ? null : current.visibility / 1000,
    aqi: num(air?.us_aqi),
    rainingNow: (num(current?.precipitation) ?? 0) > 0 || isIn(RAIN_CODES, code),
  }
}

// 数据缺失时也带项目名，句子只剩一行也不会不知道说的是哪项
const EMPTY = (key, title, icon) => ({
  key,
  title,
  verdict: `暂无${title}数据`,
  detail: '',
  icon,
})

/* ===== 1. 穿衣 ===== */

function clothing(f) {
  if (f.feelsMean == null) return EMPTY('clothing', '穿衣', 'help')
  const row = CLOTHING.find((c) => f.feelsMean >= c.min)

  // 依据只留右下角一个数字：温差大时说温差，否则说最低温
  const detail =
    f.swing != null && f.swing >= 10
      ? `温差 ${r0(f.swing)}°`
      : f.low != null
        ? `最低 ${r0(f.low)}°`
        : ''

  return { key: 'clothing', title: '穿衣', verdict: row.item, detail, icon: row.icon }
}

/* ===== 2. 防晒 ===== */

function sunscreen(f) {
  if (f.uv == null) return EMPTY('sunscreen', '防晒', 'sun-off')

  let idx = SUNSCREEN.findIndex((s) => f.uv < s.max)
  // 雪面反射把紫外线再抬一档：晴天雪地很容易被低估
  if (isIn(SNOW_CODES, f.codeToday) && idx < SUNSCREEN.length - 1) idx += 1

  return {
    key: 'sunscreen',
    title: '防晒',
    verdict: SUNSCREEN[idx].action,
    detail: `UV ${f.uv.toFixed(1)}`,
    icon: SUNSCREEN[idx].icon,
  }
}

/* ===== 3. 户外运动 ===== */

// 逐项加分，分数越高越不适合；权重集中在这里，调口径只动这段
function outdoorScore(f) {
  let score = 0
  if (f.pop != null) score += f.pop >= 60 ? 2 : f.pop >= 30 ? 1 : 0
  if (f.rainSum != null) score += f.rainSum >= 5 ? 2 : f.rainSum >= 1 ? 1 : 0
  if (f.wind != null) score += f.wind >= 25 ? 2 : f.wind >= 15 ? 1 : 0
  // 轻度污染就开始扣：普通人还能练，但不该给「适合」
  if (f.aqi != null) score += f.aqi >= 150 ? 3 : f.aqi >= 100 ? 2 : 0
  if (f.visKm != null && f.visKm < 2) score += 1
  if (f.feelsMean != null) {
    const t = f.feelsMean
    if (t >= 15 && t <= 24) score += 0
    else if ((t >= 10 && t < 15) || (t > 24 && t <= 28)) score += 1
    else if ((t >= 0 && t < 10) || (t > 28 && t <= 32)) score += 2
    else score += 3
  }
  return score
}

// 右下角只放一个数字：按「降水 → 空气 → 风 → 体感」的优先级挑一个最有解释力的
function outdoorReason(f) {
  if (f.pop != null && f.pop >= 60) return `降水 ${f.pop}%`
  if (f.aqi != null && f.aqi >= 100) return `AQI ${r0(f.aqi)}`
  if (f.wind != null && f.wind >= 15) return `风 ${r0(f.wind)}km/h`
  if (f.feelsMean != null) return `体感 ${r0(f.feelsMean)}°`
  return ''
}

function outdoor(f) {
  if (f.feelsMean == null && f.pop == null) return EMPTY('outdoor', '户外', 'ban')

  const detail = outdoorReason(f)
  const no = (reason) => ({
    key: 'outdoor',
    title: '户外运动',
    verdict: '不宜户外运动',
    detail: reason,
    icon: 'ban',
  })

  // 一票否决：这些天气下再好的分数也不该建议出门
  if (isIn(THUNDER_CODES, f.code)) return no('雷雨')
  if (isIn(HEAVY_CODES, f.code) || (f.pop != null && f.pop >= 85)) {
    return no(f.pop == null ? '雨量大' : `降水 ${f.pop}%`)
  }
  if (f.aqi != null && f.aqi >= 200) return no(`AQI ${r0(f.aqi)}`)
  if (f.wind != null && f.wind >= 39) return no(`风 ${r0(f.wind)}km/h`)
  if (f.feelsMean != null && (f.feelsMean >= 35 || f.feelsMean <= -8)) {
    return no(`体感 ${r0(f.feelsMean)}°`)
  }

  const score = outdoorScore(f)
  // 从「能跑」到「能走」到「别久待」到「别出门」，四个图标正好对上四档
  const verdict =
    score <= 1
      ? '适合户外运动'
      : score <= 2
        ? '可以户外运动'
        : score <= 4
          ? '不宜久待户外'
          : '不宜户外运动'
  const icon =
    score <= 1 ? 'run' : score <= 2 ? 'walk' : score <= 4 ? 'clock-off' : 'ban'
  return { key: 'outdoor', title: '户外运动', verdict, detail, icon }
}

/* ===== 4. 洗车 ===== */

function carWash(f) {
  if (f.pop == null && f.rainSum == null) return EMPTY('carwash', '洗车', 'car-off')

  const popText = f.pop == null ? '今日有雨' : `降水 ${f.pop}%`

  if (f.rainingNow || (f.rainSum != null && f.rainSum >= 1) || (f.pop != null && f.pop >= 50)) {
    return { key: 'carwash', title: '洗车', verdict: '不宜洗车', detail: popText, icon: 'car-off' }
  }
  // 今天洗了明天就下雨，等于白洗
  if (f.popNext != null && f.popNext >= 50) {
    return {
      key: 'carwash',
      title: '洗车',
      verdict: '暂缓洗车',
      detail: `明日 ${f.popNext}%`,
      icon: 'calendar-off',
    }
  }
  if (f.wind != null && f.wind >= 25) {
    return {
      key: 'carwash',
      title: '洗车',
      verdict: '不宜洗车',
      detail: `风 ${r0(f.wind)}km/h`,
      icon: 'car-off',
    }
  }
  if (f.uv != null && f.uv >= 8) {
    return {
      key: 'carwash',
      title: '洗车',
      verdict: '洗后易留水痕',
      detail: `UV ${f.uv.toFixed(1)}`,
      icon: 'droplet',
    }
  }
  return { key: 'carwash', title: '洗车', verdict: '适合洗车', detail: '今明无雨', icon: 'car' }
}

/* ===== 5. 带伞 ===== */

function umbrella(f) {
  if (f.pop == null) return EMPTY('umbrella', '带伞', 'help')

  const popText = `降水 ${f.pop}%`
  const base = { key: 'umbrella', title: '带伞' }

  // 伞的四种状态正好四个图标：撑开 / 收着 / 遮阳 / 不需要
  if (f.rainingNow || f.pop >= 70) return { ...base, verdict: '需要带伞', detail: popText, icon: 'umbrella' }
  if (f.pop >= 40) return { ...base, verdict: '建议带伞', detail: popText, icon: 'umbrella' }
  // 不下雨但晒：遮阳伞
  if (f.uv != null && f.uv >= 8) {
    return { ...base, verdict: '可带遮阳伞', detail: `UV ${f.uv.toFixed(1)}`, icon: 'sun-high' }
  }
  return { ...base, verdict: '不用带伞', detail: popText, icon: 'umbrella-off' }
}

/* ===== 6. 疾病风险 ===== */

// 每个诱因对应的说法：得分低说「少发 X」，中档说「易发 X」，高档说「谨防 X」
// 得分相近但主因不同（闷热 vs 温差）说的不是同一件事，所以按主因取词
const ILLNESS_TEXT = {
  swing: ['少发感冒', '易发感冒', '谨防感冒'],
  drop: ['少发感冒', '易发感冒', '谨防感冒'],
  cold: ['少发感冒', '易发感冒', '谨防感冒'],
  heat: ['少发中暑', '注意防暑', '谨防中暑'],
  aqi: ['空气略差', '呼吸道敏感', '减少外出'],
  damp: ['注意关节', '关节易不适', '关节要保暖'],
  dry: ['注意补水', '注意补水', '注意补水'],
}

// 主因不同，图标也跟着换：感冒看温度计、中暑看烈日、空气看肺、潮湿看关节、干燥看水滴
const ILLNESS_ICON = {
  swing: 'thermometer',
  drop: 'thermometer',
  cold: 'thermometer',
  heat: 'sun-high',
  aqi: 'lungs',
  damp: 'bone',
  dry: 'droplet',
}

function illness(f) {
  if (f.swing == null && f.feelsMean == null) return EMPTY('illness', '健康', 'help')

  let score = 0
  const drivers = []
  const add = (weight, key, label) => {
    if (!weight) return
    score += weight
    drivers.push({ weight, key, label })
  }

  if (f.swing != null) {
    if (f.swing >= 12) add(2, 'swing', `温差 ${r0(f.swing)}°`)
    else if (f.swing >= 9) add(1, 'swing', `温差 ${r0(f.swing)}°`)
  }
  if (f.high != null && f.highNext != null) {
    const drop = f.high - f.highNext
    if (drop >= 3) add(drop >= 5 ? 2 : 1, 'drop', `明天降 ${r0(drop)}°`)
  }
  if (f.feelsMean != null && f.feelsMean >= 33) add(2, 'heat', `体感 ${r0(f.feelsMean)}°`)
  if (f.aqi != null && f.aqi >= 150) add(2, 'aqi', `AQI ${r0(f.aqi)}`)
  else if (f.aqi != null && f.aqi >= 100) add(1, 'aqi', `AQI ${r0(f.aqi)}`)
  if (f.humidity != null && f.feelsMean != null && f.humidity >= 85 && f.feelsMean <= 20) {
    add(1, 'damp', `湿度 ${r0(f.humidity)}%`)
  }
  if (f.humidity != null && f.humidity <= 30) add(1, 'dry', `干燥 ${r0(f.humidity)}%`)
  if (f.feelsLow != null && f.feelsLow <= 3) add(1, 'cold', `清晨 ${r0(f.feelsLow)}°`)

  drivers.sort((a, b) => b.weight - a.weight)
  const top = drivers[0]
  if (!top) {
    return { key: 'illness', title: '疾病风险', verdict: '无明显风险', detail: '', icon: 'circle-check' }
  }

  const tier = score <= 1 ? 0 : score <= 3 ? 1 : 2
  return {
    key: 'illness',
    title: '疾病风险',
    verdict: ILLNESS_TEXT[top.key][tier],
    detail: top.label,
    icon: ILLNESS_ICON[top.key],
  }
}

/**
 * 六项建议，返回顺序即展示顺序（手机 / 平板 3 列 × 2 行，桌面一行六列：
 * 穿衣/防晒/户外/洗车/带伞/疾病）
 */
export function buildLifeIndices({ current, daily, air } = {}) {
  const f = readFacts(current, daily, air)
  return [clothing(f), sunscreen(f), outdoor(f), carWash(f), umbrella(f), illness(f)]
}
