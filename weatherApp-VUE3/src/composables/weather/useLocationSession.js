import {
  createAutoCandidate,
  createManualCandidate,
  createSearchCandidate,
} from '../../utils/placeCandidate.js'

function getBrowserGeolocation() {
  return typeof navigator === 'undefined' ? null : navigator.geolocation
}

export function useLocationSession({
  geolocation = getBrowserGeolocation(),
  geocode,
  resolve,
} = {}) {
  let token = 0
  let controller = null

  function invalidate() {
    token += 1
    controller?.abort()
    controller = null
    return token
  }

  async function searchCity(city) {
    const id = invalidate()
    controller = new AbortController()
    const localController = controller

    try {
      const geo = await geocode(city, { signal: localController.signal })
      if (id !== token) throw Object.assign(new Error('LOCATION_STALE'), { code: 'LOCATION_STALE' })
      const candidate = createSearchCandidate(geo)
      if (!candidate) throw Object.assign(new Error('LOCATION_INVALID'), { code: 'LOCATION_INVALID' })
      return candidate
    } catch (error) {
      if (id !== token) {
        throw Object.assign(new Error('LOCATION_STALE'), { code: 'LOCATION_STALE' })
      }
      throw error
    } finally {
      if (id === token) controller = null
    }
  }

  async function locate() {
    const id = invalidate()
    if (!geolocation?.getCurrentPosition) {
      throw Object.assign(new Error('GEOLOCATION_UNAVAILABLE'), { code: 2 })
    }

    const position = await new Promise((resolvePosition, reject) => {
      geolocation.getCurrentPosition(resolvePosition, reject, {
        enableHighAccuracy: false,
        timeout: 8000,
        maximumAge: 60000,
      })
    })
    if (id !== token) throw Object.assign(new Error('LOCATION_STALE'), { code: 'LOCATION_STALE' })

    const latitude = position.coords.latitude
    const longitude = position.coords.longitude
    const place = await resolve(latitude, longitude)
    if (id !== token) throw Object.assign(new Error('LOCATION_STALE'), { code: 'LOCATION_STALE' })
    const candidate = createAutoCandidate(latitude, longitude, place)
    if (!candidate) throw Object.assign(new Error('LOCATION_INVALID'), { code: 'LOCATION_INVALID' })
    return candidate
  }

  function fromManualPlace(place, source) {
    invalidate()
    return createManualCandidate(place, source)
  }

  return { searchCity, locate, fromManualPlace, cancel: invalidate }
}
