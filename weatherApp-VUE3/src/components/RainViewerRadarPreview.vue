<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

import { requestJson } from '@/api/weather'
import { getZonedParts } from '@/utils/timezone'

const META_URL = 'https://api.rainviewer.com/public/weather-maps.json'
const TILE_HOST_FALLBACK = 'https://tilecache.rainviewer.com'
const META_REFRESH_MS = 10 * 60 * 1000
const MAX_NATIVE_ZOOM = 7
const MAX_ZOOM = 19
const RVR_ATTR =
  'Weather data by <a href="https://www.rainviewer.com/api.html" target="_blank" rel="noopener">RainViewer</a>'
const ESRI_HOSTS = [
  'https://server2.arcgisonline.com',
  'https://server.arcgisonline.com',
]
const ESRI_PATH =
  '/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'
const ESRI_REFERENCE_PATH =
  '/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}'
const FIRST_FRAME_GUARD_MS = 6000
const ESRI_ATTR =
  'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors'
const SPEEDS = [
  { id: 'slow', label: '慢', ms: 700 },
  { id: 'normal', label: '标准', ms: 520 },
  { id: 'fast', label: '快', ms: 300 },
  { id: 'faster', label: '更快', ms: 180 },
]

const props = defineProps({
  open: { type: Boolean, default: false },
  cityName: { type: String, default: '' },
  latitude: { type: Number, default: null },
  longitude: { type: Number, default: null },
  timezone: { type: String, default: '' },
})
const emit = defineEmits(['close'])

const layerEl = ref(null)
const mapEl = ref(null)
const closeBtn = ref(null)
const frames = ref([])
const idx = ref(0)
const playing = ref(false)
const loading = ref(false)
const ready = ref(false)
const errorMsg = ref('')
const coverageWarning = ref('')
const baseWarning = ref('')
const speed = ref('normal')
const metaHost = ref(TILE_HOST_FALLBACK)

let map = null
let radarLayers = []
let radarPanes = []
let radarFront = 0
let radarFrontReady = false
let framePending = false
let frameToken = 0
let frameLoadLayer = null
let frameLoadHandler = null
let frameGuard = null
let baseLayer = null
let labelLayer = null
let baseHostIndex = 0
let baseErrors = 0
let playTimer = null
let refreshTimer = null
let metaController = null
let token = 0
let historyPushed = false
let previousFocus = null
let previousOverflow = ''

const currentFrame = computed(() => frames.value[idx.value] || null)
const maxIdx = computed(() => Math.max(0, frames.value.length - 1))
const pct = computed(() => maxIdx.value ? (idx.value / maxIdx.value) * 100 : 0)
const isLatest = computed(() => idx.value === maxIdx.value)
const speedMs = computed(() => SPEEDS.find((item) => item.id === speed.value)?.ms || 520)
const rangeText = computed(() =>
  frames.value.length > 1
    ? `${frames.value.length} 帧 · 10 分钟一帧`
    : '等待雷达帧',
)

function pad(value) {
  return String(value).padStart(2, '0')
}

function frameTimeText(frame) {
  if (!frame) return '--:--'
  const parts = getZonedParts(new Date(frame.time * 1000), props.timezone)
  return `${pad(parts.hour)}:${pad(parts.minute)}`
}

const timeText = computed(() => frameTimeText(currentFrame.value))
const relLabel = computed(() => {
  if (!currentFrame.value) return '暂无'
  return isLatest.value ? '最新' : `${maxIdx.value - idx.value} 帧前`
})

function tileTemplate(frame) {
  const host = metaHost.value || TILE_HOST_FALLBACK
  return `${host}${frame.path}/512/{z}/{x}/{y}/4/1_1.png`
}

function mountBase(hostIndex = 0) {
  if (!map) return
  baseHostIndex = hostIndex
  baseErrors = 0
  const previous = baseLayer
  baseLayer = L.tileLayer(`${ESRI_HOSTS[hostIndex]}${ESRI_PATH}`, {
    maxZoom: MAX_ZOOM,
    attribution: `${ESRI_ATTR} &nbsp;|&nbsp; ${RVR_ATTR}`,
    className: 'rv-base-tiles',
    zIndex: 0,
  })
  labelLayer = L.tileLayer(`${ESRI_HOSTS[hostIndex]}${ESRI_REFERENCE_PATH}`, {
    maxZoom: MAX_ZOOM,
    className: 'rv-label-tiles',
    opacity: 0.92,
    zIndex: 1,
  })
  baseLayer.on('tileerror', (event) => {
    if (!baseLayer || baseLayer !== event.target) return
    baseErrors += 1
    if (baseErrors < 3) return
    if (baseHostIndex + 1 < ESRI_HOSTS.length) {
      mountBase(baseHostIndex + 1)
    } else {
      baseWarning.value = '底图服务暂时不可用，请稍后重试'
    }
  })
  baseLayer.addTo(map)
  labelLayer.addTo(map)
  if (previous && map.hasLayer(previous)) map.removeLayer(previous)
}

