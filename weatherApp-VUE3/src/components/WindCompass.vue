<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'

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
//
// 角度用累加值而不是直接取 0–360：数据每 6 分钟刷新一次，风向常在小范围内来回，
// 但「350° → 10°」直接换值会让指针倒着甩 340°。这里把差值折到 ±180° 再累加，
// 指针永远走最短的一边，数值连续，CSS transition 才有平滑可言。
const targetAngle = computed(() => ((Number(props.direction) || 0) + 180) % 360)
const shownAngle = ref(0)
// 还没拨过针：第一次是从正北（0°）顺时针走到目标刻度
let firstMove = true

// 每次转向都把差值折到 ±180° 再累加，指针永远走最短的一边。
// 只有第一次例外：从 0° 直接加到目标值，方向必然是顺时针 ——
// 用户要的是「先朝北，然后顺时针转过去」，走最短路径会出现逆时针倒甩。
function stepTo(next) {
  const prev = shownAngle.value
  if (firstMove) {
    firstMove = false
    shownAngle.value = prev + next
    return
  }
  let delta = ((next - prev + 540) % 360) - 180
  if (delta === -180) delta = 180
  shownAngle.value = prev + delta
}

watch(targetAngle, stepTo)

// 打开页面时指针从 0° 扫到真实角度，和温度、四颗表盘、日出日落同一套规则：
// 要么一起生长，要么一起瞬跳。缓存命中时也要扫，不能「啪」地定格。
// 挂载后要分两拍：先把 .smooth 类落到 DOM 上、让浏览器把 0° 记成起点，
// 下一拍再改角度，transition 才会真的跑起来（同一次 tick 里改会被合并成一次样式计算）
const ready = ref(false)
onMounted(async () => {
  await nextTick()
  ready.value = true
  await nextTick()
  stepTo(targetAngle.value)
})
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
      <!-- 用 style 里的 CSS transform 而不是 transform 属性：
           属性变化不会被 CSS transition 补间，只有 CSS 属性才会。
           transform-box: view-box 让 50% 50% 正好是 viewBox 的中心 -->
      <g
        class="wc-needle-group"
        :class="{ smooth: ready }"
        :style="{ transform: `rotate(${shownAngle}deg)` }"
      >
        <line class="wc-needle" x1="50" y1="26" x2="50" y2="74" />
        <path class="wc-head" d="M50 20 55.2 30.6H44.8Z" />
        <circle class="wc-tail" cx="50" cy="74" r="3.2" />
      </g>
      <!-- 轴心画在针上面：小圆压住针杆中点，读起来像罗盘指针的轴 -->
      <circle class="wc-hub" cx="50" cy="50" :r="HUB" />
    </svg>
  </div>
</template>
