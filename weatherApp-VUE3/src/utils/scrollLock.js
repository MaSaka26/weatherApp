/**
 * 全屏覆盖层（设置面板 / 降水雷达）打开时锁住背景滚动。
 *
 * 为什么不能直接 document.body.style.overflow = 'hidden'：
 * 桌面端纵向滚动条会随之消失，视口可用宽度变大（实测 clientWidth 1430→1440），
 * 居中的 .app-container 会向右平移半个滚动条宽度，看起来「组件抖了一下」。
 * 所以锁的同时补一段等宽 padding-right，把滚动条原来占的位置留在原地。
 *
 * 不用 html{scrollbar-gutter:stable}：它会常驻预留滚动条轨道，而 .sky-bg 是
 * position:fixed; inset:0，只铺到 clientWidth，短页面右侧会露出一条纯色边。
 *
 * 设置面板与雷达浮层可能先后打开（popstate 返回、切供应商等），用引用计数保证
 * 只有第一个加锁、最后一个解锁，且恢复的是加锁前的原始内联样式，互不覆盖。
 */

let lockCount = 0
let snapshot = null

function restore() {
  const { overflow, paddingRight } = snapshot
  document.body.style.overflow = overflow
  document.body.style.paddingRight = paddingRight
  snapshot = null
}

export function lockBodyScroll() {
  if (typeof document === 'undefined') return
  if (lockCount === 0) {
    snapshot = {
      overflow: document.body.style.overflow,
      paddingRight: document.body.style.paddingRight,
    }
    // 滚动条宽度 = 布局视口与可视视口之差；无实体滚动条时为 0，移动端自然空操作
    const gap = window.innerWidth - document.documentElement.clientWidth
    document.body.style.paddingRight = `${gap}px`
    document.body.style.overflow = 'hidden'
  }
  lockCount += 1
}

export function unlockBodyScroll() {
  if (typeof document === 'undefined') return
  if (lockCount === 0) return
  lockCount -= 1
  if (lockCount === 0 && snapshot) restore()
}
