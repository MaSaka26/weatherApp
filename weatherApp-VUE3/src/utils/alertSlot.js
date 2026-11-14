/**
 * 城市预警卡片的统一尺寸（loading 与真实预警条目共用）
 *
 * 背景：loading 骨架里塞的是一个 48px 的动画，而容器有 10px 纵向内边距和 1px 边框，
 * 于是骨架被动画撑到 70px，比真正的预警条目（约 59.8px）高一截 ——
 * 数据到达时卡片会「塌一下」，下方内容整体上跳。这里把尺寸集中成一份常量，
 * 让骨架高度由「槽高」决定而不是由动画本身撑开：
 *
 *   骨架实际高度 = 边框*2 + 内边距*2 + 动画盒子
 *   只要 动画盒子 <= 槽高 - 边框*2 - 内边距*2，骨架高度就恰好等于槽高；
 *   而真实条目有 min-height: 槽高，内容矮于槽高时高度同样恰好等于槽高。
 *
 * 两边共用同一个槽高，切换时就不会再跳动。CSS 里的 --alert-slot-h 必须与
 * ALERT_SLOT_H 保持一致（有单测盯着，改一处忘了另一处会直接红）。
 */

/** 槽高：loading / 单条预警 / 空态 / 失败态共用的高度（px），对应 CSS --alert-slot-h */
export const ALERT_SLOT_H = 64

/** 容器纵向内边距（px），对应 .alert-loading / .alert-item 的 padding 上下 */
export const ALERT_PAD_Y = 10

/** 容器边框宽度（px） */
export const ALERT_BORDER_Y = 1

/** 动画组件的设计尺寸（px），缩放前 */
export const ALERT_LOADER_BASE = 48

/**
 * 单条真实预警条目的自然内容高度（px，不含 min-height 撑高）。
 *
 * 实测来源：headless Edge 里渲染一条真实条目（两行：类型/级别 + 区域·发布时间，
 * 左侧 34x26 图标），getBoundingClientRect().height 在 min-height 为 56px 时得到 59.81px。
 * 也就是说内容本身已经高过 56px —— 只把动画缩小而不抬槽高，仍会留下约 4px 落差。
 * 槽高必须 >= 这个值，min-height 才能真正决定最终高度。
 */
export const ALERT_ITEM_CONTENT_H = 60

/**
 * 动画可用的净空间（px）。
 * 动画盒子不得超过它，否则会把骨架撑到比真实条目更高。
 */
export function alertLoaderSpace(slot = ALERT_SLOT_H) {
  return slot - ALERT_PAD_Y * 2 - ALERT_BORDER_Y * 2
}

/**
 * 动画缩放比：让 48px 的动画正好落进净空间。
 * 向下取整到两位小数，保证盒子只小不大（宁可留缝，也不能超高）。
 */
export function alertLoaderScale(slot = ALERT_SLOT_H) {
  const ratio = alertLoaderSpace(slot) / ALERT_LOADER_BASE
  return Math.min(1, Math.floor(ratio * 100) / 100)
}

/** 缩放后动画盒子的实际边长（px，四舍五入到整数） */
export function alertLoaderBox(slot = ALERT_SLOT_H) {
  return Math.round(ALERT_LOADER_BASE * alertLoaderScale(slot))
}

/**
 * 骨架是否真的能被槽高吃掉（即不撑高）。
 * 盒子放得下时骨架高度 = 槽高；放不下就会被动画撑开，与真实条目产生高度差。
 */
export function isLoaderFittingSlot(slot = ALERT_SLOT_H) {
  return alertLoaderBox(slot) <= alertLoaderSpace(slot)
}
