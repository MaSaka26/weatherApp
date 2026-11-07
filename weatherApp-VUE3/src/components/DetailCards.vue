<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

import { setSetting, settings } from '@/composables/useSettings'
import { aqiText, readAir } from '@/utils/aqi'
import DialGauge from '@/components/DialGauge.vue'
import NeedleDial from '@/components/NeedleDial.vue'
import UvGauge from '@/components/UvGauge.vue'
import WindCompass from '@/components/WindCompass.vue'

const props = defineProps({
  current: { type: Object, required: true },
  daily: { type: Object, default: null },
  // 空气质量来自独立接口，可能为 null（请求失败或超时），卡片会显示「暂无」
  air: { type: Object, default: null },
})

// 卡片 item 布局由设置决定：layout-row 左文右图（默认）/ layout-stack 文字在上图形在下。
// 手机、平板、桌面三档都听这个设置，样式分档在 weather.css 的各段媒体查询里
// 两套排布都留在 weather.css 里，切换只换类名，数据与组件不用动
const layoutClass = computed(() =>
  settings.cardLayout === 'stack' ? 'layout-stack' : 'layout-row',
)

// 六卡 / 九卡由设置切换：九卡在桌面排成 5+4（末张占两格），手机九张正好三列三行
//
// 列数跟的是「正在显示的那套排布」，不是 settings.cardCount：
// 收起动画期间要先退回到六列（日出日落回到第一行第 6 位），那三张卡则被
// order 顶到第二排去淡出。如果这里直接跟着 cardCount 走，两者会在同一帧里
// 同时变化，日出日落先跳一行再跟着缩，反而更乱
const gridClass = computed(() => [
  layoutClass.value,
  displayAll.value && !collapsing.value ? 'cards-9' : 'cards-6',
  // 收起第一段：三张卡原地淡出（不动列数、不动宽度）
  fading.value ? 'fading' : '',
  // 收起第二段：切回六列后把它们用 order 压到最后一排
  collapsing.value ? 'collapsing' : '',
])

// 首页直接把卡片数量做成 16 天预报那套「列表 / 曲线」同款切换钮。
// 数据仍然只走 settings.cardCount —— 设置面板里那一项保留，两处改的是同一个值，不会各说各话
const showAll = computed(() => settings.cardCount === 9)

// 实际渲染几张。收起过渡期间它仍然是 9（三张卡先留在 DOM 里被裁剪出去），
// 等容器高度收到 6 张的尺寸之后才置 false 真正移除 —— 否则那三张会在
// 高度开始收之前就凭空消失，剩下的卡再猛地缩一下，看着很跳
const displayAll = ref(showAll.value)

// 正在收集高度：三张卡还在，但已被 order 顶到最后一行并开始淡出
const collapsing = ref(false)

// 收起第一段：三张卡还在原位，只把不透明度降到 0。这一段列数与卡片宽度都不动，
// 眼睛只看到「那三张淡了」。等淡完才切列数（宽度跳变）并开始收高度
const fading = ref(false)

function setCount(n) {
  if (settings.cardCount === n) return
  setSetting('cardCount', n)
}

// 展开 / 收起动画：纯 CSS 做不到 —— grid 的列数（6 列 → 5 列）与行数一变，
// 高度是瞬时跳变的，没有可过渡的中间值。这里先量旧高度，DOM 更新后再量新高度，
// 用 WAAPI 把高度补间出来，同时折叠容器在这段时间里 overflow: hidden。
//
// 收起走两段：① 三张卡被 order 推到最后一排并淡出，容器高度同时从两排收到一排；
// ② 高度到位后才把三张卡从 DOM 移除。因为第 6 张（日出日落）此时已经在
// 六卡的正确位置上，它不会先跳到第二行再跳回来
const foldEl = ref(null)
const animating = ref(false)

// 每次切换时现读，不用模块级常量缓存 —— 系统里的「减少动态效果」是可以在会话中途改的
function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

