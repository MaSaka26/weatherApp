<script setup>
import { useRadarPlayer } from '@/composables/useRadarPlayer'

const props = defineProps({
  open: { type: Boolean, default: false },
  cityName: { type: String, default: '' },
  skyClass: { type: String, default: '' },
})
const emit = defineEmits(['close'])
const {
  layerEl, controlsEl, creditEl, stageEl, imgA, imgB, status, errorMsg, probeHint,
  idx, playing, quality, region, speed, front, frameNote, ready,
  maxIdx, pct, isLatest, timeText, relLabel, rangeText, cityLabel,
  regionInfo, regionOnly, QUALITIES, REGIONS, SPEEDS, close, retry, togglePlay,
  onSlide, setRegion, setQuality, setSpeed,
} = useRadarPlayer(props, emit)
</script>


<template>
  <Teleport to="body">
    <div
      v-if="open"
      ref="layerEl"
      class="radar-layer"
      role="dialog"
      aria-modal="true"
      :aria-label="`${regionInfo.name}降水雷达回放`"
    >
      <!-- 与首页共用同一套天空背景（渐变 + 光晕 + 星点 + 天气自适应）。
           .sky-bg 是 weather.css 里的全局类，不是 scoped，这里直接复用；
           放在最前面、层级垫底，图区与所有控件都压在它上面。 -->
      <div class="sky-bg radar-sky" :class="skyClass" aria-hidden="true"></div>

      <!-- 图区。图片本身自带底图、省界、城市名与色标，
           所以这里不需要 Leaflet、不需要叠加图层、也不需要另做图例。 -->
      <div ref="stageEl" class="radar-stage">
        <img ref="imgA" class="radar-img" :class="{ show: front === 0 }" alt="" />
        <img ref="imgB" class="radar-img" :class="{ show: front === 1 }" alt="" />
      </div>

      <header class="radar-top">
        <div class="radar-head">
          <span class="radar-dot" aria-hidden="true"></span>
          <h2 class="radar-title">降水雷达</h2>
          <span class="radar-sep" aria-hidden="true"></span>
          <span class="radar-city">{{ cityLabel }}</span>
          <!-- 顶部标题联动：全国模式下城市名本身就写着「全国」，再挂一个区域徽标纯属重复，
               只有切到分区时才补上，让用户一眼知道当前看的是哪张大区图。 -->
          <span v-if="regionOnly" class="radar-region">{{ regionInfo.name }}</span>
        </div>

        <button class="radar-icon-btn" type="button" aria-label="关闭雷达回放" @click="close">
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>

      <div v-if="status === 'loading'" class="radar-status" role="status">
        <div class="radar-spinner"></div>
        <p class="radar-status-text">{{ probeHint || '正在获取雷达回放帧…' }}</p>
      </div>

      <div v-else-if="status === 'error'" class="radar-status" role="alert">
        <div class="radar-error-icon" aria-hidden="true">!</div>
        <p class="radar-status-text">雷达数据加载失败</p>
        <p class="radar-error-desc">{{ errorMsg }}</p>
        <button class="radar-retry" type="button" @click="retry">重试</button>
      </div>

      <p v-if="frameNote" class="radar-note" role="status">{{ frameNote }}</p>

      <p ref="creditEl" class="radar-credit">
        数据来源
        <a href="http://www.nmc.cn/" target="_blank" rel="noopener">中央气象台</a>
        <span class="credit-sep">·</span>
        6 分钟一帧
      </p>

      <footer ref="controlsEl" class="radar-controls">
        <div class="radar-row-main">
          <button
            class="radar-play"
            type="button"
            :disabled="!ready"
            :aria-label="playing ? '暂停回放' : '播放回放'"
            @click="togglePlay"
          >
            <svg
              v-if="playing"
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
            </svg>
            <svg
              v-else
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M8 5v14l11-7z" />
            </svg>
          </button>

          <div class="radar-track">
            <div class="radar-time-row">
              <span class="radar-clock">{{ timeText }}</span>
              <span class="radar-tag" :class="{ latest: isLatest }">{{ relLabel }}</span>
              <span class="radar-meta">{{ rangeText }}</span>
            </div>

            <input
              class="radar-slider"
              type="range"
              min="0"
              :max="maxIdx"
              step="1"
              :value="idx"
              :disabled="!ready"
              :style="{ '--pct': pct + '%' }"
              aria-label="雷达帧时间轴"
              @input="onSlide"
            />
          </div>

          <button class="radar-close" type="button" @click="close">关闭</button>
        </div>

        <div class="radar-row-sub">
          <div class="radar-group">
            <span class="radar-group-label">区域</span>
            <div class="radar-seg" role="group" aria-label="雷达覆盖区域">
              <button
                v-for="r in REGIONS"
                :key="r.id"
                class="radar-seg-btn"
                :class="{ on: region === r.id }"
                type="button"
                @click="setRegion(r.id)"
              >
                {{ r.name }}
              </button>
            </div>
          </div>

          <div class="radar-group">
            <span class="radar-group-label">画质</span>
            <div class="radar-seg" role="group" aria-label="图片清晰度">
              <!-- 分区图官方只发原图一档（medium/small 全 404），所以这里不给选择，
                   摆一个 disabled 的「仅原图」占位：布局高度不变，切回全国立刻恢复三档。 -->
              <template v-if="regionOnly">
                <button class="radar-seg-btn on" type="button" disabled title="区域图只提供原图">
                  仅原图
                </button>
              </template>
              <template v-else>
                <button
                  v-for="q in QUALITIES"
                  :key="q.id"
                  class="radar-seg-btn"
                  :class="{ on: quality === q.id }"
                  type="button"
                  :title="`${q.w}×${q.h} · 约 ${q.kb} KB/帧`"
                  @click="setQuality(q.id)"
                >
                  {{ q.name }}
                </button>
              </template>
            </div>
          </div>

          <div class="radar-group">
            <span class="radar-group-label">速度</span>
            <div class="radar-seg" role="group" aria-label="回放速度">
              <button
                v-for="s in SPEEDS"
                :key="s.id"
                class="radar-seg-btn"
                :class="{ on: speed === s.id }"
                type="button"
                :title="`每帧 ${s.frameMs}ms`"
                @click="setSpeed(s.id)"
              >
                {{ s.name }}
              </button>
            </div>
          </div>
        </div>
      </footer>
    </div>
  </Teleport>
