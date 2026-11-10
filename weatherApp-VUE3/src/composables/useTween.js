import { getCurrentInstance, inject, nextTick, onBeforeUnmount, ref } from 'vue'
import { createTweenClock } from '@/utils/tweenClock'

export const TWEEN_START_AT = Symbol('weather-tween-start-at')

// 所有仪表盘补间共用一条 rAF 时钟，同一帧统一采样，避免卡片各自错拍。
const tweenClock = createTweenClock()
let sharedFirstStartAt = null

/**
 * 仪表盘的首个补间共用起跑时刻，避免每个组件按不同祖先动画各自延迟。
 *
 * 统一读取详情网格的剩余入场时间，再由所有实例共用该时间戳。
 *
 * 只认有限的 endTime：天空的 twinkle 是 infinite，endTime 为 Infinity，不能等。
 */
export function entranceDelay(el, cap = 1600) {
  if (!el || typeof document === 'undefined' || typeof el.getAnimations !== 'function') return 0
  let max = 0
  let node = el
  // 动画挂在 .details-grid / .weather-content 等祖先节点上。
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
  // 留 120ms 重叠，让表盘在网格快显现时开始生长。
  return Math.min(cap, Math.max(0, max - 120))
}

/**
 * 数值缓动：props 一变就让数字/表盘「扫过去」而不是瞬移。
 * 只在浏览器里跑，注意调用方要在 setup 阶段使用，onBeforeUnmount 才能挂得上。
 *
 * 两条规则：
 * 1. 不做「首值直接落位」的特例 —— 冷启动和缓存命中都从 0 扫到真实值，
 *    否则缓存命中时画面会「啪」地出现，少了数据被取回来的过程感。
 * 2. 首次补间共用网格入场动画的起跑时刻，保证所有仪表盘同时启动。
 */
export function useTween(duration = 1000, initialValue = 0) {
  const shown = ref(initialValue)
  const instance = getCurrentInstance()
  const injectedEpoch = inject(TWEEN_START_AT, null)
  const epochAtSetup = injectedEpoch?.value ?? null
  let animation = null
  let timer = 0
  let begun = false
  let queued = null

  function cancelCurrent() {
    if (animation) tweenClock.remove(animation)
    animation = null
    if (timer) clearTimeout(timer)
    timer = 0
    queued = null
  }

  function prefersReducedMotion() {
    return (
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    )
  }

  function safeStartAt(epoch) {
    const now = performance.now()
    return Number.isFinite(epoch) && epoch <= now && now - epoch <= duration ? epoch : now
  }

  function run(to, startedAt = performance.now()) {
    if (animation) tweenClock.remove(animation)
    const from = shown.value
    animation = { startedAt, duration, from, to, update: (value) => { shown.value = value } }
    tweenClock.add(animation)
  }

  function dataEpoch() {
    const value = injectedEpoch?.value
    return Number.isFinite(value) && value !== epochAtSetup ? value : null
  }

  function queueUntilEntrance(target, epoch) {
    queued = { target, epoch }
    if (timer) return
    // 首次调用发生在 setup，此时根节点还没挂上，得等一拍才量得到动画
    nextTick(() => {
      if (begun) {
        if (queued != null) {
          const value = queued
          queued = null
          run(value.target, safeStartAt(value.epoch))
        }
        return
      }
      if (sharedFirstStartAt == null) {
        const grid = typeof document !== 'undefined' ? document.querySelector('.details-grid') : null
        sharedFirstStartAt = performance.now() + entranceDelay(grid || instance?.proxy?.$el)
      }
      const startAt = sharedFirstStartAt
      const wait = Math.max(0, startAt - performance.now())
      timer = setTimeout(() => {
        timer = 0
        begun = true
        const value = queued
        queued = null
        if (value != null) {
          const scheduledAt = Math.max(startAt, value.epoch ?? startAt)
          const actualStart = startAt < performance.now() && value.epoch == null ? performance.now() : scheduledAt
          run(value.target, safeStartAt(actualStart))
        }
      }, wait)
    })
  }

  function tween(to) {
    const target = Number.isFinite(to) ? to : 0
    const epoch = dataEpoch()
    if (prefersReducedMotion()) {
      cancelCurrent()
      shown.value = target
      return
    }
    // setTimeout 的回调可能在不同任务中被浏览器延后；以统一时间戳作为
    // 最终判据，避免某个表盘刚好在截止时刻前后更新而落入不同起跑批次。
    if (!begun && sharedFirstStartAt != null && performance.now() >= sharedFirstStartAt) {
      begun = true
      cancelCurrent()
      run(target, safeStartAt(epoch))
      return
    }
    // 起跑之后（含数据刷新）一律立即补间，不再等入场。
    if (begun) {
      run(target, safeStartAt(epoch))
      return
    }
    queueUntilEntrance(target, epoch)
  }

  function restart(to, from = initialValue, epoch = dataEpoch()) {
    const target = Number.isFinite(to) ? to : 0
    cancelCurrent()
    shown.value = Number.isFinite(from) ? from : initialValue
    if (prefersReducedMotion()) {
      shown.value = target
      return
    }
    if (begun) {
      run(target, safeStartAt(epoch))
      return
    }
    queueUntilEntrance(target, epoch)
  }

  onBeforeUnmount(() => {
    cancelCurrent()
  })

  return { shown, tween, restart }
}
