# weatherAPP

一个深色玻璃拟态的天气应用。数据来自 Open-Meteo（免费、无需 Key），界面为自定义的高 DPI 仪表盘风格，桌面与移动端分别布局。

仓库里有两代实现：

| 目录 | 说明 |
| --- | --- |
| `weatherApp-VUE3/` | **当前主工程**。Vite 8 + Vue 3.5 + Pinia + vue-router + Highcharts 13。 |
| `weather.html` | 最早的原生单文件版本（167 KB，无构建、双击即开），仅作历史留存，不再更新。 |

---

## 快速开始

```bash
cd weatherApp-VUE3
npm install
npm run dev        # http://localhost:5173
```

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动开发服务器（HMR） |
| `npm run build` | 生产构建到 `dist/` |
| `npm run preview` | 预览生产构建 |
| `npm run lint` | oxlint + eslint，**必须 0 错** |
| `npm run format` | Prettier 格式化 `src/` |

> 环境要求：Node `^22.18.0 || >=24.12.0`。

---

## 功能

**顶部**
- 实时温度、天气状况、今日最高/最低
- 右侧时钟：精确到秒的本地时间 + 日期 + 当年第几天
- 城市搜索：本地 3000+ 地名候选词（省/市/区县三级），输入即出下拉，选中后定位

**六卡详情**（体感、风速、湿度、气压、紫外线、日出日落）
- 体感：指针表盘；风速：罗盘；湿度/气压：环形表盘；紫外线：UV 表盘；日出日落：弧形轨迹
- 手机 3 列 × 2 行、平板 3 列 × 2 行、桌面一行六列（卡片纵向排列）
- 「左右 / 上下」图文布局可在设置面板切换（桌面固定纵向）

**逐小时预报**
- 横向滚动 24 小时，含温度、天气图标、降水概率
- 昼夜按接口返回的 `is_day` 逐小时判定，不再用固定时间段猜测

**降水预报条目**（新增）
- 左侧：标题「降水预报」+ 一句结论（如「正在下雨」「约 2 小时后转停」「未来 24 小时无雨」）
- 右侧：手绘感 SVG —— 十字街道 + 两团分散的雷达回波色块
- 点整条弹出全屏雷达回放：Leaflet + RainViewer 13 帧、播放/暂停/拖动、Escape 关闭
- Leaflet 从 CDN 按需注入（不打包进 bundle），雷达组件本身也只在打开时才挂载

**16 天预报**
- 列表 / 曲线双视图切换，两视图等高
- 曲线点位直接标注温度，图例配色与列表一致

**生活指数**（穿衣、防晒、户外、洗车、带伞、疾病风险）
- 每条一个结论短语 + 依据小字 + **一个语义图标**（洗车 = `car`，不宜洗车 = `car-off`）
- 好坏不靠颜色表达，靠图标语义，色弱用户同样可读
- 手机/平板 3 列 × 2 行，桌面一行六列

**设置面板**
- 毛玻璃强度：关 / 弱 / 标准 / 强
- 圆角：直角 / 标准 / 圆润
- 卡片图文布局：左右 / 上下
- 设置写入 `localStorage`，脏数据自动退回默认档位

---

## 技术要点

**数据源**（全部 Open-Meteo，无 API Key）

| 接口 | 用途 |
| --- | --- |
| `api.open-meteo.com/v1/forecast` | 实况 + 24h 逐小时 + 16 天预报（`forecast_days=16`） |
| `air-quality-api.open-meteo.com/v1/air-quality` | AQI、PM2.5 |
| `geocoding-api.open-meteo.com/v1/search` | 地名反查（备用） |

地名解析优先走本地表 `src/data/china-places.json`（394 个地级市 + 2814 个区县，区县挂在所属地级市下），命中即用，避免网络往返。

**雷达图层**

| 层 | 来源 | 坐标系 |
| --- | --- | --- |
| 底图 | Esri World Dark Gray Base | WGS84 |
| 降水回波 | RainViewer `tilecache` | WGS84 |

