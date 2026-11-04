<script setup>
import { computed, useId } from 'vue'

import { buildRainOutlook } from '@/utils/rainOutlook'

// 降水预报入口条：夹在「逐小时预报」与「16 天预报」之间。
// 只负责「一句话概览 + 一个可点的雷达小图」，真正的雷达/时间轴预览由父组件挂载，
// 所以这里不持有任何开关状态，点击只往上抛 open。
const props = defineProps({
  current: { type: Object, default: null },
  hourly: { type: Object, default: null },
})

const emit = defineEmits(['open'])

// 兜底文案：buildRainOutlook 的返回值给了 ok/text 契约，但数据还没到时不该渲染出空条；
// 先给一句中性描述，拿到结果再覆盖，避免卡片高度跳动
const emptyOutlook = {
  ok: false,
  active: false,
  hours: 0,
  withinHours: 0,
  endsInHours: 0,
  text: '正在读取降水趋势',
  sub: '',
  intensities: [],
  wetFrom: null,
  peakLevel: 0,
}

const outlook = computed(() => {
  try {
    const next = buildRainOutlook({ current: props.current, hourly: props.hourly })
    // 摊平在兜底对象上，缺字段时仍能渲染（不会出现 undefined 文案）
    return { ...emptyOutlook, ...next }
  } catch {
    // 契约方还在并行实现时宁可显示兜底句，也不要把整页炸掉
    return emptyOutlook
  }
})

// 强度档 0–3 → 三段雷达色（外层/中层/核心）。
// 用「同一团形状按比例缩小叠三层」而不是单层径向渐变：
// 渐变在 path 的 bbox 里算，斑块一扁就提前淡出，看上去像灰圈里点了颗小圆；
// 三层同形状则永远跟着斑块的轮廓走，才是雷达图上那种不规则的等值线感。
const PALETTES = {
  0: ['#8fb6d0', '#8fb6d0', '#8fb6d0'],
  1: ['#2c6fa8', '#3fa9d8', '#6fdcc8'],
  2: ['#35a86b', '#c9cf4e', '#f0a83c'],
  3: ['#d99a30', '#ee6a34', '#e23b4e'],
}

// 0 档没有雨的实感，只留描边轮廓（见模板里的 v-if/v-else）
const hasRain = computed(() => outlook.value.peakLevel > 0)
const colors = computed(() => PALETTES[outlook.value.peakLevel] || PALETTES[0])

// 两团回波的几何中心与半径，取自下面两条 path 的实际包围盒。
// 抽成常量是因为「缩放到中心」的 transform 必须和路径本身严格对应，
// 散落在模板里改一处忘一处就会错位
const BLOB_A = { cx: 61.9, cy: 25.9, rx: 16.4, ry: 11.9 }
const BLOB_B = { cx: 22.8, cy: 50.2, rx: 14.2, ry: 9.4 }

// 路径写成常量，模板里三层等值线 + 无雨档轮廓共用同一份，
// 保证「换档只换色，形状一动不动」
const BLOB_A_PATH =
  'M48.5 20.4c3.6-4.8 9.4-6.6 14.2-5.2 4.6 1.3 7.2 4.6 8 8.2 4.2.6 6.9 3.2 7.1 6.4.2 3.4-2.6 6.1-6.8 6.9-4.4.8-9.2.5-13.6-.9-5-1.6-8.8-4.3-10.4-7.4-1.6-3.3-1-6.1 1.5-8z'
const BLOB_B_PATH =
  'M12.6 46.2c2.8-3.4 6.9-5.2 10.9-4.6 3.6.6 6.2 2.9 7 5.8 3.4.2 5.6 2.3 5.7 4.8.1 2.8-2.4 5.1-5.9 6-3.6.9-7.6 1-11.4.3-4.4-.9-7.6-3.1-8.9-5.6-1.2-2.4-.6-4.7 2.6-6.7z'

// 同心缩放：scale 以斑块中心为原点（不是 0,0），否则内层会整体往左上跑。
// dx/dy 是档位带来的 1–2px 漂移，让不同强度的图有轻微呼吸感，不像同一张静态贴图
const blobTransform = (blob, scale, dx = 0, dy = 0) => {
  const x = blob.cx + (dx || 0)
  const y = blob.cy + (dy || 0)
  return `translate(${x} ${y}) scale(${scale}) translate(${-blob.cx} ${-blob.cy})`
}

// 内两层跟着强度档做 1px 级的漂移，避免三层完全同心显得像箭靶
const drift = computed(() => (outlook.value.peakLevel % 2 === 0 ? 1 : -1))

// 同一页面里这个组件可能出现多次（例如首页 + 详情），而 SVG 的 filter id 是全局的；
// 用 Vue 3.5 的 useId 保证每个实例拿到独立 id，滤镜不会互相串台
const uid = useId()
</script>

