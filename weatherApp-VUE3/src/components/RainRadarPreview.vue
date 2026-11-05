<script setup>
/**
 * 降水预报 · 雷达回放层
 *
 * 把 docs/radar-demo.html 那套「RainViewer 过去 2 小时 + Esri 暗色底图」的美术与
 * 时序策略原样搬进 Vue：不用 iframe 嵌 demo 页面 —— file:// 与 dev server 下相对
 * 路径不同、demo 的全局变量会和主应用抢 window、关闭组件时 iframe 里的 map 实例
 * 也没法保证被销毁，原生实现反而更短、更可控。
 *
 * 关键结论都来自 demo 的实测（见 docs/radar-demo-spec.md），这里按同样的规则实现：
 *   1. Leaflet 走 CDN 动态加载，不进主 bundle（首次打开才拉，首页零成本）。
 *   2. 换帧必须等「整层瓦片 load 完」再交叉淡入，不能用固定节拍定时器。
 *   3. 原生层级封顶 7（z8+ 返回 200 但是空壳），更高的缩放交给 Leaflet 上采样。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  lat: { type: Number, default: null },
  lon: { type: Number, default: null },
  cityName: { type: String, default: '' },
})
const emit = defineEmits(['close'])

/* ============================================================
   常量
   ============================================================ */

const META_URL = 'https://api.rainviewer.com/public/weather-maps.json'
const TILE_HOST_FALLBACK = 'https://tilecache.rainviewer.com'

const LEAFLET_CSS = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css'
const LEAFLET_JS = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js'

// Esri「Dark Gray Canvas」底图。注意占位符顺序是 {z}/{y}/{x}（行列在前、列在后），
// 与 Leaflet 默认的 {z}/{x}/{y} 相反，写反了整张底图会错位成噪点。
// 不用 CARTO：其免费暗色瓦片已下线，任何 dark_all 请求都返回 200 + 「API KEY REQUIRED」水印图，
// 只看状态码发现不了，必须看图。
//
// 双入口：Esri 有同源镜像主机名，实测 server2 明显比 server 稳（交替采样 server2 10/10、
// 中位 0.78s；server 只有 5/10、中位 1.59s），所以快的放前面做首屏，慢的做兜底。
// 注意这两个是「同一份数据的两个 CDN 入口」，只挡单入口故障，挡不住 Esri 整体不可用。
const ESRI_HOSTS = [
  'https://server2.arcgisonline.com',
  'https://server.arcgisonline.com',
]
const ESRI_PATH = '/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'
// 首屏攒够这么多块瓦片报错才认为这个入口坏了。单块偶发失败不切，否则来回抖动。
const BASEMAP_FAIL_THRESHOLD = 3
// 首屏等底图出图的期限：超过就认为这次没成，但仍把层挂上（可能只是慢）
const BASE_FIRST_MS = 6000


// 进图默认 z7：雷达本身可读的层级。
// 这个值是被数据逼出来的，不是随便挑的 ——
// RainViewer 的雷达瓦片 maxNativeZoom 就是 7（z8 以上全是 3269 字节的空壳，
// 且不返回错误码），所以地图一旦放大到 z15 那种街道级，z7 瓦片会被拉伸 256 倍，
// 有雨的地方变成一整屏纯蓝色块、没雨的地方全透明，回波彻底失去意义。
// 实测对照：z7 一屏约覆盖 300 km（成片雨带清晰可辨），z15 只剩色块。
// 街道名要 z15 才出现（实测 z14 只有水系名，z15 有王府井大街/东单三条，
// 小城松滋 z15 有民主路），所以「看街道名」与「看雷达回波」在同一屏里无法兼得，
// 默认取雷达这一侧 —— 这个界面本来就是用来看降水的。用户放大时下面会给出提示。
const START_ZOOM = 7
// 地图层级超过它，雷达回波就只是被拉伸的色块，界面要明确告知而不是让色块骗人。
// 注意这里说的是「地图层级」，不是 URL 层级：tileSize 512 + zoomOffset -1 让
// 地图 z8 实际请求 URL z7（实测 4992 字节，真数据），地图 z9 才请求 URL z8
// （3269 字节空壳）。所以可读上限是地图 8 级 —— 写成 7 会白白少用一级清晰度。
const RADAR_LEGIBLE_MAX = 8

// 提示条上的「回到 N 级」跳到这里，而不是跳回阈值那一级。
// 8 级是「还能读」的极限，正好停在极限上，稍有抖动就又触发提示；
// 6 级回波结构和小范围城市关系都看得清，才是真正舒服的层级。
const RADAR_COMFORT_ZOOM = 6

// 完整署名（窄屏只显示紧凑版，完整版放进 title 与 aria-label，信息不丢）
const CREDIT_FULL =
  'Tiles © Esri — Esri, HERE, Garmin, © OpenStreetMap contributors | Weather data by RainViewer'
// 没有定位坐标时退回中国全域，这时候不该放大到街道级（没有「街道」可看）
const FALLBACK_ZOOM = 5
const FALLBACK_CENTER = [35.2, 105] // 没有经纬度时退回中国全域视野
// 这个数落在「地图缩放空间」里，不是 URL 层级 —— tileSize 512 + zoomOffset -1
// 让 URL 层级恒定比它小 1。所以填 8 时才最终请求 URL z7（实测 4992 字节，真数据），
// 填 7 的话 URL 最高只到 z6，白丢一级清晰度。
// URL z8 起才是 3269 字节的空壳（且不返回错误码、不触发 tileerror），只能在这一层拦。
const MAX_NATIVE_ZOOM = 8
const MAX_ZOOM = 19

const RADAR_COLOR = 2 // 2 = 原色，与组件内图例色条取自同一套瓦片像素；服务端 color 参数实测无效
const RADAR_OPACITY = 0.82

// 播放速度档。切换会同时改单帧停留与淡入时长（淡入取停留的 1/4，封顶 260ms）：
// 只缩短间隔会让过渡占满整帧，画面常年停在两层都半透明的中间态，反而更糊。
const SPEEDS = [
  { id: 'slow', name: '慢', frameMs: 700 },
  { id: 'normal', name: '标准', frameMs: 520 },
  { id: 'fast', name: '快', frameMs: 300 },
  { id: 'faster', name: '更快', frameMs: 180 },
]
const DEFAULT_SPEED = 'normal'
const FADE_RATIO = 0.25
const FADE_MAX_MS = 260

// 兜底超时。实测这台机器到 RainViewer 单块瓦片要 1.3–12 秒，所以「先到一块就换帧」
// 必然把剩下的瓦片全部中止、屏幕只剩底图。现在的策略是旧帧一直亮着等整层 load，
// 这里只防它永远不来。
const LOAD_GUARD_MS = 15000
// 首帧没有旧帧垫着，等满 15 秒就是纯底图，所以 6 秒先把已经到的瓦片亮出来。
const FIRST_GUARD_MS = 6000
const META_TIMEOUT_MS = 12000

/* 预热：首帧上屏后，把「接下来要播的几帧」在当前视野用到的瓦片提前拉进 HTTP 缓存。
   实测这台机器单块瓦片 1.3–12 秒，不预热时每换一帧要重新等整层 load（3–7 秒）。

   这里有个反直觉的取舍：最早试过把 12 帧全预热，但一屏 30 块 × 12 帧 = 360 个请求，
   8 并发实测 30 秒只完成 14 块 —— 要跑几分钟，而 13 帧一圈才 6.8 秒，永远追不上。
   更糟的是这 8 个并发会和用户正在看的那一帧抢连接，实测换帧新发请求从 4 个涨到 12–16 个，
   等于为了加速反而拖慢了当前画面。

   所以只预热接下来几帧、只开 3 个并发：让预热始终落后于播放进度一步，
   用户看到的帧永远优先拿到带宽，预热只在「等下一帧的那半秒」里占一点空隙。
   探到的帧进缓存后（z≤6 的 cache-control 是 48 小时）第二圈起几乎零请求。 */
const PREWARM_AHEAD = 3
const PREWARM_CONCURRENCY = 3

/* ============================================================
   Leaflet 动态加载（模块级单例）
   ============================================================ */

// 单例 promise：并发打开 / 关闭后立刻重开都不会重复插 <script>。
// 失败时置回 null，让「重试」按钮能真正重新发起请求。
let leafletPromise = null

function loadLeafletCss() {
  return new Promise((resolve, reject) => {
    const selector = 'link[data-radar-leaflet="css"]'
    let el = document.querySelector(selector)

    if (!el) {
      el = document.createElement('link')
      el.rel = 'stylesheet'
      el.href = LEAFLET_CSS
      el.dataset.radarLeaflet = 'css'
      document.head.appendChild(el)
    }

    if (el.dataset.loaded === '1') {
      resolve()
      return
    }

    // 标签可能是上一轮插进去、还在下载的（快速关→开）。不假设它可用，一律等事件给结论。
    el.addEventListener(
      'load',
      () => {
        el.dataset.loaded = '1'
        resolve()
      },
      { once: true },
    )
    el.addEventListener(
      'error',
      () => {
        // 摘掉失败标签，否则重试时不会重新发请求
        el.remove()
        reject(new Error('Leaflet 样式表加载失败（CDN 不可达）'))
      },
      { once: true },
    )

    // 命中浏览器缓存时 load 事件可能已经错过，用 sheet 兜一层
    if (el.sheet) {
      el.dataset.loaded = '1'
      resolve()
    }
  })
}

