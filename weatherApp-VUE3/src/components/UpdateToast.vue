<script setup>
import { useAppUpdate } from '@/composables/useAppUpdate'

const { hasUpdate, remoteLabel, status, applyUpdate, dismiss } = useAppUpdate()
</script>

<template>
  <Transition name="update-toast">
    <div
      v-if="hasUpdate"
      class="update-toast"
      role="dialog"
      aria-label="应用更新提示"
    >
      <div class="update-toast-text">
        <strong>发现新版本 {{ remoteLabel }}</strong>
        <span>是否立即更新？</span>
      </div>
      <div class="update-toast-actions">
        <button type="button" class="update-later" @click="dismiss">稍后</button>
        <button
          type="button"
          class="update-now"
          :disabled="status === 'updating'"
          @click="applyUpdate"
        >
          {{ status === 'updating' ? '更新中…' : '立即更新' }}
        </button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.update-toast {
  position: fixed;
  z-index: 1200;
  right: 16px;
  bottom: calc(16px + env(safe-area-inset-bottom, 0px));
  display: flex;
  width: min(340px, calc(100vw - 32px));
  flex-direction: column;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid var(--line-2);
  border-radius: var(--radius-lg);
  color: var(--text-0);
  background: rgba(12, 20, 34, 0.96);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(18px);
  pointer-events: auto;
}
.update-toast-text { display: flex; flex-direction: column; gap: 4px; }
.update-toast-text strong { font-size: 0.9375rem; font-weight: 600; }
.update-toast-text span { font-size: 0.8125rem; color: var(--text-5); }
.update-toast-actions { display: flex; justify-content: flex-end; gap: 8px; }
.update-toast-actions button {
  padding: 8px 14px;
  border: 1px solid var(--line-1);
  border-radius: 999px;
  color: var(--text-3);
  background: var(--surface-3);
  font: inherit;
  font-size: 0.8125rem;
  cursor: pointer;
}
.update-toast-actions button:hover:not(:disabled) { color: var(--text-0); background: var(--surface-5); }
.update-toast-actions .update-now {
  border-color: transparent;
  color: #06121e;
  background: var(--accent-bright, #7fd4f5);
  font-weight: 600;
}
.update-toast-actions .update-now:disabled { opacity: 0.55; cursor: default; }
.update-toast-enter-active, .update-toast-leave-active { transition: opacity .22s ease, transform .22s ease; }
.update-toast-enter-from, .update-toast-leave-to { opacity: 0; transform: translateY(12px); }
@media (prefers-reduced-motion: reduce) {
  .update-toast-enter-active, .update-toast-leave-active { transition-duration: .01ms; }
}
</style>
