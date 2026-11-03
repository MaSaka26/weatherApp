<script setup>
import { ref } from 'vue'

import { useWeatherStore } from '@/stores/weather'

const store = useWeatherStore()
const refreshing = ref(false)

async function onClick() {
  if (refreshing.value) return
  refreshing.value = true
  const started = Date.now()
  try {
    await store.refresh()
  } finally {
    // 保持至少 600ms 的旋转反馈
    const elapsed = Date.now() - started
    setTimeout(
      () => {
        refreshing.value = false
      },
      Math.max(0, 600 - elapsed),
    )
  }
}
</script>

<template>
  <button class="refresh-btn" :class="{ refreshing }" title="刷新" @click="onClick">⟳</button>
</template>
