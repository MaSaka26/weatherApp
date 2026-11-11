# Gitee Pages 部署指南

## 1. 部署原理

Gitee Pages 会读取仓库中某个分支的静态文件并对外发布。本项目采用两个互不混淆的分支：

```text
master    源码：Vue、配置、测试、文档
gh-pages  产物：index.html、404.html、assets/、sw.js、deploy.json …
```

`gh-pages` 是孤立分支，由部署脚本每次重新生成并强制推送，不包含源码历史。

## 2. 首次开启 Gitee Pages（需先确认入口是否存在）

> 重要：部分 Gitee 账号的「服务」菜单里**没有 Gitee Pages**（只有 JavaDoc、SonarQube、Jenkins、腾讯云托管等第三方服务）。这通常不是仓库配置问题，而是平台侧限制：账号未实名认证、不是仓库 Owner/管理员，或 Gitee 已收紧/调整 Pages 免费版入口。此时不要继续在菜单里找，先按下面「入口自查」确认，不行就用替代平台。

### 入口自查

1. 确认以仓库 Owner `masaka0426` 登录，且有管理员权限。
2. 完成 Gitee 实名认证：头像 → 设置 → 实名认证；完成后重新登录刷新。
3. 直接访问 `https://gitee.com/masaka0426/weather-app/pages`：
   - 跳到开通/实名页 → 继续下面「开启服务」。
   - 仍 404 或提示无权限 → 该账号未开通 Pages，改用第 6 节替代方案。
4. 旧版入口：仓库「服务」下拉里的 `Gitee Pages`；新版也可能在「仓库设置 / 管理」或「更多服务」里。

### 开启服务（入口存在时）

1. 打开 <https://gitee.com/masaka0426/weather-app>。
2. 进入「服务」→「Gitee Pages」。
3. 「部署分支」选择 `gh-pages`。
4. 「部署目录」留空，因为 `index.html` 已在 `gh-pages` 根目录。
5. 勾选/确认「强制 HTTPS」（Service Worker 和 Geolocation 依赖 HTTPS）。
6. 点击「启动」或「更新」。
7. 访问 <https://masaka0426.gitee.io/weather-app/>。

注意：Gitee Pages 免费版通常不会因分支推送自动重建，更新 `gh-pages` 后需要点击页面上的「更新」。若页面仍是 404，先确认服务是否已启动、分支是否选了 `gh-pages`。

## 3. 本地发布

```bash
bash deploy/deploy-gitee.sh
```

脚本会：

1. 取最近 tag（没有则 `master`）作为构建版本。
2. 用 `git worktree` 检出该确定版本，避免工作区未提交改动混入。
3. `npm ci`、test、lint、build。
4. 构建时生成 `dist/deploy.json` 来源指纹。
5. 把 `dist` 作为新的 `gh-pages` 分支强制推送到 Gitee。

也可以显式指定版本：

```bash
bash deploy/deploy-gitee.sh v0.1.1
bash deploy/deploy-gitee.sh master
```

需要本机具备 Gitee 推送凭据（用户名 + 私人令牌，或已保存的凭据管理器）。

## 4. 自动发布

[.github/workflows/deploy.yml](../.github/workflows/deploy.yml) 在 `master` push 或 `v*` tag push 时：

- 构建并上传 `dist`
- 若配置了 Secrets，则推送到 Gitee `gh-pages`

需要的 Secrets：

```text
GITEE_USERNAME   Gitee 用户名
GITEE_TOKEN      Gitee 私人令牌（需仓库写权限）
```

未配置 Secrets 时，部署步骤会打印 skip 并正常结束，不阻塞 CI。

注意：`.github/workflows` 是 GitHub Actions。若仓库只在 Gitee 且没有启用 Gitee Go / 仓库镜像，这个 workflow 不会自动运行；此时用第 3 节本地脚本，或在 Gitee Go 中导入等价流水线。

## 5. 来源指纹

每次构建会生成 `dist/deploy.json`，线上可通过 `/deploy.json` 查看：

```json
{
  "sourceCommit": "...",
  "sourceShort": "62d2304",
  "sourceTag": "v0.1.1",
  "latestTag": "v0.1.1",
  "sourceDirty": false,
  "builtAt": "2026-11-11T...",
  "node": "v22.x",
  "buildId": "..."
}
```

用来确认线上产物与源码版本一致。`sourceDirty` 为 true 表示构建时工作区有未提交改动，不应作为正式发布物。

## 6. 没有 Gitee Pages 入口时的替代方案

| 方案 | 说明 |
| --- | --- |
| Cloudflare Pages / Netlify | 直接部署 `weatherApp-VUE3/dist`，`_headers` 生效，自带 HTTPS |
| GitHub Pages | 把仓库镜像到 GitHub，用 `.github/workflows/deploy.yml` 自动发布 |
| 自有服务器 | 用 `deploy/nginx.conf` 托管 dist 并配置 HTTPS |

CLI 示例：

```bash
npx wrangler pages deploy weatherApp-VUE3/dist --project-name weatherapp
# 或
npx netlify deploy --dir=weatherApp-VUE3/dist --prod
```

## 7. 构建产物清单

```text
index.html
404.html
.nojekyll
deploy.json
robots.txt
sitemap.xml
manifest.webmanifest
sw.js
_headers
favicon.ico
apple-touch-icon.png
icon-192.png
icon-512.png
assets/
```

## 8. 常见问题

- **服务菜单里没有 Gitee Pages**：不是代码问题；先实名认证并确认 Owner 权限，仍无入口说明平台未开放，改用第 6 节替代方案。
- **404**：Pages 未启动、部署分支选错，或部署目录填了 `dist`。`gh-pages` 根目录就是 dist 内容，目录留空。
- **资源 404**：确认 Vite `base: './'`，构建产物中是 `./assets/...` 而非 `/assets/...`。
- **SW 不生效**：必须通过 HTTPS 访问；`sw.js` 不应被长缓存。
- **更新不生效**：到 Gitee Pages 页面点「更新」；浏览器强刷一次。
- **`_headers` 无效**：该文件只被 Netlify / Cloudflare Pages 识别；Gitee Pages 不提供自定义响应头，自有服务器用 `deploy/nginx.conf`。
