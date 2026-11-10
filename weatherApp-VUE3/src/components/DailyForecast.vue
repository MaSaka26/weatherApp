<script setup>
import { computed, nextTick, ref } from 'vue'

import { getWeatherIcon } from '@/utils/weatherCodes'
import DailyChart from '@/components/DailyChart.vue'

const props = defineProps({
  daily: { type: Object, default: null },
  dataReady: { type: Boolean, default: false },
})

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

// 视图：list（逐日列表）| chart（温度曲线）
const view = ref('list')

// 滑动方向跟着切换方向走：去「曲线」时新视图从右边推进，回「列表」时从左边推回
const dir = ref('next')

function setView(next) {
  if (next === view.value) return
  if (next === 'chart' && !props.dataReady) return
  dir.value = next === 'chart' ? 'next' : 'prev'
  view.value = next
}

async function moveTab(event, direction) {
  const tabs = [...event.currentTarget.parentElement.querySelectorAll('[role="tab"]')]
  const index = tabs.indexOf(event.currentTarget)
  const next = tabs[(index + direction + tabs.length) % tabs.length]
  if (!next || next.disabled) return
  setView(next.dataset.view)
  await nextTick()
  next.focus()
}

const items = computed(() => {
  const d = props.daily
  if (!d?.time?.length) return []

  // 接口按 timezone=auto 返回城市本地日期，d.time[0] 定义上就是该城市的「今天」。
  // 不能用 new Date().toISOString()：那是 UTC 日期，东八区凌晨 0–8 点会差一天
  const todayStr = d.time[0]
  const allHighs = d.temperature_2m_max
  const allLows = d.temperature_2m_min
  const readyHighs = props.dataReady
    ? allHighs.filter((value) => Number.isFinite(value))
    : []
  const readyLows = props.dataReady
    ? allLows.filter((value) => Number.isFinite(value))
    : []
  const globalMin = readyLows.length ? Math.min(...readyLows) : 0
  const globalMax = readyHighs.length ? Math.max(...readyHighs) : 0
  const range = globalMax - globalMin || 1

  return d.time.map((dateStr, i) => {
    const date = new Date(dateStr + 'T00:00:00')
    const isToday = dateStr === todayStr
    const ready = props.dataReady && Number.isFinite(allHighs[i]) && Number.isFinite(allLows[i])
    const high = ready ? Math.round(allHighs[i]) : null
    const low = ready ? Math.round(allLows[i]) : null
    const barLeft = ready ? ((low - globalMin) / range) * 100 : 0
    const barWidth = ready ? ((high - low) / range) * 100 : 0

    return {
      key: dateStr,
      code: d.weather_code[i],
      name: isToday ? '今天' : WEEKDAYS[date.getDay()],
      dateLabel: `${date.getMonth() + 1}/${date.getDate()}`,
      isToday,
      ready,
      icon: ready ? getWeatherIcon(d.weather_code[i], true) : '—',
      precip: ready ? (d.precipitation_probability_max[i] ?? null) : null,
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
      <div class="view-switch" role="tablist" aria-label="16 天预报视图">
        <button
          id="daily-list-tab"
          type="button"
          role="tab"
          class="view-btn"
          data-view="list"
          :class="{ active: view === 'list' }"
          :aria-selected="view === 'list'"
          aria-controls="daily-view-panel"
          :tabindex="view === 'list' ? 0 : -1"
          @click="setView('list')"
          @keydown.left.prevent="moveTab($event, -1)"
          @keydown.right.prevent="moveTab($event, 1)"
        >
          列表
        </button>
        <button
          id="daily-chart-tab"
          type="button"
          role="tab"
          class="view-btn"
          data-view="chart"
          :class="{ active: view === 'chart' }"
          :aria-selected="view === 'chart'"
          aria-controls="daily-view-panel"
          :disabled="!dataReady"
          :tabindex="view === 'chart' ? 0 : -1"
          @click="setView('chart')"
          @keydown.left.prevent="moveTab($event, -1)"
          @keydown.right.prevent="moveTab($event, 1)"
        >
          曲线
        </button>
      </div>
    </div>

    <!-- 两个视图叠在同一个固定高的框里，按方向左右滑动切换 -->
    <div
      id="daily-view-panel"
      class="daily-views"
      role="tabpanel"
      :aria-labelledby="view === 'list' ? 'daily-list-tab' : 'daily-chart-tab'"
    >
      <Transition :name="`view-${dir}`">
        <div v-if="view === 'list'" key="list" class="daily-view">
          <div class="daily-list">
            <div v-for="item in items" :key="item.key" class="daily-item">
              <span class="day-name" :class="{ today: item.isToday }">{{ item.name }}</span>
              <span class="day-icon">{{ item.icon }}</span>
              <span class="day-precip">{{ item.precip > 0 ? item.precip + '%' : '' }}</span>
              <div class="day-temps">
                <span class="low">{{ item.low == null ? '—' : item.low + '°' }}</span>
                <div class="temp-bar-wrap">
                  <div
                    v-if="item.ready"
                    class="temp-bar-fill"
                    :style="{ left: item.barLeft + '%', width: item.barWidth + '%' }"
                  ></div>
                </div>
                <span class="high">{{ item.high == null ? '—' : item.high + '°' }}</span>
              </div>
            </div>
          </div>
        </div>

        <DailyChart v-else-if="dataReady" key="chart" class="daily-view daily-view-chart" :items="items" />
        <div v-else key="chart-placeholder" class="daily-view daily-view-chart forecast-placeholder">
          正在获取 16 天预报…
        </div>
      </Transition>
    </div>
  </div>
</template>