const FOLD_MS = 360
const EASE = 'cubic-bezier(0.22, 0.61, 0.36, 1)'
// 三张卡的淡出时长，与 CSS 里 .details-grid.fading 的 transition 保持一致
const FADE_MS = 200
let foldAnim = null
let sunAnim = null
// 连点作废：两段式中间有一个 200ms 的等待窗口，这期间用户可能又点回去
let foldToken = 0
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// 收起时留下来的那六张里，最下面一张的底边就是「收完以后应该有多高」。
// 直接问布局而不是推算行高与 gap：手机 3 列 3 排、桌面 6 列 2 排都能通用
const EXTRA_CLASSES = ['precip-card', 'air-card', 'vis-card']

function keptHeightOf(fold, grid) {
  // 只把多出来的三张「从网格里摘掉」是不够的——它们还在的话，
  // 手机 3 列会排出 3 排、而 grid-auto-rows:1fr 会按最高那张卡（空气卡带表盘）
  // 把每一排都撑高，于是留下来的 6 张虽然只占 2 排，量出来仍比收完后更高。
  // 这里临时 display:none 把它们移出布局，量到的才是收完后的真实高度。
  //
  // 调用时必须还没有任何过渡在跑：元素一旦离开布局，正在跑的 opacity 过渡会被打断，
  // 恢复显示后又不会从 1 重来，三张卡就会瞬间全透明。所以调用点放在写 collapsing 之前，
  // 并在还原之后强制一次重排，让浏览器把这些样式改动落实成一帧
  // 桌面九卡是五列排布，留下来的六张在五列里仍要占两排，直接量会得到「和现在一样高」，
  // 于是被判成高度没变、收起动画整个跳过。所以量之前先把网格临时切回六列的排布
  const wasNine = grid.classList.contains('cards-9')
  const extras = Array.from(grid.children).filter((c) =>
    EXTRA_CLASSES.some((k) => c.classList.contains(k)),
  )
  const prev = extras.map((c) => c.style.display)
  extras.forEach((c) => {
    c.style.display = 'none'
  })
  if (wasNine) {
    grid.classList.remove('cards-9')
    grid.classList.add('cards-6')
  }
  const top = fold.getBoundingClientRect().top
  const kept = Array.from(grid.children).filter((c) => c.style.display !== 'none')
  const bottom = kept.length ? Math.max(...kept.map((c) => c.getBoundingClientRect().bottom)) : 0
  if (wasNine) {
    grid.classList.remove('cards-6')
    grid.classList.add('cards-9')
  }
  extras.forEach((c, i) => {
    c.style.display = prev[i]
  })
  void grid.offsetHeight // 强制重排：还原与随后的 collapsing 必须是两帧，否则过渡不会启动
  return Math.max(0, bottom - top)
}

function runFold(el, from, to) {
  animating.value = true
  // 连点时必须先把上一段断言作废：两段 WAAPI 同时作用于 height，
  // 收尾时谁最后写谁生效，容易把容器停在中间高度
  foldAnim?.cancel()
  // fill: forwards 是关键。收起结束时三张卡还留在 DOM 里（要等高度到位才卸载），
  // 此时若动画一结束就失效，容器会瞬间弹回三行的高度再跌回去——肉眼是闪一下。
  // 留住终态高度，等 DOM 更新完再撤（见 settleFold）
  const anim = el.animate(
    [{ height: `${from}px` }, { height: `${to}px` }],
    { duration: FOLD_MS, easing: EASE, fill: 'forwards' },
  )
  foldAnim = anim
  return anim.finished.then(
    () => anim,
    () => null,
  )
}

// 收尾顺序不能反：先改 displayAll 让三张卡从 DOM 里消失，等 Vue 把 DOM 更新完，
// 再撤掉 forwards 填充。这时候容器的自然高度已经等于动画终值，撤掉不会有任何跳动
async function settleFold(anim) {
  if (!anim || foldAnim !== anim) return false
  displayAll.value = showAll.value
  await nextTick()
  foldAnim?.cancel()
  foldAnim = null
  animating.value = false
  collapsing.value = false
  fading.value = false
  return true
}

