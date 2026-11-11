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
- [deploy-gitee.sh](deploy-gitee.sh)：按 tag/确定 ref 构建并推送 `gh-pages` 分支
- [gitee-pages.md](gitee-pages.md)：Gitee Pages 首次开启、自动发布与排错说明

自动部署到 Gitee 需要 `GITEE_USERNAME` 与 `GITEE_TOKEN`；未配置时会跳过推送并正常结束。Gitee Pages 服务需在仓库后台开启；若「服务」菜单里没有 Gitee Pages，说明账号未实名认证或平台未开放该入口，详见 [gitee-pages.md](gitee-pages.md) 的替代方案。

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
