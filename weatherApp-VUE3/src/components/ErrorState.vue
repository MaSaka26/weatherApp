<script setup>
defineProps({
  title: { type: String, default: '' },
  desc: { type: String, default: '' },
})

defineEmits(['retry'])
</script>

<template>
  <div class="error-message active" role="alert">
    <div class="error-icon">⚠️</div>
    <div class="error-title">{{ title }}</div>
    <div class="error-desc">{{ desc }}</div>
    <button class="error-retry" @click="$emit('retry')">重试</button>
  </div>
</template>
