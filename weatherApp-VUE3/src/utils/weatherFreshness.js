export const DEFAULT_STALE_AFTER_MS = 15 * 60 * 1000

export function isWeatherStale(
  hasWeatherData,
  lastSuccessAt,
  now = Date.now(),
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
) {
  if (!hasWeatherData || !Number.isFinite(lastSuccessAt) || lastSuccessAt <= 0) return false
  return Math.max(0, now - lastSuccessAt) >= staleAfterMs
}
