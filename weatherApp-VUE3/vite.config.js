import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'


const configDir = fileURLToPath(new URL('.', import.meta.url))

function gitValue(args, fallback = '') {
  try {
    return execFileSync('git', args, {
      cwd: configDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || fallback
  } catch {
    return fallback
  }
}

function injectServiceWorkerBuildId() {
  // 这份版本信息必须与 deploy.json 同源，且来自构建时的 git 状态。
  const version = gitValue(['describe', '--tags', '--exact-match', 'HEAD']) || gitValue(['describe', '--tags', '--abbrev=0']) || gitValue(['rev-parse', '--short', 'HEAD']) || 'dev'
  // app 级 buildId 用 commit hash：本地 define 与线上 deploy.json 同源。
  // SW 缓存名仍用 manifest 内容哈希，两者职责不同。
  const appCommit = gitValue(['rev-parse', 'HEAD']) || 'unknown'
  return {
    name: 'inject-service-worker-build-id',
    apply: 'build',
    config() {
      return {
        define: {
          __APP_VERSION__: JSON.stringify(version),
          __APP_BUILD_ID__: JSON.stringify(appCommit),
        },
      }
    },
    closeBundle() {
      const manifest = readFileSync(new URL('./dist/.vite/manifest.json', import.meta.url))
      const index = readFileSync(new URL('./dist/index.html', import.meta.url))
      const buildId = createHash('sha256')
        .update(manifest)
        .update(index)
        .digest('hex')
        .slice(0, 12)
      const swUrl = new URL('./dist/sw.js', import.meta.url)
      const sw = readFileSync(swUrl, 'utf8')
      if (!sw.includes('__WEATHER_BUILD_ID__')) {
        throw new Error('Service worker build placeholder is missing')
      }
      writeFileSync(swUrl, sw.replaceAll('__WEATHER_BUILD_ID__', buildId), 'utf8')

      // 静态托管把 index.html 当作 404 fallback；构建产物自带一份，避免依赖 CI 复制。
      writeFileSync(new URL('./dist/404.html', import.meta.url), index)
      // 禁止 Pages 的 Jekyll 处理，避免 _headers 等下划线文件被忽略。
      writeFileSync(new URL('./dist/.nojekyll', import.meta.url), '')

      // 来源指纹：线上访问 /deploy.json 即可知道这份产物来自哪个源码版本。
      const exactTag = gitValue(['describe', '--tags', '--exact-match', 'HEAD'])
      const deployInfo = {
        appVersion: version,
        appBuildId: appCommit,
        sourceCommit: gitValue(['rev-parse', 'HEAD'], 'unknown'),
        sourceShort: gitValue(['rev-parse', '--short', 'HEAD'], 'unknown'),
        sourceTag: exactTag || null,
        latestTag: gitValue(['describe', '--tags', '--abbrev=0']) || null,
        sourceDirty: gitValue(['status', '--porcelain']) !== '',
        builtAt: new Date().toISOString(),
        node: process.version,
        buildId,
      }
      writeFileSync(
        new URL('./dist/deploy.json', import.meta.url),
        `${JSON.stringify(deployInfo, null, 2)}\n`,
        'utf8',
      )
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  base: loadEnv(mode, process.cwd(), 'VITE_').VITE_SITE_BASE || './',
  build: { manifest: true },
  plugins: [
    vue(),
    vueDevTools(),
    injectServiceWorkerBuildId(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
}))
