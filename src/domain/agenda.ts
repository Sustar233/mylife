import type { DerivedCampaign, SessionMode, WorldState } from './types'
import { HOUR_MS } from './utils'

export type AgendaItemKind = 'active' | 'overdue' | 'due' | 'frontline'

export interface AgendaItem {
  id: string
  kind: AgendaItemKind
  campaignId: string
  nodeId: string
  title: string
  campaignTitle: string
  detail: string
  scheduledAt: string
  minutes: number
  mode: SessionMode
  urgency: number
}

export function getTodayAgenda(
  world: WorldState,
  campaigns: DerivedCampaign[],
  now = new Date().toISOString()
): AgendaItem[] {
  const current = new Date(now).getTime()
  const dueSoonHours = world.profile.reminders?.dueSoonHours ?? 48
  const dueLimit = current + dueSoonHours * HOUR_MS
  const activeCampaigns = campaigns.filter((campaign) => campaign.status !== 'archived')
  const items: AgendaItem[] = []

  world.sessions
    .filter((session) => session.status === 'active' || session.status === 'paused' || (session.status === 'planned' && new Date(session.scheduledAt).getTime() <= dueLimit))
    .forEach((session) => {
      const campaign = activeCampaigns.find((item) => item.id === session.campaignId)
      const node = campaign?.nodes.find((item) => item.id === session.nodeId)
      if (!campaign || !node) return
      items.push({
        id: `session:${session.id}`,
        kind: 'active',
        campaignId: campaign.id,
        nodeId: node.id,
        title: node.title,
        campaignTitle: campaign.title,
        detail: session.status === 'active' ? '前线计时中' : session.status === 'paused' ? '行动已暂停' : '已列入今日计划',
        scheduledAt: session.scheduledAt,
        minutes: session.plannedMinutes,
        mode: session.mode,
        urgency: 100
      })
    })

  activeCampaigns.forEach((campaign) => {
    campaign.nodes.forEach((node) => {
      const due = node.review.nextReviewAt ? new Date(node.review.nextReviewAt).getTime() : Number.POSITIVE_INFINITY
      if (node.effectiveState === 'lost' || node.effectiveState === 'contested' || due <= dueLimit) {
        const lost = node.effectiveState === 'lost'
        const overdue = due <= current || node.overdue
        items.push({
          id: `node:${node.id}`,
          kind: lost || overdue ? 'overdue' : 'due',
          campaignId: campaign.id,
          nodeId: node.id,
          title: node.title,
          campaignTitle: campaign.title,
          detail: lost ? '失地待收复' : overdue ? '复习已到期' : `${dueSoonHours} 小时内需要防守`,
          scheduledAt: Number.isFinite(due) ? new Date(due).toISOString() : now,
          minutes: lost ? 25 : 15,
          mode: lost ? 'recover' : 'review',
          urgency: lost ? 95 : overdue ? 90 : 70
        })
      }
    })
  })

  // 进行中的行动会占用唯一前线席位，此时不应再推荐一个无法真正启动的新目标。
  if (items.length === 0) {
    const frontline = activeCampaigns
      .flatMap((campaign) => campaign.nodes.map((node) => ({ campaign, node })))
      .find(({ node }) => node.effectiveState === 'available' || node.effectiveState === 'sieging')
    if (frontline) {
      items.push({
        id: `node:${frontline.node.id}`,
        kind: 'frontline',
        campaignId: frontline.campaign.id,
        nodeId: frontline.node.id,
        title: frontline.node.title,
        campaignTitle: frontline.campaign.title,
        detail: '今日可推进前线',
        scheduledAt: now,
        minutes: 25,
        mode: 'attack',
        urgency: 40
      })
    }
  }

  return items
    .filter((item, index, array) => array.findIndex((candidate) => candidate.nodeId === item.nodeId) === index)
    .sort((a, b) => b.urgency - a.urgency || new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
    .slice(0, 8)
}

export function getReminderCount(world: WorldState, campaigns: DerivedCampaign[], now = new Date().toISOString()): number {
  if (world.profile.reminders?.enabled === false) return 0
  let currentHour = new Date(now).getHours()
  try {
    currentHour = Number(new Intl.DateTimeFormat('en-US', {
      timeZone: world.profile.timezone || 'Asia/Hong_Kong',
      hour: '2-digit',
      hourCycle: 'h23'
    }).format(new Date(now)))
  } catch {
    // 旧运行环境不支持时区格式化时使用设备本地时间。
  }
  const briefHour = world.profile.reminders?.dailyBriefHour ?? 8
  return getTodayAgenda(world, campaigns, now)
    .filter((item) => item.kind === 'overdue' || (item.kind === 'due' && currentHour >= briefHour))
    .length
}