function initMap() {
  if (map || !mapEl.value) return
  const latitude = Number.isFinite(props.latitude) ? props.latitude : 20
  const longitude = Number.isFinite(props.longitude) ? props.longitude : 0
  map = L.map(mapEl.value, {
    minZoom: 2,
    maxZoom: MAX_ZOOM,
    zoomControl: false,
    worldCopyJump: true,
    attributionControl: true,
    // Leaflet 默认会给新瓦片做一个 opacity 0→1 的淡入；双缓冲硬切必须关掉。
    fadeAnimation: false,
  }).setView([latitude, longitude], props.latitude == null ? 2 : 6)

  mountBase(0)
  L.control.zoom({ position: 'bottomleft' }).addTo(map)
  L.circleMarker([latitude, longitude], {
    radius: 5,
    color: '#ffffff',
    weight: 2,
    fillColor: '#7fd4f5',
    fillOpacity: 1,
  }).addTo(map).bindTooltip(props.cityName || '当前位置')

  radarLayers = []
  radarPanes = []
  radarFront = 0
  radarFrontReady = false
  for (let index = 0; index < 2; index += 1) {
    const paneName = `rv-radar-${index}`
    const pane = map.createPane(paneName)
    // Leaflet 默认 tilePane 的 z-index 是 200；自定义雷达 pane 必须高于它。
    pane.style.zIndex = '250'
    pane.style.visibility = 'hidden'
    radarPanes.push(pane)

    const layer = L.tileLayer('', {
      pane: paneName,
      tileSize: 512,
      zoomOffset: -1,
      minNativeZoom: 0,
      maxNativeZoom: MAX_NATIVE_ZOOM,
      maxZoom: MAX_ZOOM,
      className: 'rv-radar-tiles',
      updateWhenIdle: false,
      keepBuffer: 2,
    })
    layer.on('tileerror', () => {
      coverageWarning.value = '该区域雷达覆盖可能不完整，空白不代表没有降水'
    })
    layer.addTo(map)
    radarLayers.push(layer)
  }
  requestAnimationFrame(() => map?.invalidateSize())
}

function clearPlayTimer() {
  if (playTimer != null) {
    clearTimeout(playTimer)
    playTimer = null
  }
}

function clearFrameWait() {
  if (frameGuard != null) {
    clearTimeout(frameGuard)
    frameGuard = null
  }
  if (frameLoadLayer && frameLoadHandler) frameLoadLayer.off('load', frameLoadHandler)
  frameLoadLayer = null
  frameLoadHandler = null
}

// 双缓冲硬切：新帧先在隐藏 pane 里加载，整层 load 后只切换 visibility。
// 不使用 opacity，避免前后两帧叠加成双重曝光。
function showFrame(index, onShown) {
  if (!frames.value.length || radarLayers.length < 2) {
    onShown?.(false)
    return
  }

  const target = Math.min(maxIdx.value, Math.max(0, Number(index) || 0))
  const back = radarFrontReady ? 1 - radarFront : 0
  const layer = radarLayers[back]
  const pane = radarPanes[back]
  if (!layer || !pane) {
    onShown?.(false)
    return
  }

  clearFrameWait()
  const requestId = ++frameToken
  framePending = true
  let settled = false

  const commit = () => {
    if (settled) return
    settled = true
    clearFrameWait()
    if (requestId !== frameToken) {
      onShown?.(false)
      return
    }

    framePending = false
    pane.style.visibility = 'visible'
    if (radarFrontReady && radarFront !== back) {
      radarPanes[radarFront].style.visibility = 'hidden'
    }
    radarFront = back
    radarFrontReady = true
    idx.value = target
    onShown?.(true)
  }

  frameLoadLayer = layer
  frameLoadHandler = commit
  layer.once('load', commit)
  layer.setUrl(tileTemplate(frames.value[target]), false)
  frameGuard = setTimeout(commit, FIRST_FRAME_GUARD_MS)
}

