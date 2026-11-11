<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { DEFAULTS, SETTING_OPTIONS, resetSettings, setSetting, settings } from '@/composables/useSettings'
import { useAppUpdate } from '@/composables/useAppUpdate'

const {
  appVersion,
  status: updateStatus,
  remoteLabel,
  errorMessage: updateError,
  isChecking: updateChecking,
  isDev: updateIsDev,
  check: checkUpdate,
} = useAppUpdate()

const updateText = computed(() => {
  if (updateIsDev) return '开发环境不检查线上版本'
  if (updateStatus.value === 'checking') return '正在检查…'
  if (updateStatus.value === 'available') return `发现新版本 ${remoteLabel.value}`
  if (updateStatus.value === 'updating') return '正在更新…'
  if (updateStatus.value === 'error') return updateError.value
  if (updateStatus.value === 'up-to-date') return '已是最新版本'
  return ''
})

const props = defineProps({
  open: { type: Boolean, default: false },
})
const emit = defineEmits(['close'])
const panel = ref(null)
let previousFocus = null
let previousOverflow = ''

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

// 面板打开时锁住背后的页面滚动，否则 iOS 上手指一滑背景跟着动
watch(
  () => props.open,
  async (open) => {
    if (typeof document === 'undefined') return
    if (open) {
      previousFocus = document.activeElement
      previousOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      await nextTick()
      ;(getFocusableElements()[0] ?? panel.value)?.focus()
    } else {
      document.body.style.overflow = previousOverflow
      if (previousFocus?.isConnected) previousFocus.focus()
      previousFocus = null
    }
  },
)

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = previousOverflow
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
        </div>
      </div>

      <footer class="settings-foot">
        <button class="settings-reset" :disabled="isDefault" @click="resetSettings">恢复默认</button>
        <span class="settings-note">改动即时生效，自动保存在本机</span>
      </footer>
    </section>
  </div>
</template>
