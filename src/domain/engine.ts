import { getTemplate } from './templates'
import type {
  Campaign,
  CampaignCreationInput,
  DerivedCampaign,
  DerivedTerritoryNode,
  Evidence,
  EvidenceDraft,
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

export function createInitialWorldState(now = new Date().toISOString()): WorldState {
  return {
    version: 1,
    profile: {
      id: 'local_commander',
      displayName: '指挥官',
      timezone: 'Asia/Hong_Kong',
      weeklyBudget: 300
    },
    campaigns: [],
    sessions: [],
    evidence: [],
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
      victoryCriteria: isCapital ? input.capitalCriteria : node.victoryCriteria,
      scoreTarget: isCapital ? input.capitalScoreTarget : undefined,
      owner: isImported ? 'self' : 'enemy',
      originOwner: isImported ? 'self' : 'enemy',
      state: isImported ? 'controlled' : 'locked',
      accumulatedMinutes: 0,
      review: isImported
        ? { baseStability: 80, nextReviewAt: addDays(now, 7), step: 2 }
        : { baseStability: 0, step: 0 }
    }
  })

  const edges = template.edges.map((edge) => ({
    id: makeId('edge'),
    campaignId,
    from: nodeIdByKey.get(edge.from)!,
    to: nodeIdByKey.get(edge.to)!,
    kind: edge.kind ?? 'hard' as const
  }))

  const campaign: Campaign = {
    id: campaignId,
    title: input.title.trim(),
    templateType: input.templateType,
    goal: input.goal.trim(),
    capitalCriteria: input.capitalCriteria.trim(),
    capitalScoreTarget: input.capitalScoreTarget,
    weeklyBudget: clamp(input.weeklyBudget, 60, 1680),
    status: 'active',
    createdAt: now,
    nodes,
    edges
  }

  return {
    ...world,
    profile: {
      ...world.profile,
      activeCampaignId: campaignId,
      weeklyBudget: campaign.weeklyBudget
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
  const progressPercent = Math.round((controlledCount / Math.max(1, nodes.length)) * 100)

  return { ...campaign, nodes, controlledCount, contestedCount, progressPercent }
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

export function planSession(
  world: WorldState,
  nodeId: string,
  plannedMinutes: number,
  mode: SessionMode,
  scheduledAt = new Date().toISOString(),
  sessionId = makeId('session')
): { world: WorldState; session: StudySession } {
  const { campaign } = findNode(world, nodeId)
  const derivedNode = deriveCampaign(campaign, scheduledAt).nodes.find((node) => node.id === nodeId)!
  if (derivedNode.effectiveState === 'locked') throw new Error('补给道路尚未打通，不能进攻此城。')
  if (mode === 'attack' && derivedNode.effectiveOwner === 'self') throw new Error('己方领地应使用防守复习。')
  if (mode === 'review' && derivedNode.effectiveOwner !== 'self') throw new Error('该领地已经失守，请使用收复行动。')

  const session: StudySession = {
    id: sessionId,
    campaignId: campaign.id,
    nodeId,
    mode,
    plannedMinutes: [15, 25, 45, 60].includes(plannedMinutes) ? plannedMinutes : 25,
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

function nextReview(now: string, step: number): { step: number; nextReviewAt: string } {
  const nextStep = clamp(step, 0, REVIEW_INTERVAL_DAYS.length - 1)
  return { step: nextStep, nextReviewAt: addDays(now, REVIEW_INTERVAL_DAYS[nextStep]) }
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
        review: { baseStability: 60, ...nextReview(now, 0) }
      }
      eventType = 'territory_captured'
      eventTitle = `${node.title}已被攻克`
      eventDetail = '领地稳定度 60，首次防守复习将在 1 天后到来。'
    } else if (target.mode === 'recover' || derivedNode.effectiveState === 'lost') {
      updatedNode = {
        ...updatedNode,
        owner: 'self',
        state: 'controlled',
        review: { baseStability: 50, ...nextReview(now, 1) }
      }
      eventType = 'territory_recovered'
      eventTitle = `${node.title}重归版图`
      eventDetail = '领地稳定度恢复到 50，3 天后需要再次巩固。'
    } else {
      const followingStep = clamp(node.review.step + 1, 0, REVIEW_INTERVAL_DAYS.length - 1)
      updatedNode = {
        ...updatedNode,
        owner: 'self',
        state: 'controlled',
        review: {
          baseStability: clamp(derivedNode.effectiveStability + 20, 0, 100),
          ...nextReview(now, followingStep)
        }
      }
      eventType = 'territory_reviewed'
      eventTitle = `${node.title}防线巩固`
      eventDetail = `稳定度提升至 ${updatedNode.review.baseStability}。`
    }
  } else if (target.mode === 'attack') {
    updatedNode = { ...updatedNode, state: 'sieging' }
    eventDetail = input.outcome === 'partial'
      ? `投入 ${earnedMinutes} 分钟并取得部分成果，围城进度保留。`
      : `投入 ${earnedMinutes} 分钟完成侦察，尚未达到占领标准。`
  } else {
    eventTitle = `${node.title}防守未决`
    eventDetail = '本次复习尚未达到巩固标准，原定复习期限保持不变。'
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
    score: input.score
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
  return nextWorld
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

export function getCompletedMinutesThisWeek(world: WorldState, now = new Date().toISOString()): number {
  const current = new Date(now)
  const day = (current.getDay() + 6) % 7
  const weekStart = new Date(current.getTime() - day * DAY_MS)
  weekStart.setHours(0, 0, 0, 0)
  return world.sessions
    .filter((session) => session.status === 'settled' && session.endedAt && new Date(session.endedAt) >= weekStart)
    .reduce((total, session) => total + Math.ceil(session.accumulatedSeconds / 60), 0)
}
