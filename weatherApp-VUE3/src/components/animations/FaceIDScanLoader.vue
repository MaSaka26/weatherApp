<script setup>
/**
 * 人脸识别（FaceID）扫描加载动画：Vue 移植自 React 版 FaceIDScan。
 * 方框内一个圆形人像图标，一条绿色扫描线自上而下、再由下而上往返，
 * 形成「正在识别」观感。rAF 推进位置，尊重「减少动态效果」。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

// 与原版一致：整段（下→上）duration 2.5s、linear、repeat Infinity
const DURATION = 2500
// 扫描线高 32px，容器 48px → 移动范围以百分比表达（-100% .. 100%）
const FROM = -100
const TO = 100

const phase = ref(0) // 0..1，一个完整往返周期
let raf = 0
let startTs = 0

// 3 个关键帧（-100% → 100% → -100%）在前半程、后半程各走一段
const top = computed(() => {
  const p = phase.value
  const raw = p < 0.5 ? FROM + (TO - FROM) * (p * 2) : TO + (FROM - TO) * ((p - 0.5) * 2)
  return raw + '%'
})

function tick() {
  const elapsed = (Date.now() - startTs) % DURATION
  phase.value = elapsed / DURATION
  raf = requestAnimationFrame(tick)
}

onMounted(() => {
  const reduced =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduced) {
    phase.value = 0.25 // 停在容器中部
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
  <span class="faceid-scan" aria-hidden="true">
    <svg class="faceid-scan-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"
      />
    </svg>
    <span class="faceid-scan-line" :style="{ top }"></span>
  </span>
</template>

<style scoped>
.faceid-scan {
  position: relative;
  display: flex;
  width: 48px;
  height: 48px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 2px solid var(--faceid-border, rgba(212, 212, 216, 0.55));
  border-radius: 12px;
}
.faceid-scan-icon {
  width: 24px;
  height: 24px;
  fill: var(--faceid-icon, rgba(255, 255, 255, 0.35));
}
/* 扫描线：上透明下绿的渐变 + 绿色底边，水平铺满整框 */
.faceid-scan-line {
  position: absolute;
  left: 0;
  width: 100%;
  height: 32px;
  border-bottom: 1px solid var(--faceid-line, #22c55e);
  background: linear-gradient(to bottom, transparent, var(--faceid-glow, rgba(74, 222, 128, 0.3)));
}
</style>