</template>

<style scoped>
/* 颜色自持：这个覆盖层刻意不依赖 weather.css 的主题变量。
   雷达图的像素是一套固定配色，跟随主题改反而会让回波颜色与色标对不上。 */
.radar-layer {
  --rr-bg: #060d16;
  --rr-glass: rgba(13, 27, 42, 0.72);
  --rr-stroke: rgba(255, 255, 255, 0.1);
  --rr-accent: #6db3f2;
  --rr-accent-bright: #7fd4f5;
  --rr-text-0: #fff;
  --rr-text-2: rgba(255, 255, 255, 0.9);
  --rr-text-4: rgba(255, 255, 255, 0.72);
  --rr-text-6: rgba(255, 255, 255, 0.52);
  --rr-blur: blur(22px) saturate(150%);
  --rr-shadow: 0 12px 48px rgba(0, 0, 0, 0.55);
  --rr-ctrl-top: 140px;
  --rr-credit-h: 14px;

  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  background: var(--rr-bg);
  color: var(--rr-text-0);
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  overscroll-behavior: contain;
}

/* 与首页完全相同的天空背景。.sky-bg 的全局规则（weather.css）已经带了
   渐变、光晕、星点与天气自适应类；这里只把它钉在覆盖层最底层。
   覆盖层本身是 fixed inset:0，所以 absolute inset:0 与它完全重合；
   z-index:0 垫底，图区与所有控件（z-index ≥3）都压在它上面。
   保留 .radar-layer 的纯色作兜底：天空图或动画没起来时不至于透出页面。 */
.radar-sky {
  position: absolute;
  z-index: 0;
}

/* 图区：让开顶部标题与底部控制条，中间居中显示。
   图片用 object-fit: contain —— 一旦拉伸变形，回波和真实地理位置就对不上了。 */
