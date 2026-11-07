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
const gridClass = computed(() => [layoutClass.value, settings.cardCount === 9 ? 'cards-9' : 'cards-6'])

// 首页直接把卡片数量做成 16 天预报那套「列表 / 曲线」同款切换钮。
// 数据仍然只走 settings.cardCount —— 设置面板里那一项保留，两处改的是同一个值，不会各说各话
const showAll = computed(() => settings.cardCount === 9)

function setCount(n) {
  if (settings.cardCount === n) return
  setSetting('cardCount', n)
}

// 展开 / 收起动画：纯 CSS 做不到 —— grid 的列数（6 列 → 5 列）与行数一变，
// 高度是瞬时跳变的，没有可过渡的中间值。这里先量旧高度，DOM 更新后再量新高度，
// 用 WAAPI 把高度补间出来，同时折叠容器在这段时间里 overflow: hidden，
// 于是展开看起来是「从下面长出来」，收起看起来是「往上收回去」
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
let foldAnim = null

watch(showAll, async () => {
  const el = foldEl.value
  if (!el) return
  const from = el.getBoundingClientRect().height
  await nextTick()
  const to = el.getBoundingClientRect().height
  if (prefersReducedMotion() || !from || !to || Math.abs(to - from) < 1) return

  animating.value = true
  // 连点时必须先把上一段断言作废：两段 WAAPI 同时作用于 height，
  // 收尾时谁最后写谁生效，容易把容器停在中间高度
  foldAnim?.cancel()
  const anim = el.animate(
    [{ height: `${from}px` }, { height: `${to}px` }],
    { duration: FOLD_MS, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)' },
  )
  foldAnim = anim
  // 被下一次切换打断时 finished 会 reject，交给新一轮接管，这里不清理
  anim.finished.then(
    () => {
      if (foldAnim !== anim) return
      animating.value = false
      foldAnim = null
    },
    () => {},
  )
})

onBeforeUnmount(() => {
  foldAnim?.cancel()
  foldAnim = null
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
    <div v-if="settings.cardCount === 9" class="detail-card split precip-card">
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
    <div v-if="settings.cardCount === 9" class="detail-card split air-card">
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
    <div v-if="settings.cardCount === 9" class="detail-card split vis-card">
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
