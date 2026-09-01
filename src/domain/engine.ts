import { getTemplate } from './templates'
import { upgradeCampaignHierarchy } from './regions'
import {
  DEFAULT_NPC_ASSIGNMENTS,
  getNpcCharacterIds,
  normalizeCustomNpcCharacters,
  normalizeNpcAssignments
} from './npcs'
import {
  calculateSessionReward,
  createInitialRewardSystem,
  creditSessionReward,
  upgradeRewardSystem
} from './rewards'
import type {
  Campaign,
  CampaignCreationInput,
  DailyTroopStatus,
  DependencyEdge,
  DerivedCampaign,
  DerivedTerritoryNode,
  Evidence,
  EvidenceDraft,
  ReviewRating,
  ReviewState,
  SessionMode,
  SettlementInput,
  StudySession,
  TerritoryEvent,
  TerritoryNode,
  WorldState
} from './types'
import { DAY_MS, HOUR_MS, addDays, clamp, isValidUrl, makeId } from './utils'

export const REVIEW_INTERVAL_DAYS = [1, 3, 7, 14, 30] as const
export const REVIEW_GRACE_HOURS = 48
export const MAX_ACTIVE_CAMPAIGNS = 3
export const CURRENT_WORLD_VERSION = 3 as const

export function createInitialWorldState(now = new Date().toISOString()): WorldState {
  return {
    version: CURRENT_WORLD_VERSION,
    profile: {
      id: 'local_commander',
      displayName: '指挥官',
      timezone: 'Asia/Hong_Kong',
      dailyTroops: 90,
      reminders: { enabled: true, dueSoonHours: 48, dailyBriefHour: 8 },
      npcAssignments: { ...DEFAULT_NPC_ASSIGNMENTS },
      customNpcCharacters: []
    },
    campaigns: [],
    sessions: [],
    evidence: [],
    mapHistories: [],
    rewards: createInitialRewardSystem(now),
    events: [
      {
        id: makeId('event'),
        type: 'campaign_created',
        title: '知识疆域待命',
        detail: '选择一套战役模板，建立你的第一片知识前线。',
        occurredAt: now
      }
    ]
  }
}

function event(input: Omit<TerritoryEvent, 'id'>): TerritoryEvent {
  return { id: makeId('event'), ...input }
}

export function createCampaignFromTemplate(
  world: WorldState,
  input: CampaignCreationInput,
  now = new Date().toISOString()
): WorldState {
  const activeCount = world.campaigns.filter((campaign) => campaign.status === 'active').length
  if (activeCount >= MAX_ACTIVE_CAMPAIGNS) throw new Error('同时最多进行 3 场战役，请先归档一场。')
  if (!input.title.trim() || !input.goal.trim() || !input.capitalCriteria.trim()) {
    throw new Error('战役名称、最终目标和首都标准不能为空。')
  }

  const template = getTemplate(input.templateType)
  const campaignId = makeId('campaign')
  const imported = new Set(input.importedTemplateKeys)
  const nodeIdByKey = new Map(template.nodes.map((node) => [node.key, `${campaignId}_${node.key}`]))

  const nodes: TerritoryNode[] = template.nodes.map((node) => {
    const isImported = imported.has(node.key) && node.kind !== 'capital'
    const isCapital = node.kind === 'capital'
    return {
      ...node,
      id: nodeIdByKey.get(node.key)!,
      campaignId,
      templateKey: node.key,
      role: isCapital ? 'campaign_capital' : 'outpost',
      victoryCriteria: isCapital ? input.capitalCriteria : node.victoryCriteria,
      scoreTarget: isCapital ? input.capitalScoreTarget : undefined,
      owner: isImported ? 'self' : 'enemy',
      originOwner: isImported ? 'self' : 'enemy',
      state: isImported ? 'controlled' : 'locked',
      accumulatedMinutes: 0,
      review: isImported
        ? { baseStability: 80, nextReviewAt: addDays(now, 7), step: 2, intervalDays: 7, ease: 2.3, successfulReviews: 0, lapses: 0 }
        : { baseStability: 0, step: 0, intervalDays: 1, ease: 2.3, successfulReviews: 0, lapses: 0 }
    }
  })

  const edges = template.edges.map((edge) => ({
    id: makeId('edge'),
    campaignId,
    from: nodeIdByKey.get(edge.from)!,
    to: nodeIdByKey.get(edge.to)!,
    kind: edge.kind ?? 'hard' as const
  }))

  const campaign = upgradeCampaignHierarchy({
    id: campaignId,
    title: input.title.trim(),
    templateType: input.templateType,
    goal: input.goal.trim(),
    capitalCriteria: input.capitalCriteria.trim(),
    capitalScoreTarget: input.capitalScoreTarget,
    dailyTroops: clamp(input.dailyTroops, 15, 240),
    status: 'active',
    createdAt: now,
    nodes,
    edges
  })

  return {
    ...world,
    profile: {
      ...world.profile,
      activeCampaignId: campaignId,
      dailyTroops: campaign.dailyTroops
    },
    campaigns: [...world.campaigns, campaign],
    events: [
      event({
        campaignId,
        type: 'campaign_created',
        title: `${campaign.title}战役开启`,
        detail: `目标：${campaign.goal}`,
        occurredAt: now
      }),
      ...world.events
    ]
  }
}

