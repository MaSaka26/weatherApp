<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { getZonedParts } from '@/utils/timezone'

const props = defineProps({
  // Open-Meteo 的时区名，例如 Asia/Shanghai。空值表示设备本地时区。
  timezone: { type: String, default: '' },
})

const now = ref(new Date())
let timer = null

const pad = (n) => String(n).padStart(2, '0')

const zoned = computed(() => getZonedParts(now.value, props.timezone))
const hoursMinutes = computed(() => `${pad(zoned.value.hour)}:${pad(zoned.value.minute)}`)
const seconds = computed(() => pad(zoned.value.second))

const dateLabel = computed(() => {
  const d = zoned.value
  return `${d.year}年${d.month}月${d.day}日`
})

// 用 UTC 差值算，避开夏令时 / 时区偏移带来的 ±1 天误差
const dayOfYear = computed(() => {
  const d = zoned.value
  const startOfYear = Date.UTC(d.year, 0, 1)
  const today = Date.UTC(d.year, d.month - 1, d.day)
  return Math.round((today - startOfYear) / 86400000) + 1
})

function tick() {
  now.value = new Date()
}

// 对齐到下一个整秒再起 1s 心跳，秒数不会滞后半拍
function start() {
  stop()
  tick()
  timer = setTimeout(() => {
    tick()
    timer = setInterval(tick, 1000)
  }, 1000 - (Date.now() % 1000))
}

function stop() {
  clearTimeout(timer)
  clearInterval(timer)
  timer = null
}

// 标签页在后台时定时器会被浏览器降频，回到前台立刻补一次
function onVisibilityChange() {
  if (!document.hidden) start()
}

onMounted(() => {
  start()
  document.addEventListener('visibilitychange', onVisibilityChange)
})

onBeforeUnmount(() => {
  stop()
  document.removeEventListener('visibilitychange', onVisibilityChange)
})
</script>

<template>
  <div class="clock-panel" :title="timezone ? `${timezone} 当地时间` : '设备本地时间'">
    <div class="clock-time">
      <span class="clock-hm">{{ hoursMinutes }}</span>
      <span class="clock-sec">:{{ seconds }}</span>
    </div>
    <div class="clock-date">{{ dateLabel }}</div>
    <div class="clock-doy">今年第 <span class="clock-doy-num">{{ dayOfYear }}</span> 天</div>
  </div>
</template>
