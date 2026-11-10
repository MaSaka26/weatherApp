<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

import { getConditionText } from '@/utils/weatherCodes'
import { useWheelScroll } from '@/composables/useWheelScroll'

const props = defineProps({
  // [{ key, name, dateLabel, icon, condition, high, low, isToday }]
  items: { type: Array, required: true },
})

const scrollHost = ref(null)
const chartHost = ref(null)
const state = ref('loading') // loading | ready | failed
const hostWidth = ref(0)
const hostHeight = ref(0)
const scrollable = ref(false)

// 指针是否为触摸（用于切换「滑动 / 滚动」文案）
const coarsePointer = ref(
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(pointer: coarse)').matches
    : false,
)

// 桌面端：滚轮纵向滚动时横向翻看曲线
useWheelScroll(scrollHost, { enabled: () => state.value === 'ready' })

// 温度色阶：低温青蓝 -> 浅蓝 -> 琥珀 -> 高温橙（与曲线渐变同一组色标，避免 RGB 直插发灰）
const RAMP = [
  [0, [56, 189, 248]], // 青蓝
  [0.42, [125, 211, 252]], // 浅蓝
  [0.74, [252, 211, 77]], // 琥珀
  [1, [251, 146, 60]], // 橙
]

function tempColor(t, min, max) {
  const ratio = max === min ? 0.5 : Math.min(1, Math.max(0, (t - min) / (max - min)))
  let i = 1
  while (i < RAMP.length - 1 && ratio > RAMP[i][0]) i++
  const [p0, c0] = RAMP[i - 1]
  const [p1, c1] = RAMP[i]
  const k = p1 === p0 ? 0 : (ratio - p0) / (p1 - p0)
  const [r, g, b] = c0.map((c, j) => Math.round(c + (c1[j] - c) * k))
  return `rgb(${r},${g},${b})`
}

let hcPromise = null
/** 按需加载项目依赖里的 Highcharts，首次切到曲线视图才会下载对应 chunk。
 *  不再优先请求第三方 CDN：版本固定、可离线预缓存，也不会因为 CDN 挂起而卡死。 */
function loadHighcharts() {
  if (!hcPromise) {
    hcPromise = import('highcharts')
      .then((mod) => mod.default || mod)
      .catch((err) => {
        hcPromise = null // 允许重试
        throw err
      })
  }
  return hcPromise
}

let chart = null

/** Highcharts 用 canvas/SVG 渲染，读不到 CSS 变量，
 *  只能把设计变量取出来传进配置，保证图表和界面共用同一套色值 */
function readTheme() {
  const root = document.documentElement
  const cs = getComputedStyle(root)
  const v = (name, fallback) => (cs.getPropertyValue(name) || '').trim() || fallback
  // 变量里写的是 calc(12px * var(--radius-scale))，直接读拿到的是表达式而非数值，
  // 塞进一个探针元素让浏览器算一次才能得到真实像素
  const px = (name, fallback) => {
    const probe = document.createElement('div')
    probe.style.cssText = `position:absolute;left:-9999px;top:0;width:var(${name})`
    root.appendChild(probe)
    const w = parseFloat(getComputedStyle(probe).width)
    probe.remove()
    return Number.isFinite(w) ? w : fallback
  }
  return {
    text0: v('--text-0', '#ffffff'),
    text1: v('--text-1', 'rgba(255,255,255,0.96)'),
    text3: v('--text-3', 'rgba(255,255,255,0.78)'),
    text5: v('--text-5', 'rgba(255,255,255,0.62)'),
    line2: v('--line-2', 'rgba(255,255,255,0.16)'),
    line3: v('--line-3', 'rgba(255,255,255,0.12)'),
    lineGrid: v('--line-grid', 'rgba(255,255,255,0.07)'),
    tempHigh: v('--temp-high', '#fb923c'),
    tempLow: v('--temp-low', '#60a5fa'),
    tooltipBg: v('--tooltip-bg', 'rgba(16,28,46,0.92)'),
    radiusSm: px('--radius-sm', 12),
  }
}

