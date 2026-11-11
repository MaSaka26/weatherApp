<script setup>
import { ref } from 'vue'

import SettingsPanel from '@/components/SettingsPanel.vue'

const open = ref(false)
const buttonEl = ref(null)
const origin = ref(null)

function openSettings() {
  // 测量按钮中心（视口坐标）。用 getBoundingClientRect 只取按钮自身，
  // 它不受面板 transform 影响，动画中重复打开也稳定。
  const rect = buttonEl.value?.getBoundingClientRect()
  origin.value = rect
    ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    : null
  open.value = true
}
</script>

<template>
  <button ref="buttonEl" class="settings-btn" title="设置" aria-label="打开设置" @click="openSettings">
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
        <path
          d="M9.59 3.94c.09-.54.56-.94 1.11-.94h2.6c.55 0 1.02.4 1.11.94l.21 1.28c.06.37.31.69.65.87q.11.06.22.13c.32.2.72.26 1.07.12l1.22-.45a1.13 1.13 0 0 1 1.37.49l1.3 2.25c.27.48.16 1.08-.26 1.43l-1 .82c-.3.24-.44.62-.44.99v.26c0 .38.14.75.43.99l1 .83c.43.35.54.95.27 1.43l-1.3 2.25a1.13 1.13 0 0 1-1.37.49l-1.22-.46c-.35-.13-.75-.07-1.07.13q-.11.07-.22.12c-.33.19-.58.5-.65.87l-.21 1.28c-.09.55-.56.95-1.11.95h-2.6c-.55 0-1.02-.4-1.11-.95l-.21-1.28c-.06-.37-.31-.68-.65-.87a6 6 0 0 1-.22-.12c-.32-.2-.72-.26-1.07-.13l-1.22.46a1.13 1.13 0 0 1-1.37-.49l-1.3-2.25a1.13 1.13 0 0 1 .27-1.43l1-.83c.29-.24.43-.61.43-.99v-.26c0-.37-.14-.75-.43-.99l-1-.82a1.13 1.13 0 0 1-.27-1.43l1.3-2.25a1.13 1.13 0 0 1 1.37-.49l1.21.45c.36.14.75.08 1.08-.12q.11-.07.22-.13c.33-.18.58-.5.64-.87z"
        />
        <circle cx="12" cy="12" r="3" />
      </g>
    </svg>
  </button>

  <SettingsPanel :open="open" :origin="origin" @close="open = false" />
</template>
