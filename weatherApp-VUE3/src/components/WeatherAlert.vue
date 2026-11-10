<script setup>
/**
 * 本地天气预警：夹在 6/9 张详情卡与逐小时预报之间
 *
 * 数据是中央气象台的省级预警列表，本地与否靠标题里的区域名匹配（见 utils/alertParse）。
 * 没有本地预警时整块不渲染 —— 空态是常态，留一条「无预警」的空卡只会占地方。
 *
 * 详情页没有 CORS 头，fetch 读不了正文，所以整条卡片点击直接新窗口打开 nmc.cn。
 *
 * 样式上不要标题栏、不要「多少条」，整块毛玻璃按预警级别染色（黄警就是黄色玻璃），
 * 而不是只在左边画一条色条。
 *
 * status（由 store 提供）用来区分「确实没有预警」和「接口失败」：
 *   - ok + total>0 → 预警卡片
 *   - ok + total=0 / idle → 整块隐藏（正常空态，不打扰用户）
 *   - error → 一行中性灰提示 + 刷新按钮，点击只重试预警这一路（不重拉整个天气）
 * 提示条刻意用中性灰而不是红色：接口失败不是灾害级别，红色会和蓝/黄/橙/红预警色语义打架。
 */
import { computed } from 'vue'

const props = defineProps({
  alerts: { type: Object, default: () => ({ list: [], top: 0, total: 0 }) },
  // idle | ok | error
  status: { type: String, default: 'idle' },
  refreshing: { type: Boolean, default: false },
})

const emit = defineEmits(['refresh'])

const LEVEL_CLASS = { 1: 'lv-blue', 2: 'lv-yellow', 3: 'lv-orange', 4: 'lv-red' }

const visible = computed(() => props.alerts.list.slice(0, 3))
const showList = computed(() => props.alerts.total > 0)
const showError = computed(() => props.status === 'error' && !showList.value)

function open(link) {
  if (!link) return
  window.open(link, '_blank', 'noopener')
}
</script>

<template>
  <section v-if="showList || showError" class="alert-section">
    <div v-if="showList" class="alert-list">
      <button
        v-for="item in visible"
        :key="item.id"
        type="button"
        class="alert-item"
        :class="LEVEL_CLASS[item.rank]"
        :title="item.title"
        @click="open(item.link)"
      >
        <img v-if="item.pic" class="alert-icon" :src="item.pic" :alt="item.type" loading="lazy" />
        <span class="alert-body">
          <span class="alert-line">
            <span class="alert-type">{{ item.type }}</span>
            <span class="alert-level">{{ item.level }}预警</span>
          </span>
          <span class="alert-meta">{{ item.region }} · {{ item.issued }}</span>
        </span>
      </button>
    </div>

    <!-- 接口失败：一行轻提示 + 只重试预警的刷新按钮。中性灰玻璃，不占用灾害级别配色 -->
    <div v-else class="alert-fail" role="status">
      <span class="alert-fail-text">预警信息暂时获取失败</span>
      <button
        type="button"
        class="alert-retry"
        :disabled="refreshing"
        @click="emit('refresh')"
      >
        <span class="alert-retry-icon" :class="{ spinning: refreshing }" aria-hidden="true">⟳</span>
        {{ refreshing ? '重试中…' : '刷新' }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.alert-section {
  width: 100%;
}

.alert-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.alert-item {
  /* 默认蓝色，具体级别由 .lv-* 覆盖；整块玻璃都用这个 RGB 上色 */
  --alert-rgb: 109, 179, 242;
  box-sizing: border-box;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  text-align: left;
  cursor: pointer;
  background: rgba(var(--alert-rgb), 0.16);
  border: 1px solid rgba(var(--alert-rgb), 0.34);
  border-radius: var(--radius-md);
  backdrop-filter: blur(var(--glass-card));
  box-shadow: 0 4px 18px rgba(var(--alert-rgb), 0.06);
  transition:
    background 0.18s,
    border-color 0.18s,
    transform 0.18s,
    box-shadow 0.18s;
}

.alert-item:hover {
  background: rgba(var(--alert-rgb), 0.28);
  border-color: rgba(var(--alert-rgb), 0.6);
  box-shadow: 0 6px 22px rgba(var(--alert-rgb), 0.14);
  transform: translateY(-1px);
}

.alert-item:active {
  transform: translateY(0);
}

.alert-item:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

/* 整块毛玻璃按级别染色：蓝 < 黄 < 橙 < 红 */
.lv-blue {
  --alert-rgb: 109, 179, 242;
}
.lv-yellow {
  --alert-rgb: 240, 209, 107;
}
.lv-orange {
  --alert-rgb: 247, 164, 94;
}
.lv-red {
  --alert-rgb: 240, 118, 118;
}

.alert-icon {
  flex: 0 0 auto;
  width: 34px;
  height: 26px;
  object-fit: contain;
}

.alert-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1 1 auto;
}

.alert-line {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.alert-type {
  font-size: 0.9375rem;
  line-height: 1.3;
  font-weight: 600;
  color: var(--text-1);
  white-space: nowrap;
}

.alert-level {
  font-size: 0.6875rem;
  font-weight: 600;
  color: rgb(var(--alert-rgb));
  white-space: nowrap;
}

.alert-meta {
  font-size: 0.6875rem;
  color: var(--text-5);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 失败提示条：刻意做成比预警卡更薄、更低调的中性灰玻璃 */
.alert-fail {
  box-sizing: border-box;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 14px;
  background: var(--surface-2);
  border: 1px solid var(--line-1);
  border-radius: var(--radius-md);
  backdrop-filter: blur(var(--glass-soft));
}

.alert-fail-text {
  font-size: 0.75rem;
  color: var(--text-6);
}

.alert-retry {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  font-size: 0.6875rem;
  font-weight: 500;
  color: var(--text-5);
  background: var(--surface-3);
  border: 1px solid var(--line-1);
  border-radius: 999px;
  cursor: pointer;
  transition:
    color 0.18s,
    border-color 0.18s,
    background 0.18s;
}

.alert-retry:hover:not(:disabled) {
  color: var(--text-1);
  border-color: var(--line-2);
  background: var(--surface-4);
}

.alert-retry:disabled {
  opacity: 0.55;
  cursor: default;
}

.alert-retry:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.alert-retry-icon {
  display: inline-block;
  font-size: 0.875rem;
  line-height: 1;
}

.alert-retry-icon.spinning {
  animation: alert-spin 0.8s linear infinite;
}

@keyframes alert-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .alert-retry-icon.spinning {
    animation: none;
  }
}

@media (max-width: 480px) {
  .alert-icon {
    width: 28px;
    height: 22px;
  }
  .alert-type {
    font-size: 0.875rem;
  }
  .alert-item {
    padding: 9px 12px;
    gap: 10px;
  }
  .alert-fail {
    padding: 8px 12px;
  }
}
</style>
