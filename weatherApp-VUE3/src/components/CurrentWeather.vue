<script setup>
import { computed } from 'vue'

import { getConditionText } from '@/utils/weatherCodes'

import ClockPanel from '@/components/ClockPanel.vue'

const props = defineProps({
  cityName: { type: String, default: '' },
  cityDetail: { type: String, default: '' },
  current: { type: Object, required: true },
  todayHigh: { type: Number, default: 0 },
  todayLow: { type: Number, default: 0 },
})

const temp = computed(() => Math.round(props.current.temperature_2m))
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
