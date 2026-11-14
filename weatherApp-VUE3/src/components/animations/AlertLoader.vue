<script setup>
/**
 * 加载动画的统一入口：每次挂载时从指定分组的动画库里随机挑一个渲染。
 * 组件本身不带布局，尺寸/边框由外部容器负责。
 *
 * group='alert'（默认）：城市预警等通用占位，音浪 / 交织双环
 * group='radar'：降水雷达 loading，雷达扫描 / 人脸识别扫描
 * scale：整体缩放（动画按 48px 设计，塞进小尺寸胶囊时传 0.7 之类）
 */
import { computed, shallowRef } from 'vue'

import { pickLoader, pickRadarLoader } from './index.js'

const props = defineProps({
  group: { type: String, default: 'alert' },
  scale: { type: Number, default: 1 },
})

// setup 阶段只跑一次：同一次 loading 过程中动画不会中途换掉
const Loader = shallowRef(
  props.group === 'radar' ? pickRadarLoader() : pickLoader()
)

// 缩放后仍占据正确的布局盒子，避免 transform 让父容器的排版尺寸失真
const boxStyle = computed(() => ({
  width: 48 * props.scale + 'px',
  height: 48 * props.scale + 'px',
}))
const innerStyle = computed(() => ({ transform: `scale(${props.scale})` }))
</script>

<template>
  <span class="loader-box" :style="boxStyle">
    <span class="loader-inner" :style="innerStyle">
      <component :is="Loader" />
    </span>
  </span>
</template>

<style scoped>
.loader-box {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
}
.loader-inner {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  transform-origin: center center;
}
</style>