watch(showAll, async (all) => {
  const el = foldEl.value
  if (!el) return
  const token = ++foldToken
  const from = el.getBoundingClientRect().height

  // 系统开了「减少动态效果」就一步到位，不留半截的过渡态
  if (prefersReducedMotion()) {
    sunAnim?.cancel()
    sunAnim = null
    displayAll.value = all
    collapsing.value = false
    fading.value = false
    return
  }

  if (all) {
    // 展开：三张卡先出现（高度还没放下来，所以被裁在可视区外），
    // 再把容器高度放下去，看起来是从下面长出来
    displayAll.value = true
    collapsing.value = false
    await nextTick()
    const to = el.getBoundingClientRect().height
    if (!from || !to || Math.abs(to - from) < 1) return
    const done = await runFold(el, from, to)
    await settleFold(done)
    return
  }

  // 收起分两段走。
  // 第一段：三张多出来的卡还在原排布里（五列、238 宽），只是把不透明度降到 0。
  //   这一段列数和卡片宽度完全不动，所以眼睛只看到「那三张淡了」。
  // 第二段：切回六列的排布（宽度 238 → 197 在这一帧跳完），同时把高度滑下去。
  // 为什么必须拆：两件事挤在同一帧时，宽度在第 0 帧就跳完了，高度却要滑 360ms，
  //   观感是「卡片先猛地变窄，然后才慢慢变矮」，跳变正好发生在最没遮挡的时候。
  //   拆开以后，跳变落在三张卡刚消失、注意力还在它们身上的那一刻。
  fading.value = true
  await nextTick()
  await sleep(FADE_MS)
  if (token !== foldToken) return

  // 日落这张卡在两套排布里位置不同（九卡在第二行、六卡在第一行第 6 位），
  // 直接重排会让它在一帧之内向上跳一大截。这里用 FLIP：先量旧位置，
  // 重排后立刻用 transform 把它按回旧位置，再补间到 0 —— 它是滑上去的，不是跳上去的
  const grid = el.querySelector('.details-grid')
  const sunEl = grid?.querySelector('.sun-card')
  const sunBefore = sunEl ? sunEl.getBoundingClientRect().top : 0

  // 先量「收完应该多高」。这时三张卡已经全透明，临时摘掉它们
  // 不会打断任何正在跑的过渡（那正是之前 F7 读到全 0 的原因）
  const to = grid ? keptHeightOf(el, grid) : from

  animating.value = true
  collapsing.value = true
  await nextTick()
  if (token !== foldToken) return

  // 必须在写 transform 之前量，否则量到的是被 transform 挪过的位置
  const sunAfter = sunEl ? sunEl.getBoundingClientRect().top : 0
  const dy = Math.round(sunBefore - sunAfter)

  if (sunEl && Math.abs(dy) > 1) {
    sunAnim?.cancel()
    sunAnim = sunEl.animate(
      [{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }],
      { duration: FOLD_MS, easing: EASE, fill: 'both' },
    )
    // 补间结束后把动画撤掉：此时元素本身就在终点，撤掉不会有任何位移
    sunAnim.finished.then(
      () => {
        sunAnim?.cancel()
        sunAnim = null
      },
      () => {},
    )
  }

  if (!to || Math.abs(to - from) < 1) {
    displayAll.value = false
    collapsing.value = false
    fading.value = false
    animating.value = false
    return
  }
  const done = await runFold(el, from, to)
  // 高度已经是一排了，这时移除三张卡不会再有任何跳动；
  // settleFold 会等 DOM 更新后才撤掉 forwards 的终态高度，避免闪一下
  await settleFold(done)
})
onBeforeUnmount(() => {
  foldToken++ // 让还在 sleep 里的那一轮直接返回
  foldAnim?.cancel()
  foldAnim = null
  sunAnim?.cancel()
  sunAnim = null
})