function loadLeafletScript() {
  return new Promise((resolve, reject) => {
    if (window.L) {
      resolve(window.L)
      return
    }

    // 上次失败的标签留在 DOM 里，它不会再触发任何事件，不清掉重试会永远卡住
    const stale = document.querySelector('script[data-radar-leaflet="js"]')
    if (stale) stale.remove()

    const el = document.createElement('script')
    el.src = LEAFLET_JS
    el.async = true
    el.dataset.radarLeaflet = 'js'
    el.addEventListener('load', () => {
      if (window.L) resolve(window.L)
      else reject(new Error('Leaflet 脚本已下载但没有注册全局 L'))
    })
    el.addEventListener('error', () => {
      el.remove()
      reject(new Error('Leaflet 脚本加载失败（CDN 不可达）'))
    })
    document.head.appendChild(el)
  })
}

async function ensureLeaflet() {
  // 已经解析过的 promise 会把「上一次」的 L 一起缓存下来。若那个引用已被外部清掉
  // （页面被别的脚本重置、或热更新替换了 window），拿到的是一个失效对象，
  // 后面 initMap 会以「地图容器尚未就绪」这种无意义文案失败。所以在出口再验一次活口。
  if (window.L) return window.L
  if (!leafletPromise) {
    leafletPromise = (async () => {
      await loadLeafletCss()
      await loadLeafletScript()
      if (!window.L) throw new Error('Leaflet 不可用')
      return window.L
    })().catch((err) => {
      leafletPromise = null // 允许重试
      throw err
    })
  }
  const L = await leafletPromise
  // 缓存里的 L 可能仍然可用，但 window 上的引用被别的东西清掉了（页面被重置、
  // 热更新替换了全局）。这时把它挂回去，而不是让 initMap 拿 undefined 去建图。
  if (!window.L && L) window.L = L
  if (window.L) return window.L
  leafletPromise = null
  throw new Error('Leaflet 未能就绪，请检查 CDN 是否可达')
}

/* ============================================================
   速度档
   ============================================================ */

function pickSpeed(id) {
  return SPEEDS.find((s) => s.id === id) || SPEEDS[1]
}

// 淡入取单帧停留的 1/4、封顶 260ms：快了会让每一帧都停在两层半透明的中间态，
// 慢了又会跟下一拍接上，两种都会糊。
function fadeMsOf(ms) {
  return Math.min(FADE_MAX_MS, Math.round(ms * FADE_RATIO))
}

/* ============================================================
   组件状态
   ============================================================ */

const mapEl = ref(null)
const layerEl = ref(null)
const controlsEl = ref(null)
const legendEl = ref(null)
const creditEl = ref(null)
const status = ref('idle') // idle | loading | ready | error
const errorMsg = ref('')
const frames = ref([]) // [{ time: UTC 秒, path }]
const idx = ref(0)
const playing = ref(false)

// 过渡与速度：都要驱动 UI，所以是 ref。frameMs/fadeMs 由速度档派生并把值本身存下来，
// 换档时正在跑的定时器要能立刻读到新值。
const fadeOn = ref(true) // true = 交叉淡入；false = 硬切（用于对照）
const speed = ref(DEFAULT_SPEED)
const frameMs = ref(pickSpeed(DEFAULT_SPEED).frameMs)
const fadeMs = ref(fadeMsOf(frameMs.value))

// 底图兜底状态
const baseHostIdx = ref(0)
const baseFailed = ref(false) // 两个入口都失败过 → 提示用户手动重试
const baseBusy = ref(false)
// 当前缩放已超出雷达数据的分辨率（z8 以上），回波只是被拉伸的色块
const overZoom = ref(false)
const currentZoom = ref(0)

// 非响应式的运行时句柄：都不需要触发重渲染，放 ref 里只会多一层 .value
let map = null
let insetsObserver = null
let baseLayer = null
let locationMarker = null
let frontLayer = null // 当前正在显示的那一层
let pendingLayer = null // 已加入地图、还没等到整层 load 的那一层
let swapToken = 0 // 递增令牌：让过期的 settle 回调自己作废
let firstFrameDone = false
let tileHost = TILE_HOST_FALLBACK
let alive = false // 异步回调的存活判断（关闭 / 重开都会翻转）
let generation = 0 // 防止重复 openRadar 把两个 map 建在同一节点上
let baseGuardTimer = null
let baseSwappedIn = false // 本次是否已经切到过备用入口

// 目前还挂在地图上的雨层（正常最多 2 个：淡入中的 + 淡出中的）。
// 用集合而不是数组，settle 里清理残留层时不必关心顺序。
const rainLayers = new Set()
// 正在渐隐的旧层：清理残留层时必须跳过它们，否则交叉淡入会退化成硬切
const fadingOut = new Set()

let playTimer = null
let guardTimer = null
let metaCtrl = null
const rafIds = new Set() // 所有在跑的分帧补间，关闭时统一 cancel
const fadeTimers = new Set() // 淡出兜底摘层的定时器，关闭时统一清理

/* ============================================================
   派生 UI 数据
   ============================================================ */

const ready = computed(() => status.value === 'ready' && frames.value.length > 0)
const maxIdx = computed(() => Math.max(0, frames.value.length - 1))
const currentFrame = computed(() => frames.value[idx.value] || null)
const isLatest = computed(() => idx.value === maxIdx.value && frames.value.length > 0)
const cityLabel = computed(() => props.cityName || '当前位置')

const timeText = computed(() => {
  const f = currentFrame.value
  if (!f) return '--:--'
  // time 是 UTC 秒；转本地时区交给 Date，不做手工 ±8h（跨时区 / 夏令时都会差一小时）
  const d = new Date(f.time * 1000)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
})

const relLabel = computed(() => {
  const f = currentFrame.value
  const last = frames.value[frames.value.length - 1]
  if (!f || !last) return ''
  // 用索引判定「最新」，不用时间比较：时钟漂移时时间比较会误判
  if (idx.value === maxIdx.value) return '最新'
  const minutes = Math.round(Math.max(0, last.time - f.time) / 60)
  return `${minutes} 分钟前`
})

