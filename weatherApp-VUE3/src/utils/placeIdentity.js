/**
 * 收藏条目的「身份」判定：什么时候两个 place 被认为同一个地点。
 *
 * 收藏列表、定位去重、当前浏览城市的高亮都依赖同一套口径，
 * 所以从 useLocationPreferences 里抽出来供两边共用：
 * 写入（rememberLocatedCity）用它决定复用还是新增，
 * 读取（findActiveFavorite）用它决定点亮哪一条 —— 两边口径必须一致，
 * 否则去重把坐标合并了，高亮却按旧坐标找，绿点就会凭空消失。
 */

export const LOCATED_MATCH_RADIUS_DEG = 0.02 // 度，约 2km

export const placeKey = (place) => `${place.lat},${place.lon}`

/** 比较用文本：去掉所有空白并忽略大小写，「浙江省 · 杭州市」与「浙江省·杭州市」视为同一个。 */
export function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, '').toLowerCase()
}

/**
 * 严格展示身份：同名同详情。
 * 详情必须一起比 —— 国外同名城市很多（Springfield 之类），只比名字会把它们合成一条。
 * 名字为空（旧数据 / 未知城市）时不参与身份匹配，否则所有无名条目会互相合并。
 */
export function sameDisplayPlace(a, b) {
  if (!a || !b) return false
  const name = normalizeText(a.name)
  if (!name || name !== normalizeText(b.name)) return false
  return normalizeText(a.detail) === normalizeText(b.detail)
}

/**
 * 收藏条目的身份判定（写入与高亮共用）。
 *
 * 同一个城市每次定位的漂移程度不同，本地行政区查表会在区县 / 地级两档之间来回切换：
 * 落进 45km 的区县圈时是「杭州 / 浙江省 · 杭州市」，只落进 60km 的城市圈时是
 * 「杭州 / 浙江省」。展示上就是同一条地址，严格比对却判定为两个地点，于是冒出重复
 * —— 所以在严格口径之外再接受「名字相同且详情互为包含（或有一边为空）」。
 * 名字必须完全相同，因此国外同名的不同城市（Springfield）不会被合并；
 * 名字不同的一对（「杭州」与「西湖」）也永远不会被合并。
 */
export function sameLocatedPlace(a, b) {
  if (sameDisplayPlace(a, b)) return true
  if (!a || !b) return false
  const name = normalizeText(a.name)
  if (!name || name !== normalizeText(b.name)) return false
  const detailA = normalizeText(a.detail)
  const detailB = normalizeText(b.detail)
  if (!detailA || !detailB) return true
  return detailA.includes(detailB) || detailB.includes(detailA)
}