function effectiveStability(node: TerritoryNode, now: string): { stability: number; overdue: boolean } {
  if (node.owner !== 'self' || !node.review.nextReviewAt) {
    return { stability: node.review.baseStability, overdue: false }
  }

  const due = new Date(node.review.nextReviewAt).getTime()
  const current = new Date(now).getTime()
  const graceEnd = due + REVIEW_GRACE_HOURS * HOUR_MS
  if (current <= graceEnd) return { stability: node.review.baseStability, overdue: false }

  const fullWeeksAfterGrace = Math.floor((current - graceEnd) / (7 * DAY_MS))
  const penalty = 10 * (1 + fullWeeksAfterGrace)
  return {
    stability: clamp(node.review.baseStability - penalty, 0, 100),
    overdue: true
  }
}

export function deriveCampaign(campaign: Campaign, now = new Date().toISOString()): DerivedCampaign {
  const derived = new Map<string, DerivedTerritoryNode>()

  campaign.nodes.forEach((node) => {
    const review = effectiveStability(node, now)
    let effectiveOwner = node.owner
    let effectiveState = node.state

    if (node.owner === 'self') {
      if (review.stability < 30) {
        effectiveOwner = node.originOwner === 'self' ? 'rebel' : 'enemy'
        effectiveState = 'lost'
      } else if (review.overdue) {
        effectiveState = 'contested'
      } else {
        effectiveState = 'controlled'
      }
    }

    derived.set(node.id, {
      ...node,
      effectiveOwner,
      effectiveState,
      effectiveStability: review.stability,
      supplyCut: false,
      effortPercent: clamp(Math.round((node.accumulatedMinutes / Math.max(1, node.estimatedMinutes)) * 100), 0, 99),
      overdue: review.overdue
    })
  })

  const incomingHard = (nodeId: string) => campaign.edges.filter((edge) => edge.kind === 'hard' && edge.to === nodeId)
  const supplyMemo = new Map<string, boolean>()

  function isSupplied(nodeId: string, visiting = new Set<string>()): boolean {
    if (supplyMemo.has(nodeId)) return supplyMemo.get(nodeId)!
    if (visiting.has(nodeId)) return false
    const node = derived.get(nodeId)
    if (!node || node.effectiveOwner !== 'self' || node.effectiveState === 'lost') return false
    const nextVisiting = new Set(visiting).add(nodeId)
    const supplied = incomingHard(nodeId).every((edge) => isSupplied(edge.from, nextVisiting))
    supplyMemo.set(nodeId, supplied)
    return supplied
  }

  derived.forEach((node, id) => {
    const prerequisites = incomingHard(id)
    if (node.effectiveOwner === 'self') {
      node.supplyCut = prerequisites.length > 0 && !isSupplied(id)
      return
    }
    if (node.effectiveState === 'lost') return
    const canAttack = prerequisites.every((edge) => isSupplied(edge.from))
    node.effectiveState = canAttack
      ? node.accumulatedMinutes > 0 ? 'sieging' : 'available'
      : 'locked'
  })

  const nodes = campaign.nodes.map((node) => derived.get(node.id)!)
  const controlledCount = nodes.filter((node) => node.effectiveOwner === 'self').length
  const contestedCount = nodes.filter((node) => node.effectiveState === 'contested' || node.effectiveState === 'lost').length
  const strategicNodes = nodes.filter((node) => node.role === 'regional_capital' || node.role === 'campaign_capital')
  const regionalCapitals = nodes.filter((node) => node.role === 'regional_capital')
  const controlledRegionCount = regionalCapitals.filter((node) => node.effectiveOwner === 'self').length
  const regionCount = regionalCapitals.length
  const controlledStrategicCount = strategicNodes.filter((node) => node.effectiveOwner === 'self').length
  const progressPercent = Math.round((controlledStrategicCount / Math.max(1, strategicNodes.length)) * 100)

  return { ...campaign, nodes, controlledCount, contestedCount, progressPercent, controlledRegionCount, regionCount }
}

