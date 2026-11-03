# 雷达降水回放 Demo —— 技术规格

> 参考实现：`docs/radar-demo.html`（单文件、零构建、file:// 可开）。本文件是该 demo 的契约与验收基线。

## 1. 技术契约

| 项 | 约束 | 违反后果 |
|---|---|---|
| 元数据 URL | `https://api.rainviewer.com/public/weather-maps.json` | 无帧列表，地图空白 |
| 元数据结构 | `{version, generated, host, radar:{past:[{time,path}], nowcast:[]}}` | — |
| 帧数与节奏 | `radar.past` 实测 13 帧，覆盖过去 120 分钟，10 分钟/帧 | 硬编码 13 会在跨小时后错位 |
| `time` 语义 | **秒级 unix UTC**，非毫秒、非本地 | 时间标签差 8 小时或显示 1970 |
| 瓦片模板 | `{host}{path}/512/{z}/{x}/{y}/{color}/{smooth}_{snow}.png` | 404 / 空图 |
| color 取值 | `2`（原色）/`4`/`6`/`8`；demo 固定 `4` | 配色不一致 |
| smooth_snow | `1_1` = 抗锯齿开 + 雪配色开 | 边缘锯齿、雪区无色 |
| 原生 zoom 上限 | **7**（官方上限；z8/z9/z10 返回 200 但恒 3269 字节 = 拉伸空图） | 高倍下灰白一片 |
| 底图 | `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png`，subdomains `abcd` | — |
| 坐标系 | RainViewer 与 CartoDB **同为 WGS84**，可直接叠加 | 引入 GCJ-02 源即偏移 300–600 m |
| 依赖 | Leaflet 1.9.4（jsDelivr，`leaflet.js` 147 KB / `leaflet.css` 14.8 KB） | — |
| 署名 | 必须显示「Weather data by RainViewer」并链接 `https://www.rainviewer.com/api.html` | 违反使用权 |
| 已知正常噪声 | CartoDB 某些 z5 瓦片 404；RainViewer `nowcast` 恒为空数组 | 误判为故障、写出防御性死代码 |

## 2. 架构决策记录（ADR）

### ADR-1 渲染引擎：Leaflet 1.9.4（而非 MapLibre GL / 原生 canvas）
- **决策**：Leaflet + `L.tileLayer`，CDN 直引。
- **理由**：需求本质是「一张底图 + 一串等尺寸栅格叠加」。Leaflet 的 `maxNativeZoom` 默认就有「低清瓦片放大」语义，正好命中 RainViewer z≤7 的硬约束；MapLibre 用 WebGL 栅格源做同样的事需要写 style JSON 且默认按 `maxzoom` 空白而非拉伸。体积上 Leaflet gzip 约 42 KB，MapLibre 约 220 KB。零构建，符合 demo 定位。
- **被否**：MapLibre GL（为单图层叠加引入 WebGL 渲染栈与 style 规范，成本远超收益）；原生 canvas（须自己实现墨卡托投影、瓦片调度、拖动惯性、缩放动画，200 行做不完）。

### ADR-2 底图：CartoDB dark（而非高德/百度）
- **决策**：`dark_all` 底图，`subdomains: 'abcd'`。
- **理由**：CartoDB 与 RainViewer 同属 WGS84，零配准成本。深色底图让半透明降水色块（蓝→绿→黄→红）保持高对比，夜间观感也成立。
- **被否**：高德/百度底图（GCJ-02/BD-09，与 WGS84 叠加会产生 300–600 m 系统性偏移，且需自建代理绕开无 key 限制）；OSM 默认瓦片（亮色底图上黄色降水几乎不可见）。