const dateText = computed(() => {
  const f = currentFrame.value
  if (!f) return ''
  const d = new Date(f.time * 1000)
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`
})

const rangeText = computed(() =>
  frames.value.length ? `${dateText.value} · 共 ${frames.value.length} 帧` : '等待雷达数据',
)

const pct = computed(() => (maxIdx.value > 0 ? (idx.value / maxIdx.value) * 100 : 0))

/* ============================================================
   定时器 / 补间清理
   ============================================================ */

function clearPlayTimer() {
  if (playTimer) {
    clearTimeout(playTimer)
    playTimer = null
  }
}

function clearGuardTimer() {
  if (guardTimer) {
    clearTimeout(guardTimer)
    guardTimer = null
  }
}

function cancelRafs() {
  rafIds.forEach((id) => cancelAnimationFrame(id))
  rafIds.clear()
}

function cancelFadeTimers() {
  fadeTimers.forEach((id) => clearTimeout(id))
  fadeTimers.clear()
}

function clearAllTimers() {
  clearPlayTimer()
  clearGuardTimer()
  cancelFadeTimers()
  if (metaCtrl) {
    metaCtrl.abort() // 关闭时在途的元数据请求直接取消，回调里靠 alive 静默退出
    metaCtrl = null
  }
  cancelRafs()
}

function prefersReducedMotion() {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/* ============================================================
   地图
   ============================================================ */

function currentCenter() {
  const { lat, lon } = props
  const valid =
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180
  return valid ? [lat, lon] : FALLBACK_CENTER
}

// 有真实定位坐标才放 📍。退回中国全域时那是猜的，放个标记等于撒谎。
function hasLocation() {
  return currentCenter() !== FALLBACK_CENTER
}

/* 定位标记：一个带脉动光环的圆点。
   不用 L.marker 的默认图钉 —— 那张图标是蓝色水滴、和暗色底图撞色，
   而且是位图，高 DPI 下会糊。用 divIcon 画，颜色走 CSS 变量，缩放时不重排。 */
function addLocationMarker() {
  const L = window.L
  if (!L || !map || !hasLocation()) return

  const [lat, lon] = currentCenter()

  // 先摘掉上一次的：refreshBase() 会再调这个函数，
  // 不清旧标记就会叠出第二个脉动光环（肉眼看着像在地图上乱闪）
  clearLocationMarker()

  locationMarker = L.marker([lat, lon], {
    icon: L.divIcon({
      className: 'radar-loc',
      html: '<span class="radar-loc-dot"></span><span class="radar-loc-ring"></span>',
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    }),
    // 标记不该吃掉地图拖拽/双击缩放
    interactive: false,
    keyboard: false,
    zIndexOffset: 800,
  }).addTo(map)
}

function clearLocationMarker() {
  if (locationMarker && map && map.hasLayer(locationMarker)) {
    map.removeLayer(locationMarker)
  }
  locationMarker = null
}

/* 雷达瓦片原生只到 z7，再放大就是纯拉伸。
   超过阈值时把选择权交给用户：要么退回去看真实回波，要么继续看街道名。 */
function onZoomEnd() {
  if (!map) return
  const z = map.getZoom()
  currentZoom.value = z
  overZoom.value = z > RADAR_LEGIBLE_MAX
}

// 提示条上的「回到 N 级」：把视野退回雷达还能读出结构的层级，
// 同时保留当前中心（用户是想看这个地方的雨，不是想看别处）
function backToLegible() {
  if (!map) return
  map.setZoom(RADAR_COMFORT_ZOOM)
}

function initMap() {
  const L = window.L
  if (!L) throw new Error('Leaflet 未能加载，地图无法初始化')
  if (!mapEl.value) throw new Error('地图容器还没渲染出来，无法初始化雷达')

  map = L.map(mapEl.value, {
    center: currentCenter(),
    zoom: hasLocation() ? START_ZOOM : FALLBACK_ZOOM,
    minZoom: 3,
    maxZoom: MAX_ZOOM,
    zoomControl: false,
    // 版权行要横跨页面最底部居中，Leaflet 自带控件钉死在右下角容器里，
    // 挪出来要跟缩放按钮抢同一个 corner 容器。干脆关掉，模板自己渲染一行。
    attributionControl: false,
    worldCopyJump: true,
    // 手机上一个手指既能拖地图又能缩放；touch-action 已在 CSS 里关掉
    dragging: true,
    touchZoom: true,
  })

  mountBaseLayer(0)
  addLocationMarker()

  // 缩放按钮与图例同在右列：图例在下、按钮紧贴其上，宽度也一致，
  // 视觉上是一条竖线而不是两个各自漂着的控件。
  L.control.zoom({ position: 'bottomright' }).addTo(map)

  map.on('zoomend', onZoomEnd)
  onZoomEnd()

  // 覆盖层是 fixed inset:0，理论上尺寸已经对了；补一次 invalidateSize 防
  // 「首次打开容器宽度为 0」（父级还在做入场动画时）导致瓦片按 0×0 计算
  const id = requestAnimationFrame(() => {
    rafIds.delete(id)
    if (map) map.invalidateSize()
  })
  rafIds.add(id)
}

/* ============================================================
   底图：双入口兜底
   ============================================================ */

function buildBaseLayer(host) {
  const layer = window.L.tileLayer(host + ESRI_PATH, {
    maxZoom: MAX_ZOOM,
    // Esri 这套底图只出到 z16，再往上请求是 404（大片空白格子）。
    // 封顶后 Leaflet 会把 z16 的瓦片放大复用，高处仍然是一张连续的地图。
    maxNativeZoom: 16,
    className: 'radar-base-tiles',
  })
  layer._baseFails = 0
  layer._baseGotTile = false
  return layer
}

/**
 * 挂上一个入口的底图，并在失败时自动换下一个。
 *
 * 两个坑在这里踩过：
 * 1. 失败监听必须 addTo 之后「立刻」挂，不能等 promise resolve 再挂 —— 两个入口
 *    都不通时，所有 tileerror 会在 6 秒窗口内触发完，resolve 时已经错过，兜底永不启动。
 * 2. 超时也要 resolve（可能只是慢），但不能因此把失败提示收掉，所以用 _baseGotTile
 *    区分「真出图」和「超时」，只有前者才认为成功。
 */
function mountBaseLayer(hostIdx) {
  if (!map) return
  const host = ESRI_HOSTS[hostIdx]
  if (host === undefined) return

  baseHostIdx.value = hostIdx
  baseBusy.value = true

  const next = buildBaseLayer(host)
  const prev = baseLayer

  next.addTo(map)
  bindBaseFailover(next)
  baseLayer = next

  clearBaseGuard()
  baseGuardTimer = setTimeout(() => {
    baseGuardTimer = null
    if (next._baseGotTile) finish()
    else {
      // 超时没出图：可能是入口慢，也可能已经彻底坏了。
      // 还有下一个入口就换，没有就亮提示让用户手动刷新。
      if (!baseSwappedIn && hostIdx + 1 < ESRI_HOSTS.length) {
        baseSwappedIn = true
        mountBaseLayer(hostIdx + 1)
      } else {
        baseFailed.value = true
        baseBusy.value = false
      }
    }
  }, BASE_FIRST_MS)

  function finish() {
    baseFailed.value = false
    baseBusy.value = false
    if (prev && prev !== next && map && map.hasLayer(prev)) {
      try {
        map.removeLayer(prev)
      } catch {
        /* 容器已销毁 */
      }
    }
  }

  next.once('tileload', () => {
    next._baseGotTile = true
    if (next === baseLayer) finish()
  })
}

function bindBaseFailover(layer) {
  if (layer._baseBound) return
  layer._baseBound = true
  layer.on('tileerror', () => {
    // 只处理当前生效的那一层，旧层的迟到错误不该触发二次切换
    if (layer !== baseLayer || layer._baseTriggered) return
    layer._baseFails += 1
    if (layer._baseFails < BASEMAP_FAIL_THRESHOLD) return
    layer._baseTriggered = true

    if (!baseSwappedIn && baseHostIdx.value + 1 < ESRI_HOSTS.length) {
      baseSwappedIn = true
      mountBaseLayer(baseHostIdx.value + 1)
    } else {
      baseFailed.value = true
      baseBusy.value = false
    }
  })
}

function clearBaseGuard() {
  if (baseGuardTimer) {
    clearTimeout(baseGuardTimer)
    baseGuardTimer = null
  }
}

// 手动刷新：两个入口都试过失败后，用户点这里重走一遍首屏流程
function refreshBase() {
  if (!map) return
  baseSwappedIn = false
  baseFailed.value = false
  baseHostIdx.value = 0
  clearBaseGuard()
  mountBaseLayer(0)
  addLocationMarker()
}

function destroyMap() {
  clearGuardTimer()
  cancelFadeTimers()
  cancelRafs()

  if (map) {
    try {
      // remove() 会拆掉所有图层与事件；容器节点交给 Vue 卸载
      map.remove()
    } catch {
      // 容器可能已经被 Vue 摘掉，Leaflet 内部取 DOM 会抛，忽略即可
    }
    map = null
  }
  frontLayer = null
  pendingLayer = null
  rainLayers.clear()
  locationMarker = null // map.remove() 已经把它的 DOM 一起拆了，这里只清引用
}

/* ============================================================
   元数据
   ============================================================ */

function normalizeHost(json) {
  const host = json && json.host
  // 只用 http(s) 绝对地址，其它一律回退到官方瓦片域名
  if (typeof host === 'string' && /^https?:\/\//i.test(host)) return host.replace(/\/+$/, '')
  return TILE_HOST_FALLBACK
}

function normalizeFrames(json) {
  const past = json && json.radar && json.radar.past
  if (!Array.isArray(past) || past.length === 0) {
    throw new Error('接口里没有可用的雷达帧（radar.past 为空）')
  }

  return past
    .filter(
      (f) =>
        f &&
        typeof f.time === 'number' &&
        Number.isFinite(f.time) &&
        typeof f.path === 'string' &&
        // path 会拼进瓦片 URL，只放行路径字符，避免把奇怪协议带进 img.src
        /^\/[A-Za-z0-9/_-]*$/.test(f.path),
    )
    .map((f) => ({ time: f.time, path: f.path }))
    .sort((a, b) => a.time - b.time)
}

function describeError(err) {
  if (!err) return '未知错误'
  if (err.name === 'AbortError') {
    return `请求超时：${Math.round(META_TIMEOUT_MS / 1000)} 秒内没有响应，可能是网络无法访问 api.rainviewer.com`
  }
  // fetch 在网络层失败（离线 / DNS / 跨域）时抛的是 TypeError，文案要能指导用户
  if (err instanceof TypeError) {
    return '网络请求被拒绝：可能是离线、被防火墙拦截，或浏览器跨域策略挡住了 api.rainviewer.com'
  }
  return String(err.message || err)
}

async function loadMeta() {
  const gen = generation
  status.value = 'loading'
  errorMsg.value = ''
  playing.value = false
  clearPlayTimer()

  const ctrl = new AbortController()
  metaCtrl = ctrl
  const timer = setTimeout(() => ctrl.abort(), META_TIMEOUT_MS)

  try {
    const res = await fetch(META_URL, {
      cache: 'no-store',
      credentials: 'omit',
      signal: ctrl.signal,
    })
    if (!res.ok) throw new Error(`雷达数据接口返回 HTTP ${res.status}`)

    const json = await res.json()
    if (!alive || gen !== generation) return // 等待期间被关闭或重开了

    const list = normalizeFrames(json)
    tileHost = normalizeHost(json)

    frames.value = list
    // 首次进入停在最新帧
    idx.value = list.length - 1
    // 注意：这里不置 ready。等首帧瓦片真正上屏（见 settle 里的 firstFrameDone）
    // 再撤遮罩 —— 否则遮罩一消失屏幕还是空的暗底图，用户以为加载完了却是黑屏。
    // 同理，播放态也不能在这里置 true：reduce 动效的用户不该被自动播放，
    // 而且首帧都没上屏就开始计时换帧，等于在空白上先跑了一拍。
    playing.value = !prefersReducedMotion() && list.length > 1
    applyFrame()
  } catch (err) {
    if (!alive || gen !== generation) return
    status.value = 'error'
    errorMsg.value = describeError(err)
    playing.value = false
    clearPlayTimer()
  } finally {
    clearTimeout(timer)
    if (metaCtrl === ctrl) metaCtrl = null
  }
}

/* ============================================================
   雨层：双图层交叉淡入
   ============================================================ */

function tileTemplate(frame) {
  // {host}{path}/512/{z}/{x}/{y}/{color}/{smooth}_{snow}.png
  // smooth=1 抗锯齿开，snow=1 雪区用另一套配色（否则下雪的地方是空白）
  return `${tileHost}${frame.path}/512/{z}/{x}/{y}/${RADAR_COLOR}/1_1.png`
}

function createRadarLayer(frame) {
  const layer = window.L.tileLayer(tileTemplate(frame), {
    tileSize: 512,
    zoomOffset: -1,
    minNativeZoom: 0,
    maxNativeZoom: MAX_NATIVE_ZOOM,
    maxZoom: MAX_ZOOM,
    opacity: 0, // 先完全透明：新层铺满之前旧层一直可见
    zIndex: 6,
    className: 'radar-rain-tiles',
    attribution: '', // 署名统一由底图那层提供，避免每一帧堆一条
    updateWhenIdle: false,
    keepBuffer: 1,
  })
  return layer
}

/* ============================================================
   预热：把还没播到的帧提前塞进浏览器缓存
   ============================================================ */

/* 为什么不是「给每帧建一个 L.tileLayer 让它自己加载」：
   13 个瓦片图层同时挂在地图上，每层都要 SVG/IMG 容器、都要参与地图事件，
   内存和重排代价都不小，而这些层用户根本还没看到。
   这里只做一件事 —— 按当前视野算出 URL，用 Image() 拉一遍。
   浏览器 HTTP 缓存命中后，之后真正换帧时 Leaflet 建的 <img> 会直接拿缓存，
   请求数几乎为零。z≤6 的 cache-control 是 48 小时，所以这一圈的成本只付一次。 */

// 算出「当前视野 + 当前地图层级」在 URL 空间里覆盖哪些 z/x/y。
// 注意 URL 层级比地图层级小 1（tileSize 512 + zoomOffset -1），
// 这里必须和 createRadarLayer 用的是同一套换算，否则会预热出一批用不上的瓦片。
function tilesInView() {
  if (!map) return []

  const bounds = map.getBounds()
  const urlZoom = Math.max(0, Math.min(MAX_NATIVE_ZOOM - 1, map.getZoom() - 1))
  const n = Math.pow(2, urlZoom)

  // 经纬度 → URL 空间的瓦片坐标（Web Mercator）
  const toTile = (lat, lng) => {
    const rad = (lat * Math.PI) / 180
    const x = ((lng + 180) / 360) * n
    const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n
    return { x, y }
  }

  const nw = toTile(bounds.getNorth(), bounds.getWest())
  const se = toTile(bounds.getSouth(), bounds.getEast())

  // 多取一圈：地图边界处的瓦片常常只露出一个角，少算这一圈会在换帧时补请求
  const x0 = Math.floor(Math.min(nw.x, se.x)) - 1
  const x1 = Math.floor(Math.max(nw.x, se.x)) + 1
  const y0 = Math.floor(Math.min(nw.y, se.y)) - 1
  const y1 = Math.floor(Math.max(nw.y, se.y)) + 1

  const out = []
  // 视野跨过 180° 经线时 x 会绕，取模之后可能产生重复，用 Set 去重
  const seen = new Set()
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const tx = ((x % n) + n) % n
      if (y < 0 || y >= n) continue
      const key = `${urlZoom}/${tx}/${y}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ z: urlZoom, x: tx, y })
    }
  }

  // 视野越大瓦片越多；给个上限，避免用户缩到全国时一次排出几百个请求
  const max = 60
  return out.length > max ? out.slice(0, max) : out
}

