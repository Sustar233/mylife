import { autoLayoutCampaign, isStructuralDependency, validateCampaignMap } from './map-planning'
import type {
  Campaign,
  CampaignMapSnapshot,
  DependencyCreationInput,
  DependencyEdge,
  MapHistoryStatus,
  OutpostCreationInput,
  RegionCreationInput,
  TerritoryEvent,
  TerritoryNode,
  TerritoryNodeUpdateInput,
  WorldState
} from './types'
import { clamp, makeId } from './utils'

function mapEditEvent(campaignId: string, title: string, detail: string, now: string): TerritoryEvent {
  return { id: makeId('event'), campaignId, type: 'map_edited', title, detail, occurredAt: now }
}

const MAP_HISTORY_LIMIT = 12

function mapSnapshot(campaign: Campaign, label: string, now: string): CampaignMapSnapshot {
  return { label, createdAt: now, nodes: campaign.nodes, edges: campaign.edges }
}

const LEARNING_FIELDS = [
  'owner',
  'originOwner',
  'state',
  'accumulatedMinutes',
  'review'
] as const satisfies ReadonlyArray<keyof TerritoryNode>

function restoreMapSnapshot(world: WorldState, campaign: Campaign, snapshot: CampaignMapSnapshot): Campaign {
  const snapshotNodeIds = new Set(snapshot.nodes.map((node) => node.id))
  const protectedRemoval = campaign.nodes.find((node) => (
    !snapshotNodeIds.has(node.id)
    && (
      node.owner === 'self'
      || node.accumulatedMinutes > 0
      || Boolean(node.review.nextReviewAt)
      || world.sessions.some((session) => session.nodeId === node.id)
    )
  ))
  if (protectedRemoval) {
    throw new Error(`「${protectedRemoval.title}」已有学习记录，不能通过撤销版图将其移除。`)
  }

  const currentNodes = new Map(campaign.nodes.map((node) => [node.id, node]))
  const nodes = snapshot.nodes.map((snapshotNode) => {
    const currentNode = currentNodes.get(snapshotNode.id)
    if (!currentNode) return snapshotNode
    const restored = { ...snapshotNode }
    LEARNING_FIELDS.forEach((field) => {
      Object.assign(restored, { [field]: currentNode[field] })
    })
    return restored
  })
  const restored = { ...campaign, nodes, edges: snapshot.edges }
  const blocking = validateCampaignMap(restored).find((item) => item.severity === 'error')
  if (blocking) throw new Error(blocking.message)
  return restored
}

function commitCampaignMap(
  world: WorldState,
  campaignId: string,
  nextCampaign: Campaign,
  title: string,
  detail: string,
  now: string
): WorldState {
  const current = world.campaigns.find((campaign) => campaign.id === campaignId)
  if (!current) throw new Error('未找到要编辑的战役。')
  const blocking = validateCampaignMap(nextCampaign).filter((item) => item.severity === 'error')
  if (blocking.length) throw new Error(blocking[0].message)
  const histories = world.mapHistories ?? []
  const history = histories.find((item) => item.campaignId === campaignId)
  const nextHistory = {
    campaignId,
    past: [...(history?.past ?? []), mapSnapshot(current, title, now)].slice(-MAP_HISTORY_LIMIT),
    future: []
  }
  return {
    ...world,
    campaigns: world.campaigns.map((campaign) => campaign.id === campaignId ? nextCampaign : campaign),
    mapHistories: [...histories.filter((item) => item.campaignId !== campaignId), nextHistory],
    events: [mapEditEvent(campaignId, title, detail, now), ...world.events]
  }
}

