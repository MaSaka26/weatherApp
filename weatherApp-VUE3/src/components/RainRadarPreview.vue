<script setup>
import { computed, defineAsyncComponent } from 'vue'

import { RADAR_PROVIDER, selectRadarProvider } from '@/utils/radarProvider'

const NmcRadarPreview = defineAsyncComponent(() => import('@/components/NmcRainRadarPreview.vue'))
const RainViewerRadarPreview = defineAsyncComponent(
  () => import('@/components/RainViewerRadarPreview.vue'),
)

const props = defineProps({
  open: { type: Boolean, default: false },
  cityName: { type: String, default: '' },
  skyClass: { type: String, default: '' },
  countryCode: { type: String, default: '' },
  latitude: { type: Number, default: null },
  longitude: { type: Number, default: null },
  locationSource: { type: String, default: '' },
  timezone: { type: String, default: '' },
})
const emit = defineEmits(['close'])

const provider = computed(() => selectRadarProvider({
  countryCode: props.countryCode,
  locationSource: props.locationSource,
}))

const providerComponent = computed(() =>
  provider.value === RADAR_PROVIDER.NMC ? NmcRadarPreview : RainViewerRadarPreview,
)

const providerProps = computed(() => provider.value === RADAR_PROVIDER.NMC
  ? {
      open: props.open,
      cityName: props.cityName,
      skyClass: props.skyClass,
    }
  : {
      open: props.open,
      cityName: props.cityName,
      latitude: props.latitude,
      longitude: props.longitude,
      timezone: props.timezone,
    },
)
</script>

<template>
  <component
    :is="providerComponent"
    :key="provider"
    v-bind="providerProps"
    @close="emit('close')"
  />
</template>
