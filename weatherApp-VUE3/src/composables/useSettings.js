/* 设置面板的唯一数据源
   - 每个开关映射到 weather.css 里的一个倍率变量，改值即全局生效，无需重新渲染
   - 只存「档位」不存任意数值：面板按钮由 SETTING_OPTIONS 自动生成，
     读回本地缓存时会校验，脏数据直接退回默认值，避免出现 0.87 这种没人调过的档 */
import { reactive, watch } from 'vue'

const STORAGE_KEY = 'weather-app:settings'

/** 档位定义：label 是面板上的按钮文案，value 写进 CSS 变量 */
export const SETTING_OPTIONS = {
  // 毛玻璃：0 等于关掉模糊，低端机 / 省电模式可以调到关
  glass: [
    { value: 0, label: '关' },
    { value: 0.6, label: '弱' },
    { value: 1, label: '标准' },
    { value: 1.6, label: '强' },
  ],
  // 圆角：0.5 硬朗 / 1 标准 / 1.5 圆润
  radius: [
    { value: 0.5, label: '直角' },
    { value: 1, label: '标准' },
    { value: 1.5, label: '圆润' },
  ],
  // 卡片 item 布局：左右 = 左文右图（手机/平板默认），上下 = 文字在上图形在下（备份）。
  // 桌面端一行六张卡宽只有 144，固定竖排，不受此项影响
  cardLayout: [
    { value: 'row', label: '左右' },
    { value: 'stack', label: '上下' },
  ],
  // 卡片数量：6 是原来那套（体感/风速/湿度/气压/紫外线/日出日落），
  // 9 再补空气质量、能见度、降水量三张。桌面九张排 5+4（末张占两格）
  cardCount: [
    { value: 6, label: '6 张' },
    { value: 9, label: '9 张' },
  ],
}

/** 开关 → CSS 变量名（cardLayout 不走 CSS 变量，由 DetailCards 换布局类） */
const CSS_VAR_OF = {
  glass: '--glass-scale',
  radius: '--radius-scale',
}

export const DEFAULTS = { glass: 1, radius: 1, cardLayout: 'row', cardCount: 6 }

export const settings = reactive({ ...DEFAULTS })

export function setSetting(key, value) {
  const allowed = SETTING_OPTIONS[key]
  if (!allowed || !allowed.some((opt) => opt.value === value)) return
  settings[key] = value
}

export function resetSettings() {
  Object.assign(settings, DEFAULTS)
}

/** 把当前档位写进 :root，CSS 里所有 calc(… * var(--x-scale)) 立刻跟着变 */
function apply() {
  const root = document.documentElement
  for (const key of Object.keys(CSS_VAR_OF)) {
    root.style.setProperty(CSS_VAR_OF[key], String(settings[key]))
  }
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const saved = JSON.parse(raw)
    for (const key of Object.keys(DEFAULTS)) {
      setSetting(key, saved?.[key])
    }
  } catch {
    // 缓存被清空 / 手动改坏 → 保持默认值，不打断启动
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // 隐私模式下 localStorage 不可写，忽略即可，本次会话内设置仍然生效
  }
}

let inited = false

/** 在 main.js 里调用一次：读缓存 → 应用 → 之后每次改动自动落盘 */
export function initSettings() {
  if (inited) return
  inited = true
  load()
  apply()
  watch(settings, () => {
    apply()
    save()
  })
}
