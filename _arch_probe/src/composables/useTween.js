import { onBeforeUnmount, ref } from 'vue'

/**
 * 数值缓动：props 一变就让数字/表盘「扫过去」而不是瞬移。
 * 只在浏览器里跑，注意调用方要在 setup 阶段使用，onBeforeUnmount 才能挂得上。
 */
export function useTween(duration = 720) {
  const shown = ref(0)
  let raf = 0

  function tween(to) {
    cancelAnimationFrame(raf)
    const target = Number.isFinite(to) ? to : 0
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      shown.value = target
      return
    }
    const from = shown.value
    const t0 = performance.now()
    const step = (now) => {
      // rAF 的时间戳取的是「帧开始」，可能早于 t0，
      // 不夹住会先算出一帧负数（数字闪一下 -1.2）
      const p = Math.min(1, Math.max(0, (now - t0) / duration))
      shown.value = from + (target - from) * (1 - Math.pow(1 - p, 3))
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
  }

  onBeforeUnmount(() => cancelAnimationFrame(raf))

  return { shown, tween }
}