### ADR-3 `maxNativeZoom: 7, maxZoom: 19`
- **决策**：`L.tileLayer(url, { maxNativeZoom: 7, maxZoom: 19 })`。
- **理由**：RainViewer 服务端在 z≥8 不做真实渲染，返回固定 3269 字节的占位图 —— HTTP 层面 200，看起来「请求成功」，实际是空壳。所以不能靠 `errorTileUrl` 或加载失败回调发现它（根本不会触发 `tileerror`）。把上限交给 Leaflet，z8+ 直接复用 z7 瓦片做客户端放大：网络请求数不增，视觉上是模糊但连续的降水场。
- **被否**：把 `maxZoom` 也压到 7（用户无法放大看城市级细节，体验断崖）；自己写 `tileload` 拦截并重写 URL（多一层黑魔法，且与 Leaflet 内部 zoom 计算耦合）。

### ADR-4 换帧策略：`setUrl` 优于 `removeLayer + 重建`，双图层交叉淡入为可选增强
- **决策**：主用 `radarLayer.setUrl(newUrl, false)`（`noRedraw=false`）；切换瞬间给容器加 `radar-frame` CSS 动画（`opacity .18s`）。
- **理由（闪烁评估）**：
  - `removeLayer + 新建 tileLayer`：旧层移除与新区块解码之间存在 1 帧以上的空窗，且 Leaflet 会丢弃旧层的 `_tiles` 缓存，回放循环里每帧都重新请求 —— 13 帧循环播放时表现为明显白闪 + 请求风暴。
  - `setUrl(url, false)`：Leaflet 保留图层实例，逐瓦片替换 `src` 并复用 `_tiles` 键；首轮 13 帧请求完成后，循环回放全部命中内存/HTTP 缓存，**零新增请求**。缺点是新帧未就绪时旧图会停留，表现为「帧滞后」而非「白屏」—— 对降水回放是更好的降级。
  - 双图层交叉淡入（A/B 交替，`zIndex` 与 opacity 过渡）：视觉最平滑，但需管理两层各自的当前帧索引、在快速拖滑块时产生层堆积，且两套 tile 缓存内存翻倍。demo 阶段以 `setUrl` + CSS 淡入覆盖 90% 场景。
- **被否**：重建图层（闪烁 + 请求风暴）；无条件双图层（复杂度/内存不划算，留作 v2）。

### ADR-5 交付形态：单文件 HTML（file:// 直开）
- **决策**：`docs/radar-demo.html` 单文件，内联 CSS/JS，外链仅 Leaflet CDN 与两个瓦片服务。
- **理由**：评审/演示零摩擦，双击即看；不污染 Vue 工程构建链，不改 `package.json`。所有请求都是跨域 `fetch` + `<img>`，RainViewer 与 CartoDB 均返回 `Access-Control-Allow-Origin: *`，`file://` 下 `origin: null` 也能通过 —— 故无需 http 服务。
- **被否**：做成 Vue 路由页（需改 `vite.config`、加依赖、跑 dev server，与「先验证可行性」的目标错配）；拆成 `index.html + radar.js + radar.css`（`file://` 下 ES module 会被 CORS 拦截，反而强制起服务）。

## 3. 审查清单

