<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'

import { searchPlaces } from '@/utils/placeSearch'

const emit = defineEmits(['search', 'select'])

const value = ref('')
const inputEl = ref(null)
const rootEl = ref(null)
const candidates = ref([])
const open = ref(false)
const activeIndex = ref(-1)
const listboxId = 'weather-city-suggest'
const optionId = (index) => `weather-city-option-${index}`

// 本地查表即查即显，不触发天气搜索；自动搜索已按需求取消
function refreshCandidates() {
  const trimmed = value.value.trim()
  candidates.value = trimmed ? searchPlaces(trimmed) : []
  open.value = candidates.value.length > 0
  activeIndex.value = -1
}

function onInput() {
  refreshCandidates()
}

function onFocus() {
  refreshCandidates()
}

function pick(item) {
  // 选中即视为完成一次搜索，输入框清空待下次输入
  value.value = ''
  open.value = false
  activeIndex.value = -1
  emit('select', item)
}

// 点击搜索按钮 / Enter：有候选取高亮（无高亮取第一条），没有候选才按原文走地理编码
function submit() {
  if (open.value && candidates.value.length > 0) {
    pick(candidates.value[activeIndex.value >= 0 ? activeIndex.value : 0])
    return
  }
  const trimmed = value.value.trim()
  if (!trimmed) return
  value.value = ''
  open.value = false
  activeIndex.value = -1
  emit('search', trimmed)
}

function onKeydown(e) {
  if (e.key === 'Escape') {
    open.value = false
    activeIndex.value = -1
    return
  }
  if (e.key === 'ArrowDown' && !open.value) {
    refreshCandidates()
  }
  if (!open.value || candidates.value.length === 0) return
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    activeIndex.value = (activeIndex.value + 1) % candidates.value.length
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    activeIndex.value =
      activeIndex.value <= 0 ? candidates.value.length - 1 : activeIndex.value - 1
  }
}

function clear() {
  value.value = ''
  open.value = false
  candidates.value = []
  activeIndex.value = -1
  inputEl.value?.focus()
}

function onDocPointerDown(e) {
  if (rootEl.value && !rootEl.value.contains(e.target)) {
    open.value = false
    activeIndex.value = -1
  }
}

onMounted(() => document.addEventListener('pointerdown', onDocPointerDown))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocPointerDown))
</script>

<template>
  <div ref="rootEl" class="search-section">
    <div class="search-wrapper">
      <button type="button" class="search-icon" aria-label="搜索" @click="submit">🔍</button>
      <input
        ref="inputEl"
        v-model="value"
        class="search-input"
        type="text"
        placeholder="搜索城市…"
        role="combobox"
        aria-label="搜索城市"
        aria-autocomplete="list"
        :aria-expanded="open && candidates.length > 0"
        :aria-controls="listboxId"
        :aria-activedescendant="activeIndex >= 0 ? optionId(activeIndex) : undefined"
        autocomplete="off"
        @input="onInput"
        @focus="onFocus"
        @keydown="onKeydown"
        @keydown.enter.prevent="submit"
      />
      <button
        class="search-clear"
        :class="{ visible: value.length > 0 }"
        aria-label="清除"
        @click="clear"
      >
        ✕
      </button>

      <ul
        v-if="open && candidates.length"
        :id="listboxId"
        class="search-suggest"
        role="listbox"
        aria-label="城市搜索候选"
      >
        <!-- pointerdown.prevent：抢在输入框 blur 之前完成选中 -->
        <li
          v-for="(item, i) in candidates"
          :key="`${item.path}:${item.level}`"
          class="suggest-item"
          :id="optionId(i)"
          :class="{ active: i === activeIndex }"
          role="option"
          :aria-selected="i === activeIndex"
          @pointerdown.prevent="pick(item)"
          @mouseenter="activeIndex = i"
        >
          <span class="suggest-text" :title="item.path">
            <span v-if="item.parent" class="suggest-parent">{{ item.parent }}-</span>
            <span class="suggest-leaf">{{ item.leaf }}</span>
          </span>
          <span class="suggest-level">{{ item.levelLabel }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>
