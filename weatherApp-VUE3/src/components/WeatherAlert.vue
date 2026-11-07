<script setup>
/**
 * 本地天气预警：夹在 6/9 张详情卡与逐小时预报之间
 *
 * 数据是中央气象台的省级预警列表，本地与否靠标题里的区域名匹配（见 utils/alertParse）。
 * 没有本地预警时整块不渲染 —— 空态是常态，留一条「无预警」的空卡只会占地方。
 *
 * 详情页没有 CORS 头，fetch 读不了正文，所以整条卡片点击直接新窗口打开 nmc.cn。
 */
import { computed } from 'vue'

const props = defineProps({
  alerts: { type: Object, default: () => ({ list: [], top: 0, total: 0 }) },
})

const LEVEL_CLASS = { 1: 'lv-blue', 2: 'lv-yellow', 3: 'lv-orange', 4: 'lv-red' }

const visible = computed(() => props.alerts.list.slice(0, 3))
const more = computed(() => Math.max(0, props.alerts.total - visible.value.length))

function open(link) {
  if (!link) return
  window.open(link, '_blank', 'noopener')
}
</script>

<template>
  <section v-if="alerts.total > 0" class="alert-section">
    <div class="section-head">
      <span class="section-title">天气预警</span>
      <span class="alert-count">{{ alerts.total }} 条</span>
    </div>

    <div class="alert-list">
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

    <p v-if="more > 0" class="alert-more">另有 {{ more }} 条本地预警，点上方任一条查看全部</p>
  </section>
</template>

<style scoped>
.alert-section {
  width: 100%;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.section-title {
  font-size: 14px;
  letter-spacing: 0.04em;
  color: var(--text-4);
  text-transform: uppercase;
  margin-bottom: 14px;
}

.alert-count {
  margin-bottom: 14px;
  font-size: 11px;
  color: var(--text-6);
  font-variant-numeric: tabular-nums;
}

.alert-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.alert-item {
  box-sizing: border-box;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  text-align: left;
  cursor: pointer;
  background: var(--surface-2);
  border: 1px solid var(--line-0);
  border-left-width: 3px;
  border-radius: var(--radius-md);
  backdrop-filter: blur(var(--glass-card));
  transition:
    background 0.18s,
    transform 0.18s,
    border-color 0.18s;
}

.alert-item:hover {
  background: var(--surface-3);
  transform: translateY(-1px);
}

.alert-item:active {
  transform: translateY(0);
}

.alert-item:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

/* 左侧色条直接编码级别：蓝 < 黄 < 橙 < 红 */
.lv-blue {
  border-left-color: #6db3f2;
}
.lv-yellow {
  border-left-color: #f0d16b;
}
.lv-orange {
  border-left-color: #f7a45e;
}
.lv-red {
  border-left-color: #f07676;
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
  font-size: 15px;
  line-height: 1.3;
  font-weight: 600;
  color: var(--text-1);
  white-space: nowrap;
}

.alert-level {
  font-size: 11px;
  color: var(--text-5);
  white-space: nowrap;
}

.alert-meta {
  font-size: 11px;
  color: var(--text-6);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.alert-more {
  margin: 8px 0 0;
  font-size: 11px;
  color: var(--text-7);
}

@media (max-width: 480px) {
  .alert-icon {
    width: 28px;
    height: 22px;
  }
  .alert-type {
    font-size: 14px;
  }
  .alert-item {
    padding: 9px 12px;
    gap: 10px;
  }
}
</style>