// 空气质量：AQI 当主值，PM2.5 / PM10 当小字，等级名走 aqi.js 的六级分档
// 接口失败时 air 是 null，卡片整体退化成「暂无」，不占位也不报错
const air = computed(() => readAir(props.air))
const aqiValue = computed(() => aqiText(air.value.aqi))
const aqiLevelName = computed(() => air.value.level?.name || '暂无')
const aqiHint = computed(() => air.value.level?.hint || '暂无空气质量数据')
// 单格宽度放不下「PM2.5 65.7 · PM10 67.1」一行（桌面 236px、手机 112px），
// 拆成两行分别渲染，避免折在「PM10」和数字之间
const pmRows = computed(() => {
  const rows = []
  if (air.value.pm25 != null) rows.push(`PM2.5 ${air.value.pm25.toFixed(1)}`)
  if (air.value.pm10 != null) rows.push(`PM10 ${air.value.pm10.toFixed(1)}`)
  return rows
})

// 能见度：接口给米（current_units 明确是 "m"），展示按公里（10 km 比 10000 m 好读）。
// 分档取日常出行感受，不是气象学的浓雾/强浓雾定义 —— 用户关心的是「看不看得远」。
// 注意阈值单位是公里，判断时必须用 km 值，不能用原始米值（曾因此把 680 m 判成「极佳」）
const VISIBILITY_TEXT = [
  [1, '浓雾'],
  [5, '有雾'],
  [10, '轻雾'],
  [20, '通透'],
  [Infinity, '极佳'],
]
const visibilityM = computed(() => {
  const v = props.current?.visibility
  return typeof v === 'number' ? v : null
})
const visibilityKm = computed(() =>
  visibilityM.value == null ? null : visibilityM.value / 1000,
)
const visibilityText = computed(() => pick(VISIBILITY_TEXT, visibilityKm.value))
const visibilityValue = computed(() =>
  visibilityKm.value == null ? '—' : visibilityKm.value.toFixed(1),
)
// 表盘上限 30 km：再远对体感没区别，山顶 60 km 也让它顶格
const visibilityDial = computed(() =>
  visibilityKm.value == null ? null : Math.min(visibilityKm.value, 30),
)

// 降水量：接口只给「上一小时」的累计值（mm），不是瞬时强度。
// 文案按小时雨量分级（中国气象局的小时雨量标准：小雨 <2.5、中雨 2.5–8、大雨 8–16）
const PRECIP_TEXT = [
  [0.05, '无降水'],
  [2.5, '小雨'],
  [8, '中雨'],
  [16, '大雨'],
  [Infinity, '暴雨'],
]
const precip = computed(() => {
  const v = props.current?.precipitation
  return typeof v === 'number' ? v : null
})
const precipText = computed(() => pick(PRECIP_TEXT, precip.value))
const precipValue = computed(() => (precip.value == null ? '—' : precip.value.toFixed(1)))
// 表盘上限 10 mm：常见降水的分辨区间，暴雨时顶格即可
const precipDial = computed(() => (precip.value == null ? null : Math.min(precip.value, 10)))

// 六张卡三列两行正好排满容器（桌面六列一行），列宽都是 minmax(0,1fr)，永远不溢出，
// 所以这里不需要 useWheelScroll；逐小时和曲线那两处真会溢出，滚动在各自组件里挂

// 分档取值：表里第一条「上限 ≥ 当前值」就是答案
function pick(table, v) {
  if (v == null) return '暂无数据'
  return (table.find(([max]) => v <= max) ?? table[table.length - 1])[1]
}

// 气压取海平面气压，跨海拔可比；站点气压在山城会明显偏低
const pressure = computed(() => Math.round(props.current.pressure_msl ?? 0))

// 体感：表盘指针按 -20～40℃ 走，文案给一句人话
const FEELS_TEXT = [
  [0, '严寒'],
  [5, '很冷'],
  [10, '冷'],
  [16, '偏凉'],
  [27, '舒适'],
  [31, '偏热'],
  [Infinity, '炎热'],
]
const feels = computed(() => {
  const v = props.current?.apparent_temperature
  return typeof v === 'number' ? v : null
})
const feelsText = computed(() => pick(FEELS_TEXT, feels.value))
const feelsValue = computed(() => (feels.value == null ? '—' : String(Math.round(feels.value))))

