<script setup>
import { computed } from 'vue'

import TablerIcon from '@/components/TablerIcon.vue'
import { buildLifeIndices } from '@/utils/lifeIndex'

const props = defineProps({
  current: { type: Object, default: null },
  daily: { type: Object, default: null },
  air: { type: Object, default: null },
})

const items = computed(() =>
  buildLifeIndices({ current: props.current, daily: props.daily, air: props.air }),
)
</script>

<template>
  <section class="life-section" aria-labelledby="life-title">
    <div id="life-title" class="section-title">生活指数</div>

    <!-- 六张独立卡片：图标在上、结论在下，判断依据缩成小字放右下角。
         图标由结论决定（洗车 = car，不宜洗车 = car-off），不靠颜色表达好坏 -->
    <div class="life-grid">
      <div v-for="item in items" :key="item.key" class="life-card">
        <TablerIcon class="life-icon" :name="item.icon" :size="18" />
        <p class="life-verdict">{{ item.verdict }}</p>
        <span v-if="item.detail" class="life-basis">{{ item.detail }}</span>
      </div>
    </div>
  </section>
</template>
