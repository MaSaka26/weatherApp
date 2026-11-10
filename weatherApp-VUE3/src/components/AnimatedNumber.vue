<script setup>
import { computed } from 'vue'

import { useAnimatedNumber } from '@/composables/useWeatherAnimations'

const props = defineProps({
  value: { type: Number, default: null },
  decimals: { type: Number, default: 0 },
  padDigits: { type: Number, default: 0 },
  initialValue: { type: Number, default: 0 },
  duration: { type: Number, default: 1000 },
  placeholder: { type: String, default: '—' },
})

const { value: shown } = useAnimatedNumber(() => props.value, {
  duration: props.duration,
  initialValue: props.initialValue,
})

const text = computed(() => {
  if (!Number.isFinite(props.value)) return props.placeholder
  return props.decimals > 0
    ? shown.value.toFixed(props.decimals)
    : String(Math.round(shown.value)).padStart(props.padDigits, '0')
})
</script>

<template>
  <span class="animated-number">{{ text }}<slot /></span>
</template>
