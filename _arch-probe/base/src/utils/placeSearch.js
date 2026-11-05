/**
 * 本地候选词搜索：关键字 -> 省 / 地级市 / 区县候选
 *
 * 数据复用 placeLookup 的 china-places.json（省只是挂在市上的字符串，
 * 这里按出现顺序合成省条目，坐标取省内首个地级条目，即省会/中心城区）。
 * 零网络请求，输入即查；排序规则：
 *   1. 匹配度：整名相等 > 名字前缀 > 全路径前缀 > 名字包含 > 全路径包含
 *   2. 同匹配度内：省 > 市 > 区县
 *   3. 再按名字长度，短的靠前（「字数少、匹配度高」优先）
 */
import PLACES from '@/data/china-places.json'
import { shortName } from './placeLookup'

const CITIES = PLACES.c
const COUNTIES = PLACES.d

const LEVEL_LABEL = { province: '省', city: '市', county: '区县' }
const LEVEL_RANK = { province: 0, city: 1, county: 2 }

// 省条目：出现顺序即数据源给的省会/中心城区顺序
const PROVINCES = (() => {
  const map = new Map()
  for (const [, province, lat, lon] of CITIES) {
    if (!map.has(province)) map.set(province, { name: province, lat, lon })
  }
  return [...map.entries()].map(([province, v]) => ({ province, ...v }))
})()

/** 查询词归一：去空格和常见分隔符，「湖北-武汉」「湖北 武汉」等价 */
function normalize(q) {
  return q.replace(/[\s\-·,，.。]/g, '')
}

/** 全路径折叠：湖北省-武汉市-武昌区 -> 湖北武汉武昌，支持「湖北武汉」这种跨级输入 */
function collapse(sections) {
  return sections.map((s) => shortName(s)).join('')
}

function buildItem(level, sections, lat, lon) {
  const leaf = sections[sections.length - 1]
  const parent = sections.slice(0, -1)
  return {
    level,
    levelLabel: LEVEL_LABEL[level],
    name: shortName(leaf),
    leaf,
    parent: parent.join('-'),
    path: sections.join('-'),
    // 头部副标题，与 placeLookup 反查结果同格式
    detail:
      level === 'province'
        ? ''
        : level === 'city'
          ? parent[0] && parent[0] !== leaf
            ? parent[0]
            : ''
          : parent.length >= 2
            ? parent.join(' · ')
            : (parent[0] || ''),
    lat,
    lon,
    _match: { name: shortName(leaf), full: leaf, collapsed: collapse(sections) },
  }
}

/**
 * 候选词查询。
 * @param {string} query 用户输入（1 个字即可命中）
 * @param {number} limit 最多返回条数
 * @returns {Array<{level, levelLabel, name, leaf, parent, path, detail, lat, lon}>}
 */
export function searchPlaces(query, limit = 8) {
  const q = normalize(query || '')
  if (!q) return []

  const out = []

  for (const p of PROVINCES) {
    const item = buildItem('province', [p.name], p.lat, p.lon)
    const tier = matchTier(item._match, q)
    if (tier >= 0) out.push({ item, tier })
  }

  for (const [cityName, province, lat, lon] of CITIES) {
    // 直辖市 / 台湾省这类「市名 == 省名」的只显示一段
    const sections = cityName === province ? [cityName] : [province, cityName]
    const item = buildItem('city', sections, lat, lon)
    const tier = matchTier(item._match, q)
    if (tier >= 0) out.push({ item, tier })
  }

  for (const [countyName, cityIndex, lat, lon] of COUNTIES) {
    const [cityName, province] = CITIES[cityIndex]
    const sections =
      cityName === province ? [province, countyName] : [province, cityName, countyName]
    const item = buildItem('county', sections, lat, lon)
    const tier = matchTier(item._match, q)
    if (tier >= 0) out.push({ item, tier })
  }

  out.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier
    const la = LEVEL_RANK[a.item.level]
    const lb = LEVEL_RANK[b.item.level]
    if (la !== lb) return la - lb
    if (a.item.name.length !== b.item.name.length) return a.item.name.length - b.item.name.length
    return a.item.path.length - b.item.path.length
  })

  return out.slice(0, limit).map(({ item }) => {
    delete item._match
    return item
  })
}

/** 匹配档位，-1 = 不命中 */
function matchTier(match, q) {
  if (match.name === q || match.full === q || match.collapsed === q) return 0
  if (match.full.startsWith(q) || match.name.startsWith(q)) return 1
  if (match.collapsed.startsWith(q)) return 2
  if (match.full.includes(q) || match.name.includes(q)) return 3
  if (match.collapsed.includes(q)) return 4
  return -1
}
