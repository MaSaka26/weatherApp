import { getCurrentInstance, nextTick, onBeforeUnmount, ref } from 'vue'

/**
 * 入场动画还要多久才放完 —— 首次补间要等它，否则用户看到的只是尾巴。
 *
 * 为什么需要它：`.details-grid` 是 `fadeUp 0.6s 0.3s both`，也就是前 300ms 完全透明、
 * 到 900ms 才稳定可见。补间若从挂载那一刻（setup）起算，等卡片露出来时已经跑过 60% 以上。
 * 这里顺着祖先链收集还在跑的有限时长动画，取「剩余时间」的最大值。
 *
 * 只认有限的 endTime：天空的 twinkle 是 infinite，endTime 为 Infinity，不能等。
 */
export function entranceDelay(el, cap = 1600) {
  if (!el || typeof el.getAnimations !== 'function') return 0
  let max = 0
  let node = el
  // 沿着祖先一路往上找：动画挂在 .detail-card / .details-grid / .weather-content 上，
  // 而 el 通常只是里面那颗表盘
  while (node && node !== document.body) {
    if (typeof node.getAnimations === 'function') {
      for (const a of node.getAnimations()) {
        const timing = a.effect?.getComputedTiming?.()
        if (!timing || !Number.isFinite(timing.endTime)) continue
        const left = timing.endTime - (Number(a.currentTime) || 0)
        if (left > max) max = left
      }
    }
    node = node.parentElement
  }
  // 留 120ms 重叠：动画在 900ms 才停，补间从 780ms 起步看起来是接着长的，
  // 而不是先定住一会儿再动
  return Math.min(cap, Math.max(0, max - 120))
}

/**
 * 数值缓动：props 一变就让数字/表盘「扫过去」而不是瞬移。
 * 只在浏览器里跑，注意调用方要在 setup 阶段使用，onBeforeUnmount 才能挂得上。
 *
 * 两条规则：
 * 1. 不做「首值直接落位」的特例 —— 冷启动和缓存命中都从 0 扫到真实值，
 *    否则缓存命中时画面会「啪」地出现，少了数据被取回来的过程感。
 * 2. 首次补间要等入场动画（见 entranceDelay）—— 直接起跑的话，
 *    等卡片真的可见时动画已接近尾声，「从 0 长起来」这件事用户根本看不到。
 */
export function useTween(duration = 720) {
  const shown = ref(0)
  const instance = getCurrentInstance()
  let raf = 0
  let timer = 0
  let begun = false
  let queued = null

  function run(to) {
    cancelAnimationFrame(raf)
    const from = shown.value
    const t0 = performance.now()
    const step = (now) => {
      // rAF 的时间戳取的是「帧开始」，可能早于 t0，
      // 不夹住会先算出一帧负数（数字闪一下 -1.2）
      const p = Math.min(1, Math.max(0, (now - t0) / duration))
      shown.value = from + (to - from) * (1 - Math.pow(1 - p, 3))
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
  }

  function tween(to) {
    const target = Number.isFinite(to) ? to : 0
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      shown.value = target
      return
    }
    // 起跑之后（含数据刷新）一律立即补间，不再等入场
    if (begun) {
      run(target)
      return
    }
    queued = target
    if (timer) return
    // 首次调用发生在 setup，此时根节点还没挂上，得等一拍才量得到动画
    nextTick(() => {
      if (begun) {
        if (queued != null) run(queued)
        return
      }
      const wait = entranceDelay(instance?.proxy?.$el)
      timer = setTimeout(() => {
        timer = 0
        begun = true
        const value = queued
        queued = null
        if (value != null) run(value)
      }, wait)
    })
  }

  onBeforeUnmount(() => {
    cancelAnimationFrame(raf)
    if (timer) clearTimeout(timer)
  })

  return { shown, tween }
}
