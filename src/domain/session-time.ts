import type { StudySession } from './types'
import { DAY_MS, localDayKey } from './utils'

function addInterval(days: Record<string, number>, startMs: number, seconds: number, timezone: string): void {
  if (!Number.isFinite(startMs) || seconds <= 0) return
  let cursor = startMs
  const end = cursor + seconds * 1000
  while (cursor < end) {
    const day = localDayKey(new Date(cursor).toISOString(), timezone)
    let boundary = Math.min(end, cursor + DAY_MS)
    if (localDayKey(new Date(boundary - 1).toISOString(), timezone) !== day) {
      // 查找该时区下一日的第一秒；不假定每个日历日恰好 24 小时。
      let low = 1
      let high = Math.ceil((boundary - cursor) / 1000)
      while (low < high) {
        const mid = Math.floor((low + high) / 2)
        if (localDayKey(new Date(cursor + mid * 1000).toISOString(), timezone) === day) low = mid + 1
        else high = mid
      }
      boundary = Math.min(end, cursor + low * 1000)
    }
    days[day] = (days[day] ?? 0) + Math.round((boundary - cursor) / 1000)
    cursor = boundary
  }
}

export function getSessionActiveSeconds(session: StudySession, now = new Date().toISOString()): number {
  if (session.status !== 'active' || !session.lastResumedAt) return session.accumulatedSeconds
  return session.accumulatedSeconds + Math.max(0, Math.floor((Date.parse(now) - Date.parse(session.lastResumedAt)) / 1000))
}

/** 老存档缺少分日记录，按最后一次计时终点向前估算；新行动按实际活动区间记账。 */
export function sessionSecondsByDay(session: StudySession, timezone: string, now?: string): Record<string, number> {
  const days = { ...session.secondsByDay }
  if (!session.secondsByDay && session.accumulatedSeconds > 0) {
    const end = Date.parse(session.endedAt ?? session.pausedAt ?? session.lastResumedAt ?? session.startedAt ?? session.scheduledAt)
    addInterval(days, end - session.accumulatedSeconds * 1000, session.accumulatedSeconds, timezone)
  }
  if (now && session.status === 'active' && session.lastResumedAt) {
    const seconds = getSessionActiveSeconds(session, now) - session.accumulatedSeconds
    addInterval(days, Date.parse(session.lastResumedAt), seconds, timezone)
  }
  return days
}

export function checkpointSession(session: StudySession, timezone: string, now: string): StudySession {
  return {
    ...session,
    accumulatedSeconds: getSessionActiveSeconds(session, now),
    secondsByDay: sessionSecondsByDay(session, timezone, now)
  }
}
