# weatherApp-VUE3

当前主工程源码在这里。项目说明、功能清单、技术取舍与未完成规划见仓库根目录的 [README](../README.md)。

## 常用命令

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # 产物在 dist/
npm run preview  # 预览构建结果
npm run lint     # 只检查：oxlint + eslint，必须 0 错
npm run lint:fix # 显式自动修复 lint 问题
npm test         # 天气规则、竞态、定位意图、过期与时区测试
npm run format   # Prettier 格式化 src/
```

环境要求 Node `^22.18.0 || >=24.12.0`。

## 文档

- [开发日志 2026-10-30 ~ 11-02](docs/开发日志-2026-10-30至11-02.md) —— 45 节，单文件原版的迁移与前三轮改版
- [开发日志 2026-11-03 ~ 11-04](docs/开发日志-2026-11-03至11-04.md) —— 生活指数图标体系、雷达 demo、降水预报条目
- [雷达 demo 技术规格](docs/radar-demo-spec.md) —— 技术契约、ADR、审查清单
- [生活指数结果对照表](docs/life-index-catalog.html) —— 54 种可能结果 × 对应图标
- [雷达回放 demo](docs/radar-demo.html) —— 单文件，双击即开

## 目录速览

```
src/
├── api/weather.js          # Open-Meteo 三个接口
├── assets/weather.css      # 全局样式与设计令牌
├── components/             # 23 个组件
├── composables/            # useSettings / useTween / useWheelScroll
├── data/china-places.json  # 本地地名表
├── stores/weather.js       # 请求编排（placeToken 防竞态）
├── utils/                  # 天气规则、缓存、定位意图、时区与地名查询
└── views/WeatherHome.vue
```

## 开发约定

1. 不要 `taskkill` 用户的浏览器或开发服务，只 kill 自己 spawn 的 PID。
2. `npm run lint` 0 错 + `npm run build` 通过才算完成。
3. 瓦片/图片类资源必须**看画面**验收，HTTP 200 不能证明内容有效。
4. Vue 的 computed 在模板里自动解包，写 `drift` 不写 `drift()`。
