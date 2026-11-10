<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

defineProps({ cities: { type: Array, default: () => [] } })
const emit = defineEmits(['select', 'remove', 'locate'])
const open = ref(false)
const trigger = ref(null)
const menu = ref(null)
const menuWidth = ref('300px')

function fitMenuToViewport() {
  if (!open.value) return
  nextTick(() => {
    if (!trigger.value) return
    const available = window.innerWidth - trigger.value.getBoundingClientRect().left - 16
    menuWidth.value = `${Math.max(0, Math.min(300, available))}px`
  })
}

function toggleMenu() {
  open.value = !open.value
  fitMenuToViewport()
}

function selectCity(place) {
  open.value = false
  emit('select', place)
}

function locate() {
  open.value = false
  emit('locate')
}

function onDocumentPointerDown(event) {
  if (!open.value) return
  if (trigger.value?.contains(event.target) || menu.value?.contains(event.target)) return
  open.value = false
}

function onDocumentKeyDown(event) {
  if (event.key === 'Escape') open.value = false
}

onMounted(() => {
  window.addEventListener('resize', fitMenuToViewport)
  document.addEventListener('pointerdown', onDocumentPointerDown)
  document.addEventListener('keydown', onDocumentKeyDown)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', fitMenuToViewport)
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  document.removeEventListener('keydown', onDocumentKeyDown)
})
</script>

<template>
  <div class="common-cities">
    <button
      class="common-cities-btn"
      ref="trigger"
      type="button"
      :aria-expanded="open"
      aria-label="常用城市"
      title="常用城市"
      @click="toggleMenu"
    >
      <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3.5 20.5V8.2L9 5.5v15M9 9.5h11.5v11H3.5M13 13h.01M17 13h.01M13 17h.01M17 17h.01" />
      </svg>
      <span class="common-cities-count">{{ cities.length }}</span>
    </button>

    <Transition name="common-cities-menu">
      <div v-if="open" ref="menu" class="common-cities-menu" :style="{ width: menuWidth }" role="dialog" aria-label="常用城市列表">
      <div class="common-cities-heading">常用城市</div>
      <div v-if="cities.length" class="common-cities-list">
        <div v-for="place in cities" :key="`${place.lat},${place.lon}`" class="common-city-row">
          <button class="common-city-select" type="button" @click="selectCity(place)">
            <strong>{{ place.name }}</strong>
            <small>{{ place.detail || ' ' }}</small>
          </button>
          <button
            class="common-city-remove"
            type="button"
            :aria-label="`删除${place.name}`"
            :title="`删除${place.name}`"
            @click="emit('remove', place)"
          >
            ×
          </button>
        </div>
      </div>
      <p v-else class="common-cities-empty">搜索并查看城市天气后，会自动加入这里</p>
      <button class="common-cities-locate" type="button" @click="locate">
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
        </svg>
        使用当前位置
      </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.common-cities { position: relative; flex: 0 0 auto; }
.common-cities-btn { position: relative; }
.common-cities-count {
  position: absolute;
  top: -4px;
  right: -4px;
  display: grid;
  min-width: 17px;
  height: 17px;
  padding: 0 3px;
  place-items: center;
  border: 1px solid var(--surface-3);
  border-radius: 999px;
  background: var(--surface-5);
  font-size: 0.625rem;
  line-height: 1;
}
.common-cities-menu {
  position: absolute;
  z-index: 30;
  top: calc(100% + 8px);
  left: 0;
  width: min(300px, 82vw);
  max-height: min(60vh, 420px);
  overflow-y: auto;
  padding: 8px;
  border: 1px solid var(--line-1);
  border-radius: var(--radius-md);
  background: rgba(15, 23, 42, .96);
  box-shadow: 0 12px 36px rgba(0, 0, 0, .25);
  backdrop-filter: blur(16px);
  transform-origin: top left;
}
.common-cities-menu-enter-active, .common-cities-menu-leave-active { transition: opacity .16s ease, transform .16s ease; }
.common-cities-menu-enter-from, .common-cities-menu-leave-to { opacity: 0; transform: translateY(-5px) scale(.98); }
.common-cities-heading { padding: 7px 10px 9px; color: var(--text-5); font-size: 0.75rem; }
.common-city-row { display: flex; align-items: center; border-radius: var(--radius-sm); }
.common-city-row:hover, .common-city-row:focus-within { background: var(--surface-3); }
.common-city-select {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 3px;
  padding: 9px 10px;
  border: 0;
  color: inherit;
  text-align: left;
  background: transparent;
  font: inherit;
  cursor: pointer;
}
.common-city-select strong, .common-city-select small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.common-city-select small { color: var(--text-5); font-size: 0.75rem; }
.common-city-remove {
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  place-items: center;
  margin-right: 3px;
  border: 0;
  border-radius: var(--radius-sm);
  color: var(--text-5);
  background: transparent;
  font-size: 1.375rem;
  line-height: 1;
  cursor: pointer;
}
.common-city-remove:hover, .common-city-remove:focus-visible { color: var(--text-0); background: var(--surface-5); }
.common-cities-empty { margin: 0; padding: 10px; color: var(--text-5); font-size: 0.75rem; line-height: 1.5; }
.common-cities-locate {
  display: flex;
  width: 100%;
  min-height: 42px;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  padding: 8px 10px;
  border: 1px solid var(--line-1);
  border-radius: var(--radius-sm);
  color: var(--text-3);
  background: var(--surface-2);
  font: inherit;
  font-size: 0.8125rem;
  cursor: pointer;
}
.common-cities-locate:hover,
.common-cities-locate:focus-visible { color: var(--text-0); background: var(--surface-4); }
</style>
