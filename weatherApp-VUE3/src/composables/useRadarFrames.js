const SLOT_MS = 6 * 60 * 1000
const API_HOST = 'https://image.nmc.cn'
const QUALITIES = [
  { id: 'orig', dir: '' },
  { id: 'medium', dir: 'medium' },
  { id: 'small', dir: 'small' },
]

const pad2 = (n) => String(n).padStart(2, '0')

export function radarStamp(date) {
  return `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}00000`
}

export function radarUrl(stamp, qualityId, code = 'ACHN') {
  const quality = QUALITIES.find((item) => item.id === qualityId) || QUALITIES[1]
  const dir = code !== 'ACHN' || !quality.dir ? '' : `${quality.dir}/`
  return `${API_HOST}/product/${stamp.slice(0, 4)}/${stamp.slice(4, 6)}/${stamp.slice(6, 8)}/RDCP/${dir}SEVP_AOC_RDCP_SLDAS3_ECREF_${code}_L88_PI_${stamp}.PNG`
}

export function radarSlot(date) {
  return new Date(Math.floor(date.getTime() / SLOT_MS) * SLOT_MS)
}

export function buildRadarFrames(latest, count, qualityId, code = 'ACHN') {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(latest.getTime() - (count - index - 1) * SLOT_MS)
    const stamp = radarStamp(date)
    return { date, stamp, url: radarUrl(stamp, qualityId, code) }
  })
}
