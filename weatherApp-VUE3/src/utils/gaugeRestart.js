/**
 * 环形表盘是否需要从 0 重新生长。
 *
 * 首屏第一次「真实数据落地」之前 previousEpoch 为 null：此时缓存值 → 网络新鲜
 * 数据属于同一次加载，若重播会让湿度/气压/紫外线/能见度出现第二次动画。
 * 只有完成过一次数据落地之后的 epoch 变化（切城市等）才同步重播所有环。
 */
export function shouldRestartOnEpoch({ restartOnEpoch, epochChanged, hadPriorEpoch, value }) {
  return restartOnEpoch && epochChanged && hadPriorEpoch && value != null
}
