# 部署指南

## 构建产物

```bash
cd weatherApp-VUE3
npm ci
npm run build
```

产物在 `weatherApp-VUE3/dist/`。默认 `base: './'` 使用相对资源路径，可部署在域名根目录或 Gitee Pages 项目子路径。

## 部署路径

- Gitee Pages：`https://masaka0426.gitee.io/weather-app/`
  - 使用相对 `base: './'`，无需修改 Vite 配置
  - 在 Gitee 仓库设置中开启 Pages，部署目录选择 `dist`，或配置 Gitee Go 流水线
- 自有域名根目录：`https://weather.example.com/`
  - 可设置 `VITE_SITE_BASE=/`
- 其他子路径：设置 `VITE_SITE_BASE=/子路径/`

复制 `weatherApp-VUE3/.env.example` 为 `.env.local` 可覆盖 base：

```bash
VITE_SITE_BASE=./
```

## HTTPS

Geolocation 与 Service Worker 都只在 HTTPS secure context 下可用。Gitee Pages 自带 HTTPS；自有服务器请配置 TLS 证书，并使用 [deploy/nginx.conf](deploy/nginx.conf) 的 80→443 跳转。

## 安全响应头

Gitee Pages 不允许自定义响应头；仓库已提供：

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
- `404.html`（由部署流水线从 `index.html` 复制；SPA fallback）
- `robots.txt`
- `sitemap.xml`
- `manifest.webmanifest`
- `sw.js`
- `favicon.ico`、`apple-touch-icon.png`、`icon-192.png`、`icon-512.png`
- `assets/*`

## CI / CD

- [.github/workflows/quality.yml](../.github/workflows/quality.yml)：推送和 PR 时运行 test / lint / build
- [.github/workflows/deploy.yml](../.github/workflows/deploy.yml)：GitHub Pages 部署流水线（仓库镜像到 GitHub 时适用）
- [deploy-gitee.sh](deploy-gitee.sh)：当前 Gitee 远端的本地一键部署脚本，推送 `gh-pages` 分支

当前 Gitee 远端使用本地脚本发布；GitHub Pages 流水线不需要额外 Secret。

## 部署前检查

1. HTTPS 可访问。
2. 浏览器直接访问 `/manifest.webmanifest` 返回 JSON。
3. `/sw.js` 返回 JavaScript 且 `Cache-Control: no-store`。
4. 刷新任意页面仍可打开应用（404 fallback）。
5. 移动端浏览器可看到安装提示或“添加到主屏幕”。
6. 刷新两次后，DevTools → Application 中 Service Worker 为 activated。
