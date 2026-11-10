/** One requestAnimationFrame clock for all weather gauge and number tweens. */
export function createTweenClock({
  requestFrame = (callback) => requestAnimationFrame(callback),
} = {}) {
  const active = new Set()
  let frameId = 0

  function schedule() {
    if (!frameId && active.size) frameId = requestFrame(tick)
  }

  function tick(now) {
    frameId = 0
    for (const animation of active) {
      const progress = Math.min(1, Math.max(0, (now - animation.startedAt) / animation.duration))
      const eased = 1 - Math.pow(1 - progress, 3)
      animation.update(animation.from + (animation.to - animation.from) * eased)
      if (progress >= 1) active.delete(animation)
    }
    schedule()
  }

  return {
    add(animation) {
      active.add(animation)
      schedule()
    },
    remove(animation) {
      active.delete(animation)
    },
    get size() {
      return active.size
    },
  }
}
