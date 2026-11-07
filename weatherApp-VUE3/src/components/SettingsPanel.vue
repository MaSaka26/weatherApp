<script setup>
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'

import { DEFAULTS, SETTING_OPTIONS, resetSettings, setSetting, settings } from '@/composables/useSettings'

const props = defineProps({
  open: { type: Boolean, default: false },
})
const emit = defineEmits(['close'])

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
        hint: '9 张会多出空气质量、能见度、降水量；桌面排成 5+4，手机三列三行',
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

function onKeydown(event) {
  if (event.key === 'Escape' && props.open) close()
}

// 面板打开时锁住背后的页面滚动，否则 iOS 上手指一滑背景跟着动
watch(
  () => props.open,
  (open) => {
    document.body.style.overflow = open ? 'hidden' : ''
  },
)

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
})
</script>

<template>
  <div class="settings-layer" :class="{ open }" :aria-hidden="!open">
    <div class="settings-mask" @click="close"></div>

    <section class="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
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
      </div>

      <footer class="settings-foot">
        <button class="settings-reset" :disabled="isDefault" @click="resetSettings">恢复默认</button>
        <span class="settings-note">改动即时生效，自动保存在本机</span>
      </footer>
    </section>
  </div>
</template>
