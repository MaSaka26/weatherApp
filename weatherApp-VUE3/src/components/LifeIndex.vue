<script setup>
import { computed } from 'vue'

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

    <!-- 六张独立卡片：结论居中，判断依据缩成小字放右下角 -->
    <div class="life-grid">
      <div v-for="item in items" :key="item.key" class="life-card">
        <p class="life-verdict">{{ item.verdict }}</p>
        <span v-if="item.detail" class="life-basis">{{ item.detail }}</span>
      </div>
    </div>
  </section>
</template>
