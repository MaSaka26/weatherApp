<script setup>
import { computed } from 'vue'

import { useWeatherStore } from '@/stores/weather'

const store = useWeatherStore()

// 旋转状态来自 store.isFetching，而不是组件自己的局部 flag：
// 首屏自动拉、6 分钟定时拉、手动点，三种来源都会让图标转起来。
// 组件只管「点一下」，不维护「我在转」这份状态，避免两处状态打架。
const refreshing = computed(() => store.isFetching)

function onClick() {
  if (refreshing.value) return
  // 只重拉数据；页面不会切到整页 loading，数字原地更新。
  // 传 quiet 让定时/后台刷新失败时不出提示，手动点则要看到失败原因
  store.refresh()
}
</script>

<template>
  <button
    class="refresh-btn"
    :class="{ refreshing }"
    :title="refreshing ? '正在更新…' : '刷新'"
    :aria-busy="refreshing"
    @click="onClick"
  >
    ⟳
  </button>
</template>
