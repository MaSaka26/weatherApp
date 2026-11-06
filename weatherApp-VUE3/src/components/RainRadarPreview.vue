<script setup>
/* 降水雷达全屏预览：只取中央气象台（NMC）的全国雷达拼图。

   为什么不用 RainViewer 了 —— 它是全球瓦片、要 Leaflet 叠在 Esri 暗色底图上，
   单块瓦片在这台机器上要 1.3–12 秒，首屏十几秒，13 帧还要预热才勉强能用。
   NMC 给的是气象台烘焙好的一整幅图（底图+省界+城市名+回波+图例都在一张 PNG 里），
   单帧 0.27–0.62 秒，12 帧并发不到 1 秒，6 分钟一帧（RainViewer 是 10 分钟），
   而且——关键——省掉了 Leaflet 那个 147KB 的 CDN 依赖。

   代价是：图不能缩放、不能平移、不能和别的底图对齐，只有整幅中国。
   对「看一眼全国哪里在下雨」这个用途，这些能力本来也用不上。 */

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  cityName: { type: String, default: '' },
  // 与首页共用同一套天气自适应天空背景（渐变 + 光晕 + 星点）
  skyClass: { type: String, default: '' },
})

const emit = defineEmits(['close'])

/* ============================================================
   常量
   ============================================================ */

const API_HOST = 'https://image.nmc.cn'
const PRODUCT = 'RDCP'
const CODE = 'ACHN' // 全国；分区另有 AECN 华东 / ANCN 华北 / ACCN 中南

// 一档 6 分钟。时间戳是 UTC，末 5 位恒 00000。
const SLOT_MS = 6 * 60 * 1000

/* 同一个时间戳有三种分辨率，靠路径里多一级目录区分：
     RDCP/          → 1349x1208  原图（官方页面不引用，但确实可取）
     RDCP/medium/   →  825x739   官方页面用的就是这一档
     RDCP/small/    →  480x430   列表缩略图
   原图那一档没有目录名，所以 dir 留空，拼 URL 时要跳过斜杠而不是接个空串（会出双斜杠）。 */
const QUALITIES = [
  { id: 'orig', name: '原图', dir: '', w: 1349, h: 1208, kb: 930 },
  { id: 'medium', name: '中图', dir: 'medium', w: 825, h: 739, kb: 515 },
  { id: 'small', name: '小图', dir: 'small', w: 480, h: 430, kb: 198 },
]

// 默认中图：全屏铺满时 825 宽只放大一点点，原图 12 帧要 10.9 MB 不值得。
const DEFAULT_QUALITY = 'medium'

// 往回最多探测多少档。发布有 6–12 分钟延迟（实测 07:42 时 0742 是 404、0736 才有图），
// 6 档 = 36 分钟，足够覆盖任何延迟，最坏 6 次探测约 2 秒。
const PROBE_TRIES = 6

// 一次装几帧。12 帧 = 1 小时 12 分钟，够看出雨带往哪走。
const FRAME_COUNT = 12

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
const speed = ref(DEFAULT_SPEED)
const front = ref(0) // 哪一张 img 在当前屏上（双缓冲）
const frameNote = ref('') // 「这一帧暂无数据」这类单帧提示

let alive = false
let generation = 0
let playTimer = null
let loadToken = 0
let imgUrls = ['', '']
let historyPushed = false
let lastFocus = null
let insetsObserver = null

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

/* ============================================================
   时间与 URL
   ============================================================ */

const pad2 = (n) => (n < 10 ? '0' + n : '' + n)

// UTC 时间戳，末 5 位固定 00000。NMC 的文件名就是这套格式。
function stampOf(date) {
  return (
    date.getUTCFullYear() +
    pad2(date.getUTCMonth() + 1) +
    pad2(date.getUTCDate()) +
    pad2(date.getUTCHours()) +
    pad2(date.getUTCMinutes()) +
    '00000'
  )
}

function urlOf(stamp, qualityId) {
  const q = QUALITIES.find((x) => x.id === qualityId) || QUALITIES[1]
  const dir = q.dir ? q.dir + '/' : ''
  return (
    `${API_HOST}/product/${stamp.slice(0, 4)}/${stamp.slice(4, 6)}/${stamp.slice(6, 8)}` +
    `/${PRODUCT}/${dir}SEVP_AOC_RDCP_SLDAS3_ECREF_${CODE}_L88_PI_${stamp}.PNG`
  )
}

