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
import { useWeatherAlerts } from '../src/composables/weather/useWeatherAlerts.js'
import { useWeatherRefresh } from '../src/composables/weather/useWeatherRefresh.js'
import { useLocationPreferences } from '../src/composables/weather/useLocationPreferences.js'
import { sameLocatedPlace } from '../src/utils/placeIdentity.js'
import { RADAR_PROVIDER, selectRadarProvider } from '../src/utils/radarProvider.js'
import { shouldRestartOnEpoch } from '../src/utils/gaugeRestart.js'
import { compareAppUpdate } from '../src/utils/appVersion.js'
import { API_MIN_INTERVAL_MS, buildDeployProbeSources, parseDeployManifest, readDeployManifest } from '../src/utils/updateProbe.js'
import {
  ALERT_BORDER_Y,
  ALERT_ITEM_CONTENT_H,
  ALERT_LOADER_BASE,
  ALERT_PAD_Y,
  ALERT_SLOT_H,
  alertLoaderBox,
  alertLoaderScale,
  alertLoaderSpace,
  isLoaderFittingSlot,
} from '../src/utils/alertSlot.js'
import { buildFavoriteGroups } from '../src/utils/favoriteGroups.js'
import { findActiveFavorite } from '../src/utils/activeFavorite.js'
import { levelOf, readAir } from '../src/utils/aqi.js'



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

test('air quality reports a failure state instead of staying silent', async () => {
  const timeoutError = Object.assign(new Error('请求超时，请检查网络后重试'), { code: 'REQUEST_TIMEOUT' })
  const { air, airStatus, airError, load, fail } = useAirQuality({
    fetcher: () => Promise.reject(timeoutError),
  })

  await load(1, 1)
  assert.equal(airStatus.value, 'error')
  assert.equal(airError.value, '请求超时')

  // 恢复成功后状态要跟着回正，否则失败态会永远挂在卡片上
  const ok = useAirQuality({ fetcher: () => Promise.resolve({ us_aqi: 42 }) })
  await ok.load(1, 1)
  assert.equal(ok.airStatus.value, 'ok')
  assert.equal(ok.airError.value, '')

  // 缺少坐标时根本不发请求，但仍然要落一个失败态
  let called = false
  const missing = useAirQuality({ fetcher: () => { called = true; return Promise.resolve(null) } })
  await missing.load(null, null)
  assert.equal(called, false)
  assert.equal(missing.airStatus.value, 'error')
  assert.equal(missing.airError.value, '缺少城市坐标')

  // 空响应体（current 缺失）是「无数据」，不是失败
  const empty = useAirQuality({ fetcher: () => Promise.resolve(null) })
  await empty.load(1, 1)
  assert.equal(empty.airStatus.value, 'ok')

  void air
  void fail
})

test('alerts can be forced out of idle so the skeleton cannot spin forever', async () => {
  const XIAN = '陕西省 · 西安市'
  const { alertStatus, alertError, fail } = useWeatherAlerts({
    fetcher: () => Promise.reject(new Error('预警请求失败')),
  })

  // 冷启动时主天气就失败，二级链路没人推状态 —— fail 必须能兜住 idle
  assert.equal(alertStatus.value, 'idle')
  fail('缺少城市坐标')
  assert.equal(alertStatus.value, 'error')
  assert.equal(alertError.value, '缺少城市坐标')

  // 正在请求时不能被迟到/重复的兜底覆写
  const busy = useWeatherAlerts({ fetcher: () => new Promise(() => {}) })
  busy.refresh(XIAN, '西安')
  assert.equal(busy.alertRefreshing.value, true)
  busy.fail('迟到的兜底')
  assert.equal(busy.alertStatus.value, 'idle')

  // 已经有结果时也不能被覆写
  const settled = useWeatherAlerts({ fetcher: () => Promise.resolve([]) })
  await settled.refresh(XIAN, '西安')
  settled.fail('迟到的兜底')
  assert.equal(settled.alertStatus.value, 'ok')

  // 真正失败时要有 error 文案，UI 才好显示「失败 + 重试」
  const failed = useWeatherAlerts({ fetcher: () => Promise.reject(new Error('坏请求')) })
  await failed.refresh(XIAN, '西安')
  assert.equal(failed.alertStatus.value, 'error')
  assert.equal(failed.alertError.value, '坏请求')

  // 重试时保持 error，不会闪回骨架
  failed.retry(XIAN, '西安')
  assert.equal(failed.alertStatus.value, 'error')

  // 境外城市（没有省份）不发请求，直接是 ok + 0 条
  let called = false
  const foreign = useWeatherAlerts({ fetcher: () => { called = true; return Promise.resolve([]) } })
  await foreign.refresh('California · United States', 'San Francisco')
  assert.equal(called, false)
  assert.equal(foreign.alertStatus.value, 'ok')
  assert.equal(foreign.alerts.value.total, 0)
})

