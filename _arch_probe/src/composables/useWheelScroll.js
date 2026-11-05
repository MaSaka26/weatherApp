import { watchEffect } from 'vue'

/**
 * 让横向滚动容器支持鼠标滚轮（含普通滚轮与触摸板）。
 *
 * 原生行为：滚轮只产生 deltaY，垂直滚动容器会把它交给页面，横向容器纹丝不动。
 * 因此桌面鼠标用户无法查看超出一屏的内容。这里把 deltaY 映射到 scrollLeft，
 * 并在到达两端时把事件交还页面，避免"卡住"页面滚动。
 *
 * @param {import('vue').Ref<HTMLElement|null>} elRef 滚动容器
 * @param {{ enabled?: () => boolean }} [options]
 */
export function useWheelScroll(elRef, options = {}) {
  const enabled = options.enabled || (() => true)

  function onWheel(event) {
    const el = elRef.value
    if (!el || !enabled()) return

    const maxScroll = el.scrollWidth - el.clientWidth
    if (maxScroll <= 1) return // 根本没溢出，保持页面默认行为

    // 触摸板横向手势交给浏览器原生处理，避免双重加速
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return

    const delta = event.deltaY
    if (!delta) return

    const atStart = el.scrollLeft <= 0
    const atEnd = el.scrollLeft >= maxScroll - 1
    if ((delta < 0 && atStart) || (delta > 0 && atEnd)) return

    el.scrollLeft = Math.max(0, Math.min(maxScroll, el.scrollLeft + delta))
    event.preventDefault()
  }

  watchEffect((onCleanup) => {
    const el = elRef.value
    if (!el) return
    el.addEventListener('wheel', onWheel, { passive: false })
    onCleanup(() => el.removeEventListener('wheel', onWheel))
  })
}
