<script setup>
/**
 * 雷达扫描加载动画：Vue 移植自 React 版 RadarSweep。
 * 圆形容器 + 两圈同心圆 + 中心点，一束 conic-gradient 光束匀速旋转，
 * 形成「雷达扫描」观感。rAF 推进角度，尊重「减少动态效果」。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'

// 与原版一致：duration 1.8s、linear、repeat Infinity
const DURATION = 1800

const angle = ref(0)
let raf = 0
let startTs = 0

function tick() {
  const elapsed = (Date.now() - startTs) % DURATION
  angle.value = (elapsed / DURATION) * 360
  raf = requestAnimationFrame(tick)
}

onMounted(() => {
  const reduced =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduced) {
    angle.value = 45
    return
  }
  startTs = Date.now()
  raf = requestAnimationFrame(tick)
})

onBeforeUnmount(() => {
  if (raf) cancelAnimationFrame(raf)
  raf = 0
})
</script>

<template>
  <span class="radar-sweep" aria-hidden="true">
    <span class="radar-sweep-ring radar-sweep-ring--outer"></span>
    <span class="radar-sweep-ring radar-sweep-ring--inner"></span>
    <span class="radar-sweep-dot"></span>
    <span class="radar-sweep-hand" :style="{ transform: `rotate(${angle}deg)` }"></span>
  </span>
</template>

<style scoped>
.radar-sweep {
  position: relative;
  display: flex;
  width: 48px;
  height: 48px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 1px solid var(--radar-sweep-border, rgba(255, 255, 255, 0.1));
  border-radius: 50%;
}
.radar-sweep-ring {
  position: absolute;
  border: 1px solid var(--radar-sweep-ring, rgba(255, 255, 255, 0.05));
  border-radius: 50%;
}
.radar-sweep-ring--outer {
  width: 32px;
  height: 32px;
}
.radar-sweep-ring--inner {
  width: 16px;
  height: 16px;
}
.radar-sweep-dot {
  position: absolute;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--radar-sweep-dot, rgba(255, 255, 255, 0.8));
}
/* 光束：conic-gradient 从 12 点方向起转，尾端渐亮，模拟扫描拖影 */
.radar-sweep-hand {
  position: absolute;
  inset: 0;
  transform-origin: center center;
  background: conic-gradient(
    from 0deg,
    transparent 50%,
    var(--radar-sweep-c1, rgba(255, 255, 255, 0.02)) 65%,
    var(--radar-sweep-c2, rgba(255, 255, 255, 0.15)) 85%,
    var(--radar-sweep-c3, rgba(255, 255, 255, 0.55)) 100%
  );
}
</style>