.radar-stage {
  position: absolute;
  inset: 0;
  z-index: 1; /* 压在 .radar-sky(z-index:0) 之上，图片与控件都不被天空盖住 */
  padding: 68px 16px calc(var(--rr-ctrl-top) + 10px);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

/* 让图片盒撑满可用区域，再由 object-fit: contain 把画面居中收进去。
   必须显式给 width/height —— <img> 是替换元素，只写 inset 而不管尺寸时
   浏览器会退回图片的固有尺寸（825×739），在窄屏上直接溢出到控制条底下。
   给了尺寸之后 contain 才有余量可居中，任何视口下都不会变形也不会溢出。 */
.radar-img {
  position: absolute;
  top: 68px;
  left: 16px;
  width: calc(100% - 32px);
  height: calc(100% - 68px - var(--rr-ctrl-top) - 10px);
  object-fit: contain;
  /* 双缓冲一次只画一张：用 visibility 硬切，不用 opacity。
     两张都是不透明的整图，做透明度过渡会把前后两帧叠成「双重曝光」→ 每帧闪一下；
     而若两张都设成 opacity:1，DOM 里靠后的 imgB 会永远盖住 imgA，
     落在 imgA 上的帧就完全看不见 → 表现为「隔一帧才变一次」。
     visibility 只切换绘制、不触发重排，且隐藏的那张仍会继续加载与 decode。 */
  visibility: hidden;
  /* NMC 的图是白底，直接放进暗色界面里像贴了一张纸。
     反相后底图变暗、城市名变白，正好和这个界面一个调子。
     hue-rotate 在反相之后把色相绕回来 —— 只做 invert 会把绿色回波翻成品红。 */
  filter: invert(1) hue-rotate(180deg) brightness(0.94) contrast(1.08);
  user-select: none;
  -webkit-user-drag: none;
}

.radar-img.show {
  visibility: visible;
}

/* ============================================================
   顶部
   ============================================================ */

.radar-top {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px 32px;
  background: linear-gradient(
    to bottom,
    rgba(6, 13, 22, 0.92) 0%,
    rgba(6, 13, 22, 0.5) 55%,
    rgba(6, 13, 22, 0) 100%
  );
  pointer-events: none;
}

.radar-top > * {
  pointer-events: auto;
}

.radar-head {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
  padding: 7px 14px 7px 12px;
  background: var(--rr-glass);
  backdrop-filter: var(--rr-blur);
  -webkit-backdrop-filter: var(--rr-blur);
  border: 1px solid var(--rr-stroke);
  border-radius: 999px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.radar-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--rr-accent-bright);
  box-shadow: 0 0 0 4px rgba(109, 179, 242, 0.18);
  flex: 0 0 auto;
}

.radar-title {
  font-size: 0.8125rem;
  font-weight: 600;
  letter-spacing: 0.4px;
  white-space: nowrap;
  margin: 0;
}

.radar-sep {
  width: 1px;
  height: 12px;
  background: rgba(255, 255, 255, 0.16);
  flex: 0 0 auto;
}

.radar-city {
  font-size: 0.75rem;
  font-weight: 300;
  color: var(--rr-text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 34vw;
}

/* 区域名徽标：跟在城市名后面，视觉上弱一级（更小、更暗），
   免得和城市名抢焦点 —— 它只是「你现在看的是哪张大区图」的注脚。 */
.radar-region {
  flex: 0 0 auto;
  padding: 2px 7px;
  font-size: 0.625rem;
  font-weight: 500;
  letter-spacing: 0.3px;
  color: var(--rr-accent-bright);
  background: rgba(109, 179, 242, 0.16);
  border: 1px solid rgba(109, 179, 242, 0.3);
  border-radius: 999px;
  white-space: nowrap;
}

.radar-icon-btn {
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  cursor: pointer;
  color: var(--rr-text-2);
  background: var(--rr-glass);
  backdrop-filter: var(--rr-blur);
  -webkit-backdrop-filter: var(--rr-blur);
  border: 1px solid var(--rr-stroke);
  transition:
    background 0.16s ease,
    color 0.16s ease;
}

.radar-icon-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  color: var(--rr-text-0);
}

.radar-icon-btn:focus-visible {
  outline: 2px solid var(--rr-accent-bright);
  outline-offset: 2px;
}

/* ============================================================
   状态
   ============================================================ */