export function addRegionToCampaign(world: WorldState, campaignId: string, input: RegionCreationInput, now = new Date().toISOString()): WorldState {
  const campaign = world.campaigns.find((item) => item.id === campaignId)
  if (!campaign) throw new Error('未找到要编辑的战役。')
  const name = input.name.trim()
  if (!name || !input.outpostTitle.trim() || !input.capitalTitle.trim() || !input.victoryCriteria.trim()) throw new Error('区域、据点、主城名称和胜利标准不能为空。')
  if (campaign.nodes.some((node) => node.region === name)) throw new Error('该区域名称已存在。')
  if (campaign.nodes.length + 2 > 100) throw new Error('单场战役最多 100 个节点。')

  const regionIndex = campaign.nodes.filter((node) => node.role === 'regional_capital').length
  const x = 14 + (regionIndex % 5) * 18
  const y = 20 + (Math.floor(regionIndex / 5) % 3) * 30
  const outpostId = makeId('outpost')
  const capitalId = makeId('regional_capital')
  const estimatedMinutes = clamp(Math.round(input.estimatedMinutes / 5) * 5, 15, 1200)
  const outpost: TerritoryNode = {
    id: outpostId,
    campaignId,
    templateKey: `custom-${outpostId}`,
    region: name,
    title: input.outpostTitle.trim(),
    description: `由指挥官为${name}规划的首个学习据点。`,
    kind: 'city',
    role: 'outpost',
    owner: 'enemy',
    originOwner: 'enemy',
    state: 'locked',
    estimatedMinutes,
    accumulatedMinutes: 0,
    victoryCriteria: `完成${input.outpostTitle.trim()}的核心学习目标并提交成果`,
    position: { x: Math.max(6, x - 4), y },
    review: { baseStability: 0, step: 0 }
  }
  const regionalCapital: TerritoryNode = {
    ...outpost,
    id: capitalId,
    templateKey: `custom-${capitalId}`,
    title: input.capitalTitle.trim(),
    description: `完成${name}全部据点后的综合验收主城。`,
    kind: 'regional_capital',
    role: 'regional_capital',
    estimatedMinutes: Math.max(30, estimatedMinutes),
    victoryCriteria: input.victoryCriteria.trim(),
    position: { x: Math.min(94, x + 4), y }
  }
  const globalCapital = campaign.nodes.find((node) => node.role === 'campaign_capital')
  const newEdges: DependencyEdge[] = [{ id: makeId('edge'), campaignId, from: outpostId, to: capitalId, kind: 'hard' }]
  if (globalCapital) newEdges.push({ id: makeId('edge'), campaignId, from: capitalId, to: globalCapital.id, kind: 'hard' })
  const nextCampaign = { ...campaign, nodes: [...campaign.nodes, outpost, regionalCapital], edges: [...campaign.edges, ...newEdges] }
  return commitCampaignMap(world, campaignId, nextCampaign, `${name}已划入版图`, `建立据点「${outpost.title}」与主城「${regionalCapital.title}」。`, now)
}

export function addOutpostToCampaign(world: WorldState, campaignId: string, input: OutpostCreationInput, now = new Date().toISOString()): WorldState {
  const campaign = world.campaigns.find((item) => item.id === campaignId)
  if (!campaign) throw new Error('未找到要编辑的战役。')
  const capital = campaign.nodes.find((node) => node.region === input.region && node.role === 'regional_capital')
  if (!capital) throw new Error('该区域没有可用的主城。')
  if (capital.owner === 'self') throw new Error('已控制区域不能追加前置据点，请新建区域。')
  if (!input.title.trim() || !input.victoryCriteria.trim()) throw new Error('据点名称和胜利标准不能为空。')
  if (campaign.nodes.length >= 100) throw new Error('单场战役最多 100 个节点。')
  const siblings = campaign.nodes.filter((node) => node.region === input.region && node.role === 'outpost')
  const id = makeId('outpost')
  const node: TerritoryNode = {
    id,
    campaignId,
    templateKey: `custom-${id}`,
    region: input.region,
    title: input.title.trim(),
    description: input.description.trim() || `由指挥官规划的${input.region}分支据点。`,
    kind: siblings.length % 3 === 2 ? 'fortress' : 'city',
    role: 'outpost',
    owner: 'enemy',
    originOwner: 'enemy',
    state: 'locked',
    estimatedMinutes: clamp(Math.round(input.estimatedMinutes / 5) * 5, 15, 1200),
    accumulatedMinutes: 0,
    victoryCriteria: input.victoryCriteria.trim(),
    position: { x: Math.max(5, Math.min(95, capital.position.x - 8 + (siblings.length % 3) * 4)), y: Math.max(8, Math.min(92, capital.position.y - 10 + (siblings.length % 4) * 7)) },
    review: { baseStability: 0, step: 0 }
  }
  const edge: DependencyEdge = { id: makeId('edge'), campaignId, from: id, to: capital.id, kind: 'hard' }
  const nextCampaign = { ...campaign, nodes: [...campaign.nodes, node], edges: [...campaign.edges, edge] }
  return commitCampaignMap(world, campaignId, nextCampaign, `${node.title}据点设立`, `已加入${input.region}，攻克后方可进攻区域主城。`, now)
}