export function deriveWorld(world: WorldState, now = new Date().toISOString()): DerivedCampaign[] {
  return world.campaigns.map((campaign) => deriveCampaign(campaign, now))
}

export function findNode(world: WorldState, nodeId: string): { campaign: Campaign; node: TerritoryNode } {
  for (const campaign of world.campaigns) {
    const node = campaign.nodes.find((item) => item.id === nodeId)
    if (node) return { campaign, node }
  }
  throw new Error('未找到目标城池。')
}

export function replaceCampaignNode(world: WorldState, campaignId: string, replacement: TerritoryNode): WorldState {
  return {
    ...world,
    campaigns: world.campaigns.map((campaign) => campaign.id === campaignId
      ? { ...campaign, nodes: campaign.nodes.map((node) => node.id === replacement.id ? replacement : node) }
      : campaign)
  }
}

export function getSessionActiveSeconds(session: StudySession, now = new Date().toISOString()): number {
  if (session.status !== 'active' || !session.lastResumedAt) return session.accumulatedSeconds
  const live = Math.max(0, Math.floor((new Date(now).getTime() - new Date(session.lastResumedAt).getTime()) / 1000))
  return session.accumulatedSeconds + live
}

export function checkpointActiveSessions(world: WorldState, now = new Date().toISOString()): WorldState {
  if (!world.sessions.some((session) => session.status === 'active' && session.lastResumedAt)) return world
  return {
    ...world,
    sessions: world.sessions.map((session) => session.status === 'active' && session.lastResumedAt
      ? { ...session, accumulatedSeconds: getSessionActiveSeconds(session, now), lastResumedAt: now }
      : session)
  }
}

export function pauseInterruptedSessions(world: WorldState, now = new Date().toISOString()): WorldState {
  if (!world.sessions.some((session) => session.status === 'active')) return world
  return {
    ...world,
    sessions: world.sessions.map((session) => {
      if (session.status !== 'active') return session
      const sinceCheckpoint = session.lastResumedAt
        ? Math.max(0, Math.floor((new Date(now).getTime() - new Date(session.lastResumedAt).getTime()) / 1000))
        : 0
      return {
        ...session,
        status: 'paused' as const,
        accumulatedSeconds: session.accumulatedSeconds + Math.min(90, sinceCheckpoint),
        lastResumedAt: undefined,
        pausedAt: now
      }
    })
  }
}

export function planSession(
  world: WorldState,
  nodeId: string,
  plannedMinutes: number,
  mode: SessionMode,
  scheduledAt = new Date().toISOString(),
  sessionId = makeId('session')
): { world: WorldState; session: StudySession } {
  const { campaign } = findNode(world, nodeId)
  const normalizedMinutes = [15, 25, 45, 60].includes(plannedMinutes) ? plannedMinutes : 25
  const troops = getDailyTroopStatus(world, scheduledAt, campaign.dailyTroops)
  if (troops.remainingMinutes < normalizedMinutes) {
    throw new Error(`今日仅剩 ${troops.remainingMinutes} 分钟兵力，次日 00:00 自动恢复。`)
  }
  const derivedNode = deriveCampaign(campaign, scheduledAt).nodes.find((node) => node.id === nodeId)!
  if (derivedNode.effectiveState === 'locked') throw new Error('补给道路尚未打通，不能进攻此城。')
  if (derivedNode.effectiveState === 'lost' && mode !== 'recover') throw new Error('该领地已经失守，请使用收复行动。')
  if (mode === 'recover' && derivedNode.effectiveState !== 'lost') throw new Error('只有失守领地可以发动收复行动。')
  if (mode === 'attack' && derivedNode.effectiveOwner === 'self') throw new Error('己方领地应使用防守复习。')
  if (mode === 'review' && derivedNode.effectiveOwner !== 'self') throw new Error('该领地已经失守，请使用收复行动。')

  const session: StudySession = {
    id: sessionId,
    campaignId: campaign.id,
    nodeId,
    mode,
    plannedMinutes: normalizedMinutes,
    scheduledAt,
    status: 'planned',
    accumulatedSeconds: 0,
    evidenceIds: []
  }

  return {
    session,
    world: {
      ...world,
      sessions: [session, ...world.sessions],
      events: [
        event({
          campaignId: campaign.id,
          nodeId,
          sessionId,
          type: 'session_planned',
          title: `部队已派往${derivedNode.title}`,
          detail: `编制 ${session.plannedMinutes} 分钟时间棋子。`,
          occurredAt: scheduledAt
        }),
        ...world.events
      ]
    }
  }
}

