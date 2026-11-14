<script setup>
/**
 * 旋转方块加载动画：Vue 移植自 React 版 SpinningSquares（framer-motion）。
 *
 * 两个方块沿正方形轨迹对角错位奔跑：一块从左上去右下，另一块反向从右下去左上，
 * 2s 一圈、ease-in-out、无限循环。原版两个方块互为 180° 点对称，
 * 所以第二块就是第一块的关键帧取负。
 *
 * 实现取舍：原版用 framer-motion 的关键帧数组
 * [0, 24, 24, 0, 0] / [0, 0, 24, 24, 0]（每段单独 easeInOut），
 * 这里直接改写成 CSS @keyframes —— CSS 的 animation-timing-function 本来就
 * 作用于每一段关键帧之间，语义与 framer-motion 的逐段 easing 完全一致，
 * 而且跑在合成线程上，不占主线程。
 *
 * 尺寸：组件铺满父容器，内部全部用百分比 —— 方块边长 40%、行程 60%
 * （translate 的百分比相对自身宽度，40% × 150% = 60%），与 16 / 24 / 40
 * 的原版比例完全一致。因此不需要 size 参数，塞进多大盒子就长多大。
 */
</script>

<template>
  <span class="spinning-squares" aria-hidden="true">
    <span class="spinning-squares-cell spinning-squares-cell--lead"></span>
    <span class="spinning-squares-cell spinning-squares-cell--trail"></span>
  </span>
</template>

<style scoped>
.spinning-squares {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
}
.spinning-squares-cell {
  position: absolute;
  width: 40%;
  height: 40%;
  /* 原版 rounded-sm：16px 方块上 2px 圆角 = 12.5%，按比例缩放后观感一致 */
  border-radius: 12.5%;
  /* ease-in-out 与 framer-motion 的 ease: "easeInOut" 是同一条曲线 */
  animation-duration: 2s;
  animation-timing-function: cubic-bezier(0.42, 0, 0.58, 1);
  animation-iteration-count: infinite;
  will-change: transform;
}
/* 前景块：原版 dark:bg-white，跟随按钮前景色 */
.spinning-squares-cell--lead {
  top: 0;
  left: 0;
  background: var(--spinning-squares-lead, var(--text-0));
  animation-name: squares-lead;
}
/* 背景块：原版 dark:bg-zinc-700；这里用半透明白压出层次，深浅背景下都不突兀 */
.spinning-squares-cell--trail {
  right: 0;
  bottom: 0;
  background: var(--spinning-squares-trail, rgba(255, 255, 255, 0.34));
  animation-name: squares-trail;
}
/* 左上 → 右上 → 右下 → 左下 → 回到左上，每段各自 ease-in-out。
   150% 是相对方块自身（= 容器 40%）的行程，换算成容器就是 60% */
@keyframes squares-lead {
  0% { transform: translate(0, 0); }
  25% { transform: translate(150%, 0); }
  50% { transform: translate(150%, 150%); }
  75% { transform: translate(0, 150%); }
  100% { transform: translate(0, 0); }
}
@keyframes squares-trail {
  0% { transform: translate(0, 0); }
  25% { transform: translate(-150%, 0); }
  50% { transform: translate(-150%, -150%); }
  75% { transform: translate(0, -150%); }
  100% { transform: translate(0, 0); }
}
/* 减少动态效果：停在「对角两块」的静止构图，仍有辨识度 */
@media (prefers-reduced-motion: reduce) {
  .spinning-squares-cell { animation: none; }
}
</style>
