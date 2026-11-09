<script setup>
import { computed, watch } from 'vue'

import { useTween } from '@/composables/useTween'

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
})

const { shown, tween } = useTween(1000, { snapFirst: true })

const ratio = computed(() => {
  const span = props.max - props.min
  if (!(span > 0)) return 0
  return Math.min(1, Math.max(0, (shown.value - props.min) / span))
})

// 外径 100、线宽 10 → 半径取 45，环正好贴满 viewBox，缩放时比例不变
const RADIUS = 45
const CIRC = 2 * Math.PI * RADIUS
const arcLen = computed(() => (CIRC * props.sweep) / 360)
// SVG 的 0° 在 3 点钟方向，CSS 的 0deg 在 12 点钟方向，差 90°
const rotate = computed(() => `rotate(${props.start - 90} 50 50)`)

const trackDash = computed(() => `${arcLen.value} ${CIRC}`)
const fillDash = computed(() => `${arcLen.value * ratio.value} ${CIRC}`)

watch(() => [props.value, props.min, props.max], () => tween(props.value), { immediate: true })
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
        class="d-fill"
        cx="50"
        cy="50"
        :r="RADIUS"
        :stroke-dasharray="fillDash"
        :transform="rotate"
      />
    </svg>
    <div class="d-center"><slot /></div>
    <span v-if="caption" class="d-caption">{{ caption }}</span>
  </div>
</template>
