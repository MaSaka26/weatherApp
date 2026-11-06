# weatherAPP

一个深色玻璃拟态的天气应用。数据来自 Open-Meteo（免费、无需 Key），界面为自定义的高 DPI 仪表盘风格，桌面与移动端分别布局。

当前仓库只维护一代实现：

| 目录 | 说明 |
| --- | --- |
| `weatherApp-VUE3/` | **唯一主工程**。Vite 8 + Vue 3.5 + Pinia + vue-router + Highcharts 13。 |

> 最早的原生单文件版 `weather.html`（167 KB，无构建、双击即开）已在 `a7ebabe` 删除，需要时可从 Git 历史 `e1105ff` 取回；不再维护。

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
- 手机 3 列 × 2 行、平板 3 列 × 2 行、桌面一行六列
- 「左右 / 上下」图文布局可在设置面板切换

**逐小时预报**
- 横向滚动 24 小时，含温度、天气图标、降水概率
- 昼夜按接口返回的 `is_day` 逐小时判定，不再用固定时间段猜测

**降水预报条目**
- 左侧：标题「降水预报」+ 一句结论（如「正在下雨」「约 2 小时后转停」「未来 24 小时无雨」）
- 右侧：手绘感 SVG —— 十字街道 + 两团分散的雷达回波色块
- 点整条弹出全屏雷达回放：**中央气象台（NMC）拼图 12 帧**、播放/暂停/拖动、Escape 关闭
- 雷达组件走动态 import，只在首次打开时才挂载；打开后**先出第一帧就撤遮罩**，其余 11 张后台预载，换帧命中缓存零延迟
- 打开期间每分钟回探最新帧并滚动追加到时间轴（上限 60 帧 / 6 小时），长时间停留不会停在旧帧
- 四档区域（全国 1349×1208 / 华东 774×1326 / 华北 954×949 / 中南 975×980）可在控制条切换；分区图官方只发原图一档，切过去时画质组自动灰化为「仅原图」
- 全国图有三档画质（原图 / 中图 825×739 / 小图 480×430），与四档速度一起可在控制条切换

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

**雷达回放**

