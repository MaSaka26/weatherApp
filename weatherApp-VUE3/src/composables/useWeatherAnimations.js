import { inject, unref, watch } from 'vue'

import { TWEEN_START_AT, useTween } from '@/composables/useTween'
import { shouldRestartOnEpoch } from '@/utils/gaugeRestart'

function readSource(source) {
  const value = typeof source === 'function' ? source() : unref(source)
  return Number.isFinite(value) ? value : null
}

/** Animate a displayed weather number from its current value to the latest API value. */
export function useAnimatedNumber(
  source,
  { duration = 1000, initialValue = 0, emptyValue = 0, restartOnEpoch = false } = {},
) {
  const { shown, tween, restart } = useTween(duration, initialValue)
  const epoch = inject(TWEEN_START_AT, null)
  let previousValue
  let previousEpoch = epoch?.value ?? null

  watch(
    () => [readSource(source), epoch?.value ?? null],
    ([value, currentEpoch]) => {
      const valueChanged = value !== previousValue
      const epochChanged = Number.isFinite(currentEpoch) && currentEpoch !== previousEpoch
      const hadPriorEpoch = Number.isFinite(previousEpoch)
      const shouldRestart = shouldRestartOnEpoch({
        restartOnEpoch,
        epochChanged,
        hadPriorEpoch,
        value,
      })
      previousValue = value
      previousEpoch = currentEpoch

      if (shouldRestart) {
        restart(value, initialValue, currentEpoch)
        return
      }
      // epoch 变化但数值没变时，普通数字无需空跑一段相同值补间。
      if (!valueChanged && epochChanged) return
      tween(value ?? emptyValue)
    },
    { immediate: true },
  )

  return { value: shown }
}

/** Animate a gauge's normalized 0–1 fill, independent of its physical unit/range. */
export function useRingProgress(
  source,
  min = 0,
  max = 100,
  { duration = 1000, restartOnEpoch = true } = {},
) {
  const progress = () => {
    const value = readSource(source)
    const lower = readSource(min)
    const upper = readSource(max)
    if (value == null || lower == null || upper == null || upper <= lower) return null
    return Math.min(1, Math.max(0, (value - lower) / (upper - lower)))
  }

  return useAnimatedNumber(progress, { duration, initialValue: 0, restartOnEpoch })
}

/** Animate a pointer angle; its first move can be forced clockwise from its resting angle. */
export function usePointerRotation(
  source,
  { duration = 1000, initialAngle = 0, firstDirection = 'clockwise' } = {},
) {
  const { shown, tween } = useTween(duration, initialAngle)
  let firstTarget = true

  watch(
    () => readSource(source),
    (target) => {
      if (target == null) return

      const current = shown.value
      let next = target
      if (firstTarget) {
        firstTarget = false
        if (firstDirection === 'clockwise') {
          next = current + modulo(target - current, 360)
        }
      } else {
        const delta = modulo(target - current + 180, 360) - 180
        next = current + (delta === -180 ? 180 : delta)
      }

      tween(next)
    },
    { immediate: true },
  )

  return { angle: shown }
}

/** Animate a 0–1 progress value used by straight or curved paths. */
export function usePathProgress(source, { duration = 1000, restartOnEpoch = false } = {}) {
  const progress = () => {
    const value = readSource(source)
    return value == null ? null : Math.min(1, Math.max(0, value))
  }

  return useAnimatedNumber(progress, { duration, initialValue: 0, restartOnEpoch })
}

function modulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor
}
