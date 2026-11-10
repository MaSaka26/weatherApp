export const LOCATION_MODES = ['auto', 'manual']

export function inferLocationMode(savedMode, locationSource = '') {
  if (LOCATION_MODES.includes(savedMode)) return savedMode
  // 旧缓存没有 locationMode：搜索和常用城市代表用户明确选择。
  return locationSource === 'search' || locationSource === 'common' ? 'manual' : 'auto'
}

export function shouldAutoLocate(mode, lat, lon) {
  return !(mode === 'manual' && Number.isFinite(lat) && Number.isFinite(lon))
}