function buildOptions() {
  const items = props.items
  const T = readTheme()
  const highs = items.map((i) => i.high)
  const lows = items.map((i) => i.low)

  const dataMin = Math.min(...lows)
  const dataMax = Math.max(...highs)
  // 少量留白：让曲线铺满绘图区，竖向色阶才有从青蓝到橙的完整过渡
  const pad = Math.max(1.5, (dataMax - dataMin) * 0.08)
  const yMin = Math.floor(dataMin - pad)
  const yMax = Math.ceil(dataMax + pad)

  // 16 天在窄屏放不下：每个点固定 62px，外层横向滚动
  const width = hostWidth.value || 360
  // 高度跟着卡片走（卡片高度由 CSS 变量 --daily-view-h 统一，列表视图同高）
  const height = hostHeight.value || 344

  // 竖向渐变（userSpaceOnUse 像素坐标）：低温青蓝 -> 高温橙
  // 两条曲线共用同一色阶，颜色真正编码温度；y 坐标与下方 chart.margin 对应
  const PLOT_TOP = 46
  const PLOT_BOTTOM = height - 104
  const lineGradient = (alpha) => ({
    linearGradient: [0, PLOT_BOTTOM, 0, PLOT_TOP],
    stops: [
      [0, `rgba(56,189,248,${alpha})`], // 青蓝（低温）
      [0.42, `rgba(125,211,252,${alpha})`], // 浅蓝
      [0.74, `rgba(252,211,77,${alpha})`], // 琥珀
      [1, `rgba(251,146,60,${alpha})`], // 橙（高温）
    ],
  })

  return {
    chart: {
      type: 'spline',
      backgroundColor: 'transparent',
      width,
      height,
      marginTop: PLOT_TOP,
      marginBottom: 104,
      marginLeft: 44,
      marginRight: 16,
      spacing: [0, 0, 0, 0],
      style: { fontFamily: 'inherit' },
      animation: { duration: 600 },
      events: {
        // Y 轴渐变：在轴线位置画一条竖向渐变细条
        load() {
          const axis = this.yAxis[0]
          if (!axis) return
          this.renderer
            .rect(this.plotLeft - 7, this.plotTop, 3, this.plotHeight)
            .attr({
              fill: {
                linearGradient: { x1: 0, y1: 1, x2: 0, y2: 0 },
                stops: [
                  [0, 'rgba(56,189,248,0.9)'],
                  [1, 'rgba(251,146,60,0.9)'],
                ],
              },
              r: 2,
            })
            .add()
        },
      },
    },
    title: { text: null },
    credits: { enabled: false },
    legend: {
      enabled: true,
      align: 'left',
      verticalAlign: 'top',
      y: -4,
      symbolRadius: 5,
      symbolWidth: 14,
      symbolHeight: 3,
      itemDistance: 18,
      itemStyle: {
        color: T.text3,
        fontWeight: '400',
        fontSize: '12px',
      },
      itemHoverStyle: { color: T.text0 },
    },
    xAxis: {
      categories: items.map((i) => i.name),
      lineColor: T.line3,
      lineWidth: 1,
      tickLength: 0,
      crosshair: {
        width: 1,
        color: T.line2,
        dashStyle: 'ShortDash',
      },
      labels: {
        useHTML: true,
        // 四行纵向排列：今天 / 10-30 / 图标 / 天气
        formatter() {
          const it = items[this.pos]
          if (!it) return ''
          return (
            `<div class="dc-x">` +
            `<span class="dc-x-day${it.isToday ? ' dc-x-today' : ''}">${it.name}</span>` +
            `<span class="dc-x-date">${it.dateLabel}</span>` +
            `<span class="dc-x-icon">${it.icon}</span>` +
            `<span class="dc-x-cond">${getConditionText(it.code)}</span>` +
            `</div>`
          )
        },
      },
    },
    yAxis: {
      min: yMin,
      max: yMax,
      tickInterval: Math.max(1, Math.round((yMax - yMin) / 4)),
      title: { text: null },
      gridLineColor: T.lineGrid,
      gridLineDashStyle: 'ShortDash',
      plotBackgroundColor: {
        linearGradient: { x1: 0, y1: 1, x2: 0, y2: 0 },
        stops: [
          [0, 'rgba(56,189,248,0.07)'],
          [1, 'rgba(251,146,60,0.07)'],
        ],
      },
      labels: {
        useHTML: true,
        formatter() {
          const color = tempColor(this.value, yMin, yMax)
          return `<span style="color:${color};font-size:0.6875rem">${this.value}°</span>`
        },
      },
    },
    tooltip: {
      shared: true,
      useHTML: true,
      backgroundColor: T.tooltipBg,
      borderWidth: 0,
      borderRadius: T.radiusSm,
      shadow: false,
      padding: 10,
      style: { color: T.text1, fontSize: '12px' },
      formatter() {
        const it = items[this.x]
        if (!it) return false
        return (
          `<div style="font-size:0.6875rem;color:${T.text5}">` +
          `${it.name} ${it.dateLabel} · ${getConditionText(it.code)}</div>` +
          `<div style="margin-top:4px">最高 <b style="color:${T.tempHigh}">${it.high}°</b>` +
          `　最低 <b style="color:${T.tempLow}">${it.low}°</b></div>`
        )
      },
    },
    plotOptions: {
      spline: {
        lineWidth: 3,
        states: { hover: { lineWidthPlus: 0 } },
        marker: {
          enabled: true,
          symbol: 'circle',
          radius: 3.4,
          lineWidth: 1.6,
          lineColor: 'rgba(8,18,32,0.5)',
          states: { hover: { radius: 5 } },
        },
      },
    },
    series: [
      {
        name: '最高温',
        data: highs,
        color: lineGradient(1),
        // 曲线本身是渐变，图例小方块若跟着渐变会显得脏，这里单独给纯色
        legendSymbolColor: T.tempHigh,
        zIndex: 3,
        // 数值直接标在点上方，不用悬停才看得到
        dataLabels: {
          enabled: true,
          crop: false,
          overflow: 'allow',
          align: 'center',
          verticalAlign: 'bottom',
          y: -9,
          formatter() {
            return `${this.y}°`
          },
          style: {
            color: T.tempHigh,
            fontSize: '11px',
            fontWeight: '600',
            // Highcharts 的数据标签默认带 textOutline: '1px contrast'，
            // 它会在文字底下再画一层 <tspan class="highcharts-text-outline" stroke-width="2px">，
            // 表现为数字周围一圈黑边。这里显式关掉。
            textOutline: 'none',
          },
        },
      },
      {
        name: '最低温',
        data: lows,
        color: lineGradient(0.95),
        legendSymbolColor: T.tempLow,
        lineWidth: 2.2,
        dashStyle: 'ShortDash',
        zIndex: 2,
        // 最低温标在点下方，两条曲线的数字不会互相打架
        dataLabels: {
          enabled: true,
          crop: false,
          overflow: 'allow',
          align: 'center',
          verticalAlign: 'top',
          y: 9,
          formatter() {
            return `${this.y}°`
          },
          style: {
            color: T.tempLow,
            fontSize: '11px',
            fontWeight: '600',
            textOutline: 'none',
          },
        },
      },
    ],
  }
}

