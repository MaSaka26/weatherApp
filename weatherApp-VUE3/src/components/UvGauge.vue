<script setup>
import { computed, onMounted, ref } from 'vue'

import { useRingProgress } from '@/composables/useWeatherAnimations'
import AnimatedNumber from '@/components/AnimatedNumber.vue'

const props = defineProps({
  // 紫外线指数（取当日峰值）；null = 还没有数据
  value: { type: Number, default: null },
  // 量程上限，UV 指数常规是 0～11，超过按满格处理
  max: { type: Number, default: 11 },
  // 缺口处的小标题，原稿是 UV
  title: { type: String, default: 'UV' },
})

// 270° 表盘：从 225°（左下）顺时针到 135°（右下），缺口留在正下方。
// 和湿度/气压/体感同一套几何：外径 100、环宽 10、半径 45、圆头收尾
const START = 225
const SWEEP = 270
const RADIUS = 45
const RING = 10
const CIRC = 2 * Math.PI * RADIUS
const ARC = (CIRC * SWEEP) / 360
// SVG 的 0° 在 3 点钟方向，CSS 的 0deg 在 12 点钟方向，差 90°
const ROT = `rotate(${START - 90} 50 50)`
// 色带拆成 90 小段画，段间用圆头互相压住 → 既没有接缝，也复刻出渐变
const SEGS = 90
// 扇形裁剪的半径要盖住整个环（半径 50），取 70 时 30° 一段的弦离圆心仍有 67
const WEDGE_R = 70

// 原稿的色阶：绿 → 黄 → 橙 → 红 → 紫，量程上均匀分四段，段间直接线性插值。
// 取主题里的 --uv-1..5，取不到时用兜底色（与 weather.css 中 --uv-* 保持一致）
const STOPS = [
  { pos: 0, token: '--uv-1', fallback: '#22c55e' },
  { pos: 0.25, token: '--uv-2', fallback: '#eab308' },
  { pos: 0.5, token: '--uv-3', fallback: '#f97316' },
  { pos: 0.75, token: '--uv-4', fallback: '#ef4444' },
  { pos: 1, token: '--uv-5', fallback: '#a855f7' },
]

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim())
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [255, 255, 255]
}
const rgbCss = ([r, g, b]) => `rgb(${r}, ${g}, ${b})`

const stops = ref(STOPS.map((s) => ({ pos: s.pos, rgb: hexToRgb(s.fallback) })))

const hasValue = computed(() => Number.isFinite(props.value))

const range = computed(() => (props.max > 0 ? props.max : 11))
const { value: ratio } = useRingProgress(() => props.value, 0, () => range.value)
const animatedValue = computed(() => (hasValue.value ? props.value : null))

function colorAt(p) {
  const list = stops.value
  const t = Math.min(1, Math.max(0, p))
  for (let i = 0; i < list.length - 1; i++) {
    const a = list[i]
    const b = list[i + 1]
    if (t >= a.pos && t <= b.pos) {
      const k = (t - a.pos) / (b.pos - a.pos)
      return rgbCss(a.rgb.map((v, j) => Math.round(v + (b.rgb[j] - v) * k)))
    }
  }
  return rgbCss(list[list.length - 1].rgb)
}

// 每一小段画成一段圆弧，颜色取该段中点的插值色。
// 圆头会往两边各多伸出半个环宽，段与段就叠在一起，看不出接缝
const segs = computed(() => {
  const out = []
  for (let i = 0; i < SEGS; i++) {
    const a = i / SEGS
    const b = (i + 1) / SEGS
    out.push({
      key: i,
      color: colorAt((a + b) / 2),
      dash: `${(b - a) * ARC} ${CIRC}`,
      offset: -a * ARC,
    })
  }
  return out
})

const trackDash = `${ARC} ${CIRC}`

// 裁剪扇形：从 225° 扫到「当前值」，把彩带切在指针位置。
// 切口是一刀直边，两端各压一枚「和环同宽」的圆点（起点帽 + 当前值点），
// 正好把直口补成半圆头 —— 和另外几颗用 stroke-linecap: round 画的环完全一致
function polar(p) {
  const rad = ((START + p * SWEEP) * Math.PI) / 180
  return { x: 50 + RADIUS * Math.sin(rad), y: 50 - RADIUS * Math.cos(rad) }
}

const wedge = computed(() => {
  const deg = ratio.value * SWEEP
  const steps = Math.max(1, Math.ceil(deg / 30))
  const pts = ['50 50']
  for (let i = 0; i <= steps; i++) {
    const rad = ((START + (deg * i) / steps) * Math.PI) / 180
    const x = 50 + WEDGE_R * Math.sin(rad)
    const y = 50 - WEDGE_R * Math.cos(rad)
    pts.push(`${x.toFixed(2)} ${y.toFixed(2)}`)
  }
  return `M${pts.join(' L')} Z`
})

const capPos = polar(0)
const dotPos = computed(() => polar(ratio.value))

// 每实例一个 id：万一以后同页放两个表盘，裁剪也不会互相抢
const clipId = `uv-clip-${Math.random().toString(36).slice(2, 8)}`

const ariaLabel = computed(() =>
  hasValue.value ? `紫外线指数 ${props.value.toFixed(1)}` : '紫外线暂无数据',
)

onMounted(() => {
  // 配色跟着主题 token 走
  const cs = getComputedStyle(document.documentElement)
  stops.value = STOPS.map((s) => ({
    pos: s.pos,
    rgb: hexToRgb(cs.getPropertyValue(s.token).trim() || s.fallback),
  }))
})
</script>

<template>
  <div class="uv-gauge" role="img" :aria-label="ariaLabel">
    <svg class="g-svg" viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <clipPath :id="clipId">
          <path :d="wedge" />
        </clipPath>
      </defs>
      <circle
        class="g-track"
        cx="50"
        cy="50"
        :r="RADIUS"
        :stroke-dasharray="trackDash"
        :transform="ROT"
      />
      <g :clip-path="`url(#${clipId})`">
        <circle
          v-for="s in segs"
          :key="s.key"
          class="g-seg"
          cx="50"
          cy="50"
          :r="RADIUS"
          :stroke="s.color"
          :stroke-dasharray="s.dash"
          :stroke-dashoffset="s.offset"
          :transform="ROT"
        />
      </g>
      <circle
        class="g-cap"
        :cx="capPos.x"
        :cy="capPos.y"
        :r="RING / 2"
        :fill="colorAt(0)"
      />
      <circle
        v-if="hasValue"
        class="g-dot"
        :cx="dotPos.x"
        :cy="dotPos.y"
        :r="RING / 2"
        :fill="colorAt(ratio)"
      />
    </svg>
    <AnimatedNumber class="g-value" :value="animatedValue" :decimals="1" />
    <span v-if="title" class="g-title" aria-hidden="true">{{ title }}</span>
  </div>
</template>
