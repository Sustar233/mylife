import type { DerivedCampaign, WorldState } from './types'
import { DAY_MS, localDayKey, shiftDayKey } from './utils'

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

function sessionMinutes(seconds: number): number {
  return Math.max(1, Math.ceil(seconds / 60))
}

export function getLearningAnalytics(
  world: WorldState,
  campaigns: DerivedCampaign[],
  now = new Date().toISOString()
): LearningAnalytics {
  const nowMs = new Date(now).getTime()
  const timezone = world.profile.timezone || 'Asia/Hong_Kong'
  const today = localDayKey(now, timezone)
  const start7 = shiftDayKey(today, -6)
  const start14 = shiftDayKey(today, -13)
  const byDay = new Map<string, { minutes: number; achieved: number }>()
  const failureByNode = new Map<string, number>()
  let settledCount = 0
  let achieved = 0
  let last7Minutes = 0
  let previous7Minutes = 0
  for (const session of world.sessions) {
    if (session.status !== 'settled' || !session.endedAt) continue
    const endedMs = new Date(session.endedAt).getTime()
    if (!Number.isFinite(endedMs) || endedMs > nowMs) continue
    const day = localDayKey(session.endedAt, timezone)
    const success = session.outcome === 'achieved' ? 1 : 0
    // 新记录按实际学习日期统计；没有分日记录的历史战报保留原有口径。
    const daySeconds = session.secondsByDay ?? { [day]: session.accumulatedSeconds }
    for (const [studyDay, seconds] of Object.entries(daySeconds)) {
      if (studyDay > today || (session.secondsByDay && seconds === 0)) continue
      const minutes = sessionMinutes(seconds)
      const studyPoint = byDay.get(studyDay) ?? { minutes: 0, achieved: 0 }
      studyPoint.minutes += minutes
      byDay.set(studyDay, studyPoint)
      if (studyDay >= start7) last7Minutes += minutes
      else if (studyDay >= start14) previous7Minutes += minutes
    }
    const point = byDay.get(day) ?? { minutes: 0, achieved: 0 }
    point.achieved += success
    byDay.set(day, point)
    settledCount += 1
    achieved += success
    if (!success) failureByNode.set(session.nodeId, (failureByNode.get(session.nodeId) ?? 0) + 1)
  }

  const daily: DailyLearningPoint[] = Array.from({ length: 7 }, (_, index) => {
    const key = shiftDayKey(today, index - 6)
    const point = byDay.get(key)
    return {
      day: key,
      label: `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`,
      minutes: point?.minutes ?? 0,
      achieved: point?.achieved ?? 0
    }
  })

  let currentStreak = 0
  let streakDay = today
  if (!byDay.has(streakDay)) streakDay = shiftDayKey(streakDay, -1)
  while (byDay.has(streakDay)) {
    currentStreak += 1
    streakDay = shiftDayKey(streakDay, -1)
  }

  const activeNodes = campaigns.filter((campaign) => campaign.status !== 'archived').flatMap((campaign) => campaign.nodes.map((node) => ({ campaign, node })))
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
    achievedRate: settledCount ? Math.round(achieved / settledCount * 100) : 0,
    dueNext7Days: activeNodes.filter(({ node }) => node.review.nextReviewAt && new Date(node.review.nextReviewAt).getTime() > nowMs && new Date(node.review.nextReviewAt).getTime() <= nowMs + 7 * DAY_MS).length,
    overdueCount: activeNodes.filter(({ node }) => node.overdue || node.effectiveState === 'lost' || node.effectiveState === 'contested').length,
    currentStreak,
    daily,
    weakTerritories
  }
}
