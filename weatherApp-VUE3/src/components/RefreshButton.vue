<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'

import SpinningSquaresLoader from '@/components/animations/SpinningSquaresLoader.vue'
import { useWeatherStore } from '@/stores/weather'

const store = useWeatherStore()

// 旋转状态来自 store.isFetching，而不是组件自己的局部 flag：
// 首屏自动拉、6 分钟定时拉、手动点，三种来源都会让图标转起来。
// 组件只管「点一下」，不维护「我在转」这份状态，避免两处状态打架。
const refreshing = computed(() => store.isFetching)
const feedback = ref('')
const feedbackKind = ref('pending')
let feedbackTimer = null
let feedbackRequest = 0

function showFeedback(message, kind, duration = 2400) {
  feedback.value = message
  feedbackKind.value = kind
  clearTimeout(feedbackTimer)
  feedbackTimer = setTimeout(() => { feedback.value = '' }, duration)
}

async function onClick() {
  if (refreshing.value) {
    showFeedback('天气正在更新，请稍候', 'pending', 1800)
    return
  }
  if (store.lat == null || store.lon == null) {
    showFeedback('当前没有可刷新的天气数据', 'error', 2800)
    return
  }

  const requestId = ++feedbackRequest
  const startedAt = Date.now()
  clearTimeout(feedbackTimer)
  feedback.value = '正在刷新天气…'
  feedbackKind.value = 'pending'

  let succeeded = false
  try {
    succeeded = await store.refresh()
  } catch {
    // 异常也通过统一提示反馈，保留当前天气数据供用户继续查看。
  }

  // 短请求也保留一小段可见时间，避免提示一闪而过。
  const remaining = 500 - (Date.now() - startedAt)
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining))
  if (requestId !== feedbackRequest) return

  if (succeeded) {
    showFeedback('天气已更新', 'success')
  } else if (store.lastError) {
    showFeedback(`刷新失败：${store.lastError}`, 'error', 3600)
  } else {
    showFeedback('刷新失败，当前天气数据已保留', 'error', 3600)
  }
}

onBeforeUnmount(() => {
  feedbackRequest += 1
  clearTimeout(feedbackTimer)
})
</script>

<template>
  <div class="refresh-control">
    <button
      class="refresh-btn"
      :title="refreshing ? '正在更新…' : '刷新天气'"
      :aria-label="refreshing ? '正在刷新天气' : '刷新天气'"
      :aria-busy="refreshing"
      @click="onClick"
    >
      <span class="refresh-icon" aria-hidden="true">
        <!-- 刷新中换成动画，按钮尺寸/其余样式完全不动：容器固定 32px，
             动画与 ⟳ 共用一个居中盒子，切换时不会引起布局跳动 -->
        <SpinningSquaresLoader v-if="refreshing" />
        <template v-else>⟳</template>
      </span>
    </button>
    <Transition name="refresh-feedback">
      <div v-if="feedback" class="refresh-feedback" :class="`is-${feedbackKind}`" role="status" aria-live="polite" aria-atomic="true">
        <span class="refresh-feedback-mark" aria-hidden="true">{{ feedbackKind === 'success' ? '✓' : feedbackKind === 'error' ? '!' : '' }}</span>
        <span>{{ feedback }}</span>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.refresh-control { position: relative; flex: 0 0 auto; margin-top: 20px; }
.refresh-control .refresh-btn { margin-top: 0; }
/* 图标容器锁死 32px：动画与 ⟳ 字符共用同一个盒子，互换时按钮不抖。
   按钮本身的 48px / 44px 尺寸仍由 responsive.css 决定，这里不碰。 */
.refresh-icon {
  display: inline-flex;
  width: 32px;
  height: 32px;
  align-items: center;
  justify-content: center;
  font-size: 1.25rem;
  line-height: 1;
}
/* 窄屏按钮收到 44px，图标盒同比收一档，四周仍留 6px */
@media (max-width: 344px) {
  .refresh-icon { width: 28px; height: 28px; font-size: 1.125rem; }
}
.refresh-feedback {
  position: fixed;
  z-index: 90;
  top: calc(env(safe-area-inset-top, 0px) + 82px);
  left: 50%;
  display: flex;
  width: max-content;
  max-width: calc(100vw - 32px);
  align-items: center;
  gap: 9px;
  padding: 11px 15px;
  transform: translateX(-50%);
  border: 1px solid var(--line-2);
  border-radius: 999px;
  color: var(--text-0);
  background: rgba(12, 20, 34, .94);
  box-shadow: 0 8px 28px rgba(0, 0, 0, .28);
  backdrop-filter: blur(14px);
  font-size: 0.8125rem;
  line-height: 1.35;
  text-align: left;
  overflow-wrap: anywhere;
  pointer-events: none;
}
.refresh-feedback-mark {
  display: grid;
  width: 17px;
  height: 17px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 50%;
  font-weight: 700;
}
.refresh-feedback.is-pending .refresh-feedback-mark {
  border: 2px solid rgba(255, 255, 255, .3);
  border-top-color: var(--text-0);
  animation: feedbackSpin .7s linear infinite;
}
.refresh-feedback.is-success .refresh-feedback-mark { color: #83e0a3; }
.refresh-feedback.is-error .refresh-feedback-mark { color: var(--accent-warm); }
.refresh-feedback-enter-active, .refresh-feedback-leave-active { transition: opacity .18s ease, margin-top .18s ease; }
.refresh-feedback-enter-from, .refresh-feedback-leave-to { opacity: 0; margin-top: -6px; }
@keyframes feedbackSpin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .refresh-feedback.is-pending .refresh-feedback-mark { animation-duration: 1.6s; }
  .refresh-feedback-enter-active, .refresh-feedback-leave-active { transition-duration: .01ms; }
}
@media (max-width: 344px) {
  .refresh-control { margin-top: 22px; }
}
</style>
