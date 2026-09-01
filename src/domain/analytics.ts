import type { DerivedCampaign, SessionOutcome, WorldState } from './types'
import { DAY_MS } from './utils'

export interface DailyLearningPoint {
  day: string
  label: string
  minutes: number
  achieved: number
}

export interface WeakTerritoryInsight {
  nodeId: string
  title: string
  campaignTitle: string
  stability: number
  failures: number
}

export interface LearningAnalytics {
  last7Minutes: number
  previous7Minutes: number
  trendPercent: number
  achievedRate: number
  dueNext7Days: number
  overdueCount: number
  currentStreak: number
  daily: DailyLearningPoint[]
  weakTerritories: WeakTerritoryInsight[]
}

function localDayKey(value: string, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date(value))
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ''
    return `${part('year')}-${part('month')}-${part('day')}`
  } catch {
    return value.slice(0, 10)
  }
}

function sessionMinutes(seconds: number): number {
  return Math.max(1, Math.ceil(seconds / 60))
}

function shiftDayKey(dayKey: string, days: number): string {
  const date = new Date(`${dayKey}T12:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function getLearningAnalytics(
  world: WorldState,
  campaigns: DerivedCampaign[],
  now = new Date().toISOString()
): LearningAnalytics {
  const nowMs = new Date(now).getTime()
  const timezone = world.profile.timezone || 'Asia/Hong_Kong'
  const start7 = nowMs - 7 * DAY_MS
  const start14 = nowMs - 14 * DAY_MS
  const settled = world.sessions.filter((session) => session.status === 'settled' && session.endedAt)
  const sumBetween = (start: number, end: number) => settled
    .filter((session) => {
      const time = new Date(session.endedAt!).getTime()
      return time >= start && time < end
    })
    .reduce((total, session) => total + sessionMinutes(session.accumulatedSeconds), 0)
  const last7Minutes = sumBetween(start7, nowMs + 1)
  const previous7Minutes = sumBetween(start14, start7)
  const achieved = settled.filter((session) => session.outcome === 'achieved').length

  const daily: DailyLearningPoint[] = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(nowMs - (6 - index) * DAY_MS)
    const key = localDayKey(date.toISOString(), timezone)
    const sessions = settled.filter((session) => localDayKey(session.endedAt!, timezone) === key)
    return {
      day: key,
      label: `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`,
      minutes: sessions.reduce((total, session) => total + sessionMinutes(session.accumulatedSeconds), 0),
      achieved: sessions.filter((session) => session.outcome === 'achieved').length
    }
  })

  const studyDays = new Set(settled.map((session) => localDayKey(session.endedAt!, timezone)))
  let currentStreak = 0
  let streakDay = localDayKey(now, timezone)
  if (!studyDays.has(streakDay)) streakDay = shiftDayKey(streakDay, -1)
  while (studyDays.has(streakDay)) {
    currentStreak += 1
    streakDay = shiftDayKey(streakDay, -1)
  }

  const activeNodes = campaigns.filter((campaign) => campaign.status !== 'archived').flatMap((campaign) => campaign.nodes.map((node) => ({ campaign, node })))
  const failureByNode = new Map<string, number>()
  settled.forEach((session) => {
    if ((session.outcome as SessionOutcome) === 'achieved') return
    failureByNode.set(session.nodeId, (failureByNode.get(session.nodeId) ?? 0) + 1)
  })
  const weakTerritories = activeNodes
    .filter(({ node }) => node.effectiveOwner === 'self' || (failureByNode.get(node.id) ?? 0) > 0)
    .map(({ campaign, node }) => ({
      nodeId: node.id,
      title: node.title,
      campaignTitle: campaign.title,
      stability: node.effectiveStability,
      failures: failureByNode.get(node.id) ?? 0
    }))
    .sort((a, b) => (a.stability + a.failures * -15) - (b.stability + b.failures * -15))
    .slice(0, 5)

  return {
    last7Minutes,
    previous7Minutes,
    trendPercent: previous7Minutes ? Math.round((last7Minutes - previous7Minutes) / previous7Minutes * 100) : last7Minutes ? 100 : 0,
    achievedRate: settled.length ? Math.round(achieved / settled.length * 100) : 0,
    dueNext7Days: activeNodes.filter(({ node }) => node.review.nextReviewAt && new Date(node.review.nextReviewAt).getTime() > nowMs && new Date(node.review.nextReviewAt).getTime() <= nowMs + 7 * DAY_MS).length,
    overdueCount: activeNodes.filter(({ node }) => node.overdue || node.effectiveState === 'lost' || node.effectiveState === 'contested').length,
    currentStreak,
    daily,
    weakTerritories
  }
}