两个坐标系一致，叠加无偏移。选 Esri 的理由：CARTO 的免费暗色瓦片已下线（HTTP 200 但返回「API KEY REQUIRED」水印图），Esri 是唯一还能用的暗色底图。

**性能取舍**
- 主包 ~185 KB（gzip 72 KB），Highcharts 单独分包 278 KB，雷达预览走动态 import
- RainViewer 瓦片单块实测 1.3–12.4 秒，播放器因此**不等 `tileload`**（第一块到就换帧会导致每 0.5 秒撕掉整层、永远加载不完），改为等整层 `load`，慢网只让回放变慢，不黑屏
- z ≤ 6 的瓦片 `cache-control: max-age=172800`（48 小时），首圈之后回放零新请求；z7 只有 5 分钟缓存

---

## 目录结构

```
weatherApp-VUE3/
├── src/
│   ├── api/weather.js          # 三个 Open-Meteo 接口封装
│   ├── assets/
│   │   ├── weather.css         # 全局样式与设计令牌（1600 行，单文件集中管理）
│   │   ├── icons.js            # 24 个 Tabler 图标的 path 数据
│   │   └── icons/*.svg         # 同上，用于生成 icons.js
│   ├── components/             # 21 个组件
│   │   ├── CurrentWeather.vue  # 温度 + 时钟
│   │   ├── DetailCards.vue     # 六卡容器
│   │   ├── NeedleDial / DialGauge / WindCompass / UvGauge
│   │   ├── HourlyForecast.vue
│   │   ├── RainForecast.vue    # 降水条目（左文右手绘 SVG）
│   │   ├── RainRadarPreview.vue# 全屏雷达回放（1497 行）
│   │   ├── DailyForecast / DailyChart
│   │   ├── LifeIndex.vue       # 生活指数
│   │   ├── TablerIcon.vue      # 通用图标组件
│   │   └── SettingsPanel / SearchBar / SkyBackground …
│   ├── composables/            # useSettings（设置）、useTween（补间）、useWheelScroll
│   ├── data/china-places.json  # 本地地名表（111 KB）
│   ├── stores/weather.js       # Pinia：请求编排 + placeToken 防竞态
│   ├── utils/
│   │   ├── lifeIndex.js        # 六大生活指数规则
│   │   ├── rainOutlook.js      # 降水展望（未来多少小时有雨）
│   │   ├── weatherCodes.js     # WMO 天气码 → 中文 + 昼夜
│   │   └── placeLookup / placeSearch
│   └── views/WeatherHome.vue
├── docs/
│   ├── 开发日志-2026-10-30至11-02.md  # 45 节开发记录
│   ├── radar-demo.html               # 雷达回放独立 demo（单文件可跑）
│   ├── radar-demo-spec.md            # demo 的技术契约与 5 条 ADR
│   └── life-index-catalog.html       # 生活指数 54 种可能结果 × 图标对照表
└── ui-review/                        # 开发期验证脚本与截图（不进版本库）
```

---

## 开发约定

这些约定来自踩过的坑，写进日志也写在这里：

1. **不要 `taskkill` 用户的浏览器或开发服务**。曾经误杀过，之后只允许 kill 自己 spawn 的进程 PID。
2. **质量门槛**：`npm run lint` 必须 0 错、`npm run build` 必须通过，才算完成。
3. **验证要看画面，不能只看状态码**。CARTO 瓦片返回 200 但是水印图——`curl -w %{http_code}` 证明不了任何事。
4. **Highcharts 的 `dataLabels.textOutline`** 会内嵌 `.highcharts-text-outline` tspan，用 CSS 改字体颜色会失效，必须改配置。
5. **Vue computed 在模板里自动解包**：`drift` 是 computed 时，模板写 `drift` 而不是 `drift()`。这个错曾让整个 `.weather-content` 不渲染。
6. **验证脚本的固定成本很高**（起无头浏览器 + 加载 + 截图 ≈ 2 分钟/次），因此脚本要一次跑完所有断言并直接落 JSON/日志，不要靠管道 `| tail` 观察。

---

## 已知限制与未完成的规划

