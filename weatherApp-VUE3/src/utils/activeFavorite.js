/**
 * 找出「当前正在浏览」的那一个收藏城市，返回 cities 里的对象引用本身
 * （模板可直接用 === 比较），没有匹配返回 null。
 *
 * 三级口径，与收藏写入（rememberLocatedCity）保持同一套身份定义：
 * 1. 精确坐标：手动搜索 / 点收藏切换时坐标完全一致，零容差可避免
 *    同城近邻（如「杭州」与「西湖」）被一起点亮；
 * 2. 约 2km 内最近的一条：定位坐标每次会抖动，收藏里存的是首次进入时的
 *    代表坐标，沿用去重时的距离口径；
 * 3. 展示身份：WiFi / IP 定位可能甩出十几公里，去重按地址把两条并成了一条，
 *    但当前浏览用的仍是这次的新坐标 —— 此时必须靠同名同详情把绿点找回来，
 *    否则去重之后绿点会凭空消失。
 * 纯函数，便于 node --test 直接覆盖。
 */
import { LOCATED_MATCH_RADIUS_DEG, sameLocatedPlace } from './placeIdentity.js'

// 高亮与去重共用同一个半径口径：去重时按 2km 合并，高亮也必须按 2km 找回。
export const ACTIVE_FAVORITE_RADIUS_DEG = LOCATED_MATCH_RADIUS_DEG

export function findActiveFavorite(cities, active) {
  if (!Array.isArray(cities) || cities.length === 0) return null
  if (!active || !Number.isFinite(active.lat) || !Number.isFinite(active.lon)) return null

  const exact = cities.find(
    (city) => Number.isFinite(city.lat) && Number.isFinite(city.lon)
      && city.lat === active.lat && city.lon === active.lon,
  )
  if (exact) return exact

  const cosLat = Math.cos((active.lat * Math.PI) / 180)
  let nearest = null
  let best = LOCATED_MATCH_RADIUS_DEG
  for (const city of cities) {
    if (!Number.isFinite(city.lat) || !Number.isFinite(city.lon)) continue
    const dLat = city.lat - active.lat
    const dLon = (city.lon - active.lon) * cosLat
    const dist = Math.hypot(dLat, dLon)
    if (dist < best) {
      best = dist
      nearest = city
    }
  }
  if (nearest) return nearest

  return cities.find((city) => sameLocatedPlace(city, active)) || null
}
