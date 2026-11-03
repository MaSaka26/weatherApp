<script setup>
import { computed } from 'vue'

import { settings } from '@/composables/useSettings'
import DialGauge from '@/components/DialGauge.vue'
import NeedleDial from '@/components/NeedleDial.vue'
import UvGauge from '@/components/UvGauge.vue'
import WindCompass from '@/components/WindCompass.vue'

const props = defineProps({
  current: { type: Object, required: true },
  daily: { type: Object, default: null },
})

// 卡片 item 布局由设置决定：layout-row 左文右图（默认）/ layout-stack 文字在上图形在下。
// 手机、平板、桌面三档都听这个设置，样式分档在 weather.css 的各段媒体查询里
// 两套排布都留在 weather.css 里，切换只换类名，数据与组件不用动
const layoutClass = computed(() =>
  settings.cardLayout === 'stack' ? 'layout-stack' : 'layout-row',
)

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
  <div class="details-grid" :class="layoutClass">
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
</template>