// 风：接口给 km/h，参考图用 m/s，除以 3.6 后保留一位。
// 左侧主值是风速（2.9 m/s 是速度不是方位），方位交给罗盘中心那两个字，
// 两者分开以后「风速」和「东南」各自对得上自己的数字
const WIND_DIRS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北']
const windDeg = computed(() => {
  const v = props.current?.wind_direction_10m
  return typeof v === 'number' ? v : null
})
const windShort = computed(() =>
  windDeg.value == null ? '' : WIND_DIRS[Math.round(windDeg.value / 45) % 8],
)
const windName = computed(() => (windShort.value ? `${windShort.value}风` : '风向'))
const windMs = computed(() => {
  const v = props.current?.wind_speed_10m
  return typeof v === 'number' ? v / 3.6 : null
})
const windText = computed(() => (windMs.value == null ? '—' : windMs.value.toFixed(1)))

// 湿度：按体感舒适度分段，71% 落在「潮湿」
const HUMIDITY_TEXT = [
  [30, '干燥'],
  [50, '干爽'],
  [70, '舒适'],
  [85, '潮湿'],
  [Infinity, '很潮湿'],
]
const humidity = computed(() => {
  const v = props.current?.relative_humidity_2m
  return typeof v === 'number' ? v : null
})
const humidityText = computed(() => pick(HUMIDITY_TEXT, humidity.value))

// 紫外线取当日峰值，比瞬时值更有防晒指导意义（傍晚瞬时值总是接近 0）
const uvMax = computed(() => {
  const v = props.daily?.uv_index_max?.[0]
  return typeof v === 'number' ? v : null
})

// 紫外线分档只用来给表盘配文字，配色由 UvGauge 内部的 --uv-1..5 渐变负责
const UV_LEVELS = [
  { max: 2, name: '低' },
  { max: 5, name: '中等' },
  { max: 7, name: '高' },
  { max: 10, name: '很高' },
  { max: Infinity, name: '极高' },
]

const uvLevel = computed(() => {
  if (uvMax.value == null) return null
  return UV_LEVELS.find((l) => uvMax.value <= l.max) ?? null
})

