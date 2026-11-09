<script setup>
import { computed, watch } from 'vue'

import { getConditionText } from '@/utils/weatherCodes'
import { useTween } from '@/composables/useTween'

import ClockPanel from '@/components/ClockPanel.vue'

const props = defineProps({
  cityName: { type: String, default: '' },
  cityDetail: { type: String, default: '' },
  current: { type: Object, required: true },
  todayHigh: { type: Number, default: 0 },
  todayLow: { type: Number, default: 0 },
})

// 大号温度走 useTween：数据注入时数字从占位的 0 扫到真值，而不是整页刷新后突然出现。
// 显示层额外 Math.round —— useTween 给的是小数，温度只要整数（21.4 显示 21）。
//
// 不做首值落位的特例：缓存命中时首个值已是真实的 19°，也从 0 扫过来。
// 和四颗表盘、日出日落同一套规则 —— 要么一起生长，要么一起瞬跳，不能有的扫有的跳。
const { shown, tween } = useTween(620)
watch(() => props.current?.temperature_2m, (v) => tween(v), { immediate: true })
const temp = computed(() => Math.round(shown.value))
const condition = computed(() => getConditionText(props.current.weather_code))
</script>

<template>
  <div class="current-weather">
    <div class="current-head">
      <div class="current-city">{{ cityName }}</div>
      <div v-if="cityDetail" class="current-region">{{ cityDetail }}</div>
    </div>

    <div class="current-body">
      <div class="current-main">
        <div class="current-temp">{{ temp }}<span class="deg-symbol">°</span></div>
        <div class="current-condition">{{ condition }}</div>
        <div class="current-highlow">
          <span class="high">最高 {{ Math.round(todayHigh) }}°</span>
          <span>|</span>
          <span class="low">最低 {{ Math.round(todayLow) }}°</span>
        </div>
      </div>

      <ClockPanel />
    </div>
  </div>
</template>
