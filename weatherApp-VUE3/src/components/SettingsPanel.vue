<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { DEFAULTS, SETTING_OPTIONS, resetSettings, setSetting, settings } from '@/composables/useSettings'
import { useAppUpdate } from '@/composables/useAppUpdate'
import { lockBodyScroll, unlockBodyScroll } from '@/utils/scrollLock'
import GitHubStarButton from '@/components/GitHubStarButton.vue'

const {
  appVersion,
  status: updateStatus,
  remoteLabel,
  errorMessage: updateError,
  isChecking: updateChecking,
  isDev: updateIsDev,
  lastSourceLabel,
  checkManually: checkUpdate,
} = useAppUpdate()

const updateText = computed(() => {
  if (updateIsDev) return '开发环境不检查线上版本'
  if (updateStatus.value === 'checking') return '正在检查…'
  if (updateStatus.value === 'available') return `发现新版本 ${remoteLabel.value}`
  if (updateStatus.value === 'updating') return '正在更新…'
  if (updateStatus.value === 'error') return updateError.value
  if (updateStatus.value === 'up-to-date') {
    // 交代「从哪查到的」：站点自身的 deploy.json 有 10 分钟 CDN 缓存，
    // 命中 GitHub 源说明已经绕开缓存，看到的是真实最新版本
    return lastSourceLabel.value ? `已是最新版本（${lastSourceLabel.value}）` : '已是最新版本'
  }
  return ''
})

const props = defineProps({
  open: { type: Boolean, default: false },
  // 设置按钮中心（视口坐标）。用来把面板的「展开起点/收回终点」对齐到按钮。
  origin: { type: Object, default: null },
})
const emit = defineEmits(['close'])
const panel = ref(null)
let previousFocus = null
// 打开/收回的 WAAPI 动画句柄，快速连点时用来取消上一次动画，避免状态错乱。
let panelAnim = null

/* 面板结构用数据描述：以后加设置项只改这里，模板不用动 */
const groups = [
  {
    title: '外观',
    items: [
      {
        key: 'glass',
        label: '毛玻璃',
        hint: '关掉更接近实心卡，调高更通透',
      },
      {
        key: 'radius',
        label: '圆角',
        hint: '卡片与按钮的圆角大小',
      },
      {
        key: 'cardLayout',
        label: '卡片布局',
        hint: '卡片内文字与图形的排列，手机、平板、桌面都跟随此设置',
      },
      {
        key: 'cardCount',
        label: '卡片数量',
        hint: '和首页「天气详情」右边那颗切换钮是同一个值，改哪边都会一起变',
      },
    ],
  },
]

const isDefault = computed(() =>
  Object.entries(DEFAULTS).every(([key, value]) => settings[key] === value),
)

function close() {
  emit('close')
}

/**
 * 计算「从设置按钮展开 / 收回设置按钮」的起止变换。
 *
 * 几何：面板最终态左上角 = layer 的 left/top + panel 的 offsetLeft/Top。
 * offset* 不受 transform 影响，动画中重算也稳定；layer 是 fixed inset:0，
 * 其 rect 即视口坐标，加 offset 直接得到面板最终态的视口位置。
 * 设缩放 s，令缩小后面板中心落在按钮中心 (ox, oy)：
 *   dx = ox - finalLeft - s*W/2 ; dy = oy - finalTop - s*H/2
 * 用 transform-origin: 0 0（CSS [data-origin]），translate 先平移再 scale 正好满足。
 *
 * 不依赖 class 切换造帧：WAAPI 的 element.animate 把起点写进第一个 keyframe，
 * 浏览器保证从起点过渡，headless 的 rAF 节流也吞不掉它。
 */
const ORIGIN_SCALE = 0.12
const PANEL_MS = 320
const PANEL_EASE = 'cubic-bezier(0.22, 0.68, 0, 1)'
function originFrames() {
  const el = panel.value
  const layer = el?.closest('.settings-layer')
  const o = props.origin
  if (!el || !layer || !o || typeof window === 'undefined') return null
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return null
  const layerRect = layer.getBoundingClientRect()
  const finalLeft = layerRect.left + el.offsetLeft
  const finalTop = layerRect.top + el.offsetTop
  const w = el.offsetWidth
  const h = el.offsetHeight
  const sc = ORIGIN_SCALE
  const dx = o.x - finalLeft - (sc * w) / 2
  const dy = o.y - finalTop - (sc * h) / 2
  // 起点：缩到按钮中心且透明；终点：identity 且不透明
  return [
    { transform: `translate(${dx}px, ${dy}px) scale(${sc})`, opacity: 0 },
    { transform: 'translate(0px, 0px) scale(1)', opacity: 1 },
  ]
}
function getFocusableElements() {
  return [...(panel.value?.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  ) ?? [])].filter((element) => element.getClientRects().length > 0)
}

