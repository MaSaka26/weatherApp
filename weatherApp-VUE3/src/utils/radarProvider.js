export const RADAR_PROVIDER = {
  NMC: 'nmc',
  RAINVIEWER: 'rainviewer',
}

export const CHINA_LOCAL_SOURCES = new Set(['county', 'city', 'near'])

export function selectRadarProvider({
  countryCode = '',
  locationSource = '',
} = {}) {
  if (countryCode === 'CN' || CHINA_LOCAL_SOURCES.has(locationSource)) {
    return RADAR_PROVIDER.NMC
  }
  return RADAR_PROVIDER.RAINVIEWER
}

export function radarProviderLabel(provider) {
  return provider === RADAR_PROVIDER.NMC ? '中央气象台' : 'RainViewer'
}
