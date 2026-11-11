# Gitee Pages 部署配置

`yanglbme/gitee-pages-action` 在不同版本里参数名略有差异。当前 [.gitee/workflows/pages.yml](../.gitee/workflows/pages.yml) 使用的是常见命名；如果 Gitee Go 报参数错误，请按该 Action 最新文档调整。

需要配置仓库密钥：

- `GITEE_TOKEN`：Gitee 个人访问令牌，需具备仓库读写权限
- 必要时还需 `GITEE_PASSWORD` 或 SSH 密钥，取决于 Action 实现

首次部署：

1. 推送 `master` 与 `v0.1.0` tag。
2. 在 Gitee 仓库「服务 → Gitee Pages」中开启 Pages。
3. 选择部署分支（流水线默认写 `gh-pages`）和部署目录 `dist`。
4. 访问 `https://masaka0426.gitee.io/weather-app/`。

如果 Gitee Pages 要求直接选择仓库内目录，而不允许从 `dist` 分支部署，可改为：

- 取消 `.gitignore` 对 `weatherApp-VUE3/dist/` 的忽略
- 把构建产物提交到 `master`
- Pages 目录选择 `weatherApp-VUE3/dist`

更推荐的方式仍是使用 Gitee Go / 镜像到 GitHub Pages，避免把构建产物混入源码。
