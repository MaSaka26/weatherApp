/**
 * 加载动画库（专属动画组件集合）
 *
 * 新增动画：在 ./ 下建一个 `XxxLoader.vue`，然后加进对应分组数组。
 * 使用方统一走 `pickLoader()` / `pickRadarLoader()` 随机取一个，
 * 避免各处各写一份随机逻辑。
 *
 * 分组：
 *   - alert 组（城市预警等通用占位）：音浪、三环手表
 *   - radar 组（降水雷达）：雷达扫描、人脸识别扫描
 *   - 专项（不进随机池）：刷新按钮的旋转方块，按名直接引用
 */
import SoundWaveLoader from './SoundWaveLoader.vue'
import WatchSpinnerLoader from './WatchSpinnerLoader.vue'
import RadarSweepLoader from './RadarSweepLoader.vue'
import FaceIDScanLoader from './FaceIDScanLoader.vue'
import SpinningSquaresLoader from './SpinningSquaresLoader.vue'

/** 城市预警等通用加载动画。顺序无关，随机等概率。 */
export const ALERT_LOADER_COMPONENTS = [SoundWaveLoader, WatchSpinnerLoader]

/** 降水雷达专用的加载动画。 */
export const RADAR_LOADER_COMPONENTS = [RadarSweepLoader, FaceIDScanLoader]

/** 全部动画的平铺列表（一般只在统计/调试时用）。 */
export const LOADER_COMPONENTS = [
  ...ALERT_LOADER_COMPONENTS,
  ...RADAR_LOADER_COMPONENTS,
  // 专项动画：用途固定（刷新按钮），不进随机池，只做统计/调试用
  SpinningSquaresLoader,
]

/**
 * 从指定分组里随机取一个组件。
 * @param {Array} pool 分组数组
 * @param {object} [exclude] 刚用过、希望本次避开的那一个（分组只剩它时仍会返回它）
 */
export function pickFrom(pool, exclude) {
  const list = pool.filter((c) => c !== exclude)
  const finalPool = list.length > 0 ? list : pool
  return finalPool[Math.floor(Math.random() * finalPool.length)]
}

/** 从 alert 组随机取一个组件。 */
export function pickLoader(exclude) {
  return pickFrom(ALERT_LOADER_COMPONENTS, exclude)
}

/** 从 radar 组随机取一个组件。 */
export function pickRadarLoader(exclude) {
  return pickFrom(RADAR_LOADER_COMPONENTS, exclude)
}

export {
  SoundWaveLoader,
  WatchSpinnerLoader,
  RadarSweepLoader,
  FaceIDScanLoader,
  SpinningSquaresLoader,
}
