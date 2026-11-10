<script setup>
import { computed } from 'vue'

import { getConditionText } from '@/utils/weatherCodes'

import AnimatedNumber from '@/components/AnimatedNumber.vue'
import ClockPanel from '@/components/ClockPanel.vue'

const props = defineProps({
  cityName: { type: String, default: '' },
  cityDetail: { type: String, default: '' },
  current: { type: Object, required: true },
  todayHigh: { type: Number, default: 0 },
  todayLow: { type: Number, default: 0 },
})

const condition = computed(() => getConditionText(props.current.weather_code))
</script>

<template>
  <div class="current-weather">
    <div class="current-head">
      <div class="current-city" :class="{ placeholder: !cityName }">
        <template v-if="cityName">{{ cityName }}</template>
        <span v-else aria-hidden="true">—</span>
      </div>
      <div class="current-region" :class="{ placeholder: !cityDetail }">
        <template v-if="cityDetail">{{ cityDetail }}</template>
        <span v-else aria-hidden="true">——— · ———</span>
      </div>
    </div>

    <div class="current-body">
      <div class="current-main">
        <div class="current-temp"><AnimatedNumber :value="current?.temperature_2m" /><span class="deg-symbol">°</span></div>
        <div class="current-condition">{{ condition }}</div>
        <div class="current-highlow">
          <span class="high">最高 <AnimatedNumber :value="todayHigh" />°</span>
          <span>|</span>
          <span class="low">最低 <AnimatedNumber :value="todayLow" />°</span>
        </div>
      </div>

      <ClockPanel />
    </div>
  </div>
</template>
