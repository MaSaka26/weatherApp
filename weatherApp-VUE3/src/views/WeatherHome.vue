<script setup>
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, provide, ref } from 'vue'
import { storeToRefs } from 'pinia'

import { useWeatherStore } from '@/stores/weather'
import { TWEEN_START_AT } from '@/composables/useTween'

import SkyBackground from '@/components/SkyBackground.vue'
import RefreshButton from '@/components/RefreshButton.vue'
import SettingsButton from '@/components/SettingsButton.vue'
import SearchBar from '@/components/SearchBar.vue'
import CommonCities from '@/components/CommonCities.vue'
import ErrorState from '@/components/ErrorState.vue'
import CurrentWeather from '@/components/CurrentWeather.vue'
import DetailCards from '@/components/DetailCards.vue'
import WeatherAlert from '@/components/WeatherAlert.vue'
import HourlyForecast from '@/components/HourlyForecast.vue'
import RainForecast from '@/components/RainForecast.vue'
// 雷达约 10 kB（gzip）在首屏关键路径上，且绝大多数访问不会打开它。
// 用 defineAsyncComponent 把它切成独立 chunk —— 这是唯一能真正减少首屏字节的办法，
// 单纯把这个 2235 行的文件拆成多个 .vue 不会少一个字节（Vite 只在 async import 边界切块）。
const RainRadarPreview = defineAsyncComponent(() => import('@/components/RainRadarPreview.vue'))
import DailyForecast from '@/components/DailyForecast.vue'
import LifeIndex from '@/components/LifeIndex.vue'

const store = useWeatherStore()
const { animationEpoch } = storeToRefs(store)
provide(TWEEN_START_AT, animationEpoch)
const isOnline = ref(typeof navigator === 'undefined' ? true : navigator.onLine)
const setOnline = () => {
  isOnline.value = navigator.onLine
  if (isOnline.value && store.isStale) store.refresh({ quiet: true })
}

const todayHigh = computed(() =>
  store.hasWeatherData ? (store.daily?.temperature_2m_max?.[0] ?? null) : null,
)
const todayLow = computed(() =>
  store.hasWeatherData ? (store.daily?.temperature_2m_min?.[0] ?? null) : null,
)

// 雷达预览是重资源（要探测最新帧 + 并发预载 12 张整图），用开关控制挂载与销毁：
// 常驻会让首屏多一个 Teleport 容器，且用户不点就白白占内存
const radarOpen = ref(false)
// 首次打开后才允许挂载。没有这个 v-if，defineAsyncComponent 的 loader 会在
// 组件挂载时立刻触发 —— chunk 照样在首页下载，异步化就变成只改了文件名。
// 一旦挂载就常驻（不随关闭销毁），避免反复开关重复跑一遍探测与预载。
const radarMounted = ref(false)

// 预取只做一次。用户在条目上悬停/聚焦/按下时就先把 chunk 拉下来，
// 等真的点击时组件已经就绪，抵消异步化带来的那个 RTT。
let radarPrefetched = false
function prefetchRadar() {
  if (radarPrefetched) return
  radarPrefetched = true
  // 动态 import 同一个路径，Rollup 会复用同一个 promise，不会重复下载
  import('@/components/RainRadarPreview.vue').catch(() => {
    // 预取失败不提示：真正的打开流程还会再 import 一次，那里有错误处理
    radarPrefetched = false
  })
}

function openRadar() {
  radarMounted.value = true
  radarOpen.value = true
}

onMounted(() => {
  window.addEventListener('online', setOnline)
  window.addEventListener('offline', setOnline)
  // 进页面先尝试浏览器定位，失败则提示手动搜索。
  // 注意这里不等数据：模板已经用缓存（或数值占位骨架）画好了完整仪表盘，
  // 数据回来只是把数字替换掉。
  store.loadInitialLocation()
  // 每分钟检查一次「距上次成功是否已满 6 分钟」，满足才真正请求 —— 节流在这里
  store.startAutoRefresh()
})

onBeforeUnmount(() => {
  store.stopAutoRefresh()
  window.removeEventListener('online', setOnline)
  window.removeEventListener('offline', setOnline)
})
</script>