// 向下取整到 6 分钟档。不能四舍五入 —— 07:35 会被推到 07:36，而那一档还没发布。
function slotOf(date) {
  return new Date(Math.floor(date.getTime() / SLOT_MS) * SLOT_MS)
}

// 手动 +8 小时再按 UTC 读，不依赖 locale / timeZone：页面在哪个时区打开都显示北京时间。
function beijingHHMM(date) {
  const d = new Date(date.getTime() + 8 * 3600 * 1000)
  return pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes())
}

function buildFrames(latest, count, qualityId) {
  const out = []
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(latest.getTime() - i * SLOT_MS)
    const stamp = stampOf(d)
    out.push({ date: d, stamp, url: urlOf(stamp, qualityId) })
  }
  return out
}

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

async function probeLatest(qualityId, token) {
  const start = slotOf(new Date())
  for (let k = 0; k < PROBE_TRIES; k++) {
    if (!alive || token !== loadToken) return null
    probeHint.value = k === 0 ? '正在探测最新一帧…' : `正在探测最新一帧…（回退 ${k} 档）`
    const t = new Date(start.getTime() - k * SLOT_MS)
    const ok = await probe(urlOf(stampOf(t), qualityId))
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

// 双缓冲换图：新图先加载到隐藏的那张上，decode 完再交换 opacity。
// 单张 img 直接换 src 会有一瞬白屏 —— 这是 800px 级的大图，解码要几十毫秒，肉眼可见。
function showFrame(index) {
  const f = frames.value[index]
  if (!f) return

  const backIdx = front.value === 0 ? 1 : 0
  const back = backIdx === 0 ? imgA.value : imgB.value
  if (!back) return

  frameNote.value = ''

  const commit = () => {
    // 换了 src 之后旧 URL 失效，用 token 判断这张回调是不是最新的那次
    if (imgUrls[backIdx] !== f.url) return
    front.value = backIdx
    idx.value = index
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
  }
  back.src = f.url
}

/* ============================================================
   播放
   ============================================================ */

function clearPlayTimer() {
  if (playTimer) {
    clearTimeout(playTimer)
    playTimer = null
  }
}

function armNextFrame() {
  clearPlayTimer()
  if (!playing.value || !ready.value) return
  playTimer = setTimeout(() => {
    playTimer = null
    if (!playing.value || !alive) return
    const n = frames.value.length
    if (!n) return
    showFrame((idx.value + 1) % n)
    armNextFrame()
  }, frameMs.value)
}

function play() {
  if (!ready.value) return
  playing.value = true
  armNextFrame()
}

function pause() {
  playing.value = false
  clearPlayTimer()
}

function togglePlay() {
  if (playing.value) pause()
  else play()
}

function step(delta) {
  if (!ready.value) return
  const n = frames.value.length
  if (!n) return
  pause()
  showFrame((idx.value + delta + n) % n)
}

function onSlide(event) {
  if (!ready.value) return
  const next = Number(event.target.value)
  if (!Number.isFinite(next)) return
  pause()
  showFrame(Math.max(0, Math.min(maxIdx.value, next)))
}

function setSpeed(id) {
  speed.value = pickSpeed(id).id
  if (playing.value) armNextFrame() // 立即生效，不用等下一拍
}

/* ============================================================
   加载 / 切换画质 / 重试
   ============================================================ */

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

  const latest = await probeLatest(quality.value, token)
  if (!alive || token !== loadToken) return

  if (!latest) {
    status.value = 'error'
    errorMsg.value = '连不上 image.nmc.cn，或者往回 36 分钟都没有可用的图'
    return
  }

  const list = buildFrames(latest, FRAME_COUNT, quality.value)
  probeHint.value = `正在预载 ${list.length} 帧…`

  // 全部预载完再撤遮罩：NMC 单帧 0.27–0.62 秒，12 帧并发实测不到 1 秒，
  // 等这一下换来的是之后每次换帧零延迟（浏览器缓存命中）。
  await preloadAll(list.map((f) => f.url))
  if (!alive || token !== loadToken) return

  frames.value = list
  imgUrls = ['', '']
  front.value = 0
  // 从最早一帧起步，播放才是「时间往前走」。停在最新帧再播，下一秒就绕回
  // 一小时前，画面会突然往回跳一大段 —— 那不是回放，是抽搐。
  idx.value = 0
  await nextTick()
  if (!alive || token !== loadToken) return

  showFrame(0)
  status.value = 'ready'

  // 尊重系统的「减少动态效果」：不自动播，用户手动点。
  if (!prefersReducedMotion() && list.length > 1) play()
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
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('popstate', onPopState)
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
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      ref="layerEl"
      class="radar-layer"
      role="dialog"
      aria-modal="true"
      aria-label="全国降水雷达回放"
    >
      <!-- 与首页共用同一套天空背景（渐变 + 光晕 + 星点 + 天气自适应）。
           .sky-bg 是 weather.css 里的全局类，不是 scoped，这里直接复用；
           放在最前面、层级垫底，图区与所有控件都压在它上面。 -->
      <div class="sky-bg radar-sky" :class="skyClass" aria-hidden="true"></div>

      <!-- 图区。图片本身自带底图、省界、城市名与色标，
           所以这里不需要 Leaflet、不需要叠加图层、也不需要另做图例。 -->
      <div ref="stageEl" class="radar-stage">
        <img ref="imgA" class="radar-img" :class="{ show: front === 0 }" alt="" />
        <img ref="imgB" class="radar-img" :class="{ show: front === 1 }" alt="" />
      </div>

      <header class="radar-top">
        <div class="radar-head">
          <span class="radar-dot" aria-hidden="true"></span>
          <h2 class="radar-title">降水雷达</h2>
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

      <div v-if="status === 'loading'" class="radar-status" role="status">
        <div class="radar-spinner"></div>
        <p class="radar-status-text">{{ probeHint || '正在获取雷达回放帧…' }}</p>
      </div>

      <div v-else-if="status === 'error'" class="radar-status" role="alert">
        <div class="radar-error-icon" aria-hidden="true">!</div>
        <p class="radar-status-text">雷达数据加载失败</p>
        <p class="radar-error-desc">{{ errorMsg }}</p>
        <button class="radar-retry" type="button" @click="retry">重试</button>
      </div>

      <p v-if="frameNote" class="radar-note" role="status">{{ frameNote }}</p>

      <p ref="creditEl" class="radar-credit">
        数据来源
        <a href="http://www.nmc.cn/" target="_blank" rel="noopener">中央气象台</a>
        <span class="credit-sep">·</span>
        6 分钟一帧
      </p>

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
            <span class="radar-group-label">画质</span>
            <div class="radar-seg" role="group" aria-label="图片清晰度">
              <button
                v-for="q in QUALITIES"
                :key="q.id"
                class="radar-seg-btn"
                :class="{ on: quality === q.id }"
                type="button"
                :title="`${q.w}×${q.h} · 约 ${q.kb} KB/帧`"
                @click="setQuality(q.id)"
              >
                {{ q.name }}
              </button>
            </div>
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
        </div>
      </footer>
    </div>
  </Teleport>
</template>

<style scoped>
/* 颜色自持：这个覆盖层刻意不依赖 weather.css 的主题变量。
   雷达图的像素是一套固定配色，跟随主题改反而会让回波颜色与色标对不上。 */
.radar-layer {
  --rr-bg: #060d16;
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
  --rr-ctrl-top: 140px;
  --rr-credit-h: 14px;

  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  background: var(--rr-bg);
  color: var(--rr-text-0);
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  overscroll-behavior: contain;
}

/* 与首页完全相同的天空背景。.sky-bg 的全局规则（weather.css）已经带了
   渐变、光晕、星点与天气自适应类；这里只把它钉在覆盖层最底层。
   覆盖层本身是 fixed inset:0，所以 absolute inset:0 与它完全重合；
   z-index:0 垫底，图区与所有控件（z-index ≥3）都压在它上面。
   保留 .radar-layer 的纯色作兜底：天空图或动画没起来时不至于透出页面。 */
.radar-sky {
  position: absolute;
  z-index: 0;
}

/* 图区：让开顶部标题与底部控制条，中间居中显示。
   图片用 object-fit: contain —— 一旦拉伸变形，回波和真实地理位置就对不上了。 */
.radar-stage {
  position: absolute;
  inset: 0;
  z-index: 1; /* 压在 .radar-sky(z-index:0) 之上，图片与控件都不被天空盖住 */
  padding: 68px 16px calc(var(--rr-ctrl-top) + 10px);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

/* 让图片盒撑满可用区域，再由 object-fit: contain 把画面居中收进去。
   必须显式给 width/height —— <img> 是替换元素，只写 inset 而不管尺寸时
   浏览器会退回图片的固有尺寸（825×739），在窄屏上直接溢出到控制条底下。
   给了尺寸之后 contain 才有余量可居中，任何视口下都不会变形也不会溢出。 */
.radar-img {
  position: absolute;
  top: 68px;
  left: 16px;
  width: calc(100% - 32px);
  height: calc(100% - 68px - var(--rr-ctrl-top) - 10px);
  object-fit: contain;
  opacity: 0;
  transition: opacity 0.18s ease;
  /* NMC 的图是白底，直接放进暗色界面里像贴了一张纸。
     反相后底图变暗、城市名变白，正好和这个界面一个调子。
     hue-rotate 在反相之后把色相绕回来 —— 只做 invert 会把绿色回波翻成品红。 */
  filter: invert(1) hue-rotate(180deg) brightness(0.94) contrast(1.08);
  user-select: none;
  -webkit-user-drag: none;
}

.radar-img.show {
  opacity: 1;
}

@media (prefers-reduced-motion: reduce) {
  .radar-img {
    transition: none;
  }
}

/* ============================================================
   顶部
   ============================================================ */

.radar-top {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 3;
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
  margin: 0;
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
    color 0.16s ease;
}

.radar-icon-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  color: var(--rr-text-0);
}

.radar-icon-btn:focus-visible {
  outline: 2px solid var(--rr-accent-bright);
  outline-offset: 2px;
}

/* ============================================================
   状态
   ============================================================ */

.radar-status {
  position: absolute;
  inset: 0;
  z-index: 4;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 0 24px;
  background: rgba(6, 13, 22, 0.86);
  backdrop-filter: blur(3px);
  text-align: center;
}

.radar-spinner {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 2px solid rgba(127, 212, 245, 0.22);
  border-top-color: var(--rr-accent-bright);
  animation: radar-spin 0.9s linear infinite;
}

@keyframes radar-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .radar-spinner {
    animation-duration: 2.4s;
  }
}

.radar-status-text {
  margin: 0;
  font-size: 13px;
  color: var(--rr-text-2);
  font-variant-numeric: tabular-nums;
}

.radar-error-icon {
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 18px;
  font-weight: 600;
  color: #ffb4a2;
  background: rgba(255, 120, 90, 0.14);
  border: 1px solid rgba(255, 140, 120, 0.32);
}

.radar-error-desc {
  margin: 0;
  max-width: 34em;
  font-size: 12px;
  line-height: 1.6;
  color: var(--rr-text-6);
}

.radar-retry {
  padding: 7px 18px;
  font-size: 12px;
  color: var(--rr-text-0);
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid var(--rr-stroke);
  border-radius: 999px;
  cursor: pointer;
}

.radar-retry:focus-visible,
.radar-close:focus-visible,
.radar-play:focus-visible,
.radar-seg-btn:focus-visible {
  outline: 2px solid var(--rr-accent-bright);
  outline-offset: 2px;
}

/* 单帧缺失提示：只说明这一格是空的，不打断回放 */
.radar-note {
  position: absolute;
  left: 50%;
  top: 74px;
  transform: translateX(-50%);
  z-index: 3;
  margin: 0;
  padding: 5px 12px;
  font-size: 11px;
  color: rgba(255, 232, 190, 0.94);
  background: rgba(58, 44, 20, 0.9);
  border: 1px solid rgba(240, 190, 90, 0.34);
  border-radius: 999px;
  white-space: nowrap;
}

/* ============================================================
   版权行
   ============================================================ */

/* 钉在页面最底部居中。控制条要按它的实测高度让位（--rr-credit-h），
   否则窄屏它折成两行时会和控制条叠在一起。 */
.radar-credit {
  position: absolute;
  left: 50%;
  bottom: 4px;
  transform: translateX(-50%);
  z-index: 7;
  width: max-content;
  max-width: calc(100% - 20px);
  margin: 0;
  text-align: center;
  font-size: 10px;
  line-height: 1.4;
  color: var(--rr-text-6);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
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

/* ============================================================
   底部控制条
   ============================================================ */

.radar-controls {
  position: absolute;
  left: 50%;
  bottom: calc(var(--rr-credit-h) + 12px);
  transform: translateX(-50%);
  z-index: 5;
  width: min(760px, calc(100% - 32px));
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  background: var(--rr-glass);
  backdrop-filter: var(--rr-blur);
  -webkit-backdrop-filter: var(--rr-blur);
  border: 1px solid var(--rr-stroke);
  border-radius: 18px;
  box-shadow: var(--rr-shadow);
}

.radar-row-main {
  display: flex;
  align-items: center;
  gap: 12px;
}

.radar-play {
  flex: 0 0 auto;
  width: 38px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  color: #06131f;
  background: var(--rr-accent-bright);
  transition: transform 0.14s ease;
}

.radar-play:hover:not(:disabled) {
  transform: scale(1.06);
}

.radar-play:disabled {
  cursor: default;
  opacity: 0.4;
}

.radar-track {
  flex: 1 1 auto;
  min-width: 0;
}

.radar-time-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 7px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
}

.radar-clock {
  font-size: 17px;
  font-weight: 400;
  letter-spacing: 0.4px;
  color: var(--rr-text-0);
}

.radar-tag {
  flex: 0 0 auto;
  padding: 2px 7px;
  font-size: 10px;
  font-weight: 500;
  color: var(--rr-text-4);
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid var(--rr-stroke);
  border-radius: 999px;
}

.radar-tag.latest {
  color: var(--rr-accent-bright);
  background: rgba(109, 179, 242, 0.16);
  border-color: rgba(109, 179, 242, 0.3);
}

.radar-meta {
  flex: 0 1 auto;
  min-width: 0;
  font-size: 10px;
  color: var(--rr-text-6);
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 滑块：用 --pct 画已播放部分，不需要额外的画布或元素 */
.radar-slider {
  width: 100%;
  height: 4px;
  margin: 0;
  appearance: none;
  -webkit-appearance: none;
  border-radius: 999px;
  cursor: pointer;
  background: linear-gradient(
    to right,
    var(--rr-accent-bright) 0%,
    var(--rr-accent-bright) var(--pct, 0%),
    rgba(255, 255, 255, 0.14) var(--pct, 0%),
    rgba(255, 255, 255, 0.14) 100%
  );
}

.radar-slider:disabled {
  cursor: default;
  opacity: 0.45;
}

.radar-slider::-webkit-slider-thumb {
  appearance: none;
  -webkit-appearance: none;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid var(--rr-accent);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
  cursor: pointer;
}

.radar-slider::-moz-range-thumb {
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid var(--rr-accent);
  cursor: pointer;
}

.radar-close {
  flex: 0 0 auto;
  padding: 8px 16px;
  font-size: 12px;
  color: var(--rr-text-2);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--rr-stroke);
  border-radius: 999px;
  cursor: pointer;
  transition:
    background 0.16s ease,
    color 0.16s ease;
}

.radar-close:hover {
  background: rgba(255, 255, 255, 0.12);
  color: var(--rr-text-0);
}

.radar-row-sub {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
  padding-top: 9px;
  border-top: 1px solid rgba(255, 255, 255, 0.07);
}

.radar-group {
  display: flex;
  align-items: center;
  gap: 7px;
}

.radar-group-label {
  font-size: 10px;
  color: var(--rr-text-6);
  white-space: nowrap;
}

.radar-seg {
  display: flex;
  gap: 2px;
  padding: 2px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 999px;
}

.radar-seg-btn {
  padding: 4px 11px;
  font-size: 11px;
  font-weight: 500;
  color: var(--rr-text-6);
  background: transparent;
  border: none;
  border-radius: 999px;
  cursor: pointer;
  white-space: nowrap;
  transition:
    background 0.14s ease,
    color 0.14s ease;
}

.radar-seg-btn:hover {
  color: var(--rr-text-2);
}

.radar-seg-btn.on {
  color: #fff;
  background: rgba(109, 179, 242, 0.26);
}

/* ============================================================
   窄屏
   ============================================================ */

@media (max-width: 640px) {
  .radar-stage {
    padding: 60px 10px calc(var(--rr-ctrl-top) + 8px);
  }

  .radar-img {
    top: 60px;
    left: 10px;
    width: calc(100% - 20px);
    height: calc(100% - 60px - var(--rr-ctrl-top) - 8px);
  }

  .radar-top {
    padding: 10px 10px 26px;
  }

  .radar-controls {
    width: calc(100% - 16px);
    padding: 10px 11px;
    gap: 8px;
    bottom: calc(var(--rr-credit-h) + 8px);
  }

  .radar-credit {
    font-size: 8px;
    bottom: 2px;
  }

  .radar-clock {
    font-size: 15px;
  }

  .radar-meta {
    display: none;
  }

  .radar-play {
    width: 34px;
    height: 34px;
  }

  .radar-close {
    padding: 7px 12px;
  }

  .radar-seg-btn {
    padding: 4px 9px;
    font-size: 10px;
  }

  .radar-note {
    top: 64px;
    font-size: 10px;
  }
}
</style>
