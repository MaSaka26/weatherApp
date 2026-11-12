<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { lookupPlace } from '@/utils/placeLookup'
import { buildFavoriteGroups } from '@/utils/favoriteGroups'

const props = defineProps({ cities: { type: Array, default: () => [] } })
const emit = defineEmits(['select', 'remove', 'locate'])

const open = ref(false)
const trigger = ref(null)
const menu = ref(null)
const menuWidth = ref('300px')

const selectedKeys = ref([])
const confirmOpen = ref(false)
const cancelBtn = ref(null)

function keyOf(place) {
  return place.lat + ',' + place.lon
}

// 分组：显式 countryCode 优先；旧收藏没有 code 时按本地行政区表兜底，
// 与 store.inferCountryCode / 城市预警的「仅国内」判定保持一致。
function isDomestic(place) {
  if (place.countryCode === 'CN') return true
  if (place.countryCode && place.countryCode !== 'CN') return false
  if (!Number.isFinite(place.lat) || !Number.isFinite(place.lon)) return false
  return Boolean(lookupPlace(place.lat, place.lon)?.level)
}

function isSelected(place) {
  return selectedKeys.value.includes(keyOf(place))
}

function groupAriaLabel(group) {
  return '全选' + group.label + '城市'
}

function cityAriaLabel(place) {
  return '选择' + place.name
}

const selectedPlaces = computed(() => props.cities.filter(isSelected))
const selectedCount = computed(() => selectedPlaces.value.length)

// 分类只依赖收藏列表本身。lookupPlace 是 O(行政区数) 的查表，若放进 groups
// 里，每次勾选都会把 12 个城市重查一遍造成卡顿，故单独缓存。
const classified = computed(() => {
  const domestic = []
  const foreign = []
  for (const place of props.cities) {
    if (isDomestic(place)) domestic.push(place)
    else foreign.push(place)
  }
  return { domestic, foreign }
})

// 只展示确实有收藏城市的分组（空分类由 buildFavoriteGroups 过滤掉），
// 再叠加每个分组的多选全选 / 半选状态。
const groups = computed(() => buildFavoriteGroups(
  classified.value.domestic,
  classified.value.foreign,
).map((group) => {
  const chosen = group.cities.filter(isSelected).length
  return {
    ...group,
    all: group.cities.length > 0 && chosen === group.cities.length,
    some: chosen > 0 && chosen < group.cities.length,
  }
}))

function toggleCity(place) {
  const key = keyOf(place)
  selectedKeys.value = isSelected(place)
    ? selectedKeys.value.filter((item) => item !== key)
    : [...selectedKeys.value, key]
}

// 大类多选框：已全选时再次点击取消全选；未全选（含半选）时点击即全选该组子类。
function toggleGroup(cities) {
  const keys = cities.map(keyOf)
  const all = keys.length > 0 && keys.every((key) => selectedKeys.value.includes(key))
  selectedKeys.value = all
    ? selectedKeys.value.filter((key) => !keys.includes(key))
    : [...new Set([...selectedKeys.value, ...keys])]
}

function openConfirm() {
  confirmOpen.value = true
  nextTick(() => cancelBtn.value?.focus())
}

function confirmDelete() {
  const places = selectedPlaces.value
  if (!places.length) {
    confirmOpen.value = false
    return
  }
  emit('remove', places)
  selectedKeys.value = []
  confirmOpen.value = false
}