function tileUrlOf(frame, t) {
  return `${tileHost}${frame.path}/512/${t.z}/${t.x}/${t.y}/${RADAR_COLOR}/1_1.png`
}

// 预热状态（驱动 UI 上的一行小字，让用户知道「转圈不是卡住」）
const warmTotal = ref(0)
const warmDone = ref(0)
const warming = computed(() => warmTotal.value > 0 && warmDone.value < warmTotal.value)

let warmToken = 0

function prewarmFrames() {
  if (!alive || !map || frames.value.length < 2) return

  const token = ++warmToken
  // 只排接下来 PREWARM_AHEAD 帧；最新帧已经作为首帧加载过，从下一帧起算
  const list = frames.value
  const start = idx.value
  const order = []
  for (let i = 1; i <= PREWARM_AHEAD && i < list.length; i++) {
    order.push(list[(start + i) % list.length])
  }

  const tiles = new Map() // frame → tile 列表，按帧顺序展开，保证「下一帧」最先到
  for (const frame of order) tiles.set(frame, tilesInView())

  const jobs = []
  for (const frame of order) {
    for (const t of tiles.get(frame)) jobs.push({ frame, t })
  }

  warmTotal.value = jobs.length
  warmDone.value = 0

  let cursor = 0
  // 预热的失败一律静默：它只是加速，不该因为某块瓦片 404 就影响回放
  async function worker() {
    while (cursor < jobs.length) {
      if (!alive || token !== warmToken) return
      // 换帧正在进行时先让路：此刻用户盯着的就是这一帧，
      // 预热去抢连接会让它更晚到（实测第一圈因此从 14 秒拖到 20 秒）。
      // 等这一帧落地再继续，带宽始终优先给「马上要看的内容」。
      if (pendingLayer) {
        await new Promise((r) => setTimeout(r, 120))
        continue
      }
      const job = jobs[cursor++]
      await loadOne(job)
      if (!alive || token !== warmToken) return
      warmDone.value++
    }
  }

  function loadOne({ frame, t }) {
    return new Promise((resolve) => {
      const img = new Image()
      img.decoding = 'async'
      img.onload = () => resolve()
      img.onerror = () => resolve()
      img.src = tileUrlOf(frame, t)
      // 不挂到 DOM 上：Image() 的加载与是否插入文档无关，
      // 一旦挂进文档反而会被 Leaflet 的清理逻辑扫到
    })
  }

  for (let i = 0; i < PREWARM_CONCURRENCY; i++) void worker()
}

function stopPrewarm() {
  warmToken++
  warmTotal.value = 0
  warmDone.value = 0
}

function hardRemove(layer) {
  if (!layer) return
  // 已经从地图上摘掉的层再 removeLayer 一次，Leaflet 会重新走一遍移除流程
  // 并去碰已经销毁的容器，所以先判存在
  if (map && map.hasLayer(layer)) {
    try {
      map.removeLayer(layer)
    } catch {
      /* 容器已被销毁 */
    }
  }
  rainLayers.delete(layer)
  if (frontLayer === layer) frontLayer = null
  if (pendingLayer === layer) pendingLayer = null
}

/**
 * 补偿式交叉淡入。
 *
 * 普通交叉淡入（新层 0→T 的同时旧层 T→0）在过渡中点会让画面「暗一下」：
 * 两层各 0.4 不透明度叠加的合成浓度只有 1-(1-0.4)(1-0.4)=0.64，比稳定态 0.8 低 20%，
 * 每帧都这么抖一次，观感就是闪烁 —— 实测确认过这是闪烁的真正成因，不是错觉。
 *
 * 这里让两层的透明度按下面的曲线走：
 *   a_new(w) = 1-(1-T)^w
 *   a_old(w) = 1-(1-T)^(1-w)
 * 于是合成浓度 = 1-(1-T)^w·(1-T)^(1-w) = 1-(1-T) = T，与 w 无关，恒定等于目标值。
 * 内容仍在按权重迁移（w=0 全是旧帧，w=1 全是新帧），但亮度不抖。
 */
function crossFadeCompensated(newLayer, oldLayer, target, ms, onDone) {
  if (!newLayer) return
  const T = Math.min(0.999, Math.max(0.001, target))

  if (!oldLayer || oldLayer === newLayer) {
    fadeLayer(newLayer, 0, T, ms, onDone)
    return
  }

  newLayer.setOpacity(0)
  oldLayer.setOpacity(T)

  if (ms <= 0 || prefersReducedMotion()) {
    newLayer.setOpacity(T)
    oldLayer.setOpacity(0)
    if (onDone) onDone()
    return
  }

  const start = performance.now()
  const keep = 1 - T
  let rafId = 0

  const tick = (now) => {
    rafIds.delete(rafId)
    if (!map || !map.hasLayer(newLayer)) return
    const w = Math.min(1, (now - start) / ms)
    newLayer.setOpacity(1 - Math.pow(keep, w))
    if (map.hasLayer(oldLayer)) oldLayer.setOpacity(1 - Math.pow(keep, 1 - w))
    if (w < 1) {
      rafId = requestAnimationFrame(tick)
      rafIds.add(rafId)
    } else {
      newLayer.setOpacity(T)
      if (map.hasLayer(oldLayer)) oldLayer.setOpacity(0)
      if (onDone) onDone()
    }
  }

  rafId = requestAnimationFrame(tick)
  rafIds.add(rafId)
}

/**
 * 用 rAF 直接补间图层的 opacity，而不是 CSS transition：
 * 回放会连续换帧，后台标签页里 CSS 过渡会被节流，补间时长就不可控了；
 * rAF 还能在中途 map 被销毁时立刻退出，不会往已移除的节点写样式。
 */
function fadeLayer(layer, from, to, ms, onDone) {
  if (!layer) return
  if (ms <= 0 || prefersReducedMotion()) {
    if (map && map.hasLayer(layer)) layer.setOpacity(to)
    if (onDone) onDone()
    return
  }

  layer.setOpacity(from)
  const start = performance.now()
  let rafId = 0

  const tick = (now) => {
    rafIds.delete(rafId)
    if (!map || !map.hasLayer(layer)) return // 中途被移除就停止补间
    const p = Math.min(1, (now - start) / ms)
    layer.setOpacity(from + (to - from) * p)
    if (p < 1) {
      rafId = requestAnimationFrame(tick)
      rafIds.add(rafId)
    } else if (onDone) {
      onDone()
    }
  }

  rafId = requestAnimationFrame(tick)
  rafIds.add(rafId)
}

/**
 * 显示某一帧。
 *
 * 为什么不是 setInterval 每 520ms 换帧：换帧意味着新建一层瓦片、把旧层删掉，
 * 固定节拍会在瓦片还没到时就把上一拍的请求全部中止 —— 这台机器单块瓦片 1.3–12 秒，
 * 结果就是每一拍都空转，屏幕上永远只有底图。
 * 所以：新层 opacity:0 加入地图 → 监听整层 'load' → 铺满后才交叉淡入 → 淡入结束才排下一拍。
 * 等待期间旧帧一直亮着，观感是「回放变慢」，绝不会黑屏。
 */
