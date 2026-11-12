/**
 * 搜索候选合并：本地中文表（中国行政区）+ 全球地理编码（Open-Meteo）。
 *
 * 本地表 searchPlaces 只有中国城市；全球建议来自 suggestCities，按坐标去重后
 * 同名但不同国家/地区的城市会全部并列出现（伦敦 GB / CA / US，北京 CN 多地…），
 * 由用户自己选。每条候选都带「名称 + 国家/地区 + 国内/国外」标签，便于区分。
 *
 * 选中后统一 emit('select', item) -> store.loadPlace 直接按 lat/lon 落地，无需二次地理编码。
 */
import { searchPlaces } from './placeSearch'
import { mergeCandidates } from './candidateMerge.js'
import { suggestCities } from '../api/weather.js'

const CHINA_LABEL = '中国'

export function buildLocalCandidates(query, limit = 8) {
  return searchPlaces(query, limit)
}

export async function buildGlobalCandidates(query, { signal, limit = 8 } = {}) {
  const raw = await suggestCities(query, { signal, limit })
  return raw.map((r) => {
    const cc = r.countryCode || ''
    const isCN = cc === 'CN'
    const region = r.admin1 || ''
    const country = r.country || cc
    // 境外：行政区 · 国家；国内：省 · 中国（与本地表 detail 风格一致）
    const detail = isCN
      ? [region, CHINA_LABEL].filter(Boolean).join(' · ')
      : [region, country].filter(Boolean).join(' · ')
    // 右侧标签：国内用「国内」，国外用两字国家码，一眼区分同名城市
    const levelLabel = isCN ? '国内' : (cc || country)
    return {
      leaf: r.name,
      parent: detail,
      path: detail ? `${detail}-${r.name}` : r.name,
      levelLabel,
      level: isCN ? 'cn' : 'global',
      name: r.name,
      altName: r.altName || '',
      detail,
      lat: r.lat,
      lon: r.lon,
      countryCode: cc,
      source: 'search',
    }
  })
}

export { mergeCandidates }