function fitMenuToViewport() {
  if (!open.value) return
  nextTick(() => {
    if (!trigger.value) return
    const available = window.innerWidth - trigger.value.getBoundingClientRect().left - 16
    menuWidth.value = Math.max(0, Math.min(300, available)) + 'px'
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
  if (event.key !== 'Escape') return
  if (confirmOpen.value) confirmOpen.value = false
  else open.value = false
}

// 关闭下拉时清空勾选与确认框，避免下次打开残留上一次的选择。
watch(open, (isOpen) => {
  if (!isOpen) {
    confirmOpen.value = false
    selectedKeys.value = []
  }
})
// 勾选被清空后，确认框不应继续挂在那儿。
watch(selectedCount, (count) => {
  if (count === 0) confirmOpen.value = false
})

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
        <div class="cc-heading">常用城市</div>

        <div class="cc-scroll">
          <template v-if="cities.length">
            <section v-for="group in groups" :key="group.key" class="cc-group">
              <div class="cc-group-head">
                <input
                  class="cc-checkbox"
                  :class="{ 'is-checked': group.all, 'is-mixed': group.some }"
                  type="checkbox"
                  :checked="group.all"
                  :indeterminate="group.some"
                  :aria-checked="group.some ? 'mixed' : group.all"
                  :disabled="!group.cities.length"
                  :aria-label="groupAriaLabel(group)"
                  @change="toggleGroup(group.cities)"
                />
                <span class="cc-group-label">{{ group.label }}</span>
                <span class="cc-group-count">{{ group.cities.length }}</span>
              </div>
              <div class="cc-group-rows">
                <div v-for="place in group.cities" :key="keyOf(place)" class="cc-row">
                  <input
                    class="cc-checkbox"
                    :class="{ 'is-checked': isSelected(place) }"
                    type="checkbox"
                    :checked="isSelected(place)"
                    :aria-label="cityAriaLabel(place)"
                    @change="toggleCity(place)"
                  />
                  <button class="cc-city" type="button" @click="selectCity(place)">
                    <strong>{{ place.name }}</strong>
                    <small>{{ place.detail || ' ' }}</small>
                  </button>
                </div>
              </div>
            </section>
          </template>
          <p v-else class="cc-empty">搜索并查看城市天气后，会自动加入这里</p>

          <button class="cc-locate" type="button" @click="locate">
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
            </svg>
            使用当前位置
          </button>
        </div>

        <div v-if="selectedCount" class="cc-footer">
          <button
            class="cc-delete"
            type="button"
            aria-haspopup="dialog"
            :aria-expanded="confirmOpen"
            @click="openConfirm"
          >
            删除所选 · {{ selectedCount }}
          </button>

          <div v-if="confirmOpen" class="cc-popconfirm" role="alertdialog" aria-label="删除确认">
            <p>确定删除选中的 {{ selectedCount }} 个城市？</p>
            <div class="cc-popconfirm-actions">
              <button ref="cancelBtn" class="cc-cancel" type="button" @click="confirmOpen = false">取消</button>
              <button class="cc-confirm-del" type="button" @click="confirmDelete">删除</button>
            </div>
            <span class="cc-popconfirm-arrow" aria-hidden="true"></span>
          </div>
        </div>
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
  max-height: min(60vh, 460px);
  display: flex;
  flex-direction: column;
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
.cc-heading { flex: 0 0 auto; padding: 7px 10px 9px; color: var(--text-5); font-size: 0.75rem; }
.cc-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
.cc-group { margin-bottom: 4px; }
.cc-group-head { display: flex; align-items: center; gap: 10px; padding: 8px 8px 6px; }
.cc-group-label { flex: 1; color: var(--text-3); font-size: 0.75rem; font-weight: 600; letter-spacing: .5px; }
.cc-group-count { min-width: 18px; color: var(--text-6); font-size: 0.6875rem; text-align: center; }
.cc-group-rows { padding-left: 4px; }
.cc-row { display: flex; align-items: center; gap: 10px; padding: 2px 8px; border-radius: var(--radius-sm); }
.cc-row:hover, .cc-row:focus-within { background: var(--surface-3); }
.cc-city {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 3px;
  padding: 8px 2px;
  border: 0;
  color: inherit;
  text-align: left;
  background: transparent;
  font: inherit;
  cursor: pointer;
}
.cc-city strong, .cc-city small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cc-city small { color: var(--text-5); font-size: 0.75rem; }

/* 自定义三态多选框：全选 / 半选 / 未选，视觉由 is-checked / is-mixed 驱动，
   :checked / :indeterminate 只负责原生语义与键盘，避免依赖浏览器默认外观。 */
.cc-checkbox {
  appearance: none;
  -webkit-appearance: none;
  position: relative;
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  margin: 0;
  border: 1px solid var(--line-2);
  border-radius: 5px;
  background: var(--surface-2);
  cursor: pointer;
  transition: background .15s ease, border-color .15s ease;
}
.cc-checkbox:disabled { opacity: .4; cursor: default; }
.cc-checkbox.is-checked, .cc-checkbox.is-mixed { background: var(--accent); border-color: var(--accent); }
.cc-checkbox.is-checked::after {
  content: '';
  position: absolute;
  left: 4px;
  top: 1px;
  width: 5px;
  height: 9px;
  border: solid var(--accent-contrast);
  border-width: 0 2px 2px 0;
  transform: rotate(42deg);
}
.cc-checkbox.is-mixed::after {
  content: '';
  position: absolute;
  left: 3px;
  top: 6px;
  width: 8px;
  height: 2px;
  border-radius: 1px;
  background: var(--accent-contrast);
}
.cc-checkbox:focus-visible { outline: 2px solid var(--accent-bright); outline-offset: 2px; }

.cc-empty { margin: 0; padding: 10px; color: var(--text-5); font-size: 0.75rem; line-height: 1.5; }
.cc-locate {
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
.cc-locate:hover, .cc-locate:focus-visible { color: var(--text-0); background: var(--surface-4); }

.cc-footer { position: relative; flex: 0 0 auto; padding-top: 8px; border-top: 1px solid var(--line-1); }
.cc-delete {
  width: 100%;
  padding: 9px 12px;
  border: 0;
  border-radius: var(--radius-sm);
  color: #fff;
  background: #dc5656;
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  transition: background .18s ease, transform .18s ease;
}
.cc-delete:hover, .cc-delete:focus-visible { background: #c74343; }
.cc-delete:active { transform: scale(.98); }

.cc-popconfirm {
  position: absolute;
  z-index: 40;
  right: 0;
  bottom: calc(100% + 10px);
  width: max-content;
  min-width: 208px;
  padding: 12px 14px;
  border: 1px solid var(--line-2);
  border-radius: var(--radius-md);
  color: var(--text-0);
  background: rgba(12, 20, 34, .98);
  box-shadow: 0 14px 40px rgba(0, 0, 0, .5);
  backdrop-filter: blur(12px);
}
.cc-popconfirm p { margin: 0 0 12px; color: var(--text-1); font-size: 0.8125rem; line-height: 1.45; }
.cc-popconfirm-actions { display: flex; justify-content: flex-end; gap: 8px; }
.cc-popconfirm-actions button {
  padding: 7px 14px;
  border: 1px solid var(--line-1);
  border-radius: 999px;
  color: var(--text-3);
  background: var(--surface-3);
  font: inherit;
  font-size: 0.8125rem;
  cursor: pointer;
}
.cc-popconfirm-actions button:hover { color: var(--text-0); background: var(--surface-5); }
.cc-popconfirm-actions .cc-confirm-del { border-color: transparent; color: #fff; background: #dc5656; font-weight: 600; }
.cc-popconfirm-actions .cc-confirm-del:hover { background: #c74343; }
.cc-popconfirm-arrow {
  position: absolute;
  right: 26px;
  bottom: -6px;
  width: 11px;
  height: 11px;
  border-right: 1px solid var(--line-2);
  border-bottom: 1px solid var(--line-2);
  background: rgba(12, 20, 34, .98);
  transform: rotate(45deg);
}
</style>