- □ 打开页面后地图中心可见，底图为深色，`.leaflet-container` 内 `.leaflet-tile-loaded` 数量 > 0。
- □ 降水层与底图上的已知地标（如海岸线/城市）**无系统性偏移**；叠加对比时降水边缘不偏移一个街区以上（验证 WGS84 一致，无 GCJ-02 混入）。
- □ 手动缩放到 z8、z10，`.leaflet-tile-loaded` 仍持续 > 0 且**无新增** `tilecache.rainviewer.com` 网络请求（浏览器 Network 面板按域名过滤计数不涨）。
- □ 拖动地图到新区域，降水层随底图同步平移，不出现「底图走了降水没走」。
- □ 点击播放后连续推进 3 帧，最新帧时间标签文案变为「最新」，且第 13 帧后自动回到第 1 帧（首尾闭环）。
- □ 点击暂停后帧序号 3 秒内不变；再次播放从当前帧继续而非跳回第 1 帧。
- □ 拖动时间滑块时地图帧跟随滑块实时变化，且松手后滑块位置与帧索引一致（无 off-by-one）。
- □ 键盘：`Space` 切换播放/暂停，`←/→` 单帧步进，`Home` 跳到首帧；焦点在滑块上时方向键仍能改值。
- □ 移动端（375×667 模拟）下控制条不遮挡地图主体，按钮可点，字号 ≥ 12 px，无横向滚动条。
- □ 移动端单指拖动平移地图时不触发页面滚动（`touch-action: none` 生效），双指缩放不误触控制条。
- □ 断网后刷新：页面显示明确错误提示（含「可能是网络无法访问 api.rainviewer.com」类文案）而不是空白地图。
- □ 元数据请求失败时底图仍渲染（降级为纯底图），不整页白屏。
- □ 元数据只请求 **1 次**：完整播放两轮后 Network 面板中 `weather-maps.json` 计数仍为 1。
- □ 署名「Weather data by RainViewer」可见、可点击、`target="_blank"` 打开 rainviewer.com，且不遮挡地图交互。
- □ 页面在 390 px 宽下首屏 3 秒内出现底图（性能兜底：CDN 慢时不阻塞 UI）。

## 4. 已知风险

| # | 触发条件 → 现象 → 缓解 |
|---|---|
| 1 | **Leaflet CDN 不可达**（中国大陆访问 jsdelivr/unpkg 抖动）→ 页面全白，`L` 未定义，控制台 `L is not defined` → `<script onerror>` 置 `window.__leafletFail`，检测后渲染纯 HTML 提示与备选 CDN 链接（unpkg / cdnjs），不抛死循环重试。 |
| 2 | **RainViewer 元数据失败**（超时 / 429 / 5xx / 地域封锁）→ 降水层永不出现，用户以为是 bug → `fetch` 加 `AbortController` 8 s 超时，失败时保留底图 + 顶部条提示，并显示「重试」按钮；重试只重发元数据请求，不重建地图实例。 |
| 3 | **CORS / file:// 限制** → `fetch` 被拦，控制台 `blocked by CORS policy`（若浏览器策略收紧或改用 `file://` 打开别的机器）→ 已确认两服务返回 `ACAO: *`，但真出错时给出可操作文案：「请用 `npx serve docs` 启动本地服务后访问」，而非静默失败。 |
| 4 | **时区错位** → `time` 是 UTC 秒，直接 `new Date(t*1000).toLocaleString()` 以外的写法（如手动 `+8h`）在跨时区或夏令时用户处差一小时 → 统一用 `new Date(t*1000)` 并交给 `toLocaleTimeString('zh-CN', {hour:'2-digit', minute:'2-digit'})`，禁止手工加减偏移；「最新」判定用索引 `i === frames.length - 1`，不用时间比较。 |
| 5 | **移动端手势冲突** → 单指拖动地图时整页跟着滚，或双指缩放被浏览器接管放大页面 → 地图容器 `touch-action: none`，`L.map(el, { dragging: true, touchZoom: true, tap: false })`；控制条单独 `touch-action: manipulation` 并 `stopPropagation`，避免 Leaflet 抢占滑块拖动。 |
| 6 | **回放请求风暴** → 快速拖滑块导致 13 帧瓦片同时排队，弱网下地图长时间半透明/花屏 → 帧切换做 60–80 ms 节流（`requestAnimationFrame` 合并），并在 `setUrl` 后不再叠加 `removeLayer`；必要时把播放间隔从 400 ms 提到 600 ms。 |
| 7 | **z≥8 假成功** → 用户强行放大看到「降水消失但也不报错」→ 已是 ADR-3 的既定形态（客户端拉伸），需在 UI 角落加一行小字「雷达原始精度至 7 级，放大为插值」，把技术限制转成预期管理。 |
