import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { buildRadarFrames, radarSlot, radarUrl } from '@/composables/useRadarFrames'
import { createRadarPlayback } from '@/composables/radarPlayback'

export function useRadarPlayer(props, emit) {

/* 降水雷达全屏预览：只取中央气象台（NMC）的雷达拼图，全国与华东/华北/中南
   四个区域可切换（见 REGIONS）。

   为什么不用 RainViewer 了 —— 它是全球瓦片、要 Leaflet 叠在 Esri 暗色底图上，
   单块瓦片在这台机器上要 1.3–12 秒，首屏十几秒，13 帧还要预热才勉强能用。
   NMC 给的是气象台烘焙好的一整幅图（底图+省界+城市名+回波+图例都在一张 PNG 里），
   单帧 0.27–0.62 秒，12 帧并发不到 1 秒，6 分钟一帧（RainViewer 是 10 分钟），
   而且——关键——省掉了 Leaflet 那个 147KB 的 CDN 依赖。

   代价是：图不能缩放、不能平移、不能和别的底图对齐，只能看官方切好的四张拼图。
   对「看一眼哪里在下雨」这个用途，这些能力本来也用不上。 */



/* ============================================================
   常量
   ============================================================ */


/* 可切换的雷达区域。id 就是文件名里那一段代号，中央气象台只发布这四张拼图：
   全国是整幅中国，另外三张是按大区裁出来并放大过的拼图。 */
const REGIONS = [
  { id: 'ACHN', name: '全国' },
  { id: 'AECN', name: '华东' },
  { id: 'ANCN', name: '华北' },
  { id: 'ACCN', name: '中南' },
]
const DEFAULT_REGION = 'ACHN'

// 一档 6 分钟。时间戳是 UTC，末 5 位恒 00000。
const SLOT_MS = 6 * 60 * 1000

/* 同一个时间戳有三种分辨率，靠路径里多一级目录区分：
     RDCP/          → 1349x1208  原图（官方页面不引用，但确实可取）
     RDCP/medium/   →  825x739   官方页面用的就是这一档
     RDCP/small/    →  480x430   列表缩略图
   原图那一档没有目录名，所以 dir 留空，拼 URL 时要跳过斜杠而不是接个空串（会出双斜杠）。

   注意：下面三张分区图（AECN/ANCN/ACCN）只有原图这一档，medium/ 与 small/
   实测全部 404 —— 它们本身就是「原图裁切放大」的产物，官方没有为分区出缩略图。
   所以区域模式下必须把画质钳到 orig，否则拼出来的每个 URL 都必然 404。 */
const QUALITIES = [
  { id: 'orig', name: '原图', w: 1349, h: 1208, kb: 930 },
  { id: 'medium', name: '中图', w: 825, h: 739, kb: 515 },
  { id: 'small', name: '小图', w: 480, h: 430, kb: 198 },
]

// 默认中图：全屏铺满时 825 宽只放大一点点，原图 12 帧要 10.9 MB 不值得。
const DEFAULT_QUALITY = 'medium'

// 往回最多探测多少档。发布有 6–12 分钟延迟（实测 07:42 时 0742 是 404、0736 才有图），
// 6 档 = 36 分钟，足够覆盖任何延迟，最坏 6 次探测约 2 秒。
const PROBE_TRIES = 6

// 一次装几帧。12 帧 = 1 小时 12 分钟，够看出雨带往哪走。
const FRAME_COUNT = 12

// 开着的时候每隔一分钟回探一次有没有新帧发布。NMC 每 6 分钟一帧，
// 用 1 分钟轮询能把「新帧出现」的感知延迟压到 1 分钟内，代价只有 1 次图片请求。
const REFRESH_MS = 60 * 1000

// 开着时最多保留 60 帧（6 小时）。只追加不回收的话，挂一整天时间轴会拖出
// 几百帧，滑块与 rangeText 都变味；到上限就丢最老的，并把 idx 平移保持指向同一帧。
const MAX_FRAMES = 60

// 首帧迟迟不落地（弱网/断网）时，最多等这么久就撤掉遮罩放行，避免永远卡在转圈。
const FIRST_FRAME_TIMEOUT_MS = 8000

const SPEEDS = [
  { id: 'slow', name: '慢', frameMs: 900 },
  { id: 'normal', name: '标准', frameMs: 600 },
  { id: 'fast', name: '快', frameMs: 360 },
  { id: 'faster', name: '更快', frameMs: 220 },
]
const DEFAULT_SPEED = 'normal'

/* ============================================================
   状态
   ============================================================ */

const layerEl = ref(null)
const controlsEl = ref(null)
const creditEl = ref(null)
const stageEl = ref(null)
const imgA = ref(null)
const imgB = ref(null)

const status = ref('idle') // idle | loading | ready | error
const errorMsg = ref('')
const probeHint = ref('') // 探测进度文案，只在加载时说
const frames = ref([]) // [{ date, stamp, url }]
const idx = ref(0)
const playing = ref(false)
const quality = ref(DEFAULT_QUALITY)
const region = ref(DEFAULT_REGION)
const speed = ref(DEFAULT_SPEED)
const front = ref(0) // 哪一张 img 在当前屏上（双缓冲）
const frameNote = ref('') // 「这一帧暂无数据」这类单帧提示

let alive = false
let generation = 0
let loadToken = 0
let imgUrls = ['', '']
let historyPushed = false
let lastFocus = null
let insetsObserver = null
let refreshTimer = null
let pendingRefresh = false

const pickSpeed = (id) => SPEEDS.find((s) => s.id === id) || SPEEDS[1]
const frameMs = computed(() => pickSpeed(speed.value).frameMs)

const ready = computed(() => status.value === 'ready' && frames.value.length > 0)
const maxIdx = computed(() => Math.max(0, frames.value.length - 1))
const pct = computed(() => (maxIdx.value > 0 ? (idx.value / maxIdx.value) * 100 : 0))
const currentFrame = computed(() => frames.value[idx.value] || null)
const isLatest = computed(() => idx.value === maxIdx.value && frames.value.length > 0)

const timeText = computed(() => {
  const f = currentFrame.value
  return f ? beijingHHMM(f.date) : '--:--'
})

const relLabel = computed(() => {
  const f = currentFrame.value
  if (!f) return '——'
  if (isLatest.value) return '最新'
  const mins = Math.round((Date.now() - f.date.getTime()) / 60000)
  if (mins < 60) return `${mins} 分钟前`
  return `${Math.floor(mins / 60)} 小时前`
})

const dateText = computed(() => {
  const f = currentFrame.value
  if (!f) return ''
  const d = new Date(f.date.getTime() + 8 * 3600 * 1000)
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`
})

const rangeText = computed(() => {
  if (!frames.value.length) return '——'
  return `${dateText.value} · 共 ${frames.value.length} 帧 · 6 分钟一帧`
})

const cityLabel = computed(() => props.cityName || '全国')
const pad2 = (n) => String(n).padStart(2, '0')

// 当前区域对象（名称用于顶部徽标 / aria-label，找不到时退回全国）
const regionInfo = computed(() => REGIONS.find((r) => r.id === region.value) || REGIONS[0])

// 分区图只有原图一档，用这个开关同时驱动「画质组变灰」与「urlOf 强制 orig」
const regionOnly = computed(() => region.value !== 'ACHN')

/* ============================================================
   时间与 URL
   ============================================================ */

const stampOf = (date) => {
  const p = (n) => String(n).padStart(2, '0')
  return `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}${p(date.getUTCHours())}${p(date.getUTCMinutes())}00000`
}
const urlOf = (stamp, qualityId, code = region.value) => radarUrl(stamp, qualityId, code)
const slotOf = radarSlot

// 手动 +8 小时再按 UTC 读，不依赖 locale / timeZone：页面在哪个时区打开都显示北京时间。
function beijingHHMM(date) {
  const d = new Date(date.getTime() + 8 * 3600 * 1000)
  return pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes())
}

const buildFrames = (latest, count, qualityId) => buildRadarFrames(latest, count, qualityId, region.value)

/* ============================================================
   探测与预载
   ============================================================ */

// NMC 没有 JSON 接口，HTML 页也没有 CORS 头，所以「最新是哪一帧」只能往回试。
// 用 Image() 试探而不是 fetch：crossOrigin 都不用设，onload 就说明文件真实存在。
function probe(url) {
  return new Promise((resolve) => {
    const im = new Image()
    im.onload = () => resolve(im.naturalWidth > 0)
    im.onerror = () => resolve(false)
    im.src = url
  })
}

// quiet=true 用于后台轮询：不写 probeHint，免得把加载文案改了。
// floorMs  用于后台轮询：退到「已知的最后一帧」或更老时直接收手，没有新帧就不必再试。
async function probeLatest(qualityId, token, quiet = false, floorMs = -Infinity) {
  const start = slotOf(new Date())
  // 进来就锁定区域代号：探测跨多次 await，期间若切了区域，token 会让这次结果作废，
  // 但已经发出的几次试探必须用同一个代号，不能中途换图。
  const code = region.value
  for (let k = 0; k < PROBE_TRIES; k++) {
    if (!alive || token !== loadToken) return null
    const t = new Date(start.getTime() - k * SLOT_MS)
    if (t.getTime() <= floorMs) return null
    if (!quiet) {
      probeHint.value = k === 0 ? '正在探测最新一帧…' : `正在探测最新一帧…（回退 ${k} 档）`
    }
    const ok = await probe(urlOf(stampOf(t), qualityId, code))
    if (ok) return t
  }
  return null
}

function preloadAll(urls) {
  return Promise.all(
    urls.map(
      (u) =>
        new Promise((resolve) => {
          const im = new Image()
          im.onload = () => resolve(true)
          im.onerror = () => resolve(false)
          im.src = u
        }),
    ),
  )
}

/* ============================================================
   渲染
   ============================================================ */

// 双缓冲换图：新图先加载到没显示的那张上，decode 完再切换显示权。
// 单张 img 直接换 src 会有一瞬白屏 —— 这是 800px 级的大图，解码要几十毫秒，肉眼可见。
// 显示权用 visibility 硬切，不用 opacity：两张都是不透明的整图，
// 一旦做透明度渐变就会把前后两帧叠成「双重曝光」，看着就是每帧闪一下。
// onShown 只用于「首帧已落地」这一次判断：解码完切换显示权后回调，
// load() 靠它决定何时撤遮罩。其余调用（播放/拖动）不传，不会有任何开销。
function showFrame(index, onShown) {
  const f = frames.value[index]
  if (!f) {
    if (onShown) onShown(false)
    return
  }

  const backIdx = front.value === 0 ? 1 : 0
  const back = backIdx === 0 ? imgA.value : imgB.value
  if (!back) {
    if (onShown) onShown(false)
    return
  }

  frameNote.value = ''

  const commit = () => {
    // 换了 src 之后旧 URL 失效，用 token 判断这张回调是不是最新的那次
    if (imgUrls[backIdx] !== f.url) return
    front.value = backIdx
    idx.value = index
    if (onShown) onShown(true)
  }

  imgUrls[backIdx] = f.url
  back.onload = () => {
    if (imgUrls[backIdx] !== f.url) return
    if (back.decode) back.decode().then(commit).catch(commit)
    else commit()
  }
  back.onerror = () => {
    // 单帧 404 不弹错误：探测已经保证了首帧存在，中间某一档缺失时
    // 停在上一张比拼一张破图好，但要让用户知道这一格是空的
    if (imgUrls[backIdx] === f.url) frameNote.value = '这一帧暂无数据'
    if (onShown) onShown(false)
  }
  back.src = f.url
}

/* ============================================================
   播放
   ============================================================ */

const playback = createRadarPlayback({ frames, idx, playing, ready, frameMs, showFrame, isAlive: () => alive })
const { clear: clearPlayTimer, arm: armNextFrame, play, pause, toggle: togglePlay, step } = playback

function onSlide(event) {
  playback.slide(event.target.value)
}

function setSpeed(id) {
  speed.value = pickSpeed(id).id
  if (playing.value) armNextFrame() // 立即生效，不用等下一拍
}

/* ============================================================
   开着时的滚动刷新
   ============================================================ */

/* NMC 每 6 分钟发一帧。只在打开时抓 12 帧的话，看十几分钟时间轴末端
   就再也不动了 —— 用户会以为数据坏了。所以开着期间每分钟回探一次，
   有新帧就追加到时间轴末尾（不丢旧帧，避免用户正在拖时间轴时画面跳变）。 */
function clearRefreshTimer() {
  if (refreshTimer) {
    clearTimeout(refreshTimer)
    refreshTimer = null
  }
}

function scheduleRefresh(delay = REFRESH_MS) {
  clearRefreshTimer()
  if (!alive) return
  refreshTimer = setTimeout(runRefresh, delay)
}

async function runRefresh() {
  refreshTimer = null
  if (!alive || !ready.value || pendingRefresh) {
    scheduleRefresh()
    return
  }

  const token = loadToken
  const qualityId = quality.value
  // 区域代号也要一起锁定：滚动刷新是「往时间轴后面追加新帧」，
  // 如果这里不带上当前区域，追加出来的那几帧会突然变回全国图，
  // 时间轴前半段是华东、后半段是全国 —— 这是最容易漏的一处。
  const code = region.value
  const last = frames.value.length ? frames.value[frames.value.length - 1] : null
  // 探到的帧只要不比「已知最后一帧」新就没意义，probeLatest 会在退到这一档之前收手，
  // 于是没新帧的那一分钟只花 1 次图片请求。
  const floorMs = last ? last.date.getTime() : -Infinity

  pendingRefresh = true
  try {
    const latest = await probeLatest(qualityId, token, true, floorMs)
    // 期间换过画质 / 重试 / 关掉层：token 变了，这次结果直接作废
    if (!alive || token !== loadToken || !latest) return

    const additions = []
    for (let t = floorMs + SLOT_MS; t <= latest.getTime(); t += SLOT_MS) {
      const d = new Date(t)
      const stamp = stampOf(d)
      additions.push({ date: d, stamp, url: urlOf(stamp, qualityId, code) })
    }
    if (!additions.length) return

    const wasLatest = isLatest.value
    let all = frames.value.concat(additions)
    // 到上限就丢最老的一批，保持时间轴长度可控；idx 平移后仍指向同一帧内容。
    let drop = 0
    if (all.length > MAX_FRAMES) {
      drop = all.length - MAX_FRAMES
      all = all.slice(drop)
    }
    const shifted = Math.max(0, idx.value - drop)
    frames.value = all
    idx.value = shifted
    // 新帧后台进缓存，播放滚到那里时才是零延迟；失败也只影响这一格的速度。
    preloadAll(additions.map((f) => f.url))

    // 停在「最新」那一格的用户跟着滚到新的最新帧；在回看旧帧的用户不要打扰。
    if (wasLatest) {
      idx.value = maxIdx.value
      showFrame(idx.value)
    }
    if (playing.value) armNextFrame()
  } finally {
    pendingRefresh = false
    scheduleRefresh()
  }
}

function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

async function load() {
  const token = ++loadToken
  status.value = 'loading'
  errorMsg.value = ''
  frameNote.value = ''
  probeHint.value = '正在探测最新一帧…'
  pause()
  clearRefreshTimer()

  const latest = await probeLatest(quality.value, token)
  if (!alive || token !== loadToken) return

  if (!latest) {
    status.value = 'error'
    errorMsg.value = '连不上 image.nmc.cn，或者往回 36 分钟都没有可用的图'
    return
  }

  const list = buildFrames(latest, FRAME_COUNT, quality.value)
  probeHint.value = '正在获取第一帧…'

  frames.value = list
  imgUrls = ['', '']
  front.value = 0
  // 从最早一帧起步，播放才是「时间往前走」。停在最新帧再播，下一秒就绕回
  // 一小时前，画面会突然往回跳一大段 —— 那不是回放，是抽搐。
  idx.value = 0
  await nextTick()
  if (!alive || token !== loadToken) return

  // 先只等第一帧，落地就撤遮罩。原来「12 张全预载完才放行」在冷缓存下要
  // 1.6–2.4 秒（medium 12 帧约 6 MB），用户盯着转圈什么也看不到。
  // 剩余 11 张交给后台预载：并发不阻塞首屏，播放滚到那里时缓存已命中。
  await new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(guard)
      if (!alive || token !== loadToken) return resolve()
      // 首帧没落地也不能永远卡着遮罩：放行让时间轴与播放可用。
      // 不写「暂无数据」—— 图片很可能还在路上，真正 404 时 showFrame 的
      // onerror 会置 frameNote；这里若先写死，等图到了反而清不掉。
      status.value = 'ready'
      if (!prefersReducedMotion() && list.length > 1) play()
      resolve()
    }
    const guard = setTimeout(() => finish(false), FIRST_FRAME_TIMEOUT_MS)
    showFrame(0, finish)
  })

  if (!alive || token !== loadToken) return
  // 首帧之外全部后台预载（不 await）：这些响应进浏览器缓存，后续换帧零延迟。
  preloadAll(list.slice(1).map((f) => f.url))
  scheduleRefresh()
}

function setQuality(id) {
  if (quality.value === id) return
  quality.value = id
  // 换画质必须重建整条帧列表：三种分辨率的 URL 完全不同，
  // 只替换当前这张会让时间轴其余帧still是旧分辨率。
  frames.value = []
  idx.value = 0
  load()
}

function setRegion(id) {
  if (region.value === id) return
  region.value = id
  // 分区图只有原图一档，切过去时把画质钳到 orig —— 否则控件上还亮着「中图」，
  // 拼出来的 URL 却是硬改成原图的那条，界面与实际请求对不上。
  if (id !== 'ACHN' && quality.value !== 'orig') quality.value = 'orig'
  // 区域是文件名的一部分，等于换了一整套图，必须整条重建。
  frames.value = []
  idx.value = 0
  load()
}

function retry() {
  frames.value = []
  idx.value = 0
  load()
}

/* ============================================================
   打开 / 关闭 / 生命周期
   ============================================================ */

function close() {
  if (historyPushed) {
    historyPushed = false
    history.back()
  }
  emit('close')
}

function onPopState() {
  if (!props.open || !historyPushed) return
  historyPushed = false
  emit('close')
}

/* 焦点陷阱。aria-modal="true" 只是声明，浏览器不会真的挡住背景元素 ——
   不自己实现的话，键盘用户按几次 Tab 就走到背后的天气页上，
   屏幕上还是雷达层，焦点却在看不见的地方。 */
const FOCUSABLE =
  'button:not([disabled]),[href],input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])'

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
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }

  // 焦点在输入控件上时不抢键：滑块上的方向键要留给原生行为
  const tag = event.target && event.target.tagName ? event.target.tagName.toLowerCase() : ''
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return
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

/* 控制条高度随窗口宽度变（窄屏次行会折），图片区必须让开它，
   否则图的下缘会被控制条压住。实测后写进 CSS 变量，由 CSS 用 calc 跟随。 */
function syncInsets() {
  const layer = layerEl.value
  const ctrl = controlsEl.value
  if (!layer || !ctrl) return
  const top = Math.max(0, Math.round(layer.getBoundingClientRect().bottom - ctrl.getBoundingClientRect().top))
  layer.style.setProperty('--rr-ctrl-top', top + 'px')

  const credit = creditEl.value
  if (credit) {
    layer.style.setProperty('--rr-credit-h', Math.round(credit.getBoundingClientRect().height) + 'px')
  }
}

function watchInsets() {
  if (insetsObserver) insetsObserver.disconnect()
  if (!controlsEl.value || typeof ResizeObserver === 'undefined') return
  insetsObserver = new ResizeObserver(syncInsets)
  insetsObserver.observe(controlsEl.value)
  if (creditEl.value) insetsObserver.observe(creditEl.value)
  syncInsets()
}

function teardown() {
  alive = false
  loadToken++
  clearPlayTimer()
  clearRefreshTimer()
  pendingRefresh = false
  playing.value = false
  frames.value = []
  idx.value = 0
  imgUrls = ['', '']
  if (insetsObserver) {
    insetsObserver.disconnect()
    insetsObserver = null
  }
  status.value = 'idle'
  errorMsg.value = ''
  probeHint.value = ''
  frameNote.value = ''
  historyPushed = false

  // 焦点还给打开它的那个元素。没记录（例如程序化打开）就直接放弃，
  // 强行 focus 到 body 反而会把用户带偏
  const prev = lastFocus
  lastFocus = null
  if (prev && typeof prev.focus === 'function' && document.contains(prev)) {
    prev.focus({ preventScroll: true })
  }
}

async function openLayer() {
  const gen = ++generation
  alive = true

  lastFocus = document.activeElement
  if (!historyPushed) {
    history.pushState({ radar: 1 }, '')
    historyPushed = true
  }

  quality.value = DEFAULT_QUALITY
  // 每次打开都回到全国：区域只是这一次的临时视角，
  // 而且全国档默认是中图，若残留上次的区域就会带着 orig 重开，白多下 4 MB。
  region.value = DEFAULT_REGION
  await nextTick()
  if (!alive || gen !== generation) return

  watchInsets()
  load()

  const firstBtn = layerEl.value && layerEl.value.querySelector(FOCUSABLE)
  if (firstBtn) firstBtn.focus({ preventScroll: true })
}

watch(
  () => props.open,
  (open) => {
    if (open) openLayer()
    else teardown()
  },
)

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('popstate', onPopState)
  if (props.open) openLayer() // 父组件用 v-if 直接挂载成 open=true 时 watch 不会补发

  // 仅开发期：给 ui-review 的自动化脚本一个主动触发滚动刷新的入口，
  // 否则验证「开着时追加新帧」得真等 60 秒。生产构建会被 tree-shake 掉。
  if (import.meta.env.DEV) {
    window.__radarDebug = {
      triggerRefresh: () => runRefresh(),
      scheduleRefresh: (ms) => scheduleRefresh(ms),
      // 把时间轴尾部砍掉 n 帧，模拟「开着几帧没跟上」；随后 triggerRefresh()
      // 会用真实的 probeLatest 把这几帧重新探测并追加回来，走的是产品代码路径。
      dropLast: (n) => {
        if (frames.value.length <= n) return
        pause()
        frames.value = frames.value.slice(0, frames.value.length - n)
        idx.value = Math.min(idx.value, maxIdx.value)
      },
      state: () => ({
        status: status.value,
        count: frames.value.length,
        idx: idx.value,
        playing: playing.value,
        // 自动化脚本要靠这个确认区域切换是否真的生效（含画质是否被钳到 orig）
        region: region.value,
        quality: quality.value,
        lastStamp: frames.value.length ? frames.value[frames.value.length - 1].stamp : null,
        firstStamp: frames.value.length ? frames.value[0].stamp : null,
      }),
    }
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('popstate', onPopState)
  if (import.meta.env.DEV) delete window.__radarDebug
  document.body.style.overflow = ''
  teardown()
})

// 覆盖层打开时锁住背后页面滚动，否则手机上单指拖图会连带整页滚
watch(
  () => props.open,
  (open) => {
    document.body.style.overflow = open ? 'hidden' : ''
  },
  { flush: 'sync' },
)

  return {
    layerEl,
    controlsEl,
    creditEl,
    stageEl,
    imgA,
    imgB,
    status,
    errorMsg,
    probeHint,
    frames,
    idx,
    playing,
    quality,
    region,
    speed,
    front,
    frameNote,
    frameMs,
    ready,
    maxIdx,
    pct,
    currentFrame,
    isLatest,
    timeText,
    relLabel,
    rangeText,
    cityLabel,
    regionInfo,
    regionOnly,
    QUALITIES,
    REGIONS,
    SPEEDS,
    close,
    retry,
    togglePlay,
    onSlide,
    setRegion,
    setQuality,
    setSpeed,
  }
}