function scheduleNext() {
  clearPlayTimer()
  if (!playing.value || !ready.value || framePending) return
  playTimer = setTimeout(() => {
    playTimer = null
    if (!playing.value || !ready.value || framePending) return
    showFrame(idx.value >= maxIdx.value ? 0 : idx.value + 1, (shown) => {
      if (shown && playing.value) scheduleNext()
    })
  }, speedMs.value)
}

function togglePlay() {
  if (!ready.value) return
  playing.value = !playing.value
  if (playing.value) scheduleNext()
  else clearPlayTimer()
}

function onSlide(event) {
  playing.value = false
  clearPlayTimer()
  showFrame(event.target.value)
}

function setSpeed(id) {
  speed.value = id
  if (playing.value) scheduleNext()
}

function scheduleRefresh() {
  if (refreshTimer != null) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => loadMeta(true), META_REFRESH_MS)
}

async function loadMeta(isRefresh = false) {
  const requestId = ++token
  metaController?.abort()
  metaController = new AbortController()
  if (!isRefresh) {
    loading.value = true
    ready.value = false
    errorMsg.value = ''
    coverageWarning.value = ''
  }

  try {
    const data = await requestJson(META_URL, {
      signal: metaController.signal,
      timeoutMs: 12000,
      errorMessage: 'RainViewer 元数据请求失败',
    })
    if (requestId !== token) return

    const past = Array.isArray(data?.radar?.past) ? data.radar.past : []
    const nowcast = Array.isArray(data?.radar?.nowcast) ? data.radar.nowcast : []
    const nextFrames = [...past, ...nowcast]
      .filter((frame) => Number.isFinite(frame?.time) && frame?.path)
      .sort((a, b) => a.time - b.time)
    if (!nextFrames.length) throw new Error('RainViewer 暂未返回可用帧')

    const wasLatest = !frames.value.length || idx.value === maxIdx.value
    metaHost.value = data.host || TILE_HOST_FALLBACK
    frames.value = nextFrames
    initMap()
    if (!isRefresh) playing.value = nextFrames.length > 1
    loading.value = false
    ready.value = true
    errorMsg.value = ''
    showFrame(wasLatest ? maxIdx.value : Math.min(idx.value, maxIdx.value), (shown) => {
      if (shown && playing.value) scheduleNext()
    })
    scheduleRefresh()
  } catch (error) {
    if (requestId !== token || error?.name === 'AbortError') return
    loading.value = false
    ready.value = false
    errorMsg.value = error?.message || '全球雷达加载失败'
  } finally {
    if (requestId === token) metaController = null
  }
}

function retry() {
  loadMeta(false)
}

function cleanupMap() {
  playing.value = false
  clearFrameWait()
  clearPlayTimer()
  framePending = false
  if (refreshTimer != null) {
    clearTimeout(refreshTimer)
    refreshTimer = null
  }
  token += 1
  metaController?.abort()
  metaController = null
  if (map) {
    map.remove()
    map = null
  }
  radarLayers = []
  radarPanes = []
  radarFrontReady = false
  baseLayer = null
  labelLayer = null
  ready.value = false
}

function lockBackground() {
  previousOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
}

function unlockBackground() {
  document.body.style.overflow = previousOverflow
}

async function openLayer() {
  previousFocus = document.activeElement
  lockBackground()
  if (!historyPushed) {
    history.pushState({ rainViewerRadar: 1 }, '')
    historyPushed = true
  }
  await nextTick()
  initMap()
  await loadMeta(false)
  closeBtn.value?.focus({ preventScroll: true })
}

function close() {
  if (historyPushed) {
    historyPushed = false
    history.back()
  }
  emit('close')
}

function onPopState() {
  if (!historyPushed) return
  historyPushed = false
  emit('close')
}

function getFocusable() {
  return [...(layerEl.value?.querySelectorAll(
    'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
  ) || [])].filter((element) => element.getClientRects().length > 0)
}

