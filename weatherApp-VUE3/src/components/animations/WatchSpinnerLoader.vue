<script setup>
/**
 * 三环手表式加载动画：Vue 移植自 React 版 WatchSpinner。
 * 三枚同心圆环（44 / 32 / 20px）各自只亮「上边」一段，以 1s / 1.5s / 2s
 * 三种不同周期同步 easeInOut 旋转，形成错落的三层转速。
 *
 * 实现取舍：这里用 CSS keyframes 而不是 rAF。
 * 本动画只做纯角度旋转、没有逐帧计算的状态，交给 CSS 动画可跑在合成线程上，
 * 不占用主线程；「减少动态效果」也由 media query 直接降级。
 */
</script>

<template>
  <span class="watch-spinner" aria-hidden="true">
    <span class="watch-ring watch-ring--1"></span>
    <span class="watch-ring watch-ring--2"></span>
    <span class="watch-ring watch-ring--3"></span>
  </span>
</template>

<style scoped>
.watch-spinner {
  position: relative;
  display: flex;
  width: 48px;
  height: 48px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
}
.watch-ring {
  position: absolute;
  border: 3px solid transparent;
  border-top-color: var(--watch-ring-main, #ffffff);
  border-radius: 50%;
  /* ease-in-out 与原版 framer-motion 的 ease: "easeInOut" 一致 */
  animation-name: watch-spin;
  animation-timing-function: cubic-bezier(0.42, 0, 0.58, 1);
  animation-iteration-count: infinite;
  will-change: transform;
}
/* 尺寸 44 - i*12 → 44 / 32 / 20；时长 1 + i*0.5 → 1s / 1.5s / 2s */
.watch-ring--1 {
  width: 44px;
  height: 44px;
  animation-duration: 1s;
}
.watch-ring--2 {
  width: 32px;
  height: 32px;
  animation-duration: 1.5s;
}
.watch-ring--3 {
  width: 20px;
  height: 20px;
  animation-duration: 2s;
}
@keyframes watch-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .watch-ring {
    animation-duration: 4s;
  }
}
</style>