<template>
  <SkyBackground :sky-class="store.skyClass" />

  <div class="app-container">
    <div class="top-bar">
      <SearchBar @search="store.loadCity" @select="store.loadPlace" />
      <CommonCities
        :cities="store.commonCities"
        @select="store.loadCommonCity"
        @remove="store.removeCommonCity"
        @locate="store.loadByGeolocation"
      />
      <RefreshButton />
      <SettingsButton />
    </div>

    <!-- 只有「连坐标都拿不到、屏幕上连占位骨架都没有」时才整页报错。
         正常路径下 status 恒为 success，仪表盘从第一帧就在。 -->
    <ErrorState
      v-if="store.status === 'error'"
      :title="store.errorTitle"
      :desc="store.errorDesc"
      @retry="store.retry"
    />

    <!-- 不绑 :key —— 数据到达时只让子组件收到新的 prop，Vue 原地打补丁即可。
         早先这里绑了 store.renderKey，每次取数成功就 +1，等于把整棵内容树销毁重建，
         于是页面整体闪一下、fadeUp 重播；数值本该平滑扫到新值，却变成了整页刷新。 -->
    <div
      v-else
      class="weather-content active"
      data-reveal-root
    >
      <CurrentWeather
        v-reveal
        v-if="store.current"
        :city-name="store.cityName"
        :city-detail="store.cityDetail"
        :current="store.current"
        :today-high="todayHigh"
        :today-low="todayLow"
        :data-ready="store.hasWeatherData"
        :timezone="store.data?.timezone || ''"
      />

      <!-- 城市预警：放在天气详情 6/9 卡上方。
           v-reveal 挂在包装层而非组件上：WeatherAlert 根元素自带 v-if，
           指令透传到 comment 占位时会丢；包装层始终是真实 DOM。 -->
      <div
        v-reveal
        v-if="store.alertStatus !== 'idle' || store.alerts.total > 0"
        class="weather-alert-slot"
      >
        <WeatherAlert
          :alerts="store.alerts"
          :status="store.alertStatus"
          :refreshing="store.alertRefreshing"
          @refresh="store.retryAlerts()"
        />
      </div>

      <DetailCards
        v-reveal
        v-if="store.current"
        :current="store.current"
        :daily="store.daily"
        :air="store.air"
        :data-ready="store.hasWeatherData"
      />

      <HourlyForecast
        v-reveal
        :hourly="store.hourly"
        :current="store.current"
        :data-ready="store.hasWeatherData"
      />

      <!-- 降水预报：夹在逐小时与 16 天之间，是本次需求指定的位置 -->
      <RainForecast
        v-reveal
        v-if="store.hasWeatherData && store.current && store.hourly"
        :current="store.current"
        :hourly="store.hourly"
        @open="openRadar"
        @prefetch="prefetchRadar"
      />

      <DailyForecast v-reveal :daily="store.daily" :data-ready="store.hasWeatherData" />

      <LifeIndex
        v-reveal
        v-if="store.hasWeatherData && store.current"
        :current="store.current"
        :daily="store.daily"
        :air="store.air"
      />

      <!-- 失败不再抹掉整页：数据更新失败时保留上一份数据，只在这一行说明。
           「占位中」表示屏幕上还是 — 骨架，从没拿到过真数据。 -->
      <div
        v-reveal
        class="location-hint"
        :class="{ 'hint-warn': store.lastError || store.isStale || store.autoRefreshFailed }"
      >
        <template v-if="!isOnline">
          <span role="status" aria-live="polite">
            离线模式 · {{ store.hasWeatherData ? `显示本机天气数据（更新于 ${store.lastUpdated}）` : '暂无可用的本机天气缓存' }}
          </span>
        </template>
        <template v-else-if="store.lastError">
          <span role="status" aria-live="polite">
            数据更新失败 · {{ store.lastError }}<template v-if="store.hasWeatherData"> · 继续显示上次成功数据（{{ store.lastUpdated }}）</template>
          </span>
        </template>
        <template v-else-if="store.isStale || store.autoRefreshFailed">
          <span role="status" aria-live="polite">
            {{ store.isStale ? '数据可能已过期' : '自动更新失败' }} · 最后成功更新于 {{ store.lastUpdated }}
          </span>
        </template>
        <template v-else-if="!store.lastUpdated">正在获取天气与位置…</template>
        <template v-else-if="store.showingCachedWeather">
          <span role="status" aria-live="polite">正在更新 · 当前显示缓存天气 · {{ store.lastUpdated }}</span>
        </template>
        <template v-else>数据来源: Open-Meteo · {{ store.lastUpdated }}</template>
      </div>
    </div>
  </div>

  <!-- 雷达回放层放在 app-container 之外：它是全屏覆盖层，
       留在内容列里会被容器的 max-width 与 padding 裁住 -->
  <RainRadarPreview
    v-if="radarMounted"
    :open="radarOpen"
    :city-name="store.cityName"
    :sky-class="store.skyClass"
    :country-code="store.cityCountryCode"
    :latitude="store.lat"
    :longitude="store.lon"
    :location-source="store.locationSource"
    :timezone="store.data?.timezone || ''"
    @close="radarOpen = false"
  />
</template>
