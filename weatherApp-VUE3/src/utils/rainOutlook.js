/**
 * 降水展望：把逐小时预报压成一句「未来多少小时内有雨」。
 *
 * 为什么单独抽一个纯函数：这个结论要同时服务文案、副文案和一根 12 格的强度条，
 * 三处必须是同一个判定，否则会出现「主句说无雨、强度条却在闪」的矛盾。
 * 所以这里一次性算完所有派生值，模板只负责渲染，不再做二次判断。
 *
 * 设计取舍：
 * 1. 三路证据取「或」——概率、降水量、天气码各有所长：概率覆盖未来时段，
 *    降水量代表已经在下，天气码识别雷暴这类概率不高但确定危险的情况。
 *    缺一路不影响其余两路（null 不当 0 参与比较）。
 * 2. 阈值全部集中在文件顶部的常量里，改口径只改常量，不动逻辑。
 * 3. 时间字符串是城市当地时间的固定长度 ISO，直接按字符串切片比较即可，
 *    不构造 Date —— 一旦构造 Date 就会卷进浏览器时区和夏令时，反而算错。
 */

// 毛毛雨 / 雨 / 雷暴 / 冰雹。雪不在内：雪的体感与措辞完全不同，另行处理
const WET_CODES = [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]
// 强降水码：大雨、冻雨、大阵雨、雷暴、雷暴冰雹
const HEAVY_CODES = [65, 67, 82, 95, 96, 99]
// 中等降水码：中雨、冻雨、中阵雨
const MID_CODES = [63, 66, 81]

const MAX_SCAN_HOURS = 24 // 主文案承诺的窗口：超过一天的预报不值得写进一句话
const WINDOW_HOURS = 12 // 强度条格子数，与组件里 SVG 的列数对齐
const PROB_WET = 40 // 概率达到四成才值得提醒，更低的就是「可能」而不是「有雨」
const PRECIP_WET = 0.05 // mm；小于这个量级的数值多是模式噪声，落不到地面
const PRECIP_HEAVY = 4
const PRECIP_MID = 1.5

// null / undefined / NaN / 字符串一律视作「没有数据」，绝不当成 0 参与阈值比较
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const has = (list, v) => v != null && list.includes(v)

/** 取 'YYYY-MM-DDTHH' 前缀，用于判断时刻先后；非字符串视为不可用 */
const hourKey = (s) => (typeof s === 'string' && s.length >= 13 ? s.slice(0, 13) : '')

/** 'YYYY-MM-DDTHH:MM' → 'HH:MM'；只有整点信息时补 ':00' */
function hhmm(s) {
  if (typeof s !== 'string' || s.length < 13) return ''
  const h = s.slice(11, 13)
  const m = s.length >= 16 ? s.slice(14, 16) : '00'
  return `${h}:${m}`
}

