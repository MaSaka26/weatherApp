<script setup>
import { computed } from 'vue'

import { getConditionText } from '@/utils/weatherCodes'

import AnimatedNumber from '@/components/AnimatedNumber.vue'
import ClockPanel from '@/components/ClockPanel.vue'

const props = defineProps({
  cityName: { type: String, default: '' },
  cityDetail: { type: String, default: '' },
  current: { type: Object, required: true },
  todayHigh: { type: Number, default: null },
  todayLow: { type: Number, default: null },
  dataReady: { type: Boolean, default: false },
  timezone: { type: String, default: '' },
})

const readyNumber = (value) =>
  props.dataReady && Number.isFinite(value) ? value : null
const temperature = computed(() => readyNumber(props.current?.temperature_2m))
const high = computed(() => readyNumber(props.todayHigh))
const low = computed(() => readyNumber(props.todayLow))
const condition = computed(() =>
  props.dataReady ? getConditionText(props.current.weather_code) : '天气加载中',
)
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
        <div class="current-temp" :class="{ placeholder: temperature == null }">
          <AnimatedNumber :value="temperature" />
          <span v-if="temperature != null" class="deg-symbol">°</span>
        </div>
        <div class="current-condition">{{ condition }}</div>
        <div class="current-highlow">
          <span class="high">最高 <AnimatedNumber :value="high" /><template v-if="high != null">°</template></span>
          <span>|</span>
          <span class="low">最低 <AnimatedNumber :value="low" /><template v-if="low != null">°</template></span>
        </div>
      </div>

      <ClockPanel :timezone="timezone" />
    </div>
  </div>
</template>
