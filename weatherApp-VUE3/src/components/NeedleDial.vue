<script setup>
import { computed, onMounted, ref } from 'vue'

import { usePointerRotation } from '@/composables/useWeatherAnimations'

const props = defineProps({
  value: { type: Number, default: null },
  min: { type: Number, default: -20 },
  max: { type: Number, default: 40 },
  // 缺口下方的小字（舒适 / 偏凉 …）
  caption: { type: String, default: '' },
  label: { type: String, default: '' },
})

const START = 225
const SWEEP = 270
const RADIUS = 45
const CIRC = 2 * Math.PI * RADIUS
// 指针只在环内走，不压到环上，所以比半径短一截
const HAND = 27

// 色带比例沿用原来的 50% 蓝、25% 绿、25% 橙。
// 用 90 段插色绘制，分界仍落在 50% 和 75%，视觉效果与自定义 UV 表盘一致。
const COLOR_STOPS = [
  { pos: 0, token: '--accent', fallback: '#6db3f2' },
  { pos: 0.5, token: '--accent', fallback: '#6db3f2' },
  { pos: 0.75, token: '--uv-1', fallback: '#22c55e' },
  { pos: 1, token: '--temp-high', fallback: '#fb923c' },
]

const arcTotal = (CIRC * SWEEP) / 360
const SEGMENTS = 90

function hexToRgb(hex) {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim())
  return match
    ? [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)]
    : [255, 255, 255]
}

const rgbCss = ([r, g, b]) => `rgb(${r}, ${g}, ${b})`
const colorStops = ref(COLOR_STOPS.map((stop) => ({
  pos: stop.pos,
  rgb: hexToRgb(stop.fallback),
})))

function colorAt(position) {
  const ratio = Math.min(1, Math.max(0, position))
  for (let index = 0; index < colorStops.value.length - 1; index++) {
    const from = colorStops.value[index]
    const to = colorStops.value[index + 1]
    if (ratio >= from.pos && ratio <= to.pos) {
      const weight = (ratio - from.pos) / (to.pos - from.pos)
      return rgbCss(from.rgb.map((channel, i) =>
        Math.round(channel + (to.rgb[i] - channel) * weight),
      ))
    }
  }
  return rgbCss(colorStops.value[colorStops.value.length - 1].rgb)
}

const bands = computed(() =>
  Array.from({ length: SEGMENTS }, (_, index) => {
    const from = index / SEGMENTS
    const to = (index + 1) / SEGMENTS
    return {
      color: colorAt((from + to) / 2),
      dash: `${(to - from) * arcTotal} ${CIRC}`,
      offset: -from * arcTotal,
    }
  }),
)

onMounted(() => {
  const styles = getComputedStyle(document.documentElement)
  colorStops.value = COLOR_STOPS.map((stop) => ({
    pos: stop.pos,
    rgb: hexToRgb(styles.getPropertyValue(stop.token).trim() || stop.fallback),
  }))
})

const targetAngle = computed(() => {
  const span = props.max - props.min
  if (!Number.isFinite(props.value) || !(span > 0)) return null
  const ratio = Math.min(1, Math.max(0, (props.value - props.min) / span))
  return START + ratio * SWEEP
})

const { angle: shownAngle } = usePointerRotation(() => targetAngle.value, {
  initialAngle: START,
  firstDirection: 'clockwise',
})

const hand = computed(() => {
  const rad = ((shownAngle.value - 90) * Math.PI) / 180
  return { x: 50 + HAND * Math.cos(rad), y: 50 + HAND * Math.sin(rad) }
})
</script>

<template>
  <div class="dial needle-dial" role="img" :aria-label="label || caption">
    <svg class="d-svg" viewBox="0 0 100 100" aria-hidden="true">
      <circle
        v-for="(b, i) in bands"
        :key="i"
        class="nd-band"
        cx="50"
        cy="50"
        :r="RADIUS"
        :stroke="b.color"
        :stroke-dasharray="b.dash"
        :stroke-dashoffset="b.offset"
        :transform="`rotate(${START - 90} 50 50)`"
      />
      <line class="nd-hand" x1="50" y1="50" :x2="hand.x" :y2="hand.y" />
      <circle class="nd-pin" cx="50" cy="50" r="4.2" />
    </svg>
    <span v-if="caption" class="d-caption">{{ caption }}</span>
  </div>
</template>