export function startSession(world: WorldState, sessionId: string, now = new Date().toISOString()): WorldState {
  const target = world.sessions.find((session) => session.id === sessionId)
  if (!target) throw new Error('未找到出征任务。')
  if (world.sessions.some((session) => session.id !== sessionId && session.status === 'active')) {
    throw new Error('已有一支部队正在出征，请先暂停或结算。')
  }
  if (!['planned', 'paused'].includes(target.status)) return world

  const sessions = world.sessions.map((session) => session.id === sessionId
    ? {
        ...session,
        status: 'active' as const,
        startedAt: session.startedAt ?? now,
        lastResumedAt: now,
        pausedAt: undefined
      }
    : session)
  const { campaign, node } = findNode(world, target.nodeId)
  return {
    ...world,
    sessions,
    events: [
      event({
        campaignId: campaign.id,
        nodeId: node.id,
        sessionId,
        type: 'session_started',
        title: `向${node.title}出征`,
        detail: '计时开始，愿每一分钟都有明确战果。',
        occurredAt: now
      }),
      ...world.events
    ]
  }
}

export function pauseSession(world: WorldState, sessionId: string, now = new Date().toISOString()): WorldState {
  return {
    ...world,
    sessions: world.sessions.map((session) => {
      if (session.id !== sessionId || session.status !== 'active') return session
      return {
        ...session,
        status: 'paused' as const,
        accumulatedSeconds: getSessionActiveSeconds(session, now),
        lastResumedAt: undefined,
        pausedAt: now
      }
    })
  }
}

export function abandonSession(world: WorldState, sessionId: string, now = new Date().toISOString()): WorldState {
  const target = world.sessions.find((session) => session.id === sessionId)
  if (!target || target.status === 'settled' || target.status === 'abandoned') return world
  return {
    ...world,
    sessions: world.sessions.map((session) => session.id === sessionId
      ? {
          ...session,
          status: 'abandoned' as const,
          accumulatedSeconds: getSessionActiveSeconds(session, now),
          lastResumedAt: undefined,
          endedAt: now
        }
      : session)
  }
}

function validateEvidence(drafts: EvidenceDraft[]): EvidenceDraft[] {
  const cleaned = drafts
    .map((draft) => ({ ...draft, content: draft.content.trim() }))
    .filter((draft) => draft.content.length > 0)
  const qualified = cleaned.some((draft) => (
    (draft.type === 'text' && draft.content.length >= 20)
    || (draft.type === 'link' && isValidUrl(draft.content))
    || (draft.type === 'image' && draft.content.length > 0)
  ))
  if (!qualified) throw new Error('请提交不少于 20 字的说明、有效链接或一张成果图片。')
  return cleaned
}

function ratingEase(rating: ReviewRating, current = 2.3): number {
  if (rating === 'again') return clamp(current - 0.2, 1.3, 3)
  if (rating === 'hard') return clamp(current - 0.1, 1.3, 3)
  if (rating === 'easy') return clamp(current + 0.1, 1.3, 3)
  return clamp(current, 1.3, 3)
}

export function scheduleInitialReview(
  now: string,
  baseStability: number,
  baseDays: number,
  rating: ReviewRating = 'good'
): ReviewState {
  const multiplier = rating === 'again' ? 0.5 : rating === 'hard' ? 0.75 : rating === 'easy' ? 1.75 : 1
  const intervalDays = clamp(Math.round(baseDays * multiplier), 1, 90)
  return {
    baseStability: clamp(baseStability + (rating === 'easy' ? 5 : rating === 'again' ? -5 : 0), 0, 100),
    step: clamp(baseDays >= 3 ? 1 : 0, 0, REVIEW_INTERVAL_DAYS.length - 1),
    intervalDays,
    nextReviewAt: addDays(now, intervalDays),
    ease: ratingEase(rating),
    successfulReviews: rating === 'again' ? 0 : 1,
    lapses: rating === 'again' ? 1 : 0
  }
}

