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
 */
import { computed } from 'vue'

const props = defineProps({
  alerts: { type: Object, default: () => ({ list: [], top: 0, total: 0 }) },
})

const LEVEL_CLASS = { 1: 'lv-blue', 2: 'lv-yellow', 3: 'lv-orange', 4: 'lv-red' }

const visible = computed(() => props.alerts.list.slice(0, 3))

function open(link) {
  if (!link) return
  window.open(link, '_blank', 'noopener')
}
</script>

<template>
  <section v-if="alerts.total > 0" class="alert-section">
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
  font-size: 15px;
  line-height: 1.3;
  font-weight: 600;
  color: var(--text-1);
  white-space: nowrap;
}

.alert-level {
  font-size: 11px;
  font-weight: 600;
  color: rgb(var(--alert-rgb));
  white-space: nowrap;
}

.alert-meta {
  font-size: 11px;
  color: var(--text-5);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