function showFrame(frame) {
  if (!map || !frame) return

  const old = frontLayer
  const stale = pendingLayer

  clearGuardTimer()
  // 上一次还没铺满就被新帧顶掉的那层永远等不到接管，直接清掉。
  // 它此时是 opacity:0 且从没亮过，摘掉不会造成任何可见变化。
  if (stale && stale !== old) hardRemove(stale)
  pendingLayer = null

  const layer = createRadarLayer(frame)
  pendingLayer = layer

  const token = ++swapToken
  let settled = false

  function settle() {
    if (settled || token !== swapToken) return
    settled = true
    clearGuardTimer()

    pendingLayer = null
    frontLayer = layer
    firstFrameDone = true

    // 首帧瓦片到齐、画面里已经有回波，这时才撤加载遮罩
    if (status.value === 'loading') {
      status.value = 'ready'
      // 遮罩一撤就轮到预热：用户此刻正在看第一帧，
      // 正好用这段「看图的时间」把后面 12 帧悄悄拉进缓存。
      // 必须是首帧之后 —— 提前预热会和首帧抢同一批连接，把首屏拖得更慢。
      prewarmFrames()
    }

    // 换帧：渐变走补偿式交叉淡入（合成浓度恒定，不闪），硬切直接用目标值。
    // 旧的从它「此刻真实的透明度」开始算：连点滑块时它可能正停在 0.4 这种中间值上，
    // 从固定值起步会看到亮度突跳。
    const ms = fadeOn.value ? fadeMs.value : 0
    if (old && old !== layer) {
      fadingOut.add(old)
      crossFadeCompensated(layer, old, RADAR_OPACITY, ms, () => {
        fadingOut.delete(old)
        hardRemove(old)
      })
      // 补间若因地图交互或标签页挂起被打断，也保证最终被摘掉，不留在 DOM 里
      const timer = setTimeout(
        () => {
          fadeTimers.delete(timer)
          fadingOut.delete(old)
          hardRemove(old)
        },
        ms + 160,
      )
      fadeTimers.add(timer)
    } else {
      crossFadeCompensated(layer, null, RADAR_OPACITY, ms)
    }

    // 极端情况（快速拖滑块）下不让残留层堆在 DOM 里。
    // 判据是「既不是当前层、也不是正在渐隐的那层」—— 少了后一条会把刚开始
    // 渐隐的旧层立刻摘掉，交叉淡入就退化成硬切。
    for (const l of Array.from(rainLayers)) {
      if (l === frontLayer || l === pendingLayer || fadingOut.has(l)) continue
      hardRemove(l)
    }

    // 这一帧已经铺在屏幕上了，此刻才开始为下一帧计时
    armNextFrame()
  }

  // 先挂监听再 addTo：瓦片全部命中缓存时 load 可能来得极早，晚挂一拍就会丢
  layer.once('load', settle)
  layer.addTo(map)
  rainLayers.add(layer)

  // 兜底：整层迟迟不 load。首帧没有旧层垫着，所以给更早的期限
  guardTimer = setTimeout(
    () => {
      guardTimer = null
      settle()
    },
    firstFrameDone ? LOAD_GUARD_MS : FIRST_GUARD_MS,
  )
}

/* ============================================================
   播放控制
   ============================================================ */

function applyFrame() {
  const frame = frames.value[idx.value]
  if (!frame) return
  showFrame(frame)
}

function armNextFrame() {
  clearPlayTimer()
  if (!playing.value) return
  // 还有帧在加载：交给它的 settle() 去排下一拍，现在排只会把它顶掉
  if (pendingLayer) return

  playTimer = setTimeout(() => {
    playTimer = null
    if (!playing.value) return
    const n = frames.value.length
    if (!n) return
    idx.value = (idx.value + 1) % n // 首尾闭环
    applyFrame()
  }, frameMs.value)
}

// 换速度档：同时改单帧停留与淡入时长，正在播放时立刻按新节奏重排下一拍
function setSpeed(id) {
  const s = pickSpeed(id)
  speed.value = s.id
  frameMs.value = s.frameMs
  fadeMs.value = fadeMsOf(s.frameMs)
  if (playing.value) armNextFrame()
}

// 渐变 / 硬切切换。关掉时把当前层拉回目标不透明度，
// 否则会停在过渡中间那个半透明状态上。
function toggleFade() {
  fadeOn.value = !fadeOn.value
  if (!fadeOn.value && frontLayer) frontLayer.setOpacity(RADAR_OPACITY)
}

function play() {
  if (!ready.value || frames.value.length < 2) return
  playing.value = true
  armNextFrame()
}

function pause() {
  playing.value = false
  clearPlayTimer()
}

function togglePlay() {
  if (!ready.value) return
  if (playing.value) pause()
  else play()
}

function setIndex(next) {
  const n = frames.value.length
  if (!n) return
  const target = Math.max(0, Math.min(n - 1, Math.round(Number(next) || 0)))
  if (target === idx.value) return
  idx.value = target
  applyFrame()
}

function step(delta) {
  const n = frames.value.length
  if (!n) return
  pause() // 手动逐帧时停掉定时器，否则下一拍就把用户的选择覆盖了
  idx.value = (idx.value + delta + n) % n
  applyFrame()
}

function onSlide(event) {
  pause()
  setIndex(Number(event.target.value))
}

/* ============================================================
   生命周期（打开 / 关闭 / 重开）
   ============================================================ */

function teardown() {
  if (insetsObserver) {
    insetsObserver.disconnect()
    insetsObserver = null
  }
  alive = false
  swapToken++ // 让所有在途的 settle 回调作废
  stopPrewarm() // 预热同样要停：旧地图的瓦片请求不该跟着用户去看别的页面
  clearAllTimers()
  playing.value = false
  destroyMap()
  frames.value = []
  idx.value = 0
  firstFrameDone = false
  status.value = 'idle'
  errorMsg.value = ''
  historyPushed = false

  // 焦点还给打开它的那个元素。没记录（例如程序化打开）就直接放弃，
  // 强行 focus 到 body 反而会把用户带偏
  const prev = lastFocus
  lastFocus = null
  if (prev && typeof prev.focus === 'function' && document.contains(prev)) {
    prev.focus({ preventScroll: true })
  }
}

/* 控制条的高度会随窗口宽度变化：窄屏下 .radar-row-sub 会折成两行，
   整条从 114px 长到 148px。图例和 Leaflet 控件如果继续用写死的 bottom，
   就会被压在控制条下面。所以实测控制条顶边到容器底部的距离，写进 CSS 变量，
   由 CSS 用 calc 跟随，任何宽度都不用再改常量。 */
function syncBottomInsets() {
  const layer = layerEl.value
  const ctrl = controlsEl.value
  if (!layer || !ctrl) return
  const top = Math.max(0, Math.round(layer.getBoundingClientRect().bottom - ctrl.getBoundingClientRect().top))
  layer.style.setProperty('--rr-ctrl-top', top + 'px')

  // 图例是竖的、高度随字号和内容变；缩放按钮要贴在它正上方，就得知道它有多高。
  // 顺手把它的宽度也量出来，让按钮同宽 —— 两件控件的宽度写两遍迟早会对不上。
  const legend = legendEl.value
  if (legend) {
    const box = legend.getBoundingClientRect()
    layer.style.setProperty('--rr-legend-h', Math.round(box.height) + 'px')
    layer.style.setProperty('--rr-legend-w', Math.round(box.width) + 'px')
  }

  // 版权行钉在页面最底部，控制条必须让开它，否则两行字直接叠在一起。
  // 高度窄屏会从一行变两行，所以同样实测而不是写死。
  const credit = creditEl.value
  if (credit) {
    layer.style.setProperty('--rr-credit-h', Math.round(credit.getBoundingClientRect().height) + 'px')
  }
}

function watchBottomInsets() {
  if (insetsObserver) insetsObserver.disconnect()
  if (!controlsEl.value || typeof ResizeObserver === 'undefined') return
  insetsObserver = new ResizeObserver(syncBottomInsets)
  insetsObserver.observe(controlsEl.value)
  if (legendEl.value) insetsObserver.observe(legendEl.value)
  if (creditEl.value) insetsObserver.observe(creditEl.value)
  syncBottomInsets()
}

async function openRadar() {
  const gen = ++generation
  alive = true

  // 记下是谁打开的，关闭后把焦点还回去 —— 键盘用户否则会掉到 body 上，
  // 接着按 Tab 就从页面顶部重新数起，等于丢失位置
  lastFocus = document.activeElement

  if (!historyPushed) {
    history.pushState({ radar: 1 }, '')
    historyPushed = true
  }

  // 每次打开都从干净状态重建：Leaflet 实例、图层、定时器一律不跨次复用
  clearAllTimers()
  destroyMap()
  frames.value = []
  idx.value = 0
  playing.value = false
  firstFrameDone = false
  errorMsg.value = ''
  status.value = 'loading'

  await nextTick() // v-if 刚把地图容器渲染出来
  if (!alive || gen !== generation || !mapEl.value) return

  try {
    await ensureLeaflet()
  } catch (err) {
    if (!alive || gen !== generation) return
    status.value = 'error'
    errorMsg.value = describeError(err)
    return
  }

  if (!alive || gen !== generation) return

  try {
    initMap()
  } catch (err) {
    if (!alive || gen !== generation) return
    status.value = 'error'
    errorMsg.value = describeError(err)
    return
  }

  await loadMeta()
  watchBottomInsets()

  // 焦点移进层内：不这么做，键盘用户的 Tab 起点还在背后的页面上
  const firstBtn = layerEl.value && layerEl.value.querySelector(FOCUSABLE)
  if (firstBtn) firstBtn.focus({ preventScroll: true })
}

/* 返回键关闭覆盖层。
   全屏层打开时不产生历史条目，移动端浏览器的「返回」就会直接离开站点 ——
   而手机没有 Esc 键，用户唯一的退出手势在这里失效。
   打开时压一条历史，返回时把它消费掉；程序内关闭则主动 back() 保持栈平衡，
   否则用户之后按返回会遇到一条空条目，看起来像「按了没反应」。 */
let historyPushed = false
let lastFocus = null

function onPopState() {
  if (!props.open) return
  if (!historyPushed) return
  historyPushed = false
  emit('close')
}

function close() {
  if (historyPushed) {
    historyPushed = false
    history.back()
  }
  emit('close')
}

function retry() {
  // Leaflet 没起来就连地图一起重建；只是元数据失败则复用现有地图，避免闪一下黑屏
  if (map && window.L) loadMeta()
  else openRadar()
}