.radar-status {
  position: absolute;
  inset: 0;
  z-index: 4;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 0 24px;
  background: rgba(6, 13, 22, 0.86);
  backdrop-filter: blur(3px);
  text-align: center;
}

.radar-spinner {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 2px solid rgba(127, 212, 245, 0.22);
  border-top-color: var(--rr-accent-bright);
  animation: radar-spin 0.9s linear infinite;
}

@keyframes radar-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .radar-spinner {
    animation-duration: 2.4s;
  }
}

.radar-status-text {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--rr-text-2);
  font-variant-numeric: tabular-nums;
}

.radar-error-icon {
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 1.125rem;
  font-weight: 600;
  color: #ffb4a2;
  background: rgba(255, 120, 90, 0.14);
  border: 1px solid rgba(255, 140, 120, 0.32);
}

.radar-error-desc {
  margin: 0;
  max-width: 34em;
  font-size: 0.75rem;
  line-height: 1.6;
  color: var(--rr-text-6);
}

.radar-retry {
  padding: 7px 18px;
  font-size: 0.75rem;
  color: var(--rr-text-0);
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid var(--rr-stroke);
  border-radius: 999px;
  cursor: pointer;
}

.radar-retry:focus-visible,
.radar-close:focus-visible,
.radar-play:focus-visible,
.radar-seg-btn:focus-visible {
  outline: 2px solid var(--rr-accent-bright);
  outline-offset: 2px;
}

/* 单帧缺失提示：只说明这一格是空的，不打断回放 */
.radar-note {
  position: absolute;
  left: 50%;
  top: 74px;
  transform: translateX(-50%);
  z-index: 3;
  margin: 0;
  padding: 5px 12px;
  font-size: 0.6875rem;
  color: rgba(255, 232, 190, 0.94);
  background: rgba(58, 44, 20, 0.9);
  border: 1px solid rgba(240, 190, 90, 0.34);
  border-radius: 999px;
  white-space: nowrap;
}

/* ============================================================
   版权行
   ============================================================ */

/* 钉在页面最底部居中。控制条要按它的实测高度让位（--rr-credit-h），
   否则窄屏它折成两行时会和控制条叠在一起。 */
.radar-credit {
  position: absolute;
  left: 50%;
  bottom: 4px;
  transform: translateX(-50%);
  z-index: 7;
  width: max-content;
  max-width: calc(100% - 20px);
  margin: 0;
  text-align: center;
  font-size: 0.625rem;
  line-height: 1.4;
  color: var(--rr-text-6);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
}

.radar-credit a {
  color: var(--rr-text-4);
  text-decoration: none;
  pointer-events: auto;
}

.radar-credit a:hover {
  color: var(--rr-accent-bright);
}

.credit-sep {
  margin: 0 2px;
  opacity: 0.6;
}

/* ============================================================
   底部控制条
   ============================================================ */

.radar-controls {
  position: absolute;
  left: 50%;
  bottom: calc(var(--rr-credit-h) + 12px);
  transform: translateX(-50%);
  z-index: 5;
  width: min(760px, calc(100% - 32px));
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  background: var(--rr-glass);
  backdrop-filter: var(--rr-blur);
  -webkit-backdrop-filter: var(--rr-blur);
  border: 1px solid var(--rr-stroke);
  border-radius: 18px;
  box-shadow: var(--rr-shadow);
}

.radar-row-main {
  display: flex;
  align-items: center;
  gap: 12px;
}

.radar-play {
  flex: 0 0 auto;
  width: 38px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  color: #06131f;
  background: var(--rr-accent-bright);
  transition: transform 0.14s ease;
}

.radar-play:hover:not(:disabled) {
  transform: scale(1.06);
}

.radar-play:disabled {
  cursor: default;
  opacity: 0.4;
}

.radar-track {
  flex: 1 1 auto;
  min-width: 0;
}

.radar-time-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 7px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
}

.radar-clock {
  font-size: 1.0625rem;
  font-weight: 400;
  letter-spacing: 0.4px;
  color: var(--rr-text-0);
}

.radar-tag {
  flex: 0 0 auto;
  padding: 2px 7px;
  font-size: 0.625rem;
  font-weight: 500;
  color: var(--rr-text-4);
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid var(--rr-stroke);
  border-radius: 999px;
}

