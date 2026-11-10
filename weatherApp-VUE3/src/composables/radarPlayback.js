/** Playback controller kept free of DOM and Vue imports so its control behavior can be tested. */
export function createRadarPlayback({ frames, idx, playing, ready, frameMs, showFrame, isAlive = () => true, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timer = null

  function clear() {
    if (timer != null) clearTimer(timer)
    timer = null
  }

  function arm() {
    clear()
    if (!playing.value || !ready.value) return
    timer = setTimer(() => {
      timer = null
      if (!playing.value || !isAlive()) return
      const count = frames.value.length
      if (!count) return
      showFrame((idx.value + 1) % count)
      arm()
    }, frameMs.value)
  }

  function play() {
    if (!ready.value) return
    playing.value = true
    arm()
  }

  function pause() {
    playing.value = false
    clear()
  }

  function toggle() {
    if (playing.value) pause()
    else play()
  }

  function step(delta) {
    const count = frames.value.length
    if (!ready.value || !count) return
    pause()
    showFrame((idx.value + delta + count) % count)
  }

  function slide(value) {
    const next = Number(value)
    if (!ready.value || !Number.isFinite(next)) return
    pause()
    showFrame(Math.max(0, Math.min(frames.value.length - 1, next)))
  }

  return { arm, clear, play, pause, toggle, step, slide }
}