/* 焦点陷阱。aria-modal="true" 只是声明，浏览器不会真的挡住背景元素 ——
   不自己实现的话，键盘用户按几次 Tab 就走到背后的天气页上，
   屏幕上还是雷达层，焦点却在看不见的地方。 */
const FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])'

function trapTab(event) {
  const root = layerEl.value
  if (!root) return

  const list = Array.from(root.querySelectorAll(FOCUSABLE)).filter(
    (el) => el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement,
  )
  if (!list.length) return

  const first = list[0]
  const last = list[list.length - 1]
  const active = document.activeElement

  // 焦点已经跑到层外（例如刚打开还没设过焦点）就直接收回第一个
  if (!root.contains(active)) {
    event.preventDefault()
    first.focus({ preventScroll: true })
    return
  }

  if (event.shiftKey && active === first) {
    event.preventDefault()
    last.focus({ preventScroll: true })
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus({ preventScroll: true })
  }
}

function onKeydown(event) {
  if (!props.open) return

  if (event.key === 'Tab') {
    trapTab(event)
    return
  }

  // 焦点在输入控件上时不抢键：滑块上的方向键要留给原生行为（调帧），
  // 但 Esc 仍然关窗，这是用户对全屏层最硬的预期
  const tag = event.target && event.target.tagName ? event.target.tagName.toLowerCase() : ''
  const typing = tag === 'input' || tag === 'textarea' || tag === 'select'

  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }

  if (typing) return
  if (event.metaKey || event.ctrlKey || event.altKey) return

  if (event.code === 'Space' || event.key === ' ') {
    event.preventDefault()
    togglePlay()
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault()
    step(-1)
  } else if (event.key === 'ArrowRight') {
    event.preventDefault()
    step(1)
  }
}

// 默认的 pre flush：关闭时 DOM 还在，map.remove() 能正常取到容器；
// 打开时组件还没重渲染，所以在 openRadar 里 await nextTick() 等容器出现。
watch(
  () => props.open,
  (open) => {
    if (open) openRadar()
    else teardown()
  },
)

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('popstate', onPopState)
  // 父组件如果用 v-if 直接挂载成 open=true，watch 不会补发，这里兜一次
  if (props.open) openRadar()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('popstate', onPopState)
  document.body.style.overflow = ''
  teardown() // 卸载路径也不能留下 map 与定时器
})

// 覆盖层打开时锁住背后页面滚动，否则手机上单指拖地图会连带整页滚
watch(
  () => props.open,
  (open) => {
    document.body.style.overflow = open ? 'hidden' : ''
  },
  { flush: 'sync' },
)
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      ref="layerEl"
      class="radar-layer"
      role="dialog"
      aria-modal="true"
      aria-label="降水雷达回放"
    >
      <div ref="mapEl" class="radar-map" :aria-busy="status === 'loading'"></div>

      <header class="radar-top">
        <div class="radar-head">
          <span class="radar-dot" aria-hidden="true"></span>
          <h2 class="radar-title">降水预报</h2>
          <span class="radar-sep" aria-hidden="true"></span>
          <span class="radar-city">{{ cityLabel }}</span>
        </div>

        <button class="radar-icon-btn" type="button" aria-label="关闭雷达回放" @click="close">
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>

      <!-- 版权行：桌面用完整署名；窄屏换紧凑版 —— 完整版 88 个字符在 390px 里
           即便缩到 8px 也接近满宽，最容易折成两行顶到控制条。紧凑版仍然点到了
           三方（Esri / OpenStreetMap / RainViewer），完整署名留在 title 里。 -->
      <div
        ref="creditEl"
        class="radar-credit"
        :title="CREDIT_FULL"
        :aria-label="CREDIT_FULL"
      >
        <span class="credit-full">
          Tiles © <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a>
          — Esri, HERE, Garmin, © OpenStreetMap contributors
          <span class="credit-sep">|</span>
          Weather data by
          <a href="https://www.rainviewer.com/api.html" target="_blank" rel="noopener">RainViewer</a>
        </span>
        <span class="credit-compact">
          Tiles © <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a>
          · © OpenStreetMap
          <span class="credit-sep">|</span>
          <a href="https://www.rainviewer.com/api.html" target="_blank" rel="noopener">RainViewer</a>
        </span>
      </div>

      <aside ref="legendEl" class="radar-legend" role="img" aria-label="降水强度图例，色条自下而上由弱到强">
        <div class="legend-title"><span>降水</span><span>强度</span></div>
        <div class="legend-body">
          <div class="legend-bar"></div>
        </div>
      </aside>

      <div v-if="status === 'loading'" class="radar-status" role="status">
        <div class="radar-spinner"></div>
        <p class="radar-status-text">正在获取雷达回放帧…</p>
      </div>

      <div v-else-if="status === 'error'" class="radar-status" role="alert">
        <div class="radar-error-icon" aria-hidden="true">!</div>
        <p class="radar-status-text">雷达数据加载失败</p>
        <p class="radar-error-desc">{{ errorMsg }}</p>
        <button class="radar-retry" type="button" @click="retry">重试</button>
      </div>

      <footer ref="controlsEl" class="radar-controls">
        <div class="radar-row-main">
          <button
            class="radar-play"
            type="button"
            :disabled="!ready"
            :aria-label="playing ? '暂停回放' : '播放回放'"
            @click="togglePlay"
          >
            <svg
              v-if="playing"
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
            </svg>
            <svg
              v-else
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M8 5v14l11-7z" />
            </svg>
          </button>

          <div class="radar-track">
            <div class="radar-time-row">
              <span class="radar-clock">{{ timeText }}</span>
              <span class="radar-tag" :class="{ latest: isLatest }">{{ relLabel }}</span>
              <!-- 预热进度。故意不叫「加载」：画面已经能用，这只是把后面 12 帧
                   提前拉进缓存，让换帧不再等 3–7 秒。没有它，用户会以为卡住了。 -->
              <span v-if="warming" class="radar-warm" role="status">
                预载 {{ warmDone }}/{{ warmTotal }}
              </span>
              <span class="radar-meta">{{ rangeText }}</span>
            </div>

            <input
              class="radar-slider"
              type="range"
              min="0"
              :max="maxIdx"
              step="1"
              :value="idx"
              :disabled="!ready"
              :style="{ '--pct': pct + '%' }"
              aria-label="雷达帧时间轴"
              @input="onSlide"
            />
          </div>

          <button class="radar-close" type="button" @click="close">关闭</button>
        </div>

        <div class="radar-row-sub">
          <div class="radar-group">
            <span class="radar-group-label">过渡</span>
            <button
              class="radar-toggle"
              :class="{ on: fadeOn }"
              type="button"
              :aria-pressed="fadeOn ? 'true' : 'false'"
              title="开启 = 交叉淡入；关闭 = 直接硬切，用于对比"
              @click="toggleFade"
            >
              {{ fadeOn ? '渐变' : '硬切' }}
            </button>
          </div>

          <div class="radar-group">
            <span class="radar-group-label">速度</span>
            <div class="radar-seg" role="group" aria-label="回放速度">
              <button
                v-for="s in SPEEDS"
                :key="s.id"
                class="radar-seg-btn"
                :class="{ on: speed === s.id }"
                type="button"
                :title="`每帧 ${s.frameMs}ms`"
                @click="setSpeed(s.id)"
              >
                {{ s.name }}
              </button>
            </div>
          </div>

          <button
            class="radar-toggle"
            type="button"
            :class="{ 'is-busy': baseBusy }"
            :disabled="baseBusy"
            title="重新加载底图（两个接入点都失败时用这个）"
            @click="refreshBase"
          >
            刷新底图
          </button>
        </div>
      </footer>

      <div v-if="baseFailed" class="radar-base-hint" role="status">
        <span>底图加载失败，两个接入点都没有响应</span>
        <button type="button" class="radar-base-retry" @click="refreshBase">重新加载底图</button>
      </div>

      <!-- 放大超出雷达分辨率时如实说明：色块不是更精细的雨，是被拉伸的同一团雨 -->
      <div v-if="overZoom && !baseFailed" class="radar-base-hint radar-zoom-hint" role="status">
        <span>
          已放大到 {{ Math.round(currentZoom) }} 级，超出雷达分辨率（最高 {{ RADAR_LEGIBLE_MAX }} 级），回波只是被拉伸
        </span>
        <button type="button" class="radar-base-retry" @click="backToLegible">
          回到 {{ RADAR_COMFORT_ZOOM }} 级
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 颜色自持：这个覆盖层刻意不依赖 weather.css 的主题变量，
   雷达图例与瓦片像素是一套固定配色，跟随主题改反而会让图例失真。 */
.radar-layer {
  --rr-bg: #060d16;
  --rr-map-bg: #0a1420;
  --rr-glass: rgba(13, 27, 42, 0.72);
  --rr-stroke: rgba(255, 255, 255, 0.1);
  --rr-accent: #6db3f2;
  --rr-accent-bright: #7fd4f5;
  --rr-text-0: #fff;
  --rr-text-2: rgba(255, 255, 255, 0.9);
  --rr-text-4: rgba(255, 255, 255, 0.72);
  --rr-text-6: rgba(255, 255, 255, 0.52);
  --rr-blur: blur(22px) saturate(150%);
  --rr-shadow: 0 12px 48px rgba(0, 0, 0, 0.55);

  position: fixed;
  inset: 0;
  z-index: 1000;
  background: var(--rr-bg);
  color: var(--rr-text-0);
  overflow: hidden;
  overscroll-behavior: none;
  -webkit-tap-highlight-color: transparent;
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  -webkit-font-smoothing: antialiased;
}