<template>
  <!-- 整块是一个 button：用原生 button 而不是 div[role=button]，
       回车/空格由浏览器天然触发 click，无障碍与键盘行为都不必自己实现 -->
  <button type="button" class="rain-item" @click="emit('open')">
    <span class="rain-text">
      <span class="rain-title">降水预报</span>
      <span class="rain-main">{{ outlook.text }}</span>
      <!-- 副文案（如「17:00 前后开始」）是补充信息，缺失时整行不渲染，避免留下空行撑高度 -->
      <span v-if="outlook.sub" class="rain-sub">{{ outlook.sub }}</span>
    </span>

    <span class="rain-art" aria-hidden="true">
      <!-- viewBox 定 96x72（4:3）：横向卡片右侧的图形区太方会显得笨重，
           4:3 既塞得下两团斑块，也给十字街道留出天际线般的留白 -->
      <svg viewBox="0 0 96 72" width="100%" height="100%" role="presentation" focusable="false">
        <defs>
          <!-- 边缘柔化：斑块用 0.6px 的高斯模糊收一下毛边，
               路径本身是折线（手绘感），不糊会露出尖锐的折角 -->
          <filter :id="`${uid}-soft`" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="0.6" />
          </filter>
          <!-- 外圈用更大的模糊半径，让最外层像雾一样洇开，而不是一圈硬描边 -->
          <filter :id="`${uid}-halo`" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="2.4" />
          </filter>
        </defs>

        <!-- 底衬：极淡圆角矩形让右侧图形区自成一块，视觉上与左侧文案区分离 -->
        <rect x="0.5" y="0.5" width="95" height="71" rx="14" fill="rgba(255,255,255,.04)" />

        <!-- 十字街道：横街带一点坡度、纵街略微偏右，线段端点故意不是整数，
             模仿手绘时刻意画歪的那一笔；两段都在图外延伸，读起来像「城市路网还在继续」 -->
        <g
          fill="none"
          stroke="rgba(255,255,255,.38)"
          stroke-width="3.2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <!-- 横街：y 从 34 缓到 31，中段压一点再抬，接近真实街道的透视起伏 -->
          <path
            d="M1.5 34.2C14 33.6 27 32.4 40 32.8c13 .4 24.5-.9 36-1.6 6.2-.4 12.4-.9 17.2-1.2"
          />
          <!-- 纵街：x 从 33 走到 30，收口处略外撇，和横街交于 (34,32) 附近，交角不是 90° -->
          <path d="M33 1.6c-.6 12.5-1.4 24.8-2.2 36.6-.7 10.8-1.5 21.6-2.6 32.2" />
        </g>
        <!-- 交叉口：两条路交叠处压一小片更亮的路面，读起来像路口而不是两根线打个叉。
             尺寸刻意小于街宽，颜色比街线更淡——放大后不能变成一块悬空的灰方块 -->
        <path
          d="M29.6 30.4c3.8-.4 7.3-.3 12.4.4.3 1.9.2 3.8-.4 5.7-4.2.5-8 .4-11.6-.4-.3-1.9-.4-3.8-.4-5.7z"
          fill="rgba(255,255,255,.055)"
        />

        <!-- 第一团（右上）：云状不规则闭合路径，右上角压平、左下角拖尾，
             用 q/c 贝塞尔制造「一团有边缘起伏的回波」，绝不用 <circle>。
             三层同形缩放叠出雷达等值线：外圈淡、中圈实、核心亮 -->
        <g v-if="hasRain">
          <!-- 外圈光晕：同形放大 1.12 倍再重模糊，补掉路径边缘的硬边，
               做成雷达图上那种「往外洇开」的衰减 -->
          <path
            :d="BLOB_A_PATH"
            :fill="colors[0]"
            fill-opacity="0.34"
            :transform="blobTransform(BLOB_A, 1.12, 0, 0)"
            :filter="`url(#${uid}-halo)`"
          />
          <path :d="BLOB_A_PATH" :fill="colors[0]" fill-opacity="0.52" :filter="`url(#${uid}-soft)`" />
          <path
            :d="BLOB_A_PATH"
            :fill="colors[1]"
            fill-opacity="0.72"
            :transform="blobTransform(BLOB_A, 0.64, 2, drift)"
            :filter="`url(#${uid}-soft)`"
          />
          <path
            :d="BLOB_A_PATH"
            :fill="colors[2]"
            fill-opacity="0.9"
            :transform="blobTransform(BLOB_A, 0.34, -1.5, -drift)"
            :filter="`url(#${uid}-soft)`"
          />
        </g>

        <!-- 第二团（左下）：比第一团小一圈、位置错开，与第一团不重叠，
             形状更「瘦长」以区分两个雨团不是同一块复制品 -->
        <g v-if="hasRain">
          <path
            :d="BLOB_B_PATH"
            :fill="colors[0]"
            fill-opacity="0.32"
            :transform="blobTransform(BLOB_B, 1.14, 0, 0)"
            :filter="`url(#${uid}-halo)`"
          />
          <path :d="BLOB_B_PATH" :fill="colors[0]" fill-opacity="0.5" :filter="`url(#${uid}-soft)`" />
          <path
            :d="BLOB_B_PATH"
            :fill="colors[1]"
            fill-opacity="0.7"
            :transform="blobTransform(BLOB_B, 0.62, -2, -drift)"
            :filter="`url(#${uid}-soft)`"
          />
          <path
            :d="BLOB_B_PATH"
            :fill="colors[2]"
            fill-opacity="0.88"
            :transform="blobTransform(BLOB_B, 0.32, 1.5, drift)"
            :filter="`url(#${uid}-soft)`"
          />
        </g>

        <!-- 无雨档：只留两条虚化的回波轮廓，暗示「这里本来会有雨斑，现在没有」 -->
        <g
          v-else
          fill="none"
          stroke="rgba(255,255,255,.16)"
          stroke-width="1.2"
          stroke-linecap="round"
        >
          <path :d="BLOB_A_PATH" />
          <path :d="BLOB_B_PATH" />
        </g>
      </svg>
    </span>

    <!-- 小箭头：把「整块可点」这件事说出来，hover 时右移半格作为点击预兆 -->
    <span class="rain-arrow" aria-hidden="true">
      <svg viewBox="0 0 16 16" width="16" height="16" focusable="false">
        <path
          d="M5.6 3.4 10.4 8 5.7 12.6"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </span>
  </button>
