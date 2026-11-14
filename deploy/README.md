# 部署指南

## 构建产物

```bash
cd weatherApp-VUE3
npm ci
npm run build
```

产物在 `weatherApp-VUE3/dist/`。默认 `base: './'` 使用相对资源路径，可部署在域名根目录或任意子路径。

## 部署路径

- GitHub Pages（当前线上）：`https://masaka26.github.io/weatherApp/`
  - 使用相对 `base: './'`，无需修改 Vite 配置
  - 由 `.github/workflows/deploy.yml` 在打 tag 时自动构建并发布，不需要手动推分支
- 自有域名根目录：`https://weather.example.com/`
  - 可设置 `VITE_SITE_BASE=/`
- 其他子路径：设置 `VITE_SITE_BASE=/子路径/`

复制 `weatherApp-VUE3/.env.example` 为 `.env.local` 可覆盖 base：

```bash
VITE_SITE_BASE=./
```

## HTTPS

Geolocation 与 Service Worker 都只在 HTTPS secure context 下可用。GitHub Pages 自带 HTTPS；自有服务器请配置 TLS 证书，并使用 [deploy/nginx.conf](deploy/nginx.conf) 的 80→443 跳转。

## 安全响应头

静态托管平台对响应头的支持不一致，GitHub Pages 不允许自定义响应头；仓库已提供：

- `weatherApp-VUE3/public/_headers`：Netlify、Cloudflare Pages 等平台可直接识别
- [deploy/nginx.conf](deploy/nginx.conf)：自有 Nginx 部署的完整 CSP、缓存和 HTTPS 配置

`_headers` 与 Nginx 配置包含：

- `X-Content-Type-Options`
- `Referrer-Policy`
- `Permissions-Policy: geolocation=(self)`
- `X-Frame-Options`
- CSP 白名单：Open-Meteo、BigDataCloud、NMC、RainViewer、Esri
- `index.html` / `sw.js` 不缓存
- `/assets/*` 长缓存
- `manifest.webmanifest` 不缓存

## 静态文件

发布目录中应包含：

- `index.html`
- `404.html`（构建时自动从 `index.html` 复制；SPA fallback）
- `robots.txt`
- `sitemap.xml`
- `manifest.webmanifest`
- `sw.js`
- `favicon.ico`、`apple-touch-icon.png`、`icon-192.png`、`icon-512.png`
- `assets/*`

## CI / CD

- [.github/workflows/quality.yml](../.github/workflows/quality.yml)：推送与 PR 时运行 test / lint / build
- [.github/workflows/deploy.yml](../.github/workflows/deploy.yml)：打 `v*` tag（或手动触发）时运行 test / lint / build，把 `dist` 提交推送到 `gh-pages` 分支（GitHub Pages 从该分支发布），并用 `gh release create --generate-notes` 自动创建对应 Release

### 发布一个版本

本地只需要提交代码和打 tag，剩下的交给 CI：

```bash
git tag -a v0.1.12 -m v0.1.12
git push github master --tags
```

流水线会依次执行：

1. `fetch-depth: 0` 拉全历史（`vite.config.js` 用 `git describe --tags --exact-match` 注入版本号）
2. `npm ci` → `npm test` → `npm run lint` → `npm run build`（`VITE_SITE_BASE=./`）
3. 打印 `dist/deploy.json` 作为构建身份凭据
4. `actions/upload-artifact` 传产物，再用 `gh-pages` 分支工作区覆盖内容并 `git push origin HEAD:gh-pages` 发布
5. tag 触发时创建 Release：说明文字取自根 README「## 更新日志」里对应版本的小节（[.github/scripts/release-notes.mjs](../.github/scripts/release-notes.mjs)），该版本没有条目时回退到 `--generate-notes`；已存在同名 Release 则跳过

所以发版前记得先在根 README 的更新日志里写好这一版，Release 正文会自动跟它一致。

发布完成后可直接核对线上身份：

```bash
curl -s https://masaka26.github.io/weatherApp/deploy.json
```

注意：仓库 Pages 设置保持 **Deploy from a branch → `gh-pages` / 根目录** 即可，不需要改成 GitHub Actions，也不需要给仓库额外授权。每次发布会在 `gh-pages` 上新增一条 `deploy: <tag> (<sha>)` 提交，历史提交天然保留，可随时回滚。

## 部署前检查

1. HTTPS 可访问。
2. 浏览器直接访问 `/manifest.webmanifest` 返回 JSON。
3. `/sw.js` 返回 JavaScript 且 `Cache-Control: no-store`。
4. 刷新任意页面仍可打开应用（404 fallback）。
5. 移动端浏览器可看到安装提示或“添加到主屏幕”。
6. 刷新两次后，DevTools → Application 中 Service Worker 为 activated。

## 首屏入场动画验收（v-reveal 统一时间线）

供人工在网页端验收以下矩阵：

1. 刷新页面：current → 预警 → cards → hourly → rain → daily → life → hint 自上而下按 80ms 阶梯渐入（位移 36px）。
2. 小视口（如 390×700）：首屏可见区块按序出现；daily / life / hint 初始不可见。
3. 滚动到底：屏幕外区块滚入视口后才淡入，且不带长 stagger delay。
4. 再次刷新并恢复滚动位置：已滚过的区块直接显示，不重播。
5. 系统开启「减少动态效果」：所有区块直接显示，无位移、无淡入。
6. 6 分钟数据刷新 / 手动刷新：数字补间生效，但入场动画不重播。
7. 6/9 卡切换、列表/曲线切换、设置面板、雷达层：交互动画保持原样，不被入场编排接管。
8. 异步雷达组件点击打开：全屏层正常，不受 v-reveal 影响。
