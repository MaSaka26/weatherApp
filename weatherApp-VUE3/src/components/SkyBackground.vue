<script setup>
defineProps({
  skyClass: { type: String, default: '' },
})
</script>

<template>
  <div class="sky-bg" :class="skyClass"></div>
</template>