function onKeydown(event) {
  if (!props.open) return
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }
  if (event.key !== 'Tab') return
  const focusable = getFocusable()
  if (!focusable.length) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) openLayer()
    else {
      cleanupMap()
      unlockBackground()
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
      previousFocus = null
    }
  },
  { immediate: true },
)

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('popstate', onPopState)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('popstate', onPopState)
  cleanupMap()
  unlockBackground()
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      ref="layerEl"
      class="rv-radar-layer"
      role="dialog"
      aria-modal="true"
      :aria-label="`${cityName || '当前位置'}全球降水雷达回放`"
    >
      <div ref="mapEl" class="rv-map" aria-label="全球降水雷达地图"></div>

      <header class="rv-head">
        <div>
          <div class="rv-eyebrow">GLOBAL PRECIPITATION RADAR</div>
          <h2>全球降水雷达</h2>
          <div class="rv-place">{{ cityName || '当前位置' }} · RainViewer</div>
        </div>
        <button ref="closeBtn" class="rv-close" type="button" aria-label="关闭雷达回放" @click="close">✕</button>
      </header>

      <div v-if="loading" class="rv-status" role="status">
        <span class="rv-spinner" aria-hidden="true"></span>
        正在获取 RainViewer 雷达帧…
      </div>
      <div v-else-if="errorMsg" class="rv-status error" role="alert">
        <strong>全球雷达加载失败</strong>
        <span>{{ errorMsg }}</span>
        <button type="button" @click="retry">重试</button>
      </div>

      <div class="rv-note" role="status">
        <span>{{ rangeText }}</span>
        <span v-if="coverageWarning">{{ coverageWarning }}</span>
        <span v-if="baseWarning">{{ baseWarning }}</span>
      </div>

      <footer class="rv-controls">
        <button
          class="rv-play"
          type="button"
          :disabled="!ready"
          :aria-label="playing ? '暂停回放' : '播放回放'"
          @click="togglePlay"
        >
          {{ playing ? '❚❚' : '▶' }}
        </button>

        <div class="rv-track">
          <div class="rv-time-row">
            <strong>{{ timeText }}</strong>
            <span>{{ relLabel }}</span>
          </div>
          <input
            class="rv-slider"
            type="range"
            min="0"
            :max="maxIdx"
            step="1"
            :value="idx"
            :disabled="!ready"
            :style="{ '--pct': `${pct}%` }"
            aria-label="雷达帧时间轴"
            @input="onSlide"
          />
        </div>

        <div class="rv-speeds" role="group" aria-label="回放速度">
          <button
            v-for="item in SPEEDS"
            :key="item.id"
            type="button"
            :class="{ on: speed === item.id }"
            @click="setSpeed(item.id)"
          >
            {{ item.label }}
          </button>
        </div>
      </footer>

      <div class="rv-credit">
        雷达数据
        <a href="https://www.rainviewer.com/api.html" target="_blank" rel="noopener">RainViewer</a>
        · 底图 © Esri · 覆盖随地区而异，空白不代表无降水
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.rv-radar-layer {
  --rv-accent: #7fd4f5;
  position: fixed;
  inset: 0;
  z-index: 1000;
  overflow: hidden;
  color: #fff;
  background: #060d16;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
}
.rv-map { position: absolute; inset: 0; z-index: 1; background: #060d16; touch-action: none; }
.rv-map :deep(.rv-radar-tiles .leaflet-tile) {
  opacity: 1 !important;
  transition: none !important;
}
.rv-map :deep(.leaflet-control-attribution) {
  max-width: calc(100vw - 160px);
  padding: 2px 6px;
  background: rgba(5, 12, 22, .72);
  color: rgba(255,255,255,.56);
  font-size: 10px;
}
.rv-map :deep(.leaflet-control-attribution a) { color: rgba(255,255,255,.75); }
.rv-map :deep(.leaflet-control-zoom) { border: 0; box-shadow: 0 5px 20px rgba(0,0,0,.35); }
.rv-map :deep(.leaflet-control-zoom a) {
  border: 0;
  color: #fff;
  background: rgba(14, 28, 44, .86);
  backdrop-filter: blur(12px);
}
.rv-head {
  position: absolute;
  z-index: 10;
  top: max(16px, env(safe-area-inset-top));
  left: 16px;
  right: 16px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  pointer-events: none;
}
.rv-head > div {
  padding: 13px 16px;
  border: 1px solid rgba(255,255,255,.13);
  border-radius: 16px;
  background: rgba(8, 17, 30, .78);
  box-shadow: 0 12px 42px rgba(0,0,0,.35);
  backdrop-filter: blur(18px);
}
.rv-eyebrow {
  color: rgba(255,255,255,.5);
  font-size: 9px;
  letter-spacing: 1.4px;
}
.rv-head h2 { margin: 3px 0 0; font-size: 18px; font-weight: 650; }
.rv-place { margin-top: 4px; color: rgba(255,255,255,.64); font-size: 12px; }
.rv-close {
  display: grid;
  width: 42px;
  height: 42px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid rgba(255,255,255,.14);
  border-radius: 50%;
  color: #fff;
  background: rgba(8, 17, 30, .78);
  font-size: 15px;
  cursor: pointer;
  pointer-events: auto;
  backdrop-filter: blur(18px);
}
.rv-status {
  position: absolute;
  z-index: 20;
  top: 50%;
  left: 50%;
  display: flex;
  max-width: min(420px, calc(100vw - 32px));
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  transform: translate(-50%, -50%);
  border: 1px solid rgba(255,255,255,.14);
  border-radius: 16px;
  background: rgba(8, 17, 30, .9);
  box-shadow: 0 20px 60px rgba(0,0,0,.45);
  font-size: 13px;
  backdrop-filter: blur(18px);
}
.rv-status.error { flex-direction: column; align-items: stretch; text-align: center; }
.rv-status.error span { color: rgba(255,255,255,.62); font-size: 12px; }
.rv-status.error button { margin-top: 4px; padding: 8px 12px; border: 0; border-radius: 10px; cursor: pointer; }
.rv-spinner {
  width: 17px;
  height: 17px;
  flex: 0 0 auto;
  border: 2px solid rgba(255,255,255,.24);
  border-top-color: #fff;
  border-radius: 50%;
  animation: rv-spin .8s linear infinite;
}
@keyframes rv-spin { to { transform: rotate(360deg); } }
.rv-note {
  position: absolute;
  z-index: 12;
  right: 16px;
  bottom: 145px;
  display: flex;
  max-width: min(430px, calc(100vw - 32px));
  flex-direction: column;
  gap: 3px;
  color: rgba(255,255,255,.6);
  font-size: 11px;
  text-align: right;
  pointer-events: none;
}
.rv-controls {
  position: absolute;
  z-index: 15;
  right: 16px;
  bottom: max(28px, calc(env(safe-area-inset-bottom) + 18px));
  left: 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border: 1px solid rgba(255,255,255,.14);
  border-radius: 18px;
  background: rgba(8, 17, 30, .84);
  box-shadow: 0 16px 54px rgba(0,0,0,.42);
  backdrop-filter: blur(20px);
}
.rv-play {
  width: 42px;
  height: 42px;
  flex: 0 0 auto;
  border: 0;
  border-radius: 50%;
  color: #071420;
  background: var(--rv-accent);
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
}
.rv-play:disabled { opacity: .4; cursor: default; }
.rv-track { min-width: 0; flex: 1; }
.rv-time-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.rv-time-row strong { font-size: 15px; font-variant-numeric: tabular-nums; }
.rv-time-row span { color: rgba(255,255,255,.55); font-size: 11px; }
.rv-slider {
  width: 100%;
  height: 4px;
  appearance: none;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--rv-accent) var(--pct), rgba(255,255,255,.18) var(--pct));
  cursor: pointer;
}
.rv-slider::-webkit-slider-thumb {
  width: 15px;
  height: 15px;
  appearance: none;
  border: 2px solid #fff;
  border-radius: 50%;
  background: #7fd4f5;
}
.rv-speeds { display: flex; gap: 3px; padding: 3px; border-radius: 10px; background: rgba(255,255,255,.07); }
.rv-speeds button {
  padding: 7px 9px;
  border: 0;
  border-radius: 8px;
  color: rgba(255,255,255,.65);
  background: transparent;
  font-size: 11px;
  cursor: pointer;
}
.rv-speeds button.on { color: #06121e; background: var(--rv-accent); font-weight: 700; }
.rv-credit {
  position: absolute;
  z-index: 12;
  bottom: 7px;
  left: 50%;
  transform: translateX(-50%);
  color: rgba(255,255,255,.5);
  font-size: 10px;
  white-space: nowrap;
}
.rv-credit a { color: rgba(255,255,255,.76); }
@media (max-width: 640px) {
  .rv-head { top: 10px; left: 10px; right: 10px; }
  .rv-head > div { padding: 10px 12px; }
  .rv-head h2 { font-size: 16px; }
  .rv-note { right: 12px; bottom: 155px; left: 12px; max-width: none; text-align: left; }
  .rv-controls { right: 10px; bottom: max(28px, calc(env(safe-area-inset-bottom) + 18px)); left: 10px; flex-wrap: wrap; }
  .rv-track { flex-basis: calc(100% - 58px); }
  .rv-speeds { width: 100%; justify-content: flex-end; }
  .rv-credit { max-width: calc(100vw - 20px); overflow: hidden; text-overflow: ellipsis; }
}
@media (prefers-reduced-motion: reduce) {
  .rv-spinner { animation-duration: 1.6s; }
}
</style>