改用 [中央气象台（NMC）](http://www.nmc.cn/publish/radar/chinaall.html) 的全国雷达拼图：整幅 PNG 一次性显示，**不再叠 Leaflet 地图**，也就没有坐标系对齐问题。
- 图片按 6 分钟一档发布，URL 由 UTC 时间戳推算（`slotOf` 用 `Math.floor`，否则 07:35 会被推到还没发布的 07:36）。发布有 6–15 分钟延迟，所以从当前档往回最多探测 6 档找最新帧。
- **首帧先出**：探测到最新帧后立即建好 12 帧列表，只等第一张图 `decode()` 完成就撤遮罩开播，其余 11 张在后台并发预载，不等整批完成（避免冷缓存下 1.6–2.4 秒的空白等待）。若首帧 8 秒仍未落地也放行，真 404 由 `onerror` 单独标记。
- **开着时滚动刷新**：每 60 秒静默回探一次，把新发布的帧追加到时间轴尾部；超过 60 帧（6 小时）就从头裁掉并平移当前索引。回看旧帧的用户不会被强行拉回最新帧。
- 换帧走双缓冲 `<img>` + `visibility` 硬切（不是 opacity 过渡——两层半透明叠加会双重曝光），隐藏那张仍可继续加载与 `decode()`。
- 三档画质：`原图 1349×1208 / 中图 825×739 / 小图 480×430`（约 930/515/198 KB 每帧），按路径里有没有 `medium/`、`small/` 目录区分；换画质会重建整条帧列表。
- 图片是白底烘焙图（底图、省界、城市名、回波、图例都在一张图里），用 `invert(1) hue-rotate(180deg)` 转暗色主题；`hue-rotate` 是为了把反相后变品红的绿色回波绕回原色相。
- 响应带 `Access-Control-Allow-Origin: *`，但**没有 JSON 帧列表接口**，只能靠时间戳回推。

选 NMC 而非 RainViewer 的理由：单帧 0.27–0.62 秒（RainViewer 单块瓦片实测 1.3–12.4 秒）、6 分钟一帧（RainViewer 10 分钟）、当天有 70+ 帧可用（RainViewer 死限 13 帧）。代价是整图不能缩放、不能与自定义暗色底图叠加。

**性能取舍**
- 主包 ~174 KB（gzip 68 KB），Highcharts 单独分包 278 KB，雷达预览走动态 import（JS gzip 4.92 KB、CSS gzip 2.29 KB）
- 移除 Leaflet 与 Esri 底图后，WeatherHome 的 CSS 从 14.79 KB 降到 2.10 KB（Leaflet 样式不再打包）
- 雷达组件只在首次打开时挂载；打开后首帧先出、其余后台预载，之后换帧命中缓存零延迟

---

## 目录结构

```
weatherApp-VUE3/
├── src/
│   ├── api/weather.js          # 三个 Open-Meteo 接口封装
│   ├── assets/
│   │   ├── weather.css         # 全局样式与设计令牌（1595 行，单文件集中管理）
│   │   ├── icons.js            # 23 个 Tabler 图标的 path 数据
│   │   └── icons/*.svg         # 同上，用于生成 icons.js
│   ├── components/             # 21 个组件
│   │   ├── CurrentWeather.vue  # 温度 + 时钟
│   │   ├── DetailCards.vue     # 六卡容器
│   │   ├── NeedleDial / DialGauge / WindCompass / UvGauge
│   │   ├── HourlyForecast.vue
│   │   ├── RainForecast.vue    # 降水条目（左文右手绘 SVG）
│   │   ├── RainRadarPreview.vue# 全屏 NMC 雷达回放（1587 行）
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
│   ├── radar-demo.html               # 雷达回放独立 demo（单文件可跑，历史验证页）
│   ├── radar-demo-spec.md            # demo 早期的技术契约与 5 条 ADR（RainViewer+Leaflet 版）
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

- **雷达数据依赖第三方**。NMC 无 SLA、无 JSON 帧列表接口，只能按 UTC 时间戳回推；发布有 6–15 分钟延迟，所以要从当前档往回探测最多 6 档。
- **雷达是整幅烘焙图**。省界、城市名、回波、图例都在一张 PNG 里，不能缩放叠加到自定义底图，只能整张显示；暗色主题靠 CSS 反相实现。
- **图片没有 `Cache-Control` 头**，但有 `Access-Control-Allow-Origin: *` 和 `Last-Modified`；换帧靠「首帧先出 + 其余后台预载 + 每分钟滚动追加」把图拉进内存，不依赖 HTTP 缓存。

### 未实现

1. **完全离线不可行**。雷达图是实时发布的滚动数据，缓存意义有限；且 NMC 无离线授权说明。断网时用不了雷达回放。
2. **PM2.5 之外的地图叠加未做**。NMC 只有雷达拼图这一种产品，没有可叠加到地图的瓦片；想要「任意缩放 + 叠加」只能自建瓦片服务（成本与授权都不划算）。
3. **多城市 / 收藏未做**。目前只有定位 + 搜索单个地点，没有城市列表、没有收藏、没有对比。
4. **天气预警未接**。中国气象局的预警接口需申请，暂未接入，因此没有暴雨/大风/高温的红色提醒。
5. **空气质量只有 AQI 与 PM2.5**，没有 PM10、O₃、NO₂ 的细分展示，也没有分时段预报。
6. **降水条目只判断「有没有雨」**，没有区分雨/雪/冻雨的类型文案，也没有按小时柱状展示强度（`intensities` 数组已算好但界面未用）。
7. **无 PWA / 离线壳**。没有 Service Worker，断网时整页不可用。
8. **无自动化测试**。`ui-review/` 里的验证脚本是开发期一次性工具，没有进 CI，也没有单测覆盖 `lifeIndex.js` / `rainOutlook.js` 这些纯函数规则——它们其实是最好测的部分。

### 工程债

- `weather.css` 单文件 1595 行，全局样式与组件样式混在一起，长期应拆分为设计令牌 + 组件级样式。
- `RainRadarPreview.vue` 1587 行（已从 2301 行的 Leaflet/RainViewer 版重写精简），帧探测、滚动刷新、预载、双缓冲播放与视图仍在同一 SFC，可抽成 `useRadarPlayer` composable。
- `ui-review/` 被 `.gitignore` 忽略，验证脚本不进版本库，换机器就丢失。若这些脚本要长期用，应单独放行或移到独立仓库。

---

## 文档

- [开发日志 2026-10-30 ~ 11-02](weatherApp-VUE3/docs/开发日志-2026-10-30至11-02.md) —— 45 节，单文件原版的迁移与前三轮改版
- [开发日志 2026-11-03 ~ 11-04](weatherApp-VUE3/docs/开发日志-2026-11-03至11-04.md) —— 图标体系、雷达 demo、降水预报条目
- [雷达 demo 技术规格](weatherApp-VUE3/docs/radar-demo-spec.md) —— 15 行技术契约、5 条 ADR、15 条审查清单。**记录的是早期 RainViewer + Leaflet 版 demo**，正式组件已改为 NMC 整图，仅作历史参考
- [生活指数结果对照表](weatherApp-VUE3/docs/life-index-catalog.html) —— 54 种可能结果 × 对应图标，单文件可开
- [雷达回放 demo](weatherApp-VUE3/docs/radar-demo.html) —— 独立单文件、双击即开的开发期验证页（含 RainViewer 地图版与 NMC 整图版切换），**不是正式组件用的实现**

---

## 数据来源

天气与空气质量数据来自 [Open-Meteo](https://open-meteo.com/)（CC BY 4.0）。
雷达拼图来自 [中央气象台](http://www.nmc.cn/publish/radar/chinaall.html)（NMC），界面已保留「数据来源 中央气象台」署名。
图标来自 [Tabler Icons](https://tabler.io/icons)（MIT）。
