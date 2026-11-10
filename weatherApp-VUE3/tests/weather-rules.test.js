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
