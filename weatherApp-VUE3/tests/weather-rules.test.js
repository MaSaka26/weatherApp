import test from 'node:test'
import assert from 'node:assert/strict'

import { buildLifeIndices } from '../src/utils/lifeIndex.js'
import { buildRainOutlook } from '../src/utils/rainOutlook.js'
import { buildRadarFrames, radarSlot, radarUrl } from '../src/composables/useRadarFrames.js'
import { createWeatherLoader } from '../src/utils/weatherRequest.js'
import { createRadarPlayback } from '../src/composables/radarPlayback.js'
import { createTweenClock } from '../src/utils/tweenClock.js'
import { clearWeatherCache, readWeatherCache, WEATHER_CACHE_KEY, WEATHER_CACHE_TTL_MS, writeWeatherCache } from '../src/utils/weatherCache.js'
import { requestJson } from '../src/api/weather.js'
import { getSkyClass } from '../src/utils/weatherCodes.js'
import { inferLocationMode, shouldAutoLocate } from '../src/utils/locationIntent.js'
import { isWeatherStale } from '../src/utils/weatherFreshness.js'
import { getZonedParts } from '../src/utils/timezone.js'
import { ref } from 'vue'
import { createManualCandidate, createSearchCandidate } from '../src/utils/placeCandidate.js'
import { useLocationSession } from '../src/composables/weather/useLocationSession.js'
import { useAirQuality } from '../src/composables/weather/useAirQuality.js'
import { useWeatherRefresh } from '../src/composables/weather/useWeatherRefresh.js'
import { useLocationPreferences } from '../src/composables/weather/useLocationPreferences.js'
import { RADAR_PROVIDER, selectRadarProvider } from '../src/utils/radarProvider.js'
import { shouldRestartOnEpoch } from '../src/utils/gaugeRestart.js'
import { compareAppUpdate } from '../src/utils/appVersion.js'



test('life indices clearly mark missing weather values', () => {
  const results = buildLifeIndices({})
  assert.equal(results.length, 6)
  assert.match(results[0].verdict, /暂无/)
  assert.match(results[1].verdict, /暂无/)
})

test('sky background stays neutral until real weather data is ready', () => {
  assert.equal(getSkyClass(0, true, false), 'weather-unknown')
  assert.equal(getSkyClass(0, true), 'clear-day')
  assert.equal(getSkyClass(3, true), 'cloudy')
})

test('rain outlook reports missing data instead of claiming no rain', () => {
  const result = buildRainOutlook({ current: { time: '2026-11-09T12:00' }, hourly: { time: [] } })
  assert.equal(result.ok, false)
  assert.equal(result.text, '暂无降水数据')
})

test('rain outlook detects hourly precipitation and returns the fixed intensity window', () => {
  const time = Array.from({ length: 24 }, (_, hour) => `2026-11-09T${String(hour).padStart(2, '0')}:00`)
  const precipitation = Array(24).fill(0)
  precipitation[14] = 2
  const result = buildRainOutlook({
    current: { time: '2026-11-09T12:00' },
    hourly: { time, precipitation, precipitation_probability: Array(24).fill(0), weather_code: Array(24).fill(0) },
  })
  assert.equal(result.ok, true)
  assert.equal(result.active, true)
  assert.equal(result.wetFrom, 2)
  assert.equal(result.intensities.length, 12)
})

test('radar frames round down to six minute slots and force original quality for regions', () => {
  const slot = radarSlot(new Date('2026-11-09T07:35:00Z'))
  assert.equal(slot.toISOString(), '2026-11-09T07:30:00.000Z')
  assert.match(radarUrl('20261109073000000', 'small', 'AECN'), /\/RDCP\/SEVP_AOC_RDCP_SLDAS3_ECREF_AECN/)
  const frames = buildRadarFrames(slot, 2, 'medium')
  assert.equal(frames.length, 2)
  assert.equal(frames[1].stamp, '20261109073000000')
})

test('weather loader applies only the newest concurrent response', async () => {
  const pending = []
  const signals = []
  const applied = []
  const finished = []
  const loader = createWeatherLoader({
    request: (lat, lon, { signal }) => new Promise((resolve) => {
      signals.push(signal)
      pending.push({ lat, resolve })
    }),
    onApply: (value) => applied.push(value),
    onFinish: () => finished.push(true),
  })
  const oldRequest = loader.load(1, 1)
  const latestRequest = loader.load(2, 2)
  assert.equal(signals[0].aborted, true)
  pending[1].resolve('latest')
  assert.equal(await latestRequest, true)
  pending[0].resolve('stale')
  assert.equal(await oldRequest, false)
  assert.deepEqual(applied, ['latest'])
  assert.equal(finished.length, 1)
})

