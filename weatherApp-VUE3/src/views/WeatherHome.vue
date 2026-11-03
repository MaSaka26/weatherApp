<script setup>
import { computed, onMounted } from 'vue'

import { useWeatherStore } from '@/stores/weather'

import SkyBackground from '@/components/SkyBackground.vue'
import RefreshButton from '@/components/RefreshButton.vue'
import SettingsButton from '@/components/SettingsButton.vue'
import SearchBar from '@/components/SearchBar.vue'
import LoadingState from '@/components/LoadingState.vue'
import ErrorState from '@/components/ErrorState.vue'
import CurrentWeather from '@/components/CurrentWeather.vue'
import DetailCards from '@/components/DetailCards.vue'
import HourlyForecast from '@/components/HourlyForecast.vue'
import DailyForecast from '@/components/DailyForecast.vue'
import LifeIndex from '@/components/LifeIndex.vue'

const store = useWeatherStore()

const todayHigh = computed(() => store.daily?.temperature_2m_max?.[0] ?? 0)
const todayLow = computed(() => store.daily?.temperature_2m_min?.[0] ?? 0)

onMounted(() => {
  // 进入页面先尝试浏览器定位，失败则提示手动搜索
  store.loadByGeolocation()
})
</script>

<template>
  <SkyBackground :sky-class="store.skyClass" />

  <div class="app-container">
    <div class="top-bar">
      <SearchBar @search="store.loadCity" @select="store.loadPlace" />
      <RefreshButton />
      <SettingsButton />
    </div>

    <LoadingState v-if="store.status === 'loading'" />

    <ErrorState
      v-else-if="store.status === 'error'"
      :title="store.errorTitle"
      :desc="store.errorDesc"
      @retry="store.retry"
    />

    <div
      v-else-if="store.status === 'success'"
      :key="store.renderKey"
      class="weather-content active"
    >
      <CurrentWeather
        v-if="store.current"
        :city-name="store.cityName"
        :city-detail="store.cityDetail"
        :current="store.current"
        :today-high="todayHigh"
        :today-low="todayLow"
      />

      <DetailCards v-if="store.current" :current="store.current" :daily="store.daily" />

      <HourlyForecast :hourly="store.hourly" :current="store.current" />

      <DailyForecast :daily="store.daily" />

      <LifeIndex v-if="store.current" :current="store.current" :daily="store.daily" :air="store.air" />

      <div class="location-hint">数据来源: Open-Meteo · {{ store.lastUpdated }}</div>
    </div>
  </div>
</template>