test('alert loading skeleton is exactly as tall as a real alert item', async () => {
  // 骨架高度 = 边框*2 + 内边距*2 + 动画盒子。动画是 48px 的死尺寸，
  // 一旦它超过净空间就会把骨架撑到比真实条目更高 —— 数据到达时整块版面往上跳。
  assert.ok(
    isLoaderFittingSlot(),
    `loader box ${alertLoaderBox()}px must fit inside ${alertLoaderSpace()}px, otherwise the skeleton outgrows a real item`
  )

  const skeletonH = ALERT_BORDER_Y * 2 + ALERT_PAD_Y * 2 + alertLoaderBox()
  assert.equal(skeletonH, ALERT_SLOT_H)

  // 真实条目高度 = max(槽高, 自然内容高)，必须和骨架一模一样
  const itemH = Math.max(ALERT_SLOT_H, ALERT_ITEM_CONTENT_H)
  assert.equal(skeletonH, itemH)

  // 槽高必须真的能盖住内容，否则 min-height 说了不算，条目会被内容顶高
  assert.ok(
    ALERT_SLOT_H >= ALERT_ITEM_CONTENT_H,
    `slot ${ALERT_SLOT_H}px must be >= natural item content ${ALERT_ITEM_CONTENT_H}px`
  )

  // 缩放只缩不放：动画永远不能比设计尺寸更大
  assert.ok(alertLoaderScale() > 0 && alertLoaderScale() <= 1)
  assert.ok(alertLoaderBox(70) <= ALERT_LOADER_BASE)
  assert.equal(alertLoaderScale(70), 1)
  assert.equal(alertLoaderBox(70), ALERT_LOADER_BASE)
  // 越小的槽只会缩得越狠，绝不反向放大
  assert.ok(alertLoaderScale(48) < alertLoaderScale(64))
  assert.ok(alertLoaderBox(48) < alertLoaderBox(64))

  // CSS 里的 --alert-slot-h 必须与这里一致，改一处忘了另一处会在这里红
  const { readFileSync } = await import('node:fs')
  const vue = readFileSync(new URL('../src/components/WeatherAlert.vue', import.meta.url), 'utf8')
  const cssSlot = Number((vue.match(/--alert-slot-h:\s*(\d+)px/) || [])[1])
  const cssPad = Number((vue.match(/\.alert-loading[\s\S]*?padding:\s*(\d+)px/) || [])[1])
  assert.equal(cssSlot, ALERT_SLOT_H, 'WeatherAlert.vue --alert-slot-h drifted from utils/alertSlot.js')
  assert.equal(cssPad, ALERT_PAD_Y, 'WeatherAlert.vue .alert-loading padding drifted from utils/alertSlot.js')
})

test('desktop alert card puts the picture on its own line above the text', async () => {
  // 桌面端预警卡从「左图右文」改成「图上文下」（见 WeatherAlert.vue 的 1024 块）。
  // 这条测试盯住三处容易回退的地方：竖排声明、图片独占一行、槽高被抬到能装下两行文字。
  const { readFileSync } = await import('node:fs')
  const vue = readFileSync(new URL('../src/components/WeatherAlert.vue', import.meta.url), 'utf8')
  const desktop = (vue.match(/@media \(min-width: 1024px\)[\s\S]*?\n\}/) || [''])[0]
  assert.ok(desktop, 'WeatherAlert.vue 少了桌面端 1024 媒体查询块')
  assert.match(desktop, /\.alert-item\s*\{[^}]*flex-direction:\s*column/, '桌面端预警卡必须是竖排')
  assert.match(desktop, /\.alert-media\s*\{[^}]*width:\s*100%/, '图片容器必须独占一行')
  const desktopSlot = Number((desktop.match(/--alert-slot-h:\s*(\d+)px/) || [])[1])
  assert.ok(desktopSlot >= ALERT_ITEM_CONTENT_H, `桌面端槽高 ${desktopSlot}px 装不下内容`)
  // 桌面槽高也必须是文件里的第一处之外的那一处，别误改了移动端基准
  const firstSlot = Number((vue.match(/--alert-slot-h:\s*(\d+)px/) || [])[1])
  assert.equal(firstSlot, ALERT_SLOT_H, '移动端 --alert-slot-h 不能动')
  // 模板里必须有 .alert-media 包裹层，否则桌面端没有可撑满整行的元素
  assert.match(vue, /<span class="alert-media">/, '模板缺少 .alert-media 包裹层')
})

