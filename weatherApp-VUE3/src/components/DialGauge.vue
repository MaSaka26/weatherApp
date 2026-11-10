<script setup>
import { computed } from 'vue'

import { useRingProgress } from '@/composables/useWeatherAnimations'

const props = defineProps({
  // 当前值；null = 还没有数据，环只画底轨
  value: { type: Number, default: null },
  min: { type: Number, default: 0 },
  max: { type: Number, default: 100 },
  // CSS 角度约定（0 = 正上方，顺时针）：225 = 左下，扫 270° 到右下，缺口在正下方
  start: { type: Number, default: 225 },
  sweep: { type: Number, default: 270 },
  // 缺口下方的小字（潮湿 / hPa …）
  caption: { type: String, default: '' },
  label: { type: String, default: '' },
  gradientStops: { type: Array, default: () => [] },
})

// 先归一化到 0–1 再补间，避免气压从 0 走到 970 hPa 时圆环一直停在起点。
const { value: ratio } = useRingProgress(
  () => props.value,
  () => props.min,
  () => props.max,
)
const GRADIENT_SEGMENTS = 120

function gradientColorAt(position) {
  const stops = props.gradientStops
  if (!stops.length) return 'var(--accent)'
  let upperIndex = stops.findIndex((stop) => stop.position >= position)
  if (upperIndex <= 0) return stops[Math.max(0, upperIndex)].color
  if (upperIndex === -1) return stops[stops.length - 1].color

  const lower = stops[upperIndex - 1]
  const upper = stops[upperIndex]
  const portion = (position - lower.position) / (upper.position - lower.position || 1)
  const lowerPercent = Math.round((1 - portion) * 100)
  const upperPercent = 100 - lowerPercent
  return `color-mix(in srgb, ${lower.color} ${lowerPercent}%, ${upper.color} ${upperPercent}%)`
}

const gradientSegments = computed(() => {
  if (!props.gradientStops.length || ratio.value <= 0) return []
  const progress = Math.min(1, Math.max(0, ratio.value))
  const segmentLength = arcLen.value / GRADIENT_SEGMENTS
  const count = Math.min(GRADIENT_SEGMENTS, Math.ceil(progress * GRADIENT_SEGMENTS))
  return Array.from({ length: count }, (_, index) => {
    const portion = Math.min(1, progress * GRADIENT_SEGMENTS - index)
    return {
      dash: `${segmentLength * portion} ${CIRC}`,
      offset: -segmentLength * index,
      color: gradientColorAt((index + portion / 2) / GRADIENT_SEGMENTS),
    }
  })
})

// 外径 100、线宽 10 → 半径取 45，环正好贴满 viewBox，缩放时比例不变
const RADIUS = 45
const CIRC = 2 * Math.PI * RADIUS
const arcLen = computed(() => (CIRC * props.sweep) / 360)
// SVG 的 0° 在 3 点钟方向，CSS 的 0deg 在 12 点钟方向，差 90°
const rotate = computed(() => `rotate(${props.start - 90} 50 50)`)

const trackDash = computed(() => `${arcLen.value} ${CIRC}`)
const fillDash = computed(() => `${arcLen.value * ratio.value} ${CIRC}`)

</script>

<template>
  <div class="dial" role="img" :aria-label="label || caption">
    <svg class="d-svg" viewBox="0 0 100 100" aria-hidden="true">
      <circle
        class="d-track"
        cx="50"
        cy="50"
        :r="RADIUS"
        :stroke-dasharray="trackDash"
        :transform="rotate"
      />
      <circle
        v-if="!gradientStops.length"
        class="d-fill"
        cx="50"
        cy="50"
        :r="RADIUS"
        :stroke-dasharray="fillDash"
        :transform="rotate"
      />
      <circle
        v-for="(segment, index) in gradientSegments"
        :key="index"
        class="d-fill"
        cx="50"
        cy="50"
        :r="RADIUS"
        :stroke-dasharray="segment.dash"
        :stroke-dashoffset="segment.offset"
        :stroke="segment.color"
        :transform="rotate"
      />
    </svg>
    <div class="d-center"><slot /></div>
    <span v-if="caption" class="d-caption">{{ caption }}</span>
  </div>
</template>
