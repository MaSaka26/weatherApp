<script setup>
import { computed, onMounted, ref } from 'vue'

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
import RainForecast from '@/components/RainForecast.vue'
import { defineAsyncComponent } from 'vue'
const RainRadarPreview = defineAsyncComponent(() => import('@/components/RainRadarPreview.vue'))
import DailyForecast from '@/components/DailyForecast.vue'
import LifeIndex from '@/components/LifeIndex.vue'

const store = useWeatherStore()

const todayHigh = computed(() => store.daily?.temperature_2m_max?.[0] ?? 0)
const todayLow = computed(() => store.daily?.temperature_2m_min?.[0] ?? 0)

// 雷达预览是重资源（动态拉 Leaflet + 一次请求 13 帧），用开关控制挂载与销毁：
// 常驻会让首屏多一个 Teleport 容器，且用户不点就白白占内存
const radarOpen = ref(false)

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

      <!-- 降水预报：夹在逐小时与 16 天之间，是本次需求指定的位置 -->
      <RainForecast
        v-if="store.current && store.hourly"
        :current="store.current"
        :hourly="store.hourly"
        @open="radarOpen = true"
      />

      <DailyForecast :daily="store.daily" />

      <LifeIndex v-if="store.current" :current="store.current" :daily="store.daily" :air="store.air" />

      <div class="location-hint">数据来源: Open-Meteo · {{ store.lastUpdated }}</div>
    </div>
  </div>

  <!-- 雷达回放层放在 app-container 之外：它是全屏覆盖层，
       留在内容列里会被容器的 max-width 与 padding 裁住 -->
  <RainRadarPreview
    :open="radarOpen"
    :lat="store.lat"
    :lon="store.lon"
    :city-name="store.cityName"
    @close="radarOpen = false"
  />
</template>
