/* 空气质量的分档与文案
   - us_aqi 用美国 EPA 的 0–500 刻度，断点 50/100/150/200/300
     正好对应国内「优 / 良 / 轻度 / 中度 / 重度 / 严重」六级，标签沿用中文习惯
   - 这套断点与 lifeIndex.js 里「户外 / 疾病」两项的判据是同一套（>=100 扣一档、>=150 扣两档、>=200 一票否决），
     所以卡片上写的等级和下面的生活指数结论永远不打架
   - 纯函数、无副作用，方便单测；null 一律当「没有数据」处理，绝不当 0
*/

/** 六级分档：上限（含）→ 等级名 + 一句人话 */
export const AQI_LEVELS = [
  { max: 50, name: '优', short: '优', hint: '空气清新，适合通风' },
  { max: 100, name: '良', short: '良', hint: '可以正常户外活动' },
  { max: 150, name: '轻度污染', short: '轻度', hint: '敏感人群减少长时间户外' },
  { max: 200, name: '中度污染', short: '中度', hint: '建议戴口罩，少开窗' },
  { max: 300, name: '重度污染', short: '重度', hint: '避免户外运动，关窗净化' },
  { max: Infinity, name: '严重污染', short: '严重', hint: '尽量留在室内' },
]

/** 是否是一个能参与计算的数字（null / undefined / NaN 都不算） */
function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v)
}

/**
 * 按 AQI 取分档；没有数据返回 null，让调用方去显示「暂无」
 * @param {unknown} aqi
 * @returns {{max:number,name:string,short:string,hint:string,index:number}|null}
 */
export function levelOf(aqi) {
  if (!isNum(aqi)) return null
  const v = Math.max(0, aqi)
  const index = AQI_LEVELS.findIndex((lv) => v <= lv.max)
  const i = index === -1 ? AQI_LEVELS.length - 1 : index
  return { ...AQI_LEVELS[i], index: i }
}

/**
 * 把 air 接口的三个字段整理成卡片要用的形状
 * 只要有 AQI 就算可用；PM 两项缺失时单独为 null，不连累主值
 * @param {{us_aqi?:number, pm2_5?:number, pm10?:number}|null|undefined} air
 */
export function readAir(air) {
  const aqi = isNum(air?.us_aqi) ? Math.round(air.us_aqi) : null
  return {
    aqi,
    level: levelOf(aqi),
    pm25: isNum(air?.pm2_5) ? Math.round(air.pm2_5 * 10) / 10 : null,
    pm10: isNum(air?.pm10) ? Math.round(air.pm10 * 10) / 10 : null,
  }
}

/**
 * 卡片左侧主值的文案：有数据给整数，没数据给破折号
 * 单独抽出来是因为模板里写三元表达式会让 vue 模板变长
 */
export function aqiText(aqi) {
  return isNum(aqi) ? String(Math.round(aqi)) : '—'
}

/**
 * PM 小字，例如「PM2.5 14」「PM10 —」
 * 两个都有时并排显示，缺哪个就只显示另一个
 */
export function pmText(pm25, pm10) {
  const parts = []
  if (pm25 != null) parts.push(`PM2.5 ${pm25}`)
  if (pm10 != null) parts.push(`PM10 ${pm10}`)
  return parts.join(' · ')
}