export function scheduleAdaptiveReview(
  review: ReviewState,
  rating: ReviewRating,
  now = new Date().toISOString(),
  currentStability = review.baseStability
): ReviewState {
  const ease = ratingEase(rating, review.ease ?? 2.3)
  const fallbackInterval = REVIEW_INTERVAL_DAYS[clamp(review.step, 0, REVIEW_INTERVAL_DAYS.length - 1)]
  const currentInterval = clamp(review.intervalDays ?? fallbackInterval, 1, 90)
  const intervalDays = rating === 'again'
    ? 1
    : rating === 'hard'
      ? clamp(Math.round(currentInterval * 1.2), 1, 90)
      : rating === 'easy'
        ? clamp(Math.round(currentInterval * (ease + 0.45)), 2, 90)
        : clamp(Math.round(currentInterval * ease), 1, 90)
  const stabilityDelta = rating === 'again' ? -15 : rating === 'hard' ? 10 : rating === 'easy' ? 25 : 20
  const stepDelta = rating === 'again' ? -1 : rating === 'hard' ? 0 : rating === 'easy' ? 2 : 1
  return {
    baseStability: clamp(currentStability + stabilityDelta, 0, 100),
    step: clamp(review.step + stepDelta, 0, REVIEW_INTERVAL_DAYS.length - 1),
    intervalDays,
    nextReviewAt: addDays(now, intervalDays),
    ease,
    successfulReviews: rating === 'again' ? 0 : (review.successfulReviews ?? 0) + 1,
    lapses: (review.lapses ?? 0) + (rating === 'again' ? 1 : 0)
  }
}

