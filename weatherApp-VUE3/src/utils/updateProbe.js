/**
 * 版本探测源：页面「主动发现新版本」的唯一入口。
 *
 * 为什么不能只读站点自己的 deploy.json：
 * 它走 GitHub Pages 的 Fastly CDN，实测 cache-control: max-age=600；带上
 * cache-control / pragma / 随机 query / Range 全部打不穿（响应恒为 x-cache: HIT、
 * age 递增、内容不变）。所以只能去 GitHub 侧读同一份文件（gh-pages 分支根目录）。
 *
 * 探测顺序（先快后慢，任一成功即返回）：
 *   1. api.github.com contents + accept: application/vnd.github.raw —— max-age=60，最快；
 *      未登录限额 60 次/小时/IP，且 304 也计数，被限流后由调用方暂时跳过它。
 *   2. raw.githubusercontent.com —— max-age=300，无配额，稳定兜底。
 *   3. 站点自己的 deploy.json —— max-age=600，最慢，只在前两个都失败时使用。
 */

/** 与 git remote github 保持一致；换仓库时只改这里。 */
export const UPDATE_REPO_OWNER = 'MaSaka26'
export const UPDATE_REPO_NAME = 'weatherApp'
/** 产物分支：CI 把 dist 推到 gh-pages，deploy.json 就在分支根目录。 */
export const UPDATE_BRANCH = 'gh-pages'
/** 单次探测的超时；超时只影响这一源，继续试下一个。 */
export const PROBE_TIMEOUT_MS = 8000
/** 被限流后默认冷却多久再试 GitHub API。 */
export const RATE_LIMIT_COOLDOWN_MS = 30 * 60 * 1000
/**
 * GitHub API 的最小使用间隔。未登录限额是 60 次/小时/IP，而页面每 2 分钟探测一次就是
 * 30 次/小时 —— 单标签页勉强够、多标签页或共用出口 IP 就会打满。所以 API 只当作「首次
 * 和偶尔的快速确认」，两次之间至少隔 5 分钟（≤12 次/小时），其余轮询走 raw 源。
 */
export const API_MIN_INTERVAL_MS = 5 * 60 * 1000

function probeError(code, message, extra) {
  const error = new Error(message)
  error.code = code
  if (extra) Object.assign(error, extra)
  return error
}

/**
 * 构造探测源列表。baseHref 用 document.baseURI，保证子路径部署也能拼对站点地址。
 * freshMs 是各源自己声明的缓存时长，minIntervalMs 是两次使用之间的最小间隔
 * （写在这里既方便对照，也方便测试断言）。
 */
export function buildDeployProbeSources(baseHref = './') {
  const apiUrl =
    `https://api.github.com/repos/${UPDATE_REPO_OWNER}/${UPDATE_REPO_NAME}/contents/deploy.json?ref=${UPDATE_BRANCH}`
  const rawUrl =
    `https://raw.githubusercontent.com/${UPDATE_REPO_OWNER}/${UPDATE_REPO_NAME}/${UPDATE_BRANCH}/deploy.json`
  let siteUrl = 'deploy.json'
  try {
    siteUrl = new URL('deploy.json', baseHref).href
  } catch {
    // baseHref 非法（比如空串）时退回相对路径，交给浏览器解析
  }
  return [
    {
      id: 'github-api',
      label: 'GitHub API',
      url: apiUrl,
      freshMs: 60 * 1000,
      quota: true,
      minIntervalMs: API_MIN_INTERVAL_MS,
      init: { cache: 'no-store', headers: { accept: 'application/vnd.github.raw' } },
    },
    {
      id: 'github-raw',
      label: 'GitHub Raw',
      url: rawUrl,
      freshMs: 5 * 60 * 1000,
      quota: false,
      minIntervalMs: 0,
      init: { cache: 'no-store' },
    },
    {
      id: 'site',
      label: '站点 deploy.json',
      url: siteUrl,
      freshMs: 10 * 60 * 1000,
      quota: false,
      minIntervalMs: 0,
      init: { cache: 'no-store' },
    },
  ]
}

/**
 * 解析探测源返回的文本。
 * 至少要有一个能判断版本的字段，避免把 404 页面 / 空对象当成有效清单。
 */
export function parseDeployManifest(text) {
  if (typeof text !== 'string' || !text.trim()) throw probeError('BAD_PAYLOAD', '探测源返回空内容')
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw probeError('BAD_PAYLOAD', '探测源返回的不是 JSON')
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw probeError('BAD_PAYLOAD', '探测源返回的结构不对')
  }
  if (!data.appBuildId && !data.sourceTag && !data.latestTag) {
    throw probeError('BAD_PAYLOAD', '探测源缺少版本字段')
  }
  return data
}

async function readSource(source, options) {
  const fetchImpl = options.fetchImpl || globalThis.fetch
  const timeoutMs = options.timeoutMs || PROBE_TIMEOUT_MS
  if (typeof fetchImpl !== 'function') throw probeError('NO_FETCH', '当前环境没有 fetch')
  const controller = typeof AbortController === 'function' ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null
  try {
    const res = await fetchImpl(source.url, {
      ...source.init,
      signal: controller ? controller.signal : undefined,
    })
    const remaining = res.headers && res.headers.get ? res.headers.get('x-ratelimit-remaining') : null
    if (res.status === 429 || (res.status === 403 && remaining === '0')) {
      const reset = Number((res.headers && res.headers.get('x-ratelimit-reset')) || 0) * 1000
      throw probeError('RATE_LIMITED', '探测源被限流', {
        resetAt: reset || Date.now() + RATE_LIMIT_COOLDOWN_MS,
      })
    }
    if (!res.ok) throw probeError('HTTP_ERROR', `HTTP ${res.status}`, { status: res.status })
    return parseDeployManifest(await res.text())
  } catch (error) {
    if (error && error.name === 'AbortError') throw probeError('TIMEOUT', '探测超时')
    throw error
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * 依次尝试各探测源，返回第一个成功的清单。
 * isSourceBlocked(source) 为真时跳过该源（限流冷却）。
 * 全部失败时抛出 ALL_SOURCES_FAILED，failures 里保留每个源各自的失败原因。
 */
export async function readDeployManifest(sources, options = {}) {
  const { isSourceBlocked, ...rest } = options
  const failures = []
  for (const source of sources) {
    if (typeof isSourceBlocked === 'function' && isSourceBlocked(source)) {
      failures.push({ source, error: probeError('SKIPPED', '探测源被跳过') })
      continue
    }
    try {
      const manifest = await readSource(source, rest)
      return { manifest, source, failures }
    } catch (error) {
      failures.push({ source, error })
    }
  }
  throw probeError('ALL_SOURCES_FAILED', '所有更新探测源都失败', { failures })
}
