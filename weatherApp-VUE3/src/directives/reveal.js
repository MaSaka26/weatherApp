/**
 * v-reveal：统一入场编排
 *
 * - index 由 directive 按注册顺序（≈ DOM 顺序）分配，作为统一时间线的档期。
 * - 首屏内：按 index 补 stagger，保持自上而下。
 * - 首屏外 / 挂载时不可见：等 IntersectionObserver 命中才播，且不补长 delay。
 * - 异步组件 / v-if 晚挂载 / 接口晚到：挂载即注册，天然纳入同一套编排。
 * - 已经滚过视口的区块（刷新恢复滚动位置）：直接显示，不重播。
 */
const counters = new WeakMap()

function nextIndex(root) {
  const key = root || document.body
  const n = (counters.get(key) || 0) + 1
  counters.set(key, n)
  return n - 1
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export const reveal = {
  mounted(el, binding) {
    setup(el, binding)
  },
  unmounted(el) {
    el.__revealCleanup?.()
    delete el.__revealCleanup
  },
}

function setup(el, binding) {
  const root = el.closest?.('[data-reveal-root]') || el.parentElement
  const index = Number.isFinite(binding.value?.index)
    ? binding.value.index
    : nextIndex(root)

  el.dataset.reveal = ''
  el.style.setProperty('--enter-index', String(index))

  if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') {
    el.classList.add('is-instant')
    return
  }

  const rect = el.getBoundingClientRect()
  const inFirstScreen = rect.top < window.innerHeight && rect.bottom > 0
  const alreadyPassed = rect.bottom <= 0

  if (alreadyPassed) {
    el.classList.add('is-instant')
    return
  }

  const show = (deferred) => {
    if (deferred) el.classList.add('is-deferred')
    el.classList.add('is-visible')
    observer?.disconnect()
  }

  let observer = null
  if (inFirstScreen) {
    // 立即放开 play-state；delay 由 CSS 负责，不等 rAF 以免 dev 首帧拖慢起跑
    show(false)
  } else {
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        show(true)
      }
    }, { rootMargin: '0px 0px 64px 0px', threshold: 0 })
    observer.observe(el)
  }

  el.__revealCleanup = () => observer?.disconnect()
}
