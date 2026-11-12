/**
 * 搜索候选合并的纯逻辑（不依赖 @/ 别名，便于 node:test 单测）。
 *
 * 与旧版不同：不再按 name+countryCode 把「本地北京」和「API 北京」合并 —— 用户要求
 * 同名城市全部并列、自己选。这里只在「坐标完全相同」时去重（本地表与 API 恰好指向
 * 同一地点），其余全部保留：本地候选在前（国内优先），全球候选在后。总数上限 12。
 */
const COORD_PRECISION = 3

function coordKey(item) {
  const lat = Number(item.lat)
  const lon = Number(item.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  return `${lat.toFixed(COORD_PRECISION)},${lon.toFixed(COORD_PRECISION)}|${item.countryCode || ''}`
}

export function mergeCandidates(local = [], global = [], limit = 12) {
  const seen = new Set()
  const out = []
  for (const item of local) {
    const key = coordKey(item)
    if (key && seen.has(key)) continue
    if (key) seen.add(key)
    out.push({ ...item, isGlobal: false })
  }
  for (const item of global) {
    const key = coordKey(item)
    if (key && seen.has(key)) continue
    if (key) seen.add(key)
    out.push({ ...item, isGlobal: true })
  }
  return out.slice(0, limit)
}