export function updateCampaignNode(world: WorldState, campaignId: string, nodeId: string, input: TerritoryNodeUpdateInput, now = new Date().toISOString()): WorldState {
  const campaign = world.campaigns.find((item) => item.id === campaignId)
  const node = campaign?.nodes.find((item) => item.id === nodeId)
  if (!campaign || !node) throw new Error('未找到要修改的节点。')
  if (!input.title.trim() || !input.victoryCriteria.trim()) throw new Error('名称和胜利标准不能为空。')
  const replacement: TerritoryNode = { ...node, title: input.title.trim(), description: input.description.trim(), victoryCriteria: input.victoryCriteria.trim(), estimatedMinutes: clamp(Math.round(input.estimatedMinutes / 5) * 5, 15, 1200) }
  const nextCampaign = { ...campaign, nodes: campaign.nodes.map((item) => item.id === replacement.id ? replacement : item) }
  return commitCampaignMap(world, campaignId, nextCampaign, `${replacement.title}军令已更新`, '节点名称、说明、投入时间或胜利标准已调整。', now)
}

export function removeCustomOutpost(world: WorldState, campaignId: string, nodeId: string, now = new Date().toISOString()): WorldState {
  const campaign = world.campaigns.find((item) => item.id === campaignId)
  const node = campaign?.nodes.find((item) => item.id === nodeId)
  if (!campaign || !node) throw new Error('未找到要删除的据点。')
  if (node.role !== 'outpost' || !node.templateKey.startsWith('custom-')) throw new Error('只能删除尚未投入的自定义据点。')
  if (node.owner === 'self' || node.accumulatedMinutes > 0 || world.sessions.some((session) => session.nodeId === nodeId)) throw new Error('该据点已有学习记录，不能删除；可修改名称或胜利标准。')
  const siblings = campaign.nodes.filter((item) => item.region === node.region && item.role === 'outpost')
  if (siblings.length <= 1) throw new Error('区域至少保留一个据点。')
  const nextCampaign = { ...campaign, nodes: campaign.nodes.filter((candidate) => candidate.id !== nodeId), edges: campaign.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId) }
  return commitCampaignMap(world, campaignId, nextCampaign, `${node.title}据点撤销`, '未产生的学习计划节点已从版图中移除。', now)
}

export function addDependencyToCampaign(world: WorldState, campaignId: string, input: DependencyCreationInput, now = new Date().toISOString()): WorldState {
  const campaign = world.campaigns.find((item) => item.id === campaignId)
  if (!campaign) throw new Error('未找到要编辑的战役。')
  const from = campaign.nodes.find((node) => node.id === input.from)
  const to = campaign.nodes.find((node) => node.id === input.to)
  if (!from || !to) throw new Error('请选择有效的起点和目标据点。')
  if (from.id === to.id) throw new Error('不能把同一据点设为自己的前置。')
  if (to.role === 'regional_capital' || to.role === 'campaign_capital') throw new Error('主城解锁由区域规则自动维护，请选择分支据点作为目标。')
  if (campaign.edges.some((edge) => edge.from === from.id && edge.to === to.id)) throw new Error('这条前置道路已经存在。')
  const edge: DependencyEdge = { id: makeId('edge'), campaignId, from: from.id, to: to.id, kind: input.kind }
  const nextCampaign = { ...campaign, edges: [...campaign.edges, edge] }
  return commitCampaignMap(world, campaignId, nextCampaign, '前置道路已部署', `「${from.title}」成为「${to.title}」的${input.kind === 'hard' ? '硬前置' : '提示前置'}。`, now)
}