/* ---------- 地图 ---------- */
.radar-map {
  position: absolute;
  inset: 0;
  /* z-index:0 让地图自成一个层叠上下文：Leaflet 内部的 pane 用到 z-index 400+，
     不给地图单独一层，它们就会盖到控制条和图例上面去 */
  z-index: 0;
  background: var(--rr-map-bg);
  /* 手势全交给 Leaflet，否则单指拖地图会变成滚动整页 */
  touch-action: none;
}

/* Leaflet 会把 .leaflet-container 加在容器节点（即 .radar-map 本身）上，
   所以这一条必须写成「自身」而不是后代选择器 */
.radar-map.leaflet-container {
  background: var(--rr-map-bg);
  font-family: inherit;
  outline: none;
}

/* 只压暗底图，雨层保持原亮度，对比才出得来 */
.radar-map :deep(.radar-base-tiles) {
  filter: brightness(0.82) contrast(1.05);
}

/* 淡入淡出由 rAF 直接写 style.opacity，这里只做合成层提示 */
.radar-map :deep(.leaflet-tile-pane > .leaflet-layer) {
  will-change: opacity;
}

/* 版权行：横跨页面最底部居中。
   它不在 Leaflet 的控件容器里（那里只有四个角），所以是模板里独立的一行、
   用绝对定位钉在覆盖层底部。文字不换行，窄屏就缩小字号 ——
   换行会顶到控制条上，反而更难看。 */
.radar-credit {
  position: absolute;
  left: 50%;
  bottom: 4px;
  transform: translateX(-50%);
  z-index: 7;
  width: max-content;
  max-width: calc(100% - 16px);
  text-align: center;
  font-size: 10px;
  line-height: 1.4;
  /* 强制单行：一旦折行就会顶到控制条上（两者都钉在页面底部）。
     窄屏换更短的紧凑署名，而不是靠折行硬塞。 */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--rr-text-6);
  pointer-events: none;
}

/* 桌面显示完整署名，窄屏换紧凑版 */
.credit-compact {
  display: none;
}

.radar-credit a {
  color: var(--rr-text-4);
  text-decoration: none;
  pointer-events: auto;
}

.radar-credit a:hover {
  color: var(--rr-accent-bright);
}

.credit-sep {
  margin: 0 2px;
  opacity: 0.6;
}

/* 缩放按钮贴在竖向图例正上方：底边 = 图例顶边 + 6px 间距，
   宽度与图例同源（--rr-legend-w）。两个值都由 syncBottomInsets() 实测写入，
   任何视口宽度下都自动对齐，不用为断点再写一遍。 */
.radar-map :deep(.leaflet-control-zoom) {
  border: none !important;
  box-shadow: none !important;
  margin: 0 !important;
  width: var(--rr-legend-w, 60px) !important;
}

.radar-map :deep(.leaflet-bottom.leaflet-right) {
  /* 图例占住右下角，缩放控件排在它上面 */
  right: 16px;
  bottom: calc(var(--rr-ctrl-top, 148px) + 8px + var(--rr-legend-h, 120px) + 6px);
}

.radar-map :deep(.leaflet-control-zoom a) {
  background: var(--rr-glass) !important;
  color: var(--rr-text-2) !important;
  border: 1px solid var(--rr-stroke) !important;
  width: 30px !important;
  height: 30px !important;
  line-height: 28px !important;
  font-size: 16px !important;
  backdrop-filter: var(--rr-blur);
  -webkit-backdrop-filter: var(--rr-blur);
  transition:
    background 0.16s ease,
    color 0.16s ease;
}

.radar-map :deep(.leaflet-control-zoom a:first-child) {
  border-radius: 10px 10px 0 0 !important;
}

.radar-map :deep(.leaflet-control-zoom a:last-child) {
  border-radius: 0 0 10px 10px !important;
  border-top: none !important;
}

.radar-map :deep(.leaflet-control-zoom a:hover) {
  background: rgba(109, 179, 242, 0.24) !important;
  color: #fff !important;
}

/* ---------- 顶部标题 ---------- */
.radar-top {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px 32px;
  background: linear-gradient(
    to bottom,
    rgba(6, 13, 22, 0.92) 0%,
    rgba(6, 13, 22, 0.5) 55%,
    rgba(6, 13, 22, 0) 100%
  );
  /* 整条拖不得、点得着：只有子元素接收指针，其余交给地图 */
  pointer-events: none;
}

.radar-top > * {
  pointer-events: auto;
}

.radar-head {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
  padding: 7px 14px 7px 12px;
  background: var(--rr-glass);
  backdrop-filter: var(--rr-blur);
  -webkit-backdrop-filter: var(--rr-blur);
  border: 1px solid var(--rr-stroke);
  border-radius: 999px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.radar-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--rr-accent-bright);
  box-shadow: 0 0 0 4px rgba(109, 179, 242, 0.18);
  flex: 0 0 auto;
}

.radar-title {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.4px;
  white-space: nowrap;
}

.radar-sep {
  width: 1px;
  height: 12px;
  background: rgba(255, 255, 255, 0.16);
  flex: 0 0 auto;
}

.radar-city {
  font-size: 12px;
  font-weight: 300;
  color: var(--rr-text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 34vw;
}

.radar-icon-btn {
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  cursor: pointer;
  color: var(--rr-text-2);
  background: var(--rr-glass);
  backdrop-filter: var(--rr-blur);
  -webkit-backdrop-filter: var(--rr-blur);
  border: 1px solid var(--rr-stroke);
  transition:
    background 0.16s ease,
    color 0.16s ease,
    transform 0.16s ease;
}

.radar-icon-btn:hover {
  background: rgba(109, 179, 242, 0.24);
  color: #fff;
}

.radar-icon-btn:active {
  transform: scale(0.94);
}

/* ---------- 图例 ---------- */
/* ---------- 定位标记 ---------- */
.radar-layer :deep(.radar-loc) {
  /* divIcon 默认没有尺寸约束，这里只做定位，尺寸交给内部 span */
  background: none;
  border: none;
}

.radar-layer :deep(.radar-loc-dot) {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 12px;
  height: 12px;
  margin: -6px 0 0 -6px;
  border-radius: 50%;
  background: #7fd4f5;
  border: 2px solid #fff;
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.45),
    0 2px 8px rgba(0, 0, 0, 0.6);
}

/* 呼吸光环：描边而不是实心圆。
   实心填充在静态截图/动画中途看上去是一团模糊的灰斑，边界不清；
   一圈细描边扩散出去才读得出「这里有个点」的脉冲语义。
   只动 transform 与 opacity，避免动画触发重排。
   prefers-reduced-motion 下由下面的媒体查询关掉。 */
.radar-layer :deep(.radar-loc-ring) {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 18px;
  height: 18px;
  margin: -9px 0 0 -9px;
  border-radius: 50%;
  border: 2px solid rgba(127, 212, 245, 0.9);
  background: transparent;
  animation: radar-loc-pulse 2.4s cubic-bezier(0.22, 0.61, 0.36, 1) infinite;
}

@keyframes radar-loc-pulse {
  0% {
    transform: scale(0.55);
    opacity: 0.9;
  }
  75% {
    transform: scale(2.6);
    opacity: 0;
  }
  100% {
    transform: scale(2.6);
    opacity: 0;
  }
}

.radar-legend {
  position: absolute;
  right: 16px;
  /* --rr-ctrl-top 由 syncBottomInsets() 实测写入（控制条高度随宽度变化） */
  bottom: calc(var(--rr-ctrl-top, 148px) + 8px);
  z-index: 5;
  /* 竖向图例只放三个字宽，比横向版窄得多。
     宽度与缩放按钮共用 --rr-legend-w，两者右边缘对齐、宽度一致。 */
  width: var(--rr-legend-w, 60px);
  padding: 9px 8px 8px;
  background: var(--rr-glass);
  backdrop-filter: var(--rr-blur);
  -webkit-backdrop-filter: var(--rr-blur);
  border: 1px solid var(--rr-stroke);
  border-radius: 14px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  pointer-events: none;
}

/* 标题拆成「降水 / 强度」两行：一行四个字要 32px 才放得下，
   两行只要两个字宽（16px），图例整体能收窄到 40px 出头。
   每行仍用 nowrap —— 这里断行是我们自己排的，不是让它自由折。 */
.legend-title {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  font-size: 9px;
  line-height: 1.15;
  color: var(--rr-text-6);
  letter-spacing: 0;
  margin-bottom: 6px;
  white-space: nowrap;
  text-align: center;
}

/* 色条取自瓦片真实像素：RainViewer 这套配色是 深蓝 → 亮蓝 → 浅青 → 黄 → 橙 → 红，
   不是常见美国雷达图那套「绿 → 黄 → 红」。图例必须跟着瓦片走，否则屏幕上蓝雨配绿图例。 */
/* 色条竖着排：渐变方向改成 to top，色序仍然是「弱→强」从下往上。
   用 to top 而不是把色标倒着写 —— 色标含义（哪种颜色代表多强的雨）保持不变，
   换方向只是排版的事。 */
/* 去掉强/中/弱之后的图例主体：只剩一根色条，水平居中 */
.legend-body {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  justify-content: center;
  gap: 0;
}

.legend-bar {
  width: 10px;
  /* 高度随内容撑开，给一个下限避免字少时挤成一条线 */
  min-height: 74px;
  align-self: stretch;
  margin: 0 auto;
  border-radius: 5px;
  background: linear-gradient(
    to top,
    #0058a0,
    #0098d8,
    #50c8e8,
    #88e0f0,
    #fff000,
    #ff8c00,
    #d40000
  );
}


