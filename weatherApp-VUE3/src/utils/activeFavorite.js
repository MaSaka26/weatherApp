/**
 * 找出「当前正在浏览」的那一个收藏城市，返回 cities 里的对象引用本身
 * （模板可直接用 === 比较），没有匹配返回 null。
 *
 * 精确坐标优先：手动搜索 / 点收藏切换时坐标完全一致，零容差可避免
 * 同城近邻（如「杭州」与「西湖区」）被一起点亮。
 * 否则取约 2km 内最近的一条：定位坐标每次会抖动，收藏里存的是
 * rememberLocatedCity 去重后的代表坐标，沿用它的距离口径。
 * 纯函数，便于 node --test 直接覆盖。
 */
export const ACTIVE_FAVORITE_RADIUS_DEG = 0.02

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
  let best = ACTIVE_FAVORITE_RADIUS_DEG
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
  return nearest
}
