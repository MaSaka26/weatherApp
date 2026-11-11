/**
 * 判断线上产物与当前页面是否为同一版本。
 * 以 buildId（manifest+index 内容哈希）为准，tag 只用于展示；
 * 没有 buildId 的旧产物回退到 sourceTag/sourceShort 比较，避免永远提示更新。
 */
export function compareAppUpdate(local, remote) {
  if (!remote || typeof remote !== 'object') return { hasUpdate: false, reason: 'no-remote' }
  const localBuild = local?.buildId || null
  const remoteBuild = remote.appBuildId || null
  const remoteTag = remote.sourceTag || remote.latestTag || null
  const remoteLabel = remoteTag || remote.sourceShort || remote.sourceCommit?.slice(0, 7) || '新版本'

  if (localBuild && remoteBuild) {
    return localBuild === remoteBuild
      ? { hasUpdate: false, reason: 'same', remoteLabel }
      : { hasUpdate: true, reason: 'build-changed', remoteLabel }
  }
  const localVersion = local?.version || null
  if (localVersion && remoteTag) {
    return localVersion === remoteTag
      ? { hasUpdate: false, reason: 'same', remoteLabel }
      : { hasUpdate: true, reason: 'tag-changed', remoteLabel }
  }
  // 本地没有可比较的身份（dev / 旧构建）时不打扰用户
  return { hasUpdate: false, reason: 'no-local', remoteLabel }
}