test('all active gauge tweens sample one shared frame at the same progress', () => {
  const frames = []
  const clock = createTweenClock({ requestFrame: (callback) => (frames.push(callback), frames.length) })
  const values = [0, 0]
  const startedAt = 100
  for (let index = 0; index < values.length; index += 1) {
    clock.add({
      startedAt,
      duration: 1000,
      from: 0,
      to: 100,
      update: (value) => { values[index] = value },
    })
  }

  assert.equal(frames.length, 1)
  frames.shift()(600)
  assert.equal(values[0], values[1])
  assert.equal(values[0], 87.5)
  assert.equal(clock.size, 2)
})

test('quiet weather request failures suppress the error callback and clear busy state', async () => {
  let failures = 0
  let finishes = 0
  const loader = createWeatherLoader({
    request: async () => { throw new Error('offline') },
    onFailure: () => { failures += 1 },
    onFinish: () => { finishes += 1 },
  })
  assert.equal(await loader.load(0, 0, { quiet: true }), false)
  assert.equal(failures, 0)
  assert.equal(finishes, 1)
})

test('API request timeout aborts the underlying fetch and reports a timeout error', async () => {
  const originalFetch = globalThis.fetch
  let wasAborted = false
  globalThis.fetch = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => {
      wasAborted = true
      reject(new DOMException('Aborted', 'AbortError'))
    }, { once: true })
  })
  try {
    await assert.rejects(
      requestJson('/slow', { timeoutMs: 5 }),
      (error) => error.code === 'REQUEST_TIMEOUT',
    )
    assert.equal(wasAborted, true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('weather cache round trips, rejects expired or malformed entries, and clears', () => {
  const original = globalThis.localStorage
  const values = new Map()
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
  try {
    const payload = { data: { current: { temperature_2m: 12 } }, place: { cityName: '杭州' } }
    writeWeatherCache(payload)
    assert.equal(readWeatherCache().place.cityName, '杭州')
    values.set(WEATHER_CACHE_KEY, JSON.stringify({ ...payload, savedAt: Date.now() - WEATHER_CACHE_TTL_MS - 1 }))
    assert.equal(readWeatherCache(), null)
    values.set(WEATHER_CACHE_KEY, '{bad json')
    assert.equal(readWeatherCache(), null)
    clearWeatherCache()
    assert.equal(values.has(WEATHER_CACHE_KEY), false)
  } finally {
    if (original === undefined) delete globalThis.localStorage
    else globalThis.localStorage = original
  }
})

test('radar play controls wrap frames, reschedule at selected speed, and pause on scrubbing', () => {
  const frames = { value: [{}, {}, {}] }
  const idx = { value: 2 }
  const playing = { value: false }
  const ready = { value: true }
  const frameMs = { value: 300 }
  let timerId = 0
  const timers = new Map()
  const shown = []
  const player = createRadarPlayback({
    frames, idx, playing, ready, frameMs,
    showFrame: (value) => { shown.push(value); idx.value = value },
    setTimer: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id },
    clearTimer: (id) => timers.delete(id),
  })
  player.play()
  assert.equal(playing.value, true)
  assert.equal([...timers.values()][0].delay, 300)
  const tick = [...timers.values()][0]
  timers.clear()
  tick.callback()
  assert.deepEqual(shown, [0])
  assert.equal(timers.size, 1)
  frameMs.value = 120
  player.arm()
  assert.equal([...timers.values()][0].delay, 120)
  player.slide('99')
  assert.equal(idx.value, 2)
  assert.equal(playing.value, false)
  assert.equal(timers.size, 0)
  player.step(1)
  assert.equal(idx.value, 0)
})

test('location intent stays manual after an explicit city choice', () => {
  assert.equal(inferLocationMode(null, 'search'), 'manual')
  assert.equal(inferLocationMode(null, 'common'), 'manual')
  assert.equal(inferLocationMode(null, 'county'), 'auto')
  assert.equal(inferLocationMode('manual', 'county'), 'manual')
  assert.equal(shouldAutoLocate('manual', 30.1, 120.2), false)
  assert.equal(shouldAutoLocate('manual', null, null), true)
  assert.equal(shouldAutoLocate('auto', 30.1, 120.2), true)
})

test('weather data is marked stale only after the freshness window', () => {
  const now = 10_000_000
  assert.equal(isWeatherStale(false, now - 60_000, now), false)
  assert.equal(isWeatherStale(true, now - 5 * 60_000, now), false)
  assert.equal(isWeatherStale(true, now - 16 * 60_000, now), true)
})

test('clock uses the selected city timezone instead of the device timezone', () => {
  const instant = new Date('2026-11-10T00:00:00Z')
  assert.deepEqual(getZonedParts(instant, 'Asia/Shanghai'), {
    year: 2026,
    month: 11,
    day: 10,
    hour: 8,
    minute: 0,
    second: 0,
  })
  assert.deepEqual(getZonedParts(instant, 'America/Los_Angeles'), {
    year: 2026,
    month: 11,
    day: 9,
    hour: 16,
    minute: 0,
    second: 0,
  })
})

test('place candidates keep coordinates, source, and intent together', () => {
  assert.deepEqual(createSearchCandidate({
    lat: 30.2,
    lon: 120.1,
    name: '杭州',
    admin1: '浙江省',
    country: '中国',
    countryCode: 'CN',
  }), {
    lat: 30.2,
    lon: 120.1,
    name: '杭州',
    detail: '浙江省',
    countryCode: 'CN',
    source: 'search',
    mode: 'manual',
  })
  assert.equal(createManualCandidate({ name: '杭州' }, 'common'), null)
})

test('location session discards stale searches and aborts the previous request', async () => {
  const pending = []
  const geocode = (city, { signal }) => new Promise((resolve) => {
    pending.push({ city, signal, resolve })
  })
  const session = useLocationSession({ geocode })

  const first = session.searchCity('A')
  const second = session.searchCity('B')
  assert.equal(pending[0].signal.aborted, true)

  pending[1].resolve({ lat: 2, lon: 2, name: 'B', admin1: 'B省', country: '中国' })
  const candidate = await second
  assert.equal(candidate.name, 'B')

  pending[0].resolve({ lat: 1, lon: 1, name: 'A', admin1: 'A省', country: '中国' })
  await assert.rejects(first, (error) => error.code === 'LOCATION_STALE')
})

test('air quality keeps only the newest request result', async () => {
  const pending = []
  const fetcher = (_lat, _lon, { signal }) => new Promise((resolve) => {
    pending.push({ signal, resolve })
  })
  const { air, load } = useAirQuality({ fetcher })

  const first = load(1, 1)
  const second = load(2, 2)
  assert.equal(pending[0].signal.aborted, true)

  pending[1].resolve({ us_aqi: 25 })
  await second
  assert.equal(air.value.us_aqi, 25)

  pending[0].resolve({ us_aqi: 80 })
  await first
  assert.equal(air.value.us_aqi, 25)
})

test('refresh controller marks failures stale and resets after success', async () => {
  let now = 20 * 60 * 1000
  let refreshCalls = 0
  const listeners = new Map()
  const documentRef = {
    hidden: false,
    addEventListener: (name, handler) => listeners.set(name, handler),
    removeEventListener: (name) => listeners.delete(name),
  }
  const lastSuccessAt = ref(1)
  const hasWeatherData = ref(true)
  const isFetching = ref(false)
  const controller = useWeatherRefresh({
    isFetching,
    lastSuccessAt,
    hasWeatherData,
    canRefresh: () => true,
    refresh: async () => {
      refreshCalls += 1
      return false
    },
    now: () => now,
    documentRef,
    setTimer: () => 1,
    clearTimer: () => {},
  })

  assert.equal(await controller.maybeAutoRefresh(), false)
  assert.equal(refreshCalls, 1)
  assert.equal(controller.autoRefreshFailed.value, true)
  assert.equal(controller.isStale.value, true)

  controller.markSuccess(now)
  assert.equal(controller.autoRefreshFailed.value, false)
  assert.equal(controller.isStale.value, false)

  controller.start()
  assert.equal(listeners.has('visibilitychange'), true)
  controller.stop()
  assert.equal(listeners.has('visibilitychange'), false)
  now += 1
})

test('location preferences persist manual mode and common cities', () => {
  const original = globalThis.localStorage
  const values = new Map()
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
  try {
    const preferences = useLocationPreferences({
      cachedPlace: { locationSource: 'county' },
    })
    assert.equal(preferences.locationMode.value, 'auto')
    preferences.setLocationMode('manual')
    assert.equal(values.get('weather:location-mode:v1'), 'manual')

    const city = { name: '杭州', detail: '浙江省', countryCode: 'CN', lat: 30.2, lon: 120.1 }
    preferences.rememberCommonCity(city)
    preferences.rememberCommonCity(city)
    assert.equal(preferences.commonCities.value.length, 1)
    assert.equal(preferences.commonCities.value[0].countryCode, 'CN')

    preferences.removeCommonCity(city)
    assert.equal(preferences.commonCities.value.length, 0)
  } finally {
    if (original === undefined) delete globalThis.localStorage
    else globalThis.localStorage = original
  }
})

test('removeCommonCities removes a batch at once and persists the rest', () => {
  const original = globalThis.localStorage
  const values = new Map()
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
  try {
    const preferences = useLocationPreferences()
    const cities = [
      { name: '杭州', detail: '浙江省', countryCode: 'CN', lat: 30.2, lon: 120.1 },
      { name: '北京', detail: '北京市', countryCode: 'CN', lat: 39.9, lon: 116.4 },
      { name: '伦敦', detail: '英国', countryCode: 'GB', lat: 51.5, lon: -0.12 },
      { name: '东京', detail: '日本', countryCode: 'JP', lat: 35.7, lon: 139.7 },
    ]
    cities.forEach((city) => preferences.rememberCommonCity(city))
    assert.equal(preferences.commonCities.value.length, 4)

    preferences.removeCommonCities([cities[0], cities[2]])
    assert.deepEqual(
      preferences.commonCities.value.map((c) => c.name),
      ['东京', '北京'],
    )
    assert.deepEqual(
      JSON.parse(values.get('weather:common-cities:v1')).map((c) => c.name),
      ['东京', '北京'],
    )

    // 空集合 / 非数组是空操作，不应误删或抛错
    preferences.removeCommonCities([])
    preferences.removeCommonCities(null)
    assert.equal(preferences.commonCities.value.length, 2)
  } finally {
    if (original === undefined) delete globalThis.localStorage
    else globalThis.localStorage = original
  }
})

test('radar provider follows location country and local source', () => {
  assert.equal(selectRadarProvider({ countryCode: 'CN' }), RADAR_PROVIDER.NMC)
  assert.equal(selectRadarProvider({ countryCode: 'GB' }), RADAR_PROVIDER.RAINVIEWER)
  assert.equal(selectRadarProvider({ countryCode: '', locationSource: 'county' }), RADAR_PROVIDER.NMC)
  assert.equal(selectRadarProvider({ countryCode: '', locationSource: 'search' }), RADAR_PROVIDER.RAINVIEWER)
})

test('gauge rings restart only after the first real data epoch', () => {
  const base = { restartOnEpoch: true, epochChanged: true }
  // 首屏：缓存值先长一次，网络新鲜数据到达触发第一次 epoch，不应重播
  assert.equal(shouldRestartOnEpoch({ ...base, hadPriorEpoch: false, value: 0.6 }), false)
  // 切城市：已有过数据 epoch，再变化才让所有环同步重新生长
  assert.equal(shouldRestartOnEpoch({ ...base, hadPriorEpoch: true, value: 0.6 }), true)
  // 数值缺失不重播；纯数字（restartOnEpoch=false）永不重播
  assert.equal(shouldRestartOnEpoch({ ...base, hadPriorEpoch: true, value: null }), false)
  assert.equal(shouldRestartOnEpoch({ restartOnEpoch: false, epochChanged: true, hadPriorEpoch: true, value: 0.6 }), false)
  // epoch 没变（6 分钟刷新但同一帧）也不重播
  assert.equal(shouldRestartOnEpoch({ restartOnEpoch: true, epochChanged: false, hadPriorEpoch: true, value: 0.6 }), false)
})

test('app update compares build identity and falls back to tag', () => {
  const local = { version: 'v0.1.2', buildId: 'commit-aaa' }
  assert.equal(compareAppUpdate(local, { appBuildId: 'commit-aaa', sourceTag: 'v0.1.2' }).hasUpdate, false)
  assert.equal(compareAppUpdate(local, { appBuildId: 'commit-bbb', sourceTag: 'v0.1.3' }).hasUpdate, true)
  assert.equal(compareAppUpdate(local, { appBuildId: 'commit-bbb', sourceTag: 'v0.1.3' }).remoteLabel, 'v0.1.3')
  // 旧产物没有 appBuildId：用 tag 比较
  assert.equal(compareAppUpdate(local, { sourceTag: 'v0.1.2' }).hasUpdate, false)
  assert.equal(compareAppUpdate(local, { sourceTag: 'v0.1.3' }).hasUpdate, true)
  // 本地无身份 / 远端缺失不打扰用户
  assert.equal(compareAppUpdate({ version: 'dev', buildId: '' }, { appBuildId: 'x' }).hasUpdate, false)
  assert.equal(compareAppUpdate(local, null).hasUpdate, false)
})
