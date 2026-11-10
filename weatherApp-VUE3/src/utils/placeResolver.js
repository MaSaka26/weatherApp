import { formatCoords, reverseGeocode } from '../api/weather.js'
import { lookupPlace } from './placeLookup.js'

/** 本地行政区表优先，境外 / 远海才联网反查；失败时退回坐标文本。 */
export async function resolvePlace(latitude, longitude) {
  const local = lookupPlace(latitude, longitude)
  if (local) {
    return { name: local.name, detail: local.detail, source: local.level }
  }

  try {
    const place = await reverseGeocode(latitude, longitude, 3000)
    if (place.name) {
      return {
        name: place.name,
        detail: [place.province, place.country].filter(Boolean).join(' · '),
        source: 'reverse',
      }
    }
  } catch {
    // 网络不可用，继续降级到坐标。
  }

  return { name: formatCoords(latitude, longitude), detail: '', source: 'coord' }
}