test('spinning squares loader keeps the framer-motion geometry and the button size', async () => {
  // 刷新按钮里的动画：React 版 SpinningSquares 是 40×40 容器里 16px 方块跑 24px 行程，
  // 即 方块占 40%、行程占 60%（translate 百分比相对方块自身，故 40% × 150% = 60%）。
  // 这里把「比例」锁死：以后有人调百分比、调时长、把两块改成同向，都会在这里红。
  const { readFileSync } = await import('node:fs')
  const read = (rel) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8')
  const loader = read('src/components/animations/SpinningSquaresLoader.vue')

  // 1) 方块边长 40%，容器铺满父级
  assert.match(loader, /\.spinning-squares\s*\{[^}]*width:\s*100%/, 'loader must fill its parent')
  const cellRule = (loader.match(/\.spinning-squares-cell\s*\{([\s\S]*?)\}/) || [])[1] || ''
  const cellSize = Number((cellRule.match(/width:\s*(\d+)%/) || [])[1])
  assert.equal(cellSize, 40, 'cell must be 40% of the container like the 16/40 original')

  // 2) 2s 一圈、无限循环、easeInOut（CSS 的 cubic-bezier 与 framer-motion 的 easeInOut 同曲线）
  assert.match(cellRule, /animation-duration:\s*2s/, 'duration must stay 2s')
  assert.match(cellRule, /animation-iteration-count:\s*infinite/)
  assert.match(cellRule, /animation-timing-function:\s*cubic-bezier\(0\.42,\s*0,\s*0\.58,\s*1\)/, 'easing drifted from easeInOut')

  // 3) 关键帧：行程 150%（相对方块自身 = 容器 60%），四段回到原点
  const framesOf = (name) => {
    const body = (loader.match(new RegExp('@keyframes ' + name + '\\s*\\{([\\s\\S]*?\\n\\})')) || [])[1] || ''
    return [...body.matchAll(/(\d+)%\s*\{\s*transform:\s*translate\(([^)]*)\)/g)].map((m) => [Number(m[1]), m[2].replace(/\s+/g, '')])
  }
  const lead = framesOf('squares-lead')
  const trail = framesOf('squares-trail')
  assert.deepEqual(lead.map(([pct]) => pct), [0, 25, 50, 75, 100], 'lead keyframes must close the loop')
  assert.equal(lead[1][1], '150%,0', 'lead travels 150% of its own width (= 60% of container)')
  assert.equal(lead[2][1], '150%,150%')
  const travelPct = 150
  assert.equal((travelPct * cellSize) / 100, 60, '16px cell + 24px travel on a 40px box = 60%')

  // 4) 两块必须始终点对称：轨迹取负、起点在对角
  const negate = (v) => v.replace(/(-?\d+)%/g, (_, n) => (n === '0' ? '0' : String(-Number(n))) + '%')
  assert.deepEqual(trail.map(([pct, v]) => [pct, v]), lead.map(([pct, v]) => [pct, negate(v)]), 'trail must be the exact negation of lead')
  const leadPos = (loader.match(/--lead\s*\{([\s\S]*?)\}/) || [])[1] || ''
  const trailPos = (loader.match(/--trail\s*\{([\s\S]*?)\}/) || [])[1] || ''
  assert.match(leadPos, /top:\s*0/)
  assert.match(leadPos, /left:\s*0/)
  assert.match(trailPos, /right:\s*0/)
  assert.match(trailPos, /bottom:\s*0/)

  // 5) 减少动态效果时停住，不做无意义的循环
  assert.match(loader, /prefers-reduced-motion:[\s\S]*?\.spinning-squares-cell\s*\{\s*animation:\s*none/, 'reduced motion must stop the loop')

  // 6) 按钮只换图标，尺寸不许被改写
  const button = read('src/components/RefreshButton.vue')
  assert.match(button, /import SpinningSquaresLoader from '@\/components\/animations\/SpinningSquaresLoader\.vue'/)
  assert.match(button, /<SpinningSquaresLoader v-if="refreshing"\s*\/>/, 'loader shows only while refreshing')
  assert.match(button, /<template v-else>⟳<\/template>/, 'idle state keeps the plain glyph')
  assert.doesNotMatch(button, /\.refresh-btn\s*\{[^}]*\b(width|height):/, 'button size must not be redefined here')
  assert.doesNotMatch(button, /refresh-icon[^{]*\{[^}]*animation:/, 'the glyph must no longer spin via CSS')
  // 图标盒是固定尺寸，动画与 ⟳ 共用，切换时不会引起布局跳动
  const iconBox = (button.match(/\.refresh-icon\s*\{([\s\S]*?)\}/) || [])[1] || ''
  assert.match(iconBox, /width:\s*32px/)
  assert.match(iconBox, /height:\s*32px/)

  // 7) 旧的旋转关键帧必须已经清掉，不能和动画叠着转
  const responsive = read('src/assets/responsive.css')
  assert.doesNotMatch(responsive, /@keyframes iconSpin/, 'legacy iconSpin keyframes must be gone')
  assert.doesNotMatch(responsive, /\.refresh-icon\.spinning/, 'legacy spinning class must be gone')
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

test('rememberLocatedCity adds geolocated cities and de-dups jittered GPS coordinates', () => {
  const original = globalThis.localStorage
  const values = new Map()
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
  try {
    const preferences = useLocationPreferences()

    // 首次定位写入收藏（countryCode 由 store 推断后透传）
    preferences.rememberLocatedCity({
      name: '杭州', detail: '浙江省', countryCode: 'CN', lat: 30.2741, lon: 120.1551,
    })
    assert.equal(preferences.commonCities.value.length, 1)
    assert.equal(preferences.commonCities.value[0].countryCode, 'CN')

    // GPS 抖动：2km 半径内（含跨 toFixed 网格边界）的坐标变化不新增条目，且复用已有精确坐标作为身份
    preferences.rememberLocatedCity({
      name: '杭州', detail: '浙江省', countryCode: 'CN', lat: 30.2749, lon: 120.1542,
    })
    assert.equal(preferences.commonCities.value.length, 1)
    assert.equal(preferences.commonCities.value[0].lat, 30.2741)
    assert.equal(preferences.commonCities.value[0].lon, 120.1551)
    assert.deepEqual(
      JSON.parse(values.get('weather:common-cities:v1'))[0],
      { name: '杭州', detail: '浙江省', countryCode: 'CN', lat: 30.2741, lon: 120.1551 },
    )

    // 搜索添加的精确坐标也参与网格匹配：定位到同一地点时不重复，且被置顶
    const searched = { name: '北京', detail: '北京市', countryCode: 'CN', lat: 39.9042, lon: 116.4074 }
    preferences.rememberCommonCity(searched)
    assert.equal(preferences.commonCities.value.length, 2)
    preferences.rememberLocatedCity({
      name: '北京', detail: '北京市', countryCode: 'CN', lat: 39.9038, lon: 116.4081,
    })
    assert.equal(preferences.commonCities.value.length, 2)
    assert.equal(preferences.commonCities.value[0].name, '北京')
    assert.equal(preferences.commonCities.value[0].lat, 39.9042)

    // 真正不同的地点是独立条目
    preferences.rememberLocatedCity({
      name: '伦敦', detail: '英国', countryCode: 'GB', lat: 51.5074, lon: -0.1278,
    })
    assert.equal(preferences.commonCities.value.length, 3)

    // 非法坐标是空操作
    preferences.rememberLocatedCity({ name: 'X', lat: NaN, lon: 1 })
    preferences.rememberLocatedCity(null)
    assert.equal(preferences.commonCities.value.length, 3)

    // 不超过 MAX_COMMON_CITIES(12)
    for (let i = 0; i < 20; i += 1) {
      preferences.rememberLocatedCity({
        name: 'C' + i, detail: '', countryCode: 'CN', lat: 10 + i, lon: 10 + i,
      })
    }
    assert.equal(preferences.commonCities.value.length, 12)
  } finally {
    if (original === undefined) delete globalThis.localStorage
    else globalThis.localStorage = original
  }
})

function withFakeStorage(run) {
  const original = globalThis.localStorage
  const values = new Map()
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
  try {
    return run(values)
  } finally {
    if (original === undefined) delete globalThis.localStorage
    else globalThis.localStorage = original
  }
}

test('the same address counts as one favorite however it was spelled', () => {
  // 严格口径：名字与详情都相同（空白差异不算不同）
  const hangzhou = { name: '杭州', detail: '浙江省 · 杭州市' }
  assert.equal(sameLocatedPlace(hangzhou, { name: ' 杭州 ', detail: '浙江省·杭州市' }), true)
  // 行政区查表在区县 / 地级两档之间切换时详情会变短，仍是同一条地址
  assert.equal(sameLocatedPlace(hangzhou, { name: '杭州', detail: '浙江省' }), true)
  assert.equal(sameLocatedPlace({ name: '杭州', detail: '浙江省' }, hangzhou), true)
  // 详情缺失（反地理编码降级 / 坐标文本）也复用同名条目
  assert.equal(sameLocatedPlace(hangzhou, { name: '杭州', detail: '' }), true)
  // 名字不同就是两个地方：搜「西湖」不该并进「杭州」
  assert.equal(sameLocatedPlace(hangzhou, { name: '西湖', detail: '浙江省 · 杭州市' }), false)
  // 同名不同详情是两个地方：国外同名城市很多，只比名字会把它们合成一条
  assert.equal(sameLocatedPlace(hangzhou, { name: '杭州', detail: '浙江省 · 宁波市' }), false)
  assert.equal(sameLocatedPlace({ name: '春田', detail: '美国 · 伊利诺伊州' }, { name: '春田', detail: '美国 · 马萨诸塞州' }), false)
  // 没有名字的旧数据 / 未知城市不参与身份匹配，否则会互相合并成一条
  assert.equal(sameLocatedPlace({ name: '', detail: '' }, { name: '', detail: '' }), false)
  assert.equal(sameLocatedPlace(null, hangzhou), false)
})

test('a located city is reused when the geocoder reports a coarser address', () =>
  withFakeStorage(() => {
    const preferences = useLocationPreferences()
    // 第一次进入：定位落进区县圈
    preferences.rememberLocatedCity({ name: '杭州', detail: '浙江省 · 杭州市', countryCode: 'CN', lat: 30.2741, lon: 120.1551 })
    // 第二次进入：同一城市，但只落进城市圈，详情少了一段
    preferences.rememberLocatedCity({ name: '杭州', detail: '浙江省', countryCode: 'CN', lat: 30.2810, lon: 120.1620 })
    assert.equal(preferences.commonCities.value.length, 1)
    assert.equal(preferences.commonCities.value[0].detail, '浙江省')
    assert.equal(preferences.commonCities.value[0].lat, 30.2741)
  }))

test('a located city whose name changes with the lookup radius stays one favorite', () =>
  withFakeStorage(() => {
    const preferences = useLocationPreferences()
    // 第一次落进城市圈：名字规整
    preferences.rememberLocatedCity({ name: '杭州', detail: '浙江省', countryCode: 'CN', lat: 30.2741, lon: 120.1551 })
    // 第二次只落进 200km 的「附近」档：名字多了前缀，但离上一次不到 1km
    preferences.rememberLocatedCity({ name: '附近：杭州', detail: '浙江省', countryCode: 'CN', lat: 30.2790, lon: 120.1560 })
    assert.equal(preferences.commonCities.value.length, 1)
    // 复用第一次的坐标与名字，只把展示字段刷新到最新
    assert.equal(preferences.commonCities.value[0].lat, 30.2741)
    assert.equal(preferences.commonCities.value[0].name, '附近：杭州')
  }))

test('a located city stays one favorite even when Wi-Fi positioning drifts far', () =>
  withFakeStorage(() => {
    const preferences = useLocationPreferences()
    // 首次进入：定位写入收藏
    preferences.rememberLocatedCity({ name: '杭州', detail: '浙江省 · 杭州市', countryCode: 'CN', lat: 30.2741, lon: 120.1551 })
    assert.equal(preferences.commonCities.value.length, 1)

    // 第二次进入：地址一样，但 WiFi / IP 定位把坐标甩出十几公里（远超 2km 抖动半径）
    preferences.rememberLocatedCity({ name: '杭州', detail: '浙江省 · 杭州市', countryCode: 'CN', lat: 30.3441, lon: 120.2551 })
    assert.equal(preferences.commonCities.value.length, 1)
    // 复用第一次的坐标作身份，只刷新展示字段
    assert.equal(preferences.commonCities.value[0].lat, 30.2741)
    assert.equal(preferences.commonCities.value[0].lon, 120.1551)

    // 再来一次更远的漂移（约 40km）仍然只有一条，并且被置顶
    preferences.rememberLocatedCity({ name: '北京', detail: '北京市', countryCode: 'CN', lat: 39.9042, lon: 116.4074 })
    preferences.rememberLocatedCity({ name: '杭州', detail: '浙江省 · 杭州市', countryCode: 'CN', lat: 30.6, lon: 120.6 })
    assert.equal(preferences.commonCities.value.length, 2)
    assert.deepEqual(
      preferences.commonCities.value.map((city) => city.name),
      ['杭州', '北京'],
    )
  }))

test('searching a neighbouring place does not swallow an existing favorite', () => withFakeStorage(() => {
  const preferences = useLocationPreferences()
  preferences.rememberLocatedCity({ name: '杭州', detail: '浙江省 · 杭州市', countryCode: 'CN', lat: 30.2741, lon: 120.1551 })
  // 西湖离杭州不到 1km：搜索路径不开 2km 匹配，两个地点各自保留一条
  preferences.rememberCommonCity({ name: '西湖', detail: '浙江省 · 杭州市', countryCode: 'CN', lat: 30.2790, lon: 120.1550 })
  assert.equal(preferences.commonCities.value.length, 2)
  assert.deepEqual(
    preferences.commonCities.value.map((city) => city.name),
    ['西湖', '杭州'],
  )

  // 但搜索同一个地点（名字与详情一致）时仍然复用已有条目，不会多出一条
  preferences.rememberCommonCity({ name: '杭州', detail: '浙江省 · 杭州市', countryCode: 'CN', lat: 30.3000, lon: 120.2000 })
  assert.equal(preferences.commonCities.value.length, 2)
  assert.equal(preferences.commonCities.value[0].lat, 30.2741)
}) )

test('legacy duplicate favorites collapse the next time the city is remembered', () => withFakeStorage((values) => {
  // 旧版本已经写坏的数据：同一个地址两条，坐标不同
  values.set('weather:common-cities:v1', JSON.stringify([
    { name: '杭州', detail: '浙江省 · 杭州市', countryCode: 'CN', lat: 30.2741, lon: 120.1551 },
    { name: '杭州', detail: '浙江省 · 杭州市', countryCode: 'CN', lat: 30.3441, lon: 120.2551 },
    { name: '伦敦', detail: '英国', countryCode: 'GB', lat: 51.5074, lon: -0.1278 },
  ]))
  const preferences = useLocationPreferences()
  assert.equal(preferences.commonCities.value.length, 3)

  preferences.rememberLocatedCity({ name: '杭州', detail: '浙江省 · 杭州市', countryCode: 'CN', lat: 30.3500, lon: 120.2600 })
  assert.deepEqual(
    preferences.commonCities.value.map((city) => city.name),
    ['杭州', '伦敦'],
  )
  assert.equal(JSON.parse(values.get('weather:common-cities:v1')).length, 2)
}) )

test('favorite groups only include categories that have cities', () => {
  const hangzhou = { name: '杭州', lat: 30.27, lon: 120.15 }
  const london = { name: '伦敦', lat: 51.5, lon: -0.12 }

  // 两类都为空 -> 一个分组都不渲染（下拉表为空）
  assert.deepEqual(buildFavoriteGroups([], []), [])
  assert.deepEqual(buildFavoriteGroups(), [])

  // 只有国内 -> 只显示「国内」，不显示空的「国外」表头
  const domesticOnly = buildFavoriteGroups([hangzhou], [])
  assert.deepEqual(domesticOnly.map((g) => g.key), ['domestic'])
  assert.equal(domesticOnly[0].cities.length, 1)

  // 只有国外 -> 只显示「国外」
  const foreignOnly = buildFavoriteGroups([], [london])
  assert.deepEqual(foreignOnly.map((g) => g.key), ['foreign'])

  // 两类都有 -> 顺序为国内、国外
  const both = buildFavoriteGroups([hangzhou], [london])
  assert.deepEqual(both.map((g) => g.label), ['国内', '国外'])
})

test('active favorite marks exactly the city currently being viewed', () => {
  const hangzhou = { name: '杭州', lat: 30.2741, lon: 120.1551 }
  const london = { name: '伦敦', lat: 51.5, lon: -0.12 }
  const cities = [hangzhou, london]

  // 浏览坐标与收藏条目完全一致 -> 精确命中该条
  assert.equal(findActiveFavorite(cities, { lat: 30.2741, lon: 120.1551 }), hangzhou)
  assert.equal(findActiveFavorite(cities, { lat: 51.5, lon: -0.12 }), london)
  // 定位 GPS 抖动：约 90m 内仍命中同一条代表坐标（与 2km 去重口径一致）
  assert.equal(findActiveFavorite(cities, { lat: 30.2749, lon: 120.1542 }), hangzhou)

  // 同城近邻：精确坐标各自命中自己，不会两条一起亮
  const westLake = { name: '西湖区', lat: 30.275, lon: 120.14 }
  const nearCities = [hangzhou, westLake]
  assert.equal(findActiveFavorite(nearCities, { lat: 30.2741, lon: 120.1551 }), hangzhou)
  assert.equal(findActiveFavorite(nearCities, { lat: 30.275, lon: 120.14 }), westLake)

  // 定位漂移十几公里：收藏里存的是首次进入时的代表坐标，靠展示身份把绿点找回
  // （去重把它们并成了一条，如果高亮只会按坐标找，绿点就会凭空消失）
  const drifted = [
    { name: '杭州', detail: '浙江省 · 杭州市', lat: 30.2741, lon: 120.1551 },
    { name: '伦敦', detail: '英国', lat: 51.5074, lon: -0.1278 },
  ]
  assert.equal(
    findActiveFavorite(drifted, { name: '杭州', detail: '浙江省 · 杭州市', lat: 30.3441, lon: 120.2551 }),
    drifted[0],
  )
  // 详情变短（行政区查表在区县 / 地级之间切换）同样能找回
  assert.equal(
    findActiveFavorite(drifted, { name: '杭州', detail: '浙江省', lat: 30.3441, lon: 120.2551 }),
    drifted[0],
  )
  // 同名但确实是另一个地点时不误标
  assert.equal(
    findActiveFavorite(drifted, { name: '杭州', detail: '浙江省 · 宁波市', lat: 29.87, lon: 121.55 }),
    null,
  )
  // 名字不同（杭州 vs 西湖）从不互相点亮
  assert.equal(
    findActiveFavorite(drifted, { name: '西湖', detail: '浙江省 · 杭州市', lat: 30.3441, lon: 120.2551 }),
    null,
  )
  // 浏览不在收藏里的城市 / 空列表 / 无当前城市 / 非法坐标 -> 不标
  assert.equal(findActiveFavorite(cities, { lat: 31.2, lon: 121.5 }), null)
  assert.equal(findActiveFavorite([], { lat: 30.27, lon: 120.15 }), null)
  assert.equal(findActiveFavorite(cities, null), null)
  assert.equal(findActiveFavorite(cities, undefined), null)
  assert.equal(findActiveFavorite(cities, { lat: null, lon: null }), null)
  assert.equal(findActiveFavorite(cities, { lat: NaN, lon: 120 }), null)
  assert.equal(findActiveFavorite([{ name: '坏数据', lat: NaN, lon: 1 }], { lat: 30.27, lon: 120.15 }), null)
})

test('aqi dial captions are plain adjectives without 污染', () => {
  const names = [0, 80, 130, 180, 250, 400].map((v) => levelOf(v).name)
  assert.deepEqual(names, ['优', '良', '轻度', '中度', '重度', '严重'])
  for (const name of names) assert.equal(name.includes('污染'), false)
  assert.equal(readAir({ us_aqi: 130 }).level.name, '轻度')
  assert.equal(readAir({ us_aqi: 260 }).level.name, '重度')
  assert.equal(readAir({ us_aqi: 400 }).level.name, '严重')
  assert.equal(levelOf(null), null)
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

test('update probe reads GitHub first so the ten minute page cache cannot hide a release', async () => {
  const sources = buildDeployProbeSources('https://example.test/app/')
  assert.deepEqual(sources.map((source) => source.id), ['github-api', 'github-raw', 'site'])
  const [api, raw, site] = sources
  // GitHub 源必须比站点自身快，否则「主动发现」没有意义
  assert.ok(api.freshMs < site.freshMs)
  assert.ok(raw.freshMs < site.freshMs)
  assert.ok(api.quota, 'api.github.com 未登录只能 60 次/小时，必须标记为有配额')
  assert.equal(raw.quota, false)
  // 每 2 分钟探测一次 = 30 次/小时，API 必须有最小使用间隔，否则多标签页就打满配额
  assert.equal(api.minIntervalMs, API_MIN_INTERVAL_MS)
  assert.ok(api.minIntervalMs >= 5 * 60 * 1000, 'API 间隔不能低于 5 分钟')
  assert.equal(raw.minIntervalMs, 0)
  assert.equal(site.minIntervalMs, 0)
  assert.equal(api.init.headers.accept, 'application/vnd.github.raw')
  assert.equal(api.init.cache, 'no-store')
  assert.ok(api.url.includes('/contents/deploy.json?ref=gh-pages'))
  assert.ok(raw.url.startsWith('https://raw.githubusercontent.com/'))
  assert.equal(site.url, 'https://example.test/app/deploy.json')
  // baseHref 非法时退回相对路径，而不是抛错
  assert.equal(buildDeployProbeSources('').at(-1).url, 'deploy.json')
})

test('update probe rejects payloads that cannot prove a version', () => {
  const bad = (text) => {
    try {
      parseDeployManifest(text)
      return null
    } catch (error) {
      return error.code
    }
  }
  assert.equal(bad(''), 'BAD_PAYLOAD')
  assert.equal(bad('   '), 'BAD_PAYLOAD')
  assert.equal(bad(undefined), 'BAD_PAYLOAD')
  assert.equal(bad('<html>404</html>'), 'BAD_PAYLOAD')
  assert.equal(bad('[1,2]'), 'BAD_PAYLOAD')
  assert.equal(bad('{}'), 'BAD_PAYLOAD')
  assert.equal(bad('{"appVersion":"v0.1.13"}'), 'BAD_PAYLOAD')
  // 三个版本字段任一存在即可
  assert.equal(parseDeployManifest('{"appBuildId":"abc"}').appBuildId, 'abc')
  assert.equal(parseDeployManifest('{"sourceTag":"v0.1.13"}').sourceTag, 'v0.1.13')
  assert.equal(parseDeployManifest('{"latestTag":"v0.1.12"}').latestTag, 'v0.1.12')
})

function fakeResponse(body, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    text: async () => body,
  }
}

test('update probe falls back source by source and reports every failure', async () => {
  const sources = buildDeployProbeSources('https://example.test/')
  const calls = []
  const manifest = await readDeployManifest(sources, {
    fetchImpl: async (url) => {
      calls.push(url)
      if (calls.length === 1) throw Object.assign(new Error('offline'), { code: 'NETWORK' })
      if (calls.length === 2) return fakeResponse('', { status: 503 })
      return fakeResponse(JSON.stringify({ appBuildId: 'commit-new' }))
    },
  })
  assert.equal(calls.length, 3, '前两个源都失败时要继续试第三个')
  assert.equal(manifest.source.id, 'site')
  assert.equal(manifest.manifest.appBuildId, 'commit-new')
  assert.equal(manifest.failures.length, 2)
  assert.equal(manifest.failures[1].error.code, 'HTTP_ERROR')
  assert.equal(manifest.failures[1].error.status, 503)
})

test('update probe honours rate limits and skips a cooling source', async () => {
  const sources = buildDeployProbeSources('https://example.test/')
  let limited
  await assert.rejects(
    readDeployManifest(sources, {
      fetchImpl: async () => fakeResponse('rate limited', {
        status: 403,
        headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1700000000' },
      }),
    }),
    (error) => {
      assert.equal(error.code, 'ALL_SOURCES_FAILED')
      limited = error.failures[0].error
      assert.equal(limited.code, 'RATE_LIMITED')
      assert.equal(limited.resetAt, 1700000000000)
      return true
    },
  )
  // 冷却中的源必须被跳过，而不是再打一次配额
  const calls = []
  const result = await readDeployManifest(sources, {
    isSourceBlocked: (source) => source.id === 'github-api',
    fetchImpl: async (url) => {
      calls.push(url)
      return fakeResponse(JSON.stringify({ sourceTag: 'v0.1.99' }))
    },
  })
  assert.equal(calls.length, 1)
  assert.equal(result.source.id, 'github-raw')
  assert.equal(result.failures[0].error.code, 'SKIPPED')
})

test('update probe gives up after a timeout instead of hanging forever', async () => {
  const sources = buildDeployProbeSources('https://example.test/')
  const started = Date.now()
  await assert.rejects(
    readDeployManifest(sources, {
      timeoutMs: 20,
      fetchImpl: (url, init) => new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const error = new Error('aborted')
          error.name = 'AbortError'
          reject(error)
        })
      }),
    }),
    (error) => {
      assert.equal(error.code, 'ALL_SOURCES_FAILED')
      assert.equal(error.failures.length, sources.length)
      for (const failure of error.failures) assert.equal(failure.error.code, 'TIMEOUT')
      return true
    },
  )
  assert.ok(Date.now() - started < 2000, '超时要真的中断，不能等到 HTTP 自己超时')
})

test('update probe keeps the quota source on a leash instead of burning it every poll', () => {
  const [api] = buildDeployProbeSources('https://example.test/')
  // 反推上限：一小时内的调用次数必须远小于未登录限额 60 次
  const perHour = Math.floor((60 * 60 * 1000) / api.minIntervalMs)
  assert.ok(perHour <= 12, `GitHub API 一小时最多用 ${perHour} 次`)
  assert.ok(perHour > 0)
})