/* ---------- 底部控制条 ---------- */
.radar-controls {
  position: absolute;
  left: 50%;
  /* 版权行钉在页面最底部（bottom:4px），控制条必须让开它 ——
     否则两行字直接叠在一起。高度由 syncBottomInsets() 实测写入。 */
  bottom: calc(var(--rr-credit-h, 14px) + 14px);
  transform: translateX(-50%);
  z-index: 6;
  width: min(720px, calc(100% - 24px));
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 16px;
  background: var(--rr-glass);
  backdrop-filter: var(--rr-blur);
  -webkit-backdrop-filter: var(--rr-blur);
  border: 1px solid var(--rr-stroke);
  border-radius: 18px;
  box-shadow: var(--rr-shadow);
  touch-action: manipulation;
}

.radar-row-main {
  display: flex;
  align-items: center;
  gap: 14px;
}

/* 第二行：过渡 / 速度 / 刷新底图。小按钮集中在一条，主控制区保持清爽 */
.radar-row-sub {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  padding-top: 9px;
  border-top: 1px solid rgba(255, 255, 255, 0.07);
}

.radar-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.radar-group-label {
  font-size: 11px;
  color: var(--rr-text-6);
  letter-spacing: 0.3px;
}

.radar-toggle {
  font-family: inherit;
  font-size: 11px;
  height: 26px;
  padding: 0 12px;
  border: none;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.05);
  color: var(--rr-text-6);
  cursor: pointer;
  transition:
    background 0.16s ease,
    color 0.16s ease;
}

.radar-toggle:hover:not(:disabled) {
  color: var(--rr-text-2);
  background: rgba(255, 255, 255, 0.1);
}

.radar-toggle.on {
  background: rgba(109, 179, 242, 0.26);
  color: #fff;
}

.radar-toggle:disabled {
  opacity: 0.55;
  cursor: default;
}

.radar-toggle.is-busy {
  animation: radar-pulse 1.1s ease-in-out infinite;
}

@keyframes radar-pulse {
  0%,
  100% {
    opacity: 0.55;
  }
  50% {
    opacity: 1;
  }
}

.radar-seg {
  display: flex;
  gap: 2px;
  padding: 2px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.05);
}

.radar-seg-btn {
  font-family: inherit;
  font-size: 11px;
  height: 22px;
  padding: 0 9px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--rr-text-6);
  cursor: pointer;
  transition:
    background 0.16s ease,
    color 0.16s ease;
}

.radar-seg-btn:hover {
  color: var(--rr-text-2);
}

.radar-seg-btn.on {
  background: rgba(109, 179, 242, 0.26);
  color: #fff;
}

/* ---------- 底图失败提示 ---------- */
/* 超出雷达分辨率的提示：偏琥珀色，与「底图加载失败」的偏红区分开 ——
   一个是可以继续看但要知道它不准，一个是彻底没东西可看。
   选择器连写两个类：这条规则排在 .radar-base-hint 之前，单类选择器打不过它，
   写完仍会被判成红色（实测就是红色）。双类才有足够优先级。 */
.radar-base-hint.radar-zoom-hint {
  background: rgba(58, 44, 20, 0.9);
  border-color: rgba(240, 190, 90, 0.34);
  color: rgba(255, 232, 190, 0.94);
}

.radar-base-hint {
  position: absolute;
  left: 50%;
  top: 96px;
  transform: translateX(-50%);
  z-index: 7;
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: calc(100% - 32px);
  padding: 9px 12px 9px 16px;
  font-size: 12px;
  color: var(--rr-text-2);
  background: rgba(60, 32, 32, 0.86);
  backdrop-filter: var(--rr-blur);
  -webkit-backdrop-filter: var(--rr-blur);
  border: 1px solid rgba(255, 140, 120, 0.32);
  border-radius: 999px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.42);
}

.radar-base-retry {
  flex: 0 0 auto;
  font-family: inherit;
  font-size: 11px;
  padding: 5px 12px;
  border: 1px solid rgba(255, 140, 120, 0.4);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  cursor: pointer;
}

.radar-base-retry:hover {
  background: rgba(255, 255, 255, 0.16);
}

.radar-play {
  flex: 0 0 auto;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #fff;
  background: rgba(109, 179, 242, 0.2);
  border: 1px solid rgba(127, 212, 245, 0.4);
  transition:
    background 0.18s ease,
    transform 0.18s ease,
    opacity 0.18s ease;
}

.radar-play:hover:not(:disabled) {
  background: rgba(109, 179, 242, 0.36);
  transform: scale(1.06);
}

.radar-play:active:not(:disabled) {
  transform: scale(0.96);
}

.radar-play:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.radar-track {
  flex: 1 1 auto;
  min-width: 0;
}

.radar-time-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 8px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* 预热进度：比正文更弱的一档，它是背景任务，不该抢时间与帧标签的位置 */
.radar-warm {
  font-size: 10px;
  font-weight: 400;
  color: var(--rr-text-6);
  letter-spacing: 0.2px;
  opacity: 0.78;
}

.radar-clock {
  font-size: 18px;
  font-weight: 400;
  letter-spacing: 0.4px;
}

.radar-tag {
  font-size: 10px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.62);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 999px;
  padding: 2px 7px;
  letter-spacing: 0.5px;
  transition:
    color 0.2s ease,
    background 0.2s ease,
    border-color 0.2s ease;
}

.radar-tag.latest {
  color: var(--rr-accent-bright);
  background: rgba(109, 179, 242, 0.16);
  border-color: rgba(109, 179, 242, 0.3);
}

.radar-meta {
  margin-left: auto;
  font-size: 11px;
  color: var(--rr-text-6);
  overflow: hidden;
  text-overflow: ellipsis;
}

.radar-slider {
  -webkit-appearance: none;
  appearance: none;
  display: block;
  width: 100%;
  height: 5px;
  border-radius: 3px;
  outline: none;
  cursor: pointer;
  background: linear-gradient(
    to right,
    var(--rr-accent) 0%,
    var(--rr-accent) var(--pct, 0%),
    rgba(255, 255, 255, 0.14) var(--pct, 0%),
    rgba(255, 255, 255, 0.14) 100%
  );
}

.radar-slider:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.radar-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid var(--rr-accent);
  cursor: pointer;
  box-shadow: 0 0 0 4px rgba(109, 179, 242, 0.2);
}

.radar-slider::-moz-range-thumb {
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid var(--rr-accent);
  cursor: pointer;
}

.radar-close {
  flex: 0 0 auto;
  font-family: inherit;
  font-size: 12px;
  color: var(--rr-text-2);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--rr-stroke);
  border-radius: 999px;
  padding: 8px 16px;
  cursor: pointer;
  transition:
    background 0.16s ease,
    color 0.16s ease;
}

.radar-close:hover {
  background: rgba(255, 255, 255, 0.13);
  color: #fff;
}

/* ---------- 加载 / 错误 ---------- */
.radar-status {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 24px;
  background: rgba(6, 13, 22, 0.9);
}

.radar-spinner {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.12);
  border-top-color: var(--rr-accent);
  animation: radar-spin 0.85s linear infinite;
}

@keyframes radar-spin {
  to {
    transform: rotate(360deg);
  }
}

.radar-status-text {
  font-size: 13px;
  font-weight: 300;
  color: var(--rr-text-4);
  text-align: center;
}

.radar-error-icon {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: 600;
  color: var(--rr-accent-bright);
  border: 1px solid rgba(127, 212, 245, 0.4);
  background: rgba(109, 179, 242, 0.16);
}

.radar-error-desc {
  max-width: 460px;
  font-size: 11.5px;
  line-height: 1.8;
  color: rgba(255, 255, 255, 0.46);
  text-align: center;
  word-break: break-word;
}

.radar-retry {
  font-family: inherit;
  font-size: 12px;
  color: #fff;
  cursor: pointer;
  background: rgba(109, 179, 242, 0.26);
  border: 1px solid rgba(127, 212, 245, 0.55);
  border-radius: 999px;
  padding: 8px 22px;
  transition:
    background 0.16s ease,
    transform 0.16s ease;
}

.radar-retry:hover {
  background: rgba(109, 179, 242, 0.42);
}

.radar-retry:active {
  transform: scale(0.97);
}

/* ---------- 窄屏 ---------- */
@media (max-width: 640px) {
  .radar-controls {
    /* 窄屏版权行会折成两行（22px），仍然要让开它 —— 这里不能写死 12px */
    bottom: calc(var(--rr-credit-h, 22px) + 10px);
    gap: 10px;
    padding: 10px 12px;
  }

  .radar-play {
    width: 38px;
    height: 38px;
  }

  .radar-clock {
    font-size: 16px;
  }

  .radar-meta {
    display: none;
  }

  .radar-close {
    padding: 7px 12px;
  }

  .radar-legend {
    width: var(--rr-legend-w, 40px);
    right: 10px;
    padding: 6px 5px;
    bottom: calc(var(--rr-ctrl-top, 148px) + 8px);
  }

  .legend-bar {
    width: 8px;
    min-height: 58px;
  }

  /* 窄屏缩放按钮跟图例同宽同右边缘 */
  .radar-map :deep(.leaflet-bottom.leaflet-right) {
    right: 10px;
  }

  .legend-title {
    margin-bottom: 5px;
  }

  .radar-city {
    max-width: 30vw;
  }

  /* 窄屏不再写死 bottom：控制条折成两行时高度从 114px 变 148px，
     写死就会被压住。统一由 --rr-ctrl-top 跟随。 */

  .radar-credit {
    font-size: 8px;
    bottom: 2px;
    /* 窄屏一定放得下紧凑版：即便 320px 视口也只有约 30 个字符 × 8px ≈ 200px */
    width: max-content;
    max-width: calc(100% - 12px);
    letter-spacing: -0.1px;
  }

  .credit-full {
    display: none;
  }

  .credit-compact {
    display: inline;
  }
}

@media (prefers-reduced-motion: reduce) {
  .radar-spinner {
    animation-duration: 1.6s;
  }

  /* 定位标记只留圆点，脉动光环关掉 */
  .radar-layer :deep(.radar-loc-ring) {
    display: none;
  }
}
</style>
