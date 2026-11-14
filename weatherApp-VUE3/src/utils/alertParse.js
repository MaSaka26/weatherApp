/**
 * 天气预警的解析与本地判定（纯函数，无网络、无 Vue 依赖）
 *
 * 数据来自中央气象台 /rest/findAlarm，接口只能按「省」筛，市/县没有参数，
 * 所以拿回一省列表后要靠标题里的区域名在前端判断哪几条属于当前城市：
 *   标题形如「陕西省渭南市韩城市气象台发布寒潮蓝色预警信号」
 *   区域 = 陕西省渭南市韩城市 / 类型 = 寒潮 / 级别 = 蓝色
 */
import PLACES from '../data/china-places.json' with { type: 'json' }
import { shortName } from './placeLookup.js'

/** 34 个省级行政区全名（取自本地行政区表的省列，带「省/市/自治区」后缀） */
export const PROVINCE_NAMES = (() => {
  const set = new Set()
  for (const row of PLACES.c) if (row[1]) set.add(row[1])
  return set
})()

/** 预警级别从低到高，用来挑「最高那条」决定卡片配色 */
export const LEVELS = ['蓝色', '黄色', '橙色', '红色']
export const LEVEL_RANK = { 蓝色: 1, 黄色: 2, 橙色: 3, 红色: 4 }

/**
 * 标题拆解。末尾的「信号」二字时有时无（省级精简写法常省略），所以是可选的。
 * 实测 893 条里 886 条命中，剩下 7 条是「××气象台发布霜冻黄色预警」这种。
 */
const TITLE_RE = /^(.*?)气象台发布(.+?)(红色|橙色|黄色|蓝色)预警信号?$/

export function parseAlert(raw) {
  if (!raw || !raw.title) return null
  const m = TITLE_RE.exec(raw.title)
  if (!m) return null
  const [, region, type, level] = m
  return {
    id: raw.alertid || `${region}-${type}-${level}-${raw.issuetime || ''}`,
    title: raw.title,
    region: region.trim(),
    type: type.trim(),
    level,
    rank: LEVEL_RANK[level] || 0,
    issued: raw.issuetime || '',
    // 图标由接口直接给（125×94 的 RGBA PNG），不用自己拼文件名
    pic: raw.pic || '',
    // 详情页没有 CORS 头，fetch 读不了，只能新窗口打开
    link: raw.url ? `https://www.nmc.cn${raw.url}` : '',
  }
}

/**
 * 从城市副标题（形如「湖北省 · 荆州市」）里取出省级全名。
 * 境外城市（「California · United States」）取不到，返回空串 —— 那就没有预警可取。
 */
export function provinceOf(cityDetail) {
  const head = String(cityDetail || '').split('·')[0].trim()
  return PROVINCE_NAMES.has(head) ? head : ''
}

/**
 * 本地判定：标题里的区域串包含当前城市名即为本地。
 * 松滋的标题是「湖北省荆州市松滋市气象台发布…」，包含「松滋」即命中。
 *
 * 只比城市名不比区县名 —— 用户定位到的是「松滋」这一级，本市其它区县的预警
 * 也会带上「荆州市」前缀，属于「同一地级市内」，一并算本地。
 */
export function pickLocalAlerts(list, cityName) {
  const city = shortName(String(cityName || ''))
  if (!city || city.length < 2) return []
  return list.filter((a) => a.region.includes(city))
}

/**
 * 把接口原始列表整理成界面要的形状：解析 → 只留本地 → 按级别从高到低。
 * @returns {{ list: Array, top: number, total: number }}
 */
export function buildAlerts(rawList, cityName) {
  const parsed = (rawList || []).map(parseAlert).filter(Boolean)
  const local = pickLocalAlerts(parsed, cityName)
  local.sort((a, b) => b.rank - a.rank || String(b.issued).localeCompare(String(a.issued)))
  return {
    list: local,
    top: local.length ? local[0].rank : 0,
    total: local.length,
  }
}