### 可靠性

- **雷达数据依赖第三方**。RainViewer 免费额度无 SLA，`nowcast`（未来 30 分钟临近预报）已被官方取消，只剩 `past` 13 帧。商用需单独授权，且必须保留「Weather data by RainViewer」署名。
- **雷达只覆盖雷达拼图有效区**。中国西部、海上空白处不是 bug，是当地确实没有回波。
- **`color` 参数无效**。RainViewer 的 `color=0…9` 实测返回完全相同的像素（同 md5），所以配色改用前端 CSS filter 实现。
- **zoom > 6 时不缓存**。z7 瓦片 `max-age` 只有 5 分钟，放大后回放会每圈重新请求 390 次。

### 未实现

1. **完全离线不可行**。底图理论上可打包（全国 z3–6 数百张、5–15 MB），但 Esri 条款禁止批量下载分发，要离线必须先换 OSM/Natural Earth 底图重新出图；雷达则只能靠「低 zoom + 缓存 + 预热」逼近离线，无法真正离线。
2. **13 帧预热未做**。实测预热后单帧换帧从 3–7 秒降到 1.1 秒，成本是首屏多 156 个请求（并发 16 时约 12.8 秒）。收益明确，但会增加首次打开的等待。
3. **多城市 / 收藏未做**。目前只有定位 + 搜索单个地点，没有城市列表、没有收藏、没有对比。
4. **天气预警未接**。中国气象局的预警接口需申请，暂未接入，因此没有暴雨/大风/高温的红色提醒。
5. **空气质量只有 AQI 与 PM2.5**，没有 PM10、O₃、NO₂ 的细分展示，也没有分时段预报。
6. **降水条目只判断「有没有雨」**，没有区分雨/雪/冻雨的类型文案，也没有按小时柱状展示强度（`intensities` 数组已算好但界面未用）。
7. **无 PWA / 离线壳**。没有 Service Worker，断网时整页不可用。
8. **无自动化测试**。`ui-review/` 里的验证脚本是开发期一次性工具，没有进 CI，也没有单测覆盖 `lifeIndex.js` / `rainOutlook.js` 这些纯函数规则——它们其实是最好测的部分。
9. **根目录 `weather.html`** 是历史版本，已无维护计划。是否保留待定。

### 工程债

- `weather.css` 单文件 1600 行，全局样式与组件样式混在一起，长期应拆分为设计令牌 + 组件级样式。
- `RainRadarPreview.vue` 1497 行，逻辑（帧管理、交叉淡入、错误兜底）与视图耦合，可抽成 `useRadarPlayer` composable。
- `ui-review/` 被 `.gitignore` 忽略，验证脚本不进版本库，换机器就丢失。若这些脚本要长期用，应单独放行或移到独立仓库。

---

## 文档

- [开发日志 2026-10-30 ~ 11-02](weatherApp-VUE3/docs/开发日志-2026-10-30至11-02.md) —— 45 节，单文件原版的迁移与前三轮改版
- [开发日志 2026-11-03 ~ 11-04](weatherApp-VUE3/docs/开发日志-2026-11-03至11-04.md) —— 图标体系、雷达 demo、降水预报条目
- [雷达 demo 技术规格](weatherApp-VUE3/docs/radar-demo-spec.md) —— 15 行技术契约、5 条 ADR、15 条审查清单
- [生活指数结果对照表](weatherApp-VUE3/docs/life-index-catalog.html) —— 54 种可能结果 × 对应图标，单文件可开
- [雷达回放 demo](weatherApp-VUE3/docs/radar-demo.html) —— 独立单文件，双击即开

---

## 数据来源

天气与空气质量数据来自 [Open-Meteo](https://open-meteo.com/)（CC BY 4.0）。
雷达回波来自 [RainViewer](https://www.rainviewer.com/api.html)，署名要求已在界面保留。
底图来自 [Esri](https://www.esri.com/)，署名「Esri, HERE, Garmin, © OpenStreetMap contributors」。
图标来自 [Tabler Icons](https://tabler.io/icons)（MIT）。
