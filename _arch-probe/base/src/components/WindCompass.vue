<script setup>
import { computed } from 'vue'

const props = defineProps({
  // 风向角（气象惯例：0 = 正北，90 = 正东，即「风从哪个方位吹来」）
  direction: { type: Number, default: 0 },
  label: { type: String, default: '' },
})

const DIRS = [
  { text: '北', deg: 0 },
  { text: '东', deg: 90 },
  { text: '南', deg: 180 },
  { text: '西', deg: 270 },
]

// 中心圆 6：只做针的轴心（白色针从它上面穿过去，圆是「轴」不是「球」），
// 10 的圆和针同色会把针吞掉，看起来像只有一个大圆点。
// 中心圆 6、针头/尾点 30/24、方位字 37、刻度 43〜50 三个半径错开，谁都不压谁
const HUB = 6
const DIR_R = 37

const dirs = DIRS.map((d) => {
  const rad = ((d.deg - 90) * Math.PI) / 180
  return { text: d.text, x: 50 + DIR_R * Math.cos(rad), y: 50 + DIR_R * Math.sin(rad) }
})

// 刻度每 10° 一根，正方位（去画汉字）跳过；每 30° 的长一点，读起来有节奏
const ticks = computed(() => {
  const out = []
  for (let a = 0; a < 360; a += 10) {
    if (a % 90 === 0) continue
    const inner = a % 30 === 0 ? 43 : 46
    const rad = ((a - 90) * Math.PI) / 180
    out.push({
      deg: a,
      x1: 50 + inner * Math.cos(rad),
      y1: 50 + inner * Math.sin(rad),
      x2: 50 + 50 * Math.cos(rad),
      y2: 50 + 50 * Math.sin(rad),
    })
  }
  return out
})

// 指针照参考图做成「一整根穿过圆心」：箭头指向风吹去的方向（风向 + 180），
// 尾端的小圆点落在来风那侧（所以「南风」时箭头朝北、圆点在 5 点钟方向）
const needleAngle = computed(() => ((Number(props.direction) || 0) + 180) % 360)
</script>

<template>
  <div class="dial wind-compass" role="img" :aria-label="label" :title="label">
    <svg class="d-svg" viewBox="0 0 100 100" aria-hidden="true">
      <line
        v-for="t in ticks"
        :key="t.deg"
        class="wc-tick"
        :x1="t.x1"
        :y1="t.y1"
        :x2="t.x2"
        :y2="t.y2"
      />
      <text v-for="d in dirs" :key="d.text" class="wc-dir" :x="d.x" :y="d.y">{{ d.text }}</text>
      <!-- 指针整组绕圆心旋转：0° 时箭头朝正北。白针穿过小轴心，一眼能看出是根指针。
           箭头尖 r=30、尾点 r=24，都收在方位字（半径 37，字号 11 → 内侧约 31.5）以内，
           针不会顶到「北 / 南」这些字上 -->
      <g :transform="`rotate(${needleAngle} 50 50)`">
        <line class="wc-needle" x1="50" y1="26" x2="50" y2="74" />
        <path class="wc-head" d="M50 20 55.2 30.6H44.8Z" />
        <circle class="wc-tail" cx="50" cy="74" r="3.2" />
      </g>
      <!-- 轴心画在针上面：小圆压住针杆中点，读起来像罗盘指针的轴 -->
      <circle class="wc-hub" cx="50" cy="50" :r="HUB" />
    </svg>
  </div>
</template>
