<script setup>
import { computed, ref } from 'vue'

import { getWeatherIcon } from '@/utils/weatherCodes'
import DailyChart from '@/components/DailyChart.vue'

const props = defineProps({
  daily: { type: Object, default: null },
})

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

// 视图：list（逐日列表）| chart（温度曲线）
const view = ref('list')

// 滑动方向跟着切换方向走：去「曲线」时新视图从右边推进，回「列表」时从左边推回
const dir = ref('next')

function setView(next) {
  if (next === view.value) return
  dir.value = next === 'chart' ? 'next' : 'prev'
  view.value = next
}

const items = computed(() => {
  const d = props.daily
  if (!d?.time?.length) return []

  // 接口按 timezone=auto 返回城市本地日期，d.time[0] 定义上就是该城市的「今天」。
  // 不能用 new Date().toISOString()：那是 UTC 日期，东八区凌晨 0–8 点会差一天
  const todayStr = d.time[0]
  const allHighs = d.temperature_2m_max
  const allLows = d.temperature_2m_min
  const globalMin = Math.min(...allLows)
  const globalMax = Math.max(...allHighs)
  const range = globalMax - globalMin || 1

  return d.time.map((dateStr, i) => {
    const date = new Date(dateStr + 'T00:00:00')
    const isToday = dateStr === todayStr
    const high = Math.round(allHighs[i])
    const low = Math.round(allLows[i])
    const barLeft = ((low - globalMin) / range) * 100
    const barWidth = ((high - low) / range) * 100

    return {
      key: dateStr,
      code: d.weather_code[i],
      name: isToday ? '今天' : WEEKDAYS[date.getDay()],
      dateLabel: `${date.getMonth() + 1}/${date.getDate()}`,
      isToday,
      icon: getWeatherIcon(d.weather_code[i], true),
      precip: d.precipitation_probability_max[i] || 0,
      high,
      low,
      barLeft,
      barWidth: Math.max(barWidth, 4),
    }
  })
})
</script>

<template>
  <div class="daily-section">
    <div class="section-head">
      <div class="section-title">未来 16 天</div>
      <div class="view-switch" role="tablist">
        <button
          type="button"
          role="tab"
          class="view-btn"
          :class="{ active: view === 'list' }"
          :aria-selected="view === 'list'"
          @click="setView('list')"
        >
          列表
        </button>
        <button
          type="button"
          role="tab"
          class="view-btn"
          :class="{ active: view === 'chart' }"
          :aria-selected="view === 'chart'"
          @click="setView('chart')"
        >
          曲线
        </button>
      </div>
    </div>

    <!-- 两个视图叠在同一个固定高的框里，按方向左右滑动切换 -->
    <div class="daily-views">
      <Transition :name="`view-${dir}`">
        <div v-if="view === 'list'" key="list" class="daily-view">
          <div class="daily-list">
            <div v-for="item in items" :key="item.key" class="daily-item">
              <span class="day-name" :class="{ today: item.isToday }">{{ item.name }}</span>
              <span class="day-icon">{{ item.icon }}</span>
              <span class="day-precip">{{ item.precip > 0 ? item.precip + '%' : '' }}</span>
              <div class="day-temps">
                <span class="low">{{ item.low }}°</span>
                <div class="temp-bar-wrap">
                  <div
                    class="temp-bar-fill"
                    :style="{ left: item.barLeft + '%', width: item.barWidth + '%' }"
                  ></div>
                </div>
                <span class="high">{{ item.high }}°</span>
              </div>
            </div>
          </div>
        </div>

        <DailyChart v-else key="chart" class="daily-view daily-view-chart" :items="items" />
      </Transition>
    </div>
  </div>
</template>
