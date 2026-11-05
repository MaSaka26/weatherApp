<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const now = ref(new Date())
let timer = null

const pad = (n) => String(n).padStart(2, '0')

const hoursMinutes = computed(() => `${pad(now.value.getHours())}:${pad(now.value.getMinutes())}`)
const seconds = computed(() => pad(now.value.getSeconds()))

const dateLabel = computed(() => {
  const d = now.value
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
})

// 用 UTC 差值算，避开夏令时 / 时区偏移带来的 ±1 天误差
const dayOfYear = computed(() => {
  const d = now.value
  const startOfYear = Date.UTC(d.getFullYear(), 0, 1)
  const today = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
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
  <div class="clock-panel">
    <div class="clock-time">
      <span class="clock-hm">{{ hoursMinutes }}</span>
      <span class="clock-sec">:{{ seconds }}</span>
    </div>
    <div class="clock-date">{{ dateLabel }}</div>
    <div class="clock-doy">今年第 <span class="clock-doy-num">{{ dayOfYear }}</span> 天</div>
  </div>
</template>
