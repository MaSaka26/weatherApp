<script setup>
/**
 * 12 格音浪：一条连续滚动的波峰。
 * 波峰高度为 peak，左右相邻按 0.5^距离 递减（1 : 1/2 : 1/4 …），
 * 用浮点相位 rAF 驱动，波峰平滑扫过，整体像一条 sin 形状的波浪。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps({
  count: { type: Number, default: 12 },
  base: { type: Number, default: 7 },
  peak: { type: Number, default: 26 },
  stepMs: { type: Number, default: 110 },
})

const bars = ref(Array.from({ length: props.count }, () => props.base))
let raf = 0
let start = 0
let reduced = false

function sample(elapsed) {
  // 波峰从 -2 扫到 count+1，两端留缓冲，循环回到起点时不会跳变
  const span = props.count + 3
  const phase = ((elapsed / props.stepMs) % span) - 2
  const amp = props.peak - props.base
  bars.value = bars.value.map((_, i) => {
    const d = Math.abs(i - phase)
    return Math.round((props.base + amp * Math.pow(0.5, d)) * 100) / 100
  })
}

function tick(ts) {
  if (!start) start = ts
  sample(ts - start)
  raf = requestAnimationFrame(tick)
}

onMounted(() => {
  reduced = typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduced) {
    sample(5 * props.stepMs)
    return
  }
  raf = requestAnimationFrame(tick)
})

onBeforeUnmount(() => {
  if (raf) cancelAnimationFrame(raf)
  raf = 0
})
</script>

<template>
  <span class="alert-wave" aria-hidden="true">
    <span
      v-for="(h, i) in bars"
      :key="i"
      class="alert-wave-bar"
      :style="{ height: h + 'px' }"
    ></span>
  </span>
</template>

<style scoped>
.alert-wave {
  display: flex;
  height: 26px;
  /* 底对齐：bottom 固定，增高时只有 top 上移 */
  align-items: flex-end;
  gap: 4px;
}
.alert-wave-bar {
  width: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.42);
  /* 无 CSS 动画：高度由 rAF 直接写，避免 transform 缩放导致上下同时长 */
}
</style>