</template>

<style scoped>
/* 外层尺寸对齐 DetailCards / DailyForecast 的卡片语言：
   同样的浅白面 + 极细描边 + 同一档圆角，让它在两条列表之间像「同一张卡片族」的成员 */
.rain-item {
  box-sizing: border-box;
  width: 100%;
  min-height: 76px;
  padding: 12px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  appearance: none;
  -webkit-appearance: none;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
  background: var(--surface-2);
  border: 1px solid var(--line-0);
  border-radius: var(--radius-md);
  backdrop-filter: blur(var(--glass-card));
  -webkit-backdrop-filter: blur(var(--glass-card));
  transition:
    background 0.18s ease,
    transform 0.18s ease,
    border-color 0.18s ease;
}

.rain-item:hover {
  background: var(--surface-3);
  transform: translateY(-1px);
}

/* 按下时把位移收回，避免 hover 抬起的 1px 在点击瞬间造成「没按动」的错觉 */
.rain-item:active {
  transform: translateY(0);
}

.rain-item:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

/* 左侧文案：纵向三行，行距压紧，让「标题—主句—开始时间」读起来是一个整体 */
.rain-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1 1 auto;
}

.rain-title {
  font-size: 12px;
  line-height: 1.3;
  letter-spacing: 0.02em;
  color: var(--text-6);
}

/* 主句是这条卡片真正的信息，字号比标题大一档半，和 16 天预报的行高保持同节奏 */
.rain-main {
  font-size: 17px;
  line-height: 1.32;
  font-weight: 600;
  color: var(--text-1);
}

.rain-sub {
  font-size: 12px;
  line-height: 1.3;
  color: var(--text-5);
  /* 长城市名 + 长句子时不撑破卡片，超出一行才省略 */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 图形区固定宽高比 4:3，宽度落在 88–104 之间：
   窄于 88 时两团色块分不清是两块还是噪点，宽于 104 又会把左文案挤成两行 */
.rain-art {
  flex: 0 0 auto;
  width: 96px;
  aspect-ratio: 4 / 3;
  display: block;
}

.rain-art svg {
  display: block;
  overflow: visible;
}

.rain-arrow {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-7);
  transform: translateX(0);
  transition:
    transform 0.18s ease,
    color 0.18s ease;
}

.rain-item:hover .rain-arrow {
  color: var(--text-4);
  transform: translateX(2px);
}

/* 移动端：主句收一档（17 → 15px），图形收到 76px，
   仍保持左右布局——切上下排会把卡片顶到 130px 以上，反而挤掉逐小时的可视区 */
@media (max-width: 480px) {
  .rain-item {
    padding: 10px 12px;
    gap: 10px;
    min-height: 72px;
  }

  .rain-title {
    font-size: 11px;
  }

  .rain-main {
    font-size: 15px;
  }

  .rain-sub {
    font-size: 11px;
  }

  .rain-art {
    width: 76px;
  }

  .rain-arrow svg {
    width: 14px;
    height: 14px;
  }
}

/* 尊重系统「减少动态效果」：只保留颜色变化，去掉位移 */
@media (prefers-reduced-motion: reduce) {
  .rain-item,
  .rain-arrow {
    transition:
      background 0.18s ease,
      color 0.18s ease;
  }

  .rain-item:hover,
  .rain-item:active,
  .rain-item:hover .rain-arrow {
    transform: none;
  }
}
</style>
