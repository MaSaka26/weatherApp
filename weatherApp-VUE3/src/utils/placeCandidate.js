export function formatSearchDetail(geo) {
  const admin1 = geo?.admin1 || ''
  const country = geo?.country || ''
  if (!country || country === '中国' || country === 'China') return admin1
  return [admin1, country].filter(Boolean).join(' · ')
}

export function makePlaceCandidate({
  lat,
  lon,
  name,
  detail = '',
  source = 'coord',
  mode = 'manual',
}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !name) return null
  return {
    lat,
    lon,
    name,
    detail: detail || '',
    source,
    mode: mode === 'auto' ? 'auto' : 'manual',
  }
}

export function createSearchCandidate(geo) {
  if (!geo) return null
  return makePlaceCandidate({
    lat: geo.lat,
    lon: geo.lon,
    name: geo.name,
    detail: formatSearchDetail(geo),
    source: 'search',
    mode: 'manual',
  })
}

export function createManualCandidate(place, source) {
  if (!place) return null
  return makePlaceCandidate({
    lat: place.lat,
    lon: place.lon,
    name: place.name,
    detail: place.detail,
    source,
    mode: 'manual',
  })
}

export function createAutoCandidate(lat, lon, resolved) {
  return makePlaceCandidate({
    lat,
    lon,
    name: resolved?.name,
    detail: resolved?.detail,
    source: resolved?.source,
    mode: 'auto',
  })
}
