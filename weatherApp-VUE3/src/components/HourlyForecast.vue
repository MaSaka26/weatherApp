<script setup>
import { computed, nextTick, ref, watch } from 'vue'

import { getWeatherIcon } from '@/utils/weatherCodes'
import { useWheelScroll } from '@/composables/useWheelScroll'

const props = defineProps({
  hourly: { type: Object, default: null },
  // current.time 是城市当地时间（timezone=auto），用来定「现在」是哪一格
  current: { type: Object, default: null },
})

const scrollEl = ref(null)

// 兜底：接口没给 is_day 时，按该格自己的钟点粗判白天（6:00–18:59）
const isDayByClock = (iso) => {
  const h = Number(iso.slice(11, 13))
  return h >= 6 && h < 19
}

// 桌面端：滚轮纵向滚动时横向翻看逐小时预报
useWheelScroll(scrollEl)

const items = computed(() => {
  const h = props.hourly
  if (!h?.time?.length) return []

  const timeArr = h.time
  const tempArr = h.temperature_2m
  const codeArr = h.weather_code
  const dayArr = h.is_day

  // 统一成 "YYYY-MM-DDTHH:MM"（接口两种写法都见过），只按到「小时」比较：
  // 逐小时数组是整点（14:00），而 current.time 可能带 15 分钟刻度（14:15），
  // 精确到分钟会一格都对不上，反而把「现在」弄丢
  const at = (i) => timeArr[i].replace(' ', 'T')
  const hourKey = (iso) => iso.slice(0, 13)
  const nowIso = (props.current?.time || '').replace(' ', 'T')
  const nowHour = nowIso ? hourKey(nowIso) : ''

  // 起点 = 当前小时（或之后最近的整点）。
  // 优先用城市当地的 current.time；接口没给时才退回浏览器时钟
  const browserHour = new Date().getHours()
  const isNowAt = (i) =>
    nowHour ? hourKey(at(i)) === nowHour : Number(at(i).slice(11, 13)) === browserHour
  const reachedNow = (i) =>
    nowHour ? hourKey(at(i)) >= nowHour : Number(at(i).slice(11, 13)) >= browserHour

  let startIdx = 0
  for (let i = 0; i < timeArr.length; i++) {
    if (reachedNow(i)) {
      startIdx = i
      break
    }
  }

  const list = []
  for (let i = startIdx; i < Math.min(startIdx + 24, timeArr.length); i++) {
    const isNow = isNowAt(i)
    // 昼夜用接口按太阳高度算的 is_day；缺失时才退回 6:00–18:59 的粗判
    const isHourDay = dayArr?.[i] != null ? dayArr[i] === 1 : isDayByClock(at(i))
    list.push({
      key: timeArr[i],
      label: isNow ? '现在' : at(i).slice(11, 16),
      icon: getWeatherIcon(codeArr[i], isHourDay),
      temp: Math.round(tempArr[i]),
      isNow,
    })
  }
  return list
})

// 渲染后自动把“现在”滚动到可视区中间
watch(
  items,
  async () => {
    await nextTick()
    const nowEl = scrollEl.value?.querySelector('.now')
    if (nowEl) {
      nowEl.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
    }
  },
  { immediate: true },
)
</script>

<template>
  <div class="hourly-section">
    <div class="section-title">逐小时预报</div>
    <div ref="scrollEl" class="hourly-scroll">
      <div v-for="item in items" :key="item.key" class="hourly-item" :class="{ now: item.isNow }">
        <span class="hour-time">{{ item.label }}</span>
        <span class="hour-icon">{{ item.icon }}</span>
        <span class="hour-temp">{{ item.temp }}°</span>
      </div>
    </div>
  </div>
</template>
