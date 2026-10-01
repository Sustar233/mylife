export const DAY_MS = 24 * 60 * 60 * 1000
export const HOUR_MS = 60 * 60 * 1000

const dayFormatters = new Map<string, Intl.DateTimeFormat | null>()

/** 按日历日期分桶，复用格式器，避免历史记录越多开销越大。 */
export function localDayKey(value: string, timezone: string): string {
  if (!dayFormatters.has(timezone)) {
    if (dayFormatters.size >= 8) dayFormatters.clear()
    try {
      dayFormatters.set(timezone, new Intl.DateTimeFormat('en-US', {
        timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'
      }))
    } catch {
      dayFormatters.set(timezone, null)
    }
  }
  try {
    const parts = dayFormatters.get(timezone)?.formatToParts(new Date(value))
    if (parts) {
      const part = (type: string) => parts.find((item) => item.type === type)?.value ?? ''
      return `${part('year')}-${part('month')}-${part('day')}`
    }
  } catch {
    // 兼容不支持 Intl 或旧存档中的无效日期。
  }
  return value.slice(0, 10)
}

export function shiftDayKey(dayKey: string, days: number): string {
  const date = new Date(`${dayKey}T12:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
}

export function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * DAY_MS).toISOString()
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const seconds = safe % 60
  if (hours > 0) return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

export function formatCompactDate(iso?: string): string {
  if (!iso) return '尚未安排'
  const date = new Date(iso)
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

export function formatDateTime(iso?: string): string {
  if (!iso) return '—'
  const date = new Date(iso)
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  const hour = `${date.getHours()}`.padStart(2, '0')
  const minute = `${date.getMinutes()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day} ${hour}:${minute}`
}

export function isValidUrl(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value.trim())
}