function onKeydown(event) {
  if (!props.open) return
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }
  if (event.key !== 'Tab') return

  const focusable = getFocusableElements()
  if (!focusable.length) {
    event.preventDefault()
    panel.value?.focus()
    return
  }

  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && (document.activeElement === first || !panel.value?.contains(document.activeElement))) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (document.activeElement === last || !panel.value?.contains(document.activeElement))) {
    event.preventDefault()
    first.focus()
  }
}

// 面板打开时锁住背后的页面滚动；同时用 WAAPI 编排从按钮展开 / 收回按钮。
watch(
  () => props.open,
  async (open) => {
    if (typeof document === 'undefined') return
    // 快速连点：取消上一次动画，避免两条动画叠加导致面板卡在半路
    panelAnim?.cancel()
    panelAnim = null
    if (open) {
      previousFocus = document.activeElement
      lockBodyScroll()
      await nextTick()
      // 此刻 layer 已 .open（可见、模糊即时），面板 DOM 已就位。
      // 先设 transform-origin 与起点占位，再让 WAAPI 从起点过渡到终点。
      const el = panel.value
      const frames = originFrames()
      if (el && frames) {
        el.setAttribute('data-origin', '')
        el.style.opacity = '0'
        el.style.transform = frames[0].transform
        panelAnim = el.animate(frames, { duration: PANEL_MS, easing: PANEL_EASE, fill: 'both' })
        // 动画结束后清掉 inline 占位，让 CSS 的 .is-open 规则接管（identity）
        panelAnim.finished.then(() => {
          if (!props.open) return
          el.style.removeProperty('transform')
          el.style.removeProperty('opacity')
          el.classList.add('is-open')
        }).catch(() => {})
      } else {
        // 无坐标 / reduced-motion：直接显示，不做位移动画
        el?.classList.add('is-open')
      }
      ;(getFocusableElements()[0] ?? panel.value)?.focus()
    } else {
      const el = panel.value
      el?.classList.remove('is-open')
      const frames = originFrames()
      if (el && frames) {
        // 收回：从 identity 到按钮位置（反转帧）。layer 的 .open 已由父级移除，
        // 但 visibility 有 0.32s 离散过渡，收回期间仍可见，动画看得见。
        el.setAttribute('data-origin', '')
        panelAnim = el.animate([frames[1], frames[0]], { duration: PANEL_MS, easing: PANEL_EASE, fill: 'both' })
        panelAnim.finished.then(() => {
          if (props.open) return
          el.style.removeProperty('transform')
          el.style.removeProperty('opacity')
          el.removeAttribute('data-origin')
        }).catch(() => {})
      }
      unlockBodyScroll()
      if (previousFocus?.isConnected) previousFocus.focus()
      previousFocus = null
    }
  },
)

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  panelAnim?.cancel()
  unlockBodyScroll()
  if (previousFocus?.isConnected) previousFocus.focus()
})
</script>

<template>
  <div class="settings-layer" :class="{ open }" :aria-hidden="!open">
    <div class="settings-mask" @click="close"></div>

    <section ref="panel" class="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title" tabindex="-1">
      <header class="settings-head">
        <h2 id="settings-title" class="settings-title">设置</h2>
        <button class="settings-close" aria-label="关闭" @click="close">✕</button>
      </header>

      <div class="settings-body">
        <div v-for="group in groups" :key="group.title" class="settings-group">
          <div class="settings-group-title">{{ group.title }}</div>

          <div v-for="item in group.items" :key="item.key" class="set-row">
            <div class="set-text">
              <div class="set-label">{{ item.label }}</div>
              <div class="set-hint">{{ item.hint }}</div>
            </div>

            <div class="seg-ctrl">
              <button
                v-for="opt in SETTING_OPTIONS[item.key]"
                :key="opt.label"
                :class="{ on: settings[item.key] === opt.value }"
                @click="setSetting(item.key, opt.value)"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>
        </div>

        <div class="settings-group">
          <div class="settings-group-title">关于</div>
          <div class="set-row">
            <div class="set-text">
              <div class="set-label">应用版本</div>
              <div class="set-hint">当前 {{ appVersion }}</div>
            </div>
            <button
              class="settings-check-update"
              type="button"
              :disabled="updateChecking || updateIsDev"
              @click="checkUpdate(true)"
            >
              {{ updateIsDev ? '开发环境' : updateChecking ? '检查中…' : '检查更新' }}
            </button>
          </div>
          <div v-if="updateText" class="settings-update-state" role="status" aria-live="polite">
            {{ updateText }}
          </div>
          <div class="set-row">
            <div class="set-text">
              <div class="set-label">GitHub 仓库</div>
              <div class="set-hint">点个星吧，你的支持是动力</div>
            </div>
            <GitHubStarButton />
          </div>
        </div>
      </div>

      <footer class="settings-foot">
        <button class="settings-reset" :disabled="isDefault" @click="resetSettings">恢复默认</button>
        <span class="settings-note">改动即时生效，自动保存在本机</span>
      </footer>
    </section>
  </div>
</template>
