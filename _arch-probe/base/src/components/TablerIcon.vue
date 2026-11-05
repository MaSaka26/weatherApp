<script setup>
/**
 * 内联渲染一个 Tabler outline 图标。
 * 不引入整包图标库（6257 个图标、解压几十 MB），只把用到的 path 数据放在
 * assets/icons.js 里，这里统一套上 24×24 viewBox 与 stroke=currentColor，
 * 于是图标颜色完全由 CSS 的 color 继承，换主题不用改任何 SVG。
 */
import { computed } from 'vue'

import { ICON_PATHS } from '@/assets/icons'

const props = defineProps({
  name: { type: String, required: true },
  size: { type: [Number, String], default: 18 },
})

const paths = computed(() => ICON_PATHS[props.name] ?? ICON_PATHS.help)
</script>

<template>
  <svg
    class="tabler-icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path v-for="(d, i) in paths" :key="i" :d="d" />
  </svg>
</template>