export function settleSession(
  world: WorldState,
  sessionId: string,
  input: SettlementInput,
  now = new Date().toISOString()
): WorldState {
  const target = world.sessions.find((session) => session.id === sessionId)
  if (!target) throw new Error('未找到出征任务。')
  if (target.status === 'settled') return world
  if (target.status === 'abandoned') throw new Error('这次行动已经撤回，不能再提交战果。')
  if (target.status === 'planned') throw new Error('行动尚未开始，不能提交战果。')
  if (world.sessions.some((session) => session.clientMutationId === input.clientMutationId)) return world

  const drafts = validateEvidence(input.evidence)
  const { campaign, node } = findNode(world, target.nodeId)
  const derivedNode = deriveCampaign(campaign, now).nodes.find((item) => item.id === node.id)!
  if (node.kind === 'capital' && input.outcome === 'achieved' && node.scoreTarget != null) {
    if (input.score == null || input.score < node.scoreTarget) {
      throw new Error(`首都验收分数必须达到 ${node.scoreTarget} 分。`)
    }
  }

  const activeSeconds = Math.max(1, getSessionActiveSeconds(target, now))
  const earnedMinutes = Math.max(1, Math.ceil(activeSeconds / 60))
  const evidence: Evidence[] = drafts.map((draft) => ({
    id: makeId('evidence'),
    sessionId,
    type: draft.type,
    content: draft.content,
    createdAt: now
  }))
  const evidenceIds = evidence.map((item) => item.id)
  const reviewRating = input.reviewRating ?? (input.outcome === 'failed' ? 'again' : input.outcome === 'partial' ? 'hard' : 'good')
  const sessionReward = calculateSessionReward({
    mode: target.mode,
    outcome: input.outcome,
    nodeRole: node.role,
    earnedMinutes,
    evidenceCount: evidence.length,
    seed: input.clientMutationId
  })

  let updatedNode: TerritoryNode = {
    ...node,
    accumulatedMinutes: node.accumulatedMinutes + earnedMinutes
  }
  let eventType: TerritoryEvent['type'] = 'siege_progress'
  let eventTitle = `${node.title}围城继续`
  let eventDetail = `投入 ${earnedMinutes} 分钟，战果已写入战史。`

  if (input.outcome === 'achieved') {
    if (target.mode === 'attack') {
      updatedNode = {
        ...updatedNode,
        owner: 'self',
        state: 'controlled',
        review: scheduleInitialReview(now, 60, 1, reviewRating)
      }
      eventType = 'territory_captured'
      eventTitle = `${node.title}已被攻克`
      eventDetail = '领地稳定度 60，首次防守复习将在 1 天后到来。'
    } else if (target.mode === 'recover' || derivedNode.effectiveState === 'lost') {
      updatedNode = {
        ...updatedNode,
        owner: 'self',
        state: 'controlled',
        review: scheduleInitialReview(now, 50, 3, reviewRating)
      }
      eventType = 'territory_recovered'
      eventTitle = `${node.title}重归版图`
      eventDetail = '领地稳定度恢复到 50，3 天后需要再次巩固。'
    } else {
      const adaptiveReview = scheduleAdaptiveReview(node.review, reviewRating, now, derivedNode.effectiveStability)
      updatedNode = {
        ...updatedNode,
        owner: 'self',
        state: 'controlled',
        review: adaptiveReview
      }
      eventType = 'territory_reviewed'
      eventTitle = `${node.title}防线巩固`
      eventDetail = `稳定度调整至 ${updatedNode.review.baseStability}，${updatedNode.review.intervalDays} 天后再次复习。`
    }
  } else if (target.mode === 'attack') {
    updatedNode = { ...updatedNode, state: 'sieging' }
    eventDetail = input.outcome === 'partial'
      ? `投入 ${earnedMinutes} 分钟并取得部分成果，围城进度保留。`
      : `投入 ${earnedMinutes} 分钟完成侦察，尚未达到占领标准。`
  } else {
    updatedNode = {
      ...updatedNode,
      review: scheduleAdaptiveReview(node.review, reviewRating, now, derivedNode.effectiveStability)
    }
    eventTitle = `${node.title}防守未决`
    eventDetail = `本次复习尚未巩固，${updatedNode.review.intervalDays} 天后重新整队。`
  }

  const updatedSession: StudySession = {
    ...target,
    status: 'settled',
    accumulatedSeconds: activeSeconds,
    lastResumedAt: undefined,
    endedAt: now,
    outcome: input.outcome,
    evidenceIds,
    clientMutationId: input.clientMutationId,
    score: input.score,
    reviewRating,
    reward: sessionReward
  }

  let nextWorld = replaceCampaignNode(world, campaign.id, updatedNode)
  nextWorld = {
    ...nextWorld,
    campaigns: nextWorld.campaigns.map((item) => {
      if (item.id !== campaign.id || node.kind !== 'capital' || input.outcome !== 'achieved') return item
      return { ...item, status: 'victorious' }
    }),
    sessions: nextWorld.sessions.map((session) => session.id === sessionId ? updatedSession : session),
    evidence: [...evidence, ...nextWorld.evidence],
    events: [
      event({
        campaignId: campaign.id,
        nodeId: node.id,
        sessionId,
        type: eventType,
        title: eventTitle,
        detail: eventDetail,
        occurredAt: now
      }),
      ...nextWorld.events
    ]
  }
  return creditSessionReward(nextWorld, sessionId, sessionReward, `${node.title}行动军饷`, now)
}

export function setTruce(
  world: WorldState,
  startAt: string,
  endAt: string,
  now = new Date().toISOString()
): WorldState {
  const start = new Date(startAt).getTime()
  const end = new Date(endAt).getTime()
  const duration = end - start
  if (!Number.isFinite(duration) || duration <= 0 || duration > 14 * DAY_MS) {
    throw new Error('休整时间必须在 1 到 14 天之间。')
  }

  const campaigns = world.campaigns.map((campaign) => ({
    ...campaign,
    nodes: campaign.nodes.map((node) => node.review.nextReviewAt
      ? {
          ...node,
          review: {
            ...node.review,
            nextReviewAt: new Date(new Date(node.review.nextReviewAt).getTime() + duration).toISOString()
          }
        }
      : node)
  }))

  return {
    ...world,
    profile: { ...world.profile, truce: { startAt, endAt } },
    campaigns,
    events: [
      event({
        type: 'truce_started',
        title: '全境进入休整',
        detail: `所有复习期限顺延 ${Math.ceil(duration / DAY_MS)} 天。`,
        occurredAt: now
      }),
      ...world.events
    ]
  }
}

type UpgradeableWorldState = Omit<WorldState, 'version' | 'rewards'> & {
  version?: number
  rewards?: WorldState['rewards']
}

