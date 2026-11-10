const formatterCache = new Map()

function getFormatter(timezone) {
  if (!timezone) return null
  if (!formatterCache.has(timezone)) {
    try {
      formatterCache.set(timezone, new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      }))
    } catch {
      formatterCache.set(timezone, null)
    }
  }
  return formatterCache.get(timezone)
}

export function getZonedParts(date, timezone = '') {
  const formatter = getFormatter(timezone)
  if (!formatter) {
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hour: date.getHours(),
      minute: date.getMinutes(),
      second: date.getSeconds(),
    }
  }

  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  )
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  }
}