// 接口返回的是当地时间字符串（如 2026-10-30T06:45），按「当天第几分钟」比较即可，
// 不转 Date 是为了绕开浏览器时区与城市时区不一致的问题
function toMinutes(iso) {
  const m = /T(\d{2}):(\d{2})/.exec(iso || '')
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

const hhmm = (iso) => (iso || '').slice(11, 16)

const sun = computed(() => {
  const riseIso = props.daily?.sunrise?.[0]
  const setIso = props.daily?.sunset?.[0]
  const rise = toMinutes(riseIso)
  const set = toMinutes(setIso)
  if (rise == null || set == null || set <= rise) return null

  // current.time 同样是城市当地时间，可直接当作「现在」
  const now = toMinutes(props.current?.time) ?? rise
  const pct = Math.min(1, Math.max(0, (now - rise) / (set - rise)))
  const total = set - rise
  return {
    rise: hhmm(riseIso),
    set: hhmm(setIso),
    pct,
    isDay: now >= rise && now <= set,
    short: `${Math.floor(total / 60)}h${String(total % 60).padStart(2, '0')}`,
  }
})

// 横线图下面那行小字「白昼 X 小时 XX 分」。sun.short 是 12h56 这种紧凑写法，
// 给主值用；这里展开成中文，读起来更像一句话
const dayText = computed(() => {
  const s = sun.value
  if (!s) return '—'
  const m = /^(\d+)h(\d{2})$/.exec(s.short)
  if (!m) return '—'
  return `${m[1]} 小时 ${m[2]} 分`
})

// 抛物线（右侧图标）：起点 (0,40)、终点 (100,40)、控制点 (50,-22)。
// 二次贝塞尔展开后 y(t) = 40 - 124t + 124t²，x 恰好是线性 t*100，光点按进度取位即可
const dot = computed(() => {
  const t = sun.value?.pct ?? 0
  return { x: t * 100, y: 40 + t * (124 * t - 124) }
})
</script>

<template>
  <section class="cards-section">
    <div class="section-head">
      <div class="section-title">天气详情</div>
      <!-- 和「未来 16 天」的列表 / 曲线同一套外观：首页直接切，不用进设置面板 -->
      <div class="view-switch" role="tablist" aria-label="详情卡数量">
        <button
          type="button"
          role="tab"
          class="view-btn"
          :class="{ active: !showAll }"
          :aria-selected="!showAll"
          @click="setCount(6)"
        >
          6 张
        </button>
        <button
          type="button"
          role="tab"
          class="view-btn"
          :class="{ active: showAll }"
          :aria-selected="showAll"
          @click="setCount(9)"
        >
          9 张
        </button>
      </div>
    </div>

    <!-- 折叠容器：动画期间 overflow 收紧，多出来的三张从下方长出 / 向上收回 -->
    <div ref="foldEl" class="cards-fold" :class="{ folding: animating }">
      <div class="details-grid" :class="gridClass">
    <div class="detail-card split">
      <div class="card-main">
        <div class="label">体感</div>
        <div class="value">{{ feelsValue }}<span class="unit">°</span></div>
      </div>
      <NeedleDial :value="feels" :caption="feelsText" :label="`体感 ${feelsText}`" />
    </div>

    <div class="detail-card split">
      <div class="card-main">
        <div class="label">风速</div>
        <div class="value">{{ windText }}<span class="unit">m/s</span></div>
      </div>
      <WindCompass
        :direction="windDeg ?? 0"
        :label="`${windName} 风速 ${windText} 米每秒，方位 ${windDeg ?? '—'} 度`"
      />
    </div>

    <div class="detail-card split">
      <div class="card-main">
        <div class="label">湿度</div>
        <div class="value">{{ humidity ?? '—' }}<span class="unit">%</span></div>
      </div>
      <DialGauge :value="humidity" :min="0" :max="100" :caption="humidityText" label="湿度">
        <svg class="d-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3.4c3.3 4.1 5.9 7.2 5.9 9.9a5.9 5.9 0 1 1-11.8 0c0-2.7 2.6-5.8 5.9-9.9Z" />
        </svg>
      </DialGauge>
    </div>

    <div class="detail-card split">
      <div class="card-main">
        <div class="label">气压</div>
        <div class="value">{{ pressure }}</div>
      </div>
      <DialGauge
        :value="pressure"
        :min="970"
        :max="1050"
        caption="hPa"
        label="气压"
      >
        <svg class="d-icon d-icon-arrow" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 5v13.5m0 0 5.2-5.2M12 18.5 6.8 13.3" />
        </svg>
      </DialGauge>
    </div>

    <div class="detail-card split uv-card">
      <div class="card-main">
        <div class="label">紫外线</div>
        <div class="uv-level">{{ uvLevel?.name || '—' }}</div>
      </div>
      <UvGauge :value="uvMax" />
    </div>


    <!-- 降水量：上一小时的累计毫米数，不是瞬时强度，所以小字写「小雨」而不是「正在下小雨」 -->
    <div v-if="displayAll" class="detail-card split precip-card">
      <div class="card-main">
        <div class="label">降水量</div>
        <div class="value">{{ precipValue }}<span class="unit">mm</span></div>
      </div>
      <DialGauge
        :value="precipDial"
        :min="0"
        :max="10"
        :caption="precipText"
        :label="`近一小时降水量 ${precipValue} 毫米，${precipText}`"
      >
        <svg class="d-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 18a4.6 4.4 0 0 1 0-9a5 4.5 0 0 1 11 2h1a3.5 3.5 0 0 1 0 7" />
          <path d="M11 13v2m0 3v2m4-5v2m0 3v2" />
        </svg>
      </DialGauge>
    </div>
    <!-- 空气质量：只有切到 9 张时才渲染。
         主值是 AQI 数字，环心写等级简称，环下写 PM2.5 / PM10；
         分档断点与 lifeIndex 里「户外 / 疾病」用的是同一套，卡片和生活指数结论不会互相打架 -->
    <div v-if="displayAll" class="detail-card split air-card">
      <div class="card-main">
        <div class="label">空气质量</div>
        <div class="value">{{ aqiValue }}<span class="unit">AQI</span></div>
        <!-- PM 两项各占一行：单格宽只有 236px（手机 112px），
             拼成一行「PM2.5 65.7 · PM10 67.1」必然折行，而且会断在 PM10 和数字之间 -->
        <div v-if="pmRows.length" class="air-pm">
          <span v-for="row in pmRows" :key="row">{{ row }}</span>
        </div>
      </div>
      <DialGauge
        :value="air.aqi"
        :min="0"
        :max="300"
        :caption="aqiLevelName"
        :label="`空气质量 ${aqiLevelName}，AQI ${aqiValue}，${aqiHint}`"
      >
        <svg class="d-icon d-icon-arrow" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 15h11a3 3 0 1 0-3-3M3 11h7M3 19h9" />
        </svg>
      </DialGauge>
    </div>

    <!-- 能见度：接口给米，换算成公里显示。表盘上限 30 km，再远对出行没区别 -->
    <div v-if="displayAll" class="detail-card split vis-card">
      <div class="card-main">
        <div class="label">能见度</div>
        <div class="value">{{ visibilityValue }}<span class="unit">km</span></div>
      </div>
      <DialGauge
        :value="visibilityDial"
        :min="0"
        :max="30"
        :caption="visibilityText"
        :label="`能见度 ${visibilityValue} 公里，${visibilityText}`"
      >
        <svg class="d-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0-4 0" />
          <path d="M21 12c-2.4 4-5.4 6-9 6c-3.6 0-6.6-2-9-6c2.4-4 5.4-6 9-6c3.6 0 6.6 2 9 6" />
        </svg>
      </DialGauge>
    </div>

    <div class="detail-card split sun-card">
      <div class="card-main">
        <div class="label">日出 · 日落</div>
        <div class="value">{{ sun?.short || '—' }}</div>
      </div>

      <!-- 横线轨道（只在「桌面 + 九卡」显示）：九卡时这张卡通两格，
           横向空间富裕，横线比抛物线舒展得多，时间也能直接落在轨道两端。
           两套 DOM 都渲染、靠 CSS 的 display 切换，不引 JS 断点 —— 和项目里
           抛物线/横线历代实现的做法一致，窗口缩放时能立刻跟着换 -->
      <div
        class="sun-line-wrap"
        :class="{ night: sun && !sun.isDay }"
        :aria-label="`日出 ${sun?.rise || '—'}，日落 ${sun?.set || '—'}，白昼 ${dayText}`"
      >
        <div class="sun-line">
          <span class="sun-time">{{ sun?.rise || '--:--' }}</span>
          <span class="sun-track">
            <span class="sun-fill" :style="{ width: `${(sun?.pct ?? 0) * 100}%` }"></span>
            <span
              v-if="sun?.isDay"
              class="sun-dot"
              :style="{ left: `${(sun?.pct ?? 0) * 100}%` }"
            ></span>
          </span>
          <span class="sun-time">{{ sun?.set || '--:--' }}</span>
        </div>
      </div>

      <!-- 抛物线：起落点 (0,40)-(100,40)、控制点 (50,-22)，顶点 y=9。
           和横向 100 单位比只有 31 单位高，卡里显得紧凑，不会把整张卡撑满 -->
      <div class="sun-panel" :class="{ night: sun && !sun.isDay }">
        <svg class="sun-svg" viewBox="0 0 100 44" aria-hidden="true">
          <defs>
            <linearGradient id="sunArcGrad" x1="0" y1="0" x2="1" y2="0">
              <stop class="stop-a" offset="0%" />
              <stop class="stop-b" offset="100%" />
            </linearGradient>
          </defs>
          <path class="arc-track" d="M0 40 Q50 -22 100 40" />
          <path
            v-if="sun"
            class="arc-fill"
            d="M0 40 Q50 -22 100 40"
            pathLength="100"
            :style="{ '--dash': `${sun.pct * 100} 100` }"
          />
          <circle v-if="sun?.isDay" class="arc-dot" :cx="dot.x" :cy="dot.y" r="3.2" />
        </svg>
        <div class="sun-times">
          <span>{{ sun?.rise || '--:--' }}</span>
          <span>{{ sun?.set || '--:--' }}</span>
        </div>
      </div>
    </div>
      </div>
    </div>
  </section>
</template>
