import type { Campaign, WorldState } from './types'
import { localDayKey } from './utils'
import { sessionSecondsByDay } from './session-time'

export const ASSAULT_DEADLINE = '2026-11-21T00:00:00+08:00'
export const ASSAULT_REQUIRED_MINUTES = 4200
export function isAssault(campaign: Campaign): boolean {
  return campaign.mode === 'assault' || (campaign.templateType === 'tour-guide' && campaign.mode == null)
}
export function assertCampaignOpen(campaign: Campaign, now: string): void {
  if (campaign.status === 'archived') throw new Error('战役已归档。')
  if (isAssault(campaign) && Date.parse(now) >= Date.parse(ASSAULT_DEADLINE)) throw new Error('考试截止时间已到，突击战役不能再补交学习成果。')
}
export function assaultProgress(world: WorldState, campaign: Campaign, now: string) {
  const today = localDayKey(now, world.profile.timezone)
  let seconds = 0
  let todaySeconds = 0
  for (const session of world.sessions) {
    if (session.campaignId !== campaign.id || session.status !== 'settled' || !session.endedAt || Date.parse(session.endedAt) >= Date.parse(ASSAULT_DEADLINE)) continue
    seconds += session.accumulatedSeconds
    todaySeconds += sessionSecondsByDay(session, world.profile.timezone)[today] ?? 0
  }
  return { seconds, todaySeconds, remainingMinutes: Math.max(0, ASSAULT_REQUIRED_MINUTES - Math.floor(seconds / 60)) }
}
