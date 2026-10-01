import type { WorldState } from '../domain/types'
import { validateCampaignMap } from '../domain/map-planning'

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
function text(value: unknown): value is string { return typeof value === 'string' }
function finite(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}
function date(value: unknown): boolean { return text(value) && Number.isFinite(Date.parse(value)) }
function oneOf(value: unknown, values: string[]): boolean { return text(value) && values.includes(value) }
function uniqueIds(items: Array<{ id: string }>, label: string): Set<string> {
  const ids = new Set<string>()
  for (const item of items) {
    requireValue(item && text(item.id) && item.id.length > 0 && !ids.has(item.id), `${label}标识无效或重复。`)
    ids.add(item.id)
  }
  return ids
}

export function assertNormalizedWorld(world: WorldState): void {
  const profile = world.profile
  requireValue(profile && text(profile.id) && text(profile.displayName) && text(profile.timezone) && finite(profile.dailyTroops, 15, 240), '指挥官资料不完整。')
  requireValue(world.campaigns.length <= 100 && world.sessions.length <= 50_000 && world.evidence.length <= 50_000 && world.events.length <= 100_000, '存档记录数量超过安全限制。')
  const campaignIds = uniqueIds(world.campaigns, '战役')
  const nodeCampaign = new Map<string, string>()
  for (const campaign of world.campaigns) {
    requireValue(text(campaign.title) && text(campaign.goal) && text(campaign.capitalCriteria) && date(campaign.createdAt), '战役资料不完整。')
    requireValue(oneOf(campaign.status, ['active', 'archived', 'victorious']) && oneOf(campaign.templateType, ['operating-system', 'language', 'exam', 'stem']) && finite(campaign.dailyTroops, 15, 240), '战役状态或兵力无效。')
    requireValue(Array.isArray(campaign.nodes) && Array.isArray(campaign.edges) && campaign.nodes.length <= 100 && campaign.edges.length <= 10_000, '战役版图无效。')
    uniqueIds(campaign.nodes, '城池')
    uniqueIds(campaign.edges, '道路')
    for (const node of campaign.nodes) {
      requireValue(!nodeCampaign.has(node.id) && node.campaignId === campaign.id, '城池标识重复或引用了不存在的战役。')
      nodeCampaign.set(node.id, campaign.id)
      requireValue([node.title, node.description, node.region, node.templateKey, node.victoryCriteria].every(text), '城池资料不完整。')
      requireValue(oneOf(node.owner, ['self', 'enemy', 'rebel']) && oneOf(node.originOwner, ['self', 'enemy']) && oneOf(node.state, ['locked', 'available', 'sieging', 'controlled', 'contested', 'lost']), '城池状态无效。')
      requireValue(oneOf(node.kind, ['city', 'fortress', 'regional_capital', 'capital']) && oneOf(node.role, ['outpost', 'regional_capital', 'campaign_capital']), '城池类型无效。')
      requireValue(finite(node.estimatedMinutes, 1) && finite(node.accumulatedMinutes) && (node.scoreTarget == null || finite(node.scoreTarget)), '城池投入或分数无效。')
      requireValue(node.position && finite(node.position.x, 0, 100) && finite(node.position.y, 0, 100), '城池坐标无效。')
      requireValue(!node.tacticalPosition || (finite(node.tacticalPosition.x, 0, 100) && finite(node.tacticalPosition.y, 0, 100)), '据点坐标无效。')
      requireValue(node.review && finite(node.review.baseStability, 0, 100) && finite(node.review.step) && finite(node.review.intervalDays, 1, 90) && finite(node.review.ease, 0, 10) && finite(node.review.successfulReviews) && finite(node.review.lapses), '复习数据无效。')
      requireValue(node.review.nextReviewAt == null || date(node.review.nextReviewAt), '复习日期无效。')
    }
    for (const edge of campaign.edges) {
      requireValue(edge.campaignId === campaign.id && nodeCampaign.get(edge.from) === campaign.id && nodeCampaign.get(edge.to) === campaign.id && oneOf(edge.kind, ['hard', 'soft']), '道路引用了不存在的城池或类型无效。')
    }
    const invalidMap = validateCampaignMap(campaign).find((issue) => issue.severity === 'error')
    requireValue(!invalidMap, invalidMap?.message ?? '版图结构无效。')
  }
  const sessionIds = uniqueIds(world.sessions, '学习记录')
  const sessions = new Map(world.sessions.map((session) => [session.id, session]))
  for (const session of world.sessions) {
    requireValue(campaignIds.has(session.campaignId) && nodeCampaign.get(session.nodeId) === session.campaignId, '学习记录引用了不存在的战役或城池。')
    requireValue(oneOf(session.mode, ['attack', 'review', 'recover']) && oneOf(session.status, ['planned', 'active', 'paused', 'settled', 'abandoned']), '学习记录状态无效。')
    requireValue(finite(session.accumulatedSeconds) && Number.isInteger(session.accumulatedSeconds) && finite(session.plannedMinutes, 1, 240), '学习计时无效。')
    requireValue(date(session.scheduledAt) && [session.startedAt, session.lastResumedAt, session.pausedAt, session.endedAt].every((value) => value == null || date(value)), '学习记录日期无效。')
    requireValue(session.status !== 'active' || date(session.lastResumedAt), '进行中行动缺少计时起点。')
    requireValue(session.status !== 'settled' || (date(session.endedAt) && oneOf(session.outcome, ['achieved', 'partial', 'failed'])), '已结算行动缺少战果。')
    requireValue(Array.isArray(session.evidenceIds) && session.evidenceIds.every(text) && new Set(session.evidenceIds).size === session.evidenceIds.length, '学习记录的成果清单无效。')
    requireValue(session.score == null || finite(session.score), '学习分数无效。')
    if (session.secondsByDay != null) {
      requireValue(typeof session.secondsByDay === 'object' && !Array.isArray(session.secondsByDay), '每日计时无效。')
      const entries = Object.entries(session.secondsByDay)
      requireValue(entries.every(([day, seconds]) => /^\d{4}-\d{2}-\d{2}$/.test(day) && date(day) && finite(seconds) && Number.isInteger(seconds)), '每日计时无效。')
      requireValue(entries.reduce((sum, [, seconds]) => sum + seconds, 0) === session.accumulatedSeconds, '每日计时与总时长不一致。')
    }
    if (session.draft != null) {
      const draft = session.draft
      requireValue(text(draft.note) && draft.note.length <= 500 && text(draft.link) && draft.link.length <= 4096 && text(draft.score) && draft.score.length <= 32, '成果草稿内容无效。')
      requireValue(oneOf(draft.outcome, ['achieved', 'partial', 'failed']) && oneOf(draft.reviewRating, ['again', 'hard', 'good', 'easy']), '成果草稿状态无效。')
      requireValue(Array.isArray(draft.images) && draft.images.length <= 3 && draft.images.every((image) => text(image) && image.length <= 8 * 1024 * 1024), '成果草稿图片无效。')
    }
    if (session.reward) requireValue(finite(session.reward.coins) && finite(session.reward.merit) && finite(session.reward.randomBonus) && Array.isArray(session.reward.breakdown) && session.reward.breakdown.every(text), '行动军饷无效。')
  }
  const evidenceIds = uniqueIds(world.evidence, '成果证据')
  const evidenceSessions = new Map(world.evidence.map((item) => [item.id, item.sessionId]))
  for (const evidence of world.evidence) {
    requireValue(sessionIds.has(evidence.sessionId), '成果证据引用了不存在的学习记录。')
    requireValue(oneOf(evidence.type, ['text', 'link', 'image']) && text(evidence.content) && evidence.content.length <= 8 * 1024 * 1024 && date(evidence.createdAt), '成果证据内容或日期无效。')
    requireValue(sessions.get(evidence.sessionId)!.evidenceIds.includes(evidence.id), '成果证据与学习记录不一致。')
  }
  for (const session of world.sessions) {
    for (const id of session.evidenceIds) requireValue(evidenceIds.has(id) && evidenceSessions.get(id) === session.id, '学习记录引用了不存在的成果证据。')
  }
  uniqueIds(world.events, '战史')
  for (const event of world.events) requireValue(text(event.title) && text(event.detail) && date(event.occurredAt) && oneOf(event.type, ['campaign_created', 'session_planned', 'session_started', 'siege_progress', 'territory_captured', 'territory_reviewed', 'territory_recovered', 'truce_started', 'map_edited', 'campaign_archived']), '战史资料无效。')
  const rewards = world.rewards
  requireValue(finite(rewards.coins) && finite(rewards.merit), '国库余额无效。')
  uniqueIds(rewards.items, '犒赏')
  uniqueIds(rewards.transactions, '军饷流水')
  uniqueIds(rewards.redemptions, '兑换记录')
  for (const item of rewards.items) requireValue(text(item.title) && text(item.description) && finite(item.cost, 1) && date(item.createdAt), '犒赏资料无效。')
  for (const item of rewards.transactions) requireValue(text(item.title) && text(item.detail) && finite(item.coinDelta, -Number.MAX_SAFE_INTEGER) && finite(item.meritDelta, -Number.MAX_SAFE_INTEGER) && date(item.createdAt), '军饷流水无效。')
  for (const item of rewards.redemptions) requireValue(text(item.title) && finite(item.cost, 1) && date(item.redeemedAt), '兑换记录无效。')
  if (world.mapHistories != null) {
    requireValue(Array.isArray(world.mapHistories) && world.mapHistories.length <= 100, '版图历史无效。')
    for (const history of world.mapHistories) {
      const campaign = world.campaigns.find((item) => item.id === history?.campaignId)
      requireValue(campaign && Array.isArray(history.past) && Array.isArray(history.future) && history.past.length <= 12 && history.future.length <= 12, '版图历史引用或长度无效。')
      for (const snapshot of [...history.past, ...history.future]) {
        requireValue(snapshot && text(snapshot.label) && date(snapshot.createdAt), '版图历史资料无效。')
        assertNormalizedWorld({ ...world, campaigns: [{ ...campaign, nodes: snapshot.nodes, edges: snapshot.edges }], sessions: [], evidence: [], events: [], mapHistories: [] })
      }
    }
  }
}
