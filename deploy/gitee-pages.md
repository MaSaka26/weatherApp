# Gitee Pages 部署

当前仓库远端是 `https://gitee.com/masaka0426/weather-app.git`。Gitee Pages 与 GitHub Pages 不同，不能直接使用 `actions/deploy-pages`，因此提供两种发布路径。

## 路径 A：本地一键发布到 Gitee Pages（当前远端适用）

`deploy/deploy-gitee.sh` 会：

1. `npm ci`、test、lint、build
2. 取 `weatherApp-VUE3/dist`
3. 创建临时 Git 仓库，提交为 `gh-pages` 分支
4. 强制推送 `origin/gh-pages`

运行：

```bash
bash deploy/deploy-gitee.sh
```

推送成功后，在 Gitee 仓库：

1. 打开「服务 → Gitee Pages」
2. 部署分支选择 `gh-pages`
3. 部署目录留空（根目录就是 dist 内容）
4. 勾选/确认 HTTPS
5. 访问 `https://masaka0426.gitee.io/weather-app/`

可能需要输入 Gitee 用户名和私人令牌。该脚本会覆盖远端 `gh-pages` 分支，不会改动 `master` 源码。

## 路径 B：GitHub Actions Pages

如果仓库镜像到 GitHub，或把远端切到 GitHub，使用：

- `.github/workflows/deploy.yml`：上传 `dist` 并通过 `actions/deploy-pages` 发布
- 仓库 Settings → Pages → Source 选「GitHub Actions」

该方式不适用于当前 Gitee 远端。

## 构建产物

`vite.config.js` 在构建结束时自动生成：

- `dist/404.html`：从 `index.html` 复制
- `dist/.nojekyll`：避免 Pages 忽略下划线文件

因此静态托管目录完整包含：

```text
index.html
404.html
.nojekyll
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

## 注意

- 线上地址目前可能仍为 404：Gitee Pages 需要在仓库后台手动开启，并选择 `gh-pages` 分支。
- 没有 `GITEE_TOKEN` 也能用本地脚本发布，只要本机有 Gitee 推送凭据。
- `_headers` 只有 Netlify/Cloudflare Pages 等平台识别；Gitee Pages 不提供自定义响应头。自有服务器用 `deploy/nginx.conf`。