const MIN_PER_DAY = 62 // 需要横滑时，每个数据点的固定宽度
const FIT_PER_DAY = 52 // 一屏放下时，每个数据点的最小可读宽度（四行标签不重叠）

/**
 * 容器够宽就让 16 天铺满一屏（桌面），不够宽才按固定点宽横向滚动（手机）。
 * 旧逻辑恒取 max(容器, 16*62+44)，导致宽屏明明放得下也要横滑。
 */
function targetWidth() {
  const cw = scrollHost.value?.clientWidth || 360
  const n = props.items.length || 1
  if (cw / n >= FIT_PER_DAY) return Math.round(cw)
  return Math.max(cw, n * MIN_PER_DAY + 44)
}

function computeSize() {
  hostWidth.value = targetWidth()
  // 高度由卡片撑开（.dc-scroll 在固定高的 .dc-wrap 里 flex 布局），这里读实际值传给 Highcharts
  hostHeight.value = scrollHost.value?.clientHeight || 0
}

async function render() {
  state.value = 'loading'
  computeSize()
  await nextTick() // 先让宿主 div 拿到目标宽度，避免 Highcharts 被裁切
  try {
    const Highcharts = await loadHighcharts()
    if (!chartHost.value) return
    chart?.destroy()
    chart = Highcharts.chart(chartHost.value, buildOptions())
    state.value = 'ready'
    await nextTick()
    scrollable.value = (scrollHost.value?.scrollWidth || 0) > (scrollHost.value?.clientWidth || 0) + 4
  } catch {
    state.value = 'failed'
  }
}

function onResize() {
  const target = targetWidth()
  const targetH = scrollHost.value?.clientHeight || 0
  if (Math.abs(target - hostWidth.value) > 8 || Math.abs(targetH - hostHeight.value) > 8) render()
}

onMounted(() => {
  render()
  window.addEventListener('resize', onResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  chart?.destroy()
  chart = null
})
</script>

<template>
  <div class="dc-wrap">
    <div v-if="state === 'failed'" class="dc-failed">
      图表组件加载失败，可切换到列表视图查看
    </div>
    <div ref="scrollHost" class="dc-scroll" :class="{ 'is-loading': state !== 'ready' }">
      <div
        ref="chartHost"
        class="dc-host"
        :style="{ width: hostWidth ? hostWidth + 'px' : '100%' }"
      ></div>
      <div v-if="state === 'loading'" class="dc-loading">正在加载图表…</div>
    </div>
    <div v-if="state === 'ready' && scrollable" class="dc-hint">
      {{ coarsePointer ? '左右滑动查看全部 16 天' : '滚动查看全部 16 天' }}
    </div>
  </div>
</template>