export function removeDependencyFromCampaign(world: WorldState, campaignId: string, edgeId: string, now = new Date().toISOString()): WorldState {
  const campaign = world.campaigns.find((item) => item.id === campaignId)
  const edge = campaign?.edges.find((item) => item.id === edgeId)
  if (!campaign || !edge) throw new Error('未找到要撤销的道路。')
  if (isStructuralDependency(campaign, edge)) throw new Error('区域攻城规则所需的主干道路不能撤销。')
  const from = campaign.nodes.find((node) => node.id === edge.from)
  const to = campaign.nodes.find((node) => node.id === edge.to)
  const nextCampaign = { ...campaign, edges: campaign.edges.filter((item) => item.id !== edgeId) }
  return commitCampaignMap(world, campaignId, nextCampaign, '前置道路已撤销', `取消「${from?.title ?? '未知节点'}」到「${to?.title ?? '未知节点'}」的前置关系。`, now)
}

export function autoArrangeCampaignMap(world: WorldState, campaignId: string, now = new Date().toISOString()): WorldState {
  const campaign = world.campaigns.find((item) => item.id === campaignId)
  if (!campaign) throw new Error('未找到要编辑的战役。')
  return commitCampaignMap(world, campaignId, autoLayoutCampaign(campaign), '版图已自动排布', '根据区域与据点数量重新整理行政区和战术位置。', now)
}

export function undoCampaignMapEdit(world: WorldState, campaignId: string, now = new Date().toISOString()): WorldState {
  const campaign = world.campaigns.find((item) => item.id === campaignId)
  const histories = world.mapHistories ?? []
  const history = histories.find((item) => item.campaignId === campaignId)
  const target = history?.past[history.past.length - 1]
  if (!campaign || !history || !target) throw new Error('没有可以撤销的版图修改。')
  const restoredCampaign = restoreMapSnapshot(world, campaign, target)
  const nextHistory = { campaignId, past: history.past.slice(0, -1), future: [...history.future, mapSnapshot(campaign, target.label, now)].slice(-MAP_HISTORY_LIMIT) }
  return {
    ...world,
    campaigns: world.campaigns.map((item) => item.id === campaignId ? restoredCampaign : item),
    mapHistories: [...histories.filter((item) => item.campaignId !== campaignId), nextHistory],
    events: [mapEditEvent(campaignId, `已撤销：${target.label}`, '版图恢复到上一个安全版本，战史与学习证据未受影响。', now), ...world.events]
  }
}

export function redoCampaignMapEdit(world: WorldState, campaignId: string, now = new Date().toISOString()): WorldState {
  const campaign = world.campaigns.find((item) => item.id === campaignId)
  const histories = world.mapHistories ?? []
  const history = histories.find((item) => item.campaignId === campaignId)
  const target = history?.future[history.future.length - 1]
  if (!campaign || !history || !target) throw new Error('没有可以重做的版图修改。')
  const restoredCampaign = restoreMapSnapshot(world, campaign, target)
  const nextHistory = { campaignId, past: [...history.past, mapSnapshot(campaign, target.label, now)].slice(-MAP_HISTORY_LIMIT), future: history.future.slice(0, -1) }
  return {
    ...world,
    campaigns: world.campaigns.map((item) => item.id === campaignId ? restoredCampaign : item),
    mapHistories: [...histories.filter((item) => item.campaignId !== campaignId), nextHistory],
    events: [mapEditEvent(campaignId, `已重做：${target.label}`, '重新应用已撤销的版图修改。', now), ...world.events]
  }
}

export function getCampaignMapHistoryStatus(world: WorldState, campaignId: string): MapHistoryStatus {
  const history = world.mapHistories?.find((item) => item.campaignId === campaignId)
  return { undoCount: history?.past.length ?? 0, redoCount: history?.future.length ?? 0, lastLabel: history?.past[history.past.length - 1]?.label }
}