/** 浏览器当前小时的 'YYYY-MM-DDTHH'，仅作 current.time 缺失时的兜底 */
function browserHourKey() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}`
}

/**
 * 三组数组取最短长度：
 * 任何一路比 time 短，多出来的小时就只能算「没有数据」，
 * 若继续按 time 的长度扫，会把越界读到的 undefined 当成「不下雨」。
 * 空数组按「未提供」处理 —— 否则一个 [] 会把整条曲线归零。
 */
function usableLength(time, hourly) {
  const series = [hourly?.precipitation_probability, hourly?.weather_code, hourly?.precipitation]
  let len = time.length
  for (const s of series) {
    if (Array.isArray(s) && s.length > 0) len = Math.min(len, s.length)
  }
  return len
}

/** 第一个 >= 目标时刻的整点下标；找不到（数据整体偏旧）返回 -1 */
function findStartIndex(time, targetKey) {
  if (!targetKey) return -1
  for (let i = 0; i < time.length; i++) {
    const key = hourKey(time[i])
    if (key && key >= targetKey) return i
  }
  return -1
}

/** 数据不足时的统一形状 —— 调用方按字段取值，所以字段一个都不能少 */
function emptyOutlook(text) {
  return {
    ok: false,
    active: false,
    hours: 0,
    withinHours: null,
    endsInHours: null,
    text,
    sub: '',
    intensities: Array.from({ length: WINDOW_HOURS }, () => 0),
    wetFrom: null,
    peakLevel: 0,
  }
}

/**
 * @param {{ current?: {time?: string}, hourly?: object }} [input]
 * @returns {{ok:boolean, active:boolean, hours:number, withinHours:number|null,
 *   endsInHours:number|null, text:string, sub:string, intensities:number[],
 *   wetFrom:number|null, peakLevel:number}}
 */
export function buildRainOutlook({ current, hourly } = {}) {
  const time = Array.isArray(hourly?.time) ? hourly.time : []
  if (!time.length) return emptyOutlook('暂无降水数据')

  const prob = Array.isArray(hourly?.precipitation_probability)
    ? hourly.precipitation_probability
    : []
  const codes = Array.isArray(hourly?.weather_code) ? hourly.weather_code : []
  const precip = Array.isArray(hourly?.precipitation) ? hourly.precipitation : []

  const limit = usableLength(time, hourly)
  if (limit <= 0) return emptyOutlook('暂无降水数据')

  // current.time 可能带 15 分钟刻度（'…T14:15'），切片后与整点对齐
  const targetKey = hourKey(current?.time) || browserHourKey()
  let startIdx = findStartIndex(time, targetKey)
  // 数据最早的一小时也晚于当前时刻（缓存过期）→ 没有可扫的窗口，
  // 与其把 hours 算成 0 再对外宣称「24 小时无雨」，不如如实说没数据
  if (startIdx < 0 || startIdx >= limit) return emptyOutlook('暂无降水数据')

  const hours = Math.max(0, Math.min(MAX_SCAN_HOURS, limit - startIdx))

  // 三路证据取或；null 不参与比较，缺一路由其余两路兜住
  const isWet = (i) => {
    const p = num(prob[i])
    const mm = num(precip[i])
    const code = num(codes[i])
    return (p != null && p >= PROB_WET) || (mm != null && mm > PRECIP_WET) || has(WET_CODES, code)
  }

  const levelAt = (i) => {
    if (!isWet(i)) return 0
    const code = num(codes[i])
    const mm = num(precip[i])
    if (has(HEAVY_CODES, code) || (mm != null && mm >= PRECIP_HEAVY)) return 3
    if (has(MID_CODES, code) || (mm != null && mm >= PRECIP_MID)) return 2
    return 1
  }

  // 12 格强度条：从当前整点往后铺，不足的格子补 0（组件按定宽画柱）
  const intensities = []
  for (let k = 0; k < WINDOW_HOURS; k++) {
    const i = startIdx + k
    intensities.push(i < limit ? levelAt(i) : 0)
  }
  const peakLevel = intensities.reduce((m, v) => Math.max(m, v), 0)

  // 向前扫：withinHours 是偏移量而不是数组下标，调用方拿它直接写「N 小时后」
  let withinHours = null
  for (let k = 0; k < hours; k++) {
    if (isWet(startIdx + k)) {
      withinHours = k
      break
    }
  }
  const active = withinHours != null

  // 「判定为 wet」不等于「真的在下」：概率 40% 但降水量为 0，说的是马上要下
  const startCode = num(codes[startIdx])
  const startMm = num(precip[startIdx])
  const rainingNow =
    withinHours === 0 && (has(WET_CODES, startCode) || (startMm != null && startMm > PRECIP_WET))

  // 只有「现在就在下」才谈何时停；未来才下的雨，停不停不是这一句要回答的
  let endsInHours = null
  if (withinHours === 0) {
    for (let k = 1; k < hours; k++) {
      if (!isWet(startIdx + k)) {
        endsInHours = k
        break
      }
    }
  }

  let text
  if (!active) text = '未来 24 小时无雨'
  else if (rainingNow) text = '正在下雨'
  else if (withinHours === 0) text = '马上有雨'
  else if (withinHours === 1) text = '未来 1 小时内有雨'
  else text = `未来 ${withinHours} 小时内有雨`

  // 副文案只回答「什么时候」和「多强」，一行放得下，不复述主句
  let sub = ''
  if (rainingNow) {
    sub = endsInHours != null ? `约 ${endsInHours} 小时后转停` : '降雨持续'
  } else if (active && withinHours > 0) {
    const startLabel = hhmm(time[startIdx + withinHours])
    const strength = peakLevel >= 3 ? '，最强较强' : peakLevel === 2 ? '，最强中等' : ''
    sub = startLabel ? `${startLabel} 前后开始${strength}` : strength.replace('，', '')
  } else if (active) {
    // withinHours === 0 但不是「正在下」：只有降水概率过了阈值，云还没到位。
    // 此时给出开始时刻会等于当前整点（14:15 显示「14:00 前后开始」），
    // 读起来像在说过去。这种情况只保留强度，不写时刻。
    sub = peakLevel >= 3 ? '最强较强' : peakLevel === 2 ? '最强中等' : ''
  }

  return {
    ok: true,
    active,
    hours,
    withinHours,
    endsInHours,
    text,
    sub,
    intensities,
    wetFrom: withinHours,
    peakLevel,
  }
}
