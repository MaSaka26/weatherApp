/**
 * 本地行政区查表：坐标 -> 地名（省 / 地级市 / 区县）
 *
 * 数据来源：阿里 DataV.GeoAtlas 行政区划边界（含各级中心点坐标），
 * 构建期固化为 src/data/china-places.json，运行时零网络请求。
 *
 * 结构：{ c: [ [name, province, lat, lon], ... ],            // 地级（含直辖市、省直辖县级）
 *        d: [ [name, cityIndex, lat, lon], ... ] }          // 区县，cityIndex 指向 c
 */
import PLACES from '@/data/china-places.json'

const CITIES = PLACES.c
const COUNTIES = PLACES.d

// 各级判定半径（km）
const COUNTY_KM = 45 // 区县：覆盖城区与近郊
const CITY_KM = 60 // 地级市：区县缺失（中山、仙桃等）或数据缺口的退路
const NEAR_KM = 200 // 再远就只敢说“附近”

const DISTRICT_RE = /区$/ // 市辖区：单独显示区名有歧义（同名区很多），改用所属城市名
const SUFFIX_RE = /(特别行政区|自治州|自治县|自治旗|林区|新区|地区|省|市|县|区|盟|旗)$/
// 自治州/县里的民族名，用于「恩施土家族苗族自治州 -> 恩施」这种截断
const ETHNIC_RE =
  /(蒙古|回|藏|维吾尔|苗|彝|壮|布依|朝鲜|满|侗|瑶|白|土家|哈尼|哈萨克|傣|黎|傈僳|佤|畲|高山|拉祜|水|东乡|纳西|景颇|柯尔克孜|达斡尔|仫佬|羌|布朗|撒拉|毛南|仡佬|锡伯|阿昌|普米|塔吉克|怒|乌孜别克|俄罗斯|鄂温克|德昂|保安|裕固|塔塔尔|独龙|鄂伦春|赫哲|门巴|珞巴|基诺)/

const R = 6371

function haversine(lat1, lon1, lat2, lon2) {
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** 去掉行政后缀，用于展示：松滋市 -> 松滋、神农架林区 -> 神农架
 *  自治州/县先截掉民族名：恩施土家族苗族自治州 -> 恩施（只剥后缀会剩「恩施土家族苗族」）
 *  「内蒙古自治区」这种民族名和地名粘连的，截断结果太短则退回只剥后缀 */
export function shortName(name) {
  if (name.includes('自治')) {
    const m = ETHNIC_RE.exec(name)
    if (m && m.index >= 2) return name.slice(0, m.index)
  }
  return name.replace(SUFFIX_RE, '') || name
}

/** 在 [name, ..., lat, lon] 行集合里找最近的一条（纬度差先粗筛） */
function nearest(rows, lat, lon) {
  let best = null
  let bestDist = Infinity
  for (const row of rows) {
    if (Math.abs(row[2] - lat) > 4) continue // 约 440km，不可能胜出
    const dist = haversine(lat, lon, row[2], row[3])
    if (dist < bestDist) {
      bestDist = dist
      best = row
    }
  }
  return best ? { row: best, distanceKm: bestDist } : null
}

/**
 * 反查地名。命中不到任何行政区（境外 / 远海）时返回 null，由调用方继续降级。
 * @returns {{ name: string, detail: string, level: 'county'|'city'|'near', distanceKm: number } | null}
 */
export function lookupPlace(lat, lon) {
  const county = nearest(COUNTIES, lat, lon)
  const city = nearest(CITIES, lat, lon)

  // 中山、仙桃这类不设区的地级市只有城市中心点：若城市中心比任何区县都近，
  // 说明最近区县属于隔壁地市，不能拿来当地名。
  const cityWins = city && (!county || city.distanceKm < county.distanceKm)

  if (!cityWins && county && county.distanceKm <= COUNTY_KM) {
    const [countyName, cityIndex] = county.row
    const [cityName, province] = CITIES[cityIndex]
    // 直辖市 / 省直辖：再提一次区县名更有辨识度
    const detail =
      cityName === province ? `${province} · ${countyName}` : `${province} · ${cityName}`
    return {
      name: DISTRICT_RE.test(countyName) ? shortName(cityName) : shortName(countyName),
      detail,
      level: 'county',
      distanceKm: county.distanceKm,
    }
  }

  if (city && city.distanceKm <= CITY_KM) {
    return {
      name: shortName(city.row[0]),
      detail: city.row[1],
      level: 'city',
      distanceKm: city.distanceKm,
    }
  }
  if (city && city.distanceKm <= NEAR_KM) {
    return {
      name: `附近：${shortName(city.row[0])}`,
      detail: city.row[1],
      level: 'near',
      distanceKm: city.distanceKm,
    }
  }
  return null
}

export const PLACE_DATA_SIZE = CITIES.length + COUNTIES.length