.radar-tag.latest {
  color: var(--rr-accent-bright);
  background: rgba(109, 179, 242, 0.16);
  border-color: rgba(109, 179, 242, 0.3);
}

.radar-meta {
  flex: 0 1 auto;
  min-width: 0;
  font-size: 0.625rem;
  color: var(--rr-text-6);
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 滑块：用 --pct 画已播放部分，不需要额外的画布或元素 */
.radar-slider {
  width: 100%;
  height: 4px;
  margin: 0;
  appearance: none;
  -webkit-appearance: none;
  border-radius: 999px;
  cursor: pointer;
  background: linear-gradient(
    to right,
    var(--rr-accent-bright) 0%,
    var(--rr-accent-bright) var(--pct, 0%),
    rgba(255, 255, 255, 0.14) var(--pct, 0%),
    rgba(255, 255, 255, 0.14) 100%
  );
}

.radar-slider:disabled {
  cursor: default;
  opacity: 0.45;
}

.radar-slider::-webkit-slider-thumb {
  appearance: none;
  -webkit-appearance: none;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid var(--rr-accent);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
  cursor: pointer;
}

.radar-slider::-moz-range-thumb {
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid var(--rr-accent);
  cursor: pointer;
}

.radar-close {
  flex: 0 0 auto;
  padding: 8px 16px;
  font-size: 0.75rem;
  color: var(--rr-text-2);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--rr-stroke);
  border-radius: 999px;
  cursor: pointer;
  transition:
    background 0.16s ease,
    color 0.16s ease;
}

.radar-close:hover {
  background: rgba(255, 255, 255, 0.12);
  color: var(--rr-text-0);
}

.radar-row-sub {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
  padding-top: 9px;
  border-top: 1px solid rgba(255, 255, 255, 0.07);
}

.radar-group {
  display: flex;
  align-items: center;
  gap: 7px;
}

.radar-group-label {
  font-size: 0.625rem;
  color: var(--rr-text-6);
  white-space: nowrap;
}

.radar-seg {
  display: flex;
  gap: 2px;
  padding: 2px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 999px;
}

.radar-seg-btn {
  padding: 4px 11px;
  font-size: 0.6875rem;
  font-weight: 500;
  color: var(--rr-text-6);
  background: transparent;
  border: none;
  border-radius: 999px;
  cursor: pointer;
  white-space: nowrap;
  transition:
    background 0.14s ease,
    color 0.14s ease;
}

/* 用 :not(:disabled) 而不是靠层叠顺序压掉 hover —— 否则「仅原图」那个
   disabled 按钮鼠标一过还是会变亮，看起来像能点。 */
.radar-seg-btn:not(:disabled):hover {
  color: var(--rr-text-2);
}

.radar-seg-btn.on {
  color: #fff;
  background: rgba(109, 179, 242, 0.26);
}

/* 分区图的「仅原图」占位按钮：保持选中态配色但整体压暗，
   明确传达「这一档没得选」，而不是让用户去点一个点不动的按钮。 */
.radar-seg-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

/* ============================================================
   窄屏
   ============================================================ */

@media (max-width: 640px) {
  .radar-stage {
    padding: 60px 10px calc(var(--rr-ctrl-top) + 8px);
  }

  .radar-img {
    top: 60px;
    left: 10px;
    width: calc(100% - 20px);
    height: calc(100% - 60px - var(--rr-ctrl-top) - 8px);
  }

  .radar-top {
    padding: 10px 10px 26px;
  }

  .radar-controls {
    width: calc(100% - 16px);
    padding: 10px 11px;
    gap: 8px;
    bottom: calc(var(--rr-credit-h) + 8px);
  }

  .radar-credit {
    font-size: 0.5rem;
    bottom: 2px;
  }

  .radar-clock {
    font-size: 0.9375rem;
  }

  .radar-meta {
    display: none;
  }

  .radar-play {
    width: 34px;
    height: 34px;
  }

  .radar-close {
    padding: 7px 12px;
  }

  .radar-seg-btn {
    padding: 4px 9px;
    font-size: 0.625rem;
  }

  .radar-note {
    top: 64px;
    font-size: 0.625rem;
  }
}
</style>