export function upgradeWorldState(world: UpgradeableWorldState): WorldState {
  const dailyTroops = world.profile.dailyTroops
    ?? Math.max(30, Math.round((world.profile.weeklyBudget ?? 300) / 5 / 15) * 15)
  const customNpcCharacters = normalizeCustomNpcCharacters(world.profile.customNpcCharacters)
  return {
    ...world,
    version: CURRENT_WORLD_VERSION,
    profile: {
      ...world.profile,
      dailyTroops,
      reminders: world.profile.reminders ?? { enabled: true, dueSoonHours: 48, dailyBriefHour: 8 },
      customNpcCharacters,
      npcAssignments: normalizeNpcAssignments(world.profile.npcAssignments, getNpcCharacterIds(customNpcCharacters))
    },
    campaigns: world.campaigns.map(upgradeCampaignHierarchy).map((campaign) => ({
      ...campaign,
      nodes: campaign.nodes.map((node) => ({
        ...node,
        review: {
          ...node.review,
          intervalDays: node.review.intervalDays ?? REVIEW_INTERVAL_DAYS[clamp(node.review.step, 0, REVIEW_INTERVAL_DAYS.length - 1)],
          ease: node.review.ease ?? 2.3,
          successfulReviews: node.review.successfulReviews ?? 0,
          lapses: node.review.lapses ?? 0
        }
      }))
    })),
    mapHistories: world.mapHistories ?? [],
    rewards: upgradeRewardSystem(world.rewards)
  }
}

export function setActiveCampaign(world: WorldState, campaignId: string): WorldState {
  if (!world.campaigns.some((campaign) => campaign.id === campaignId)) return world
  return { ...world, profile: { ...world.profile, activeCampaignId: campaignId } }
}

export function archiveCampaign(world: WorldState, campaignId: string, now = new Date().toISOString()): WorldState {
  const campaign = world.campaigns.find((item) => item.id === campaignId)
  if (!campaign) return world
  const campaigns = world.campaigns.map((item) => item.id === campaignId ? { ...item, status: 'archived' as const } : item)
  const nextActive = campaigns.find((item) => item.status === 'active' || item.status === 'victorious')
  return {
    ...world,
    campaigns,
    profile: { ...world.profile, activeCampaignId: nextActive?.id },
    events: [
      event({
        campaignId,
        type: 'campaign_archived',
        title: `${campaign.title}转入档案`,
        detail: '全部地图、证据和战史均已保留。',
        occurredAt: now
      }),
      ...world.events
    ]
  }
}

export function getMostUrgentNode(world: WorldState, now = new Date().toISOString()): DerivedTerritoryNode | undefined {
  const campaigns = deriveWorld(world, now).filter((campaign) => campaign.status !== 'archived')
  const nodes = campaigns.flatMap((campaign) => campaign.nodes)
  const endangered = nodes
    .filter((node) => node.effectiveState === 'lost' || node.effectiveState === 'contested')
    .sort((a, b) => a.effectiveStability - b.effectiveStability)
  if (endangered[0]) return endangered[0]
  return nodes.find((node) => node.effectiveState === 'available' || node.effectiveState === 'sieging')
}

function dayKeyAtTimezone(iso: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date(iso))
  } catch {
    return iso.slice(0, 10)
  }
}

export function getDailyTroopStatus(
  world: WorldState,
  now = new Date().toISOString(),
  quotaOverride?: number
): DailyTroopStatus {
  const timezone = world.profile.timezone || 'Asia/Hong_Kong'
  const dayKey = dayKeyAtTimezone(now, timezone)
  const quotaMinutes = clamp(quotaOverride ?? world.profile.dailyTroops ?? 90, 15, 240)
  const spentMinutes = world.sessions
    .filter((session) => {
      if (session.status === 'planned') return false
      const reference = session.startedAt ?? session.scheduledAt
      return dayKeyAtTimezone(reference, timezone) === dayKey
    })
    .reduce((total, session) => total + Math.ceil(getSessionActiveSeconds(session, now) / 60), 0)
  const remainingMinutes = Math.max(0, quotaMinutes - spentMinutes)
  return {
    quotaMinutes,
    spentMinutes,
    remainingMinutes,
    percentRemaining: Math.round(remainingMinutes / Math.max(1, quotaMinutes) * 100),
    dayKey
  }
}
