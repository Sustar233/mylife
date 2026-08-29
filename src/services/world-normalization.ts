import { CURRENT_WORLD_VERSION, upgradeWorldState } from '../domain/engine'
import type { WorldState } from '../domain/types'

export const MAX_WORLD_SNAPSHOTS = 3

export interface WorldSnapshot {
  id: string
  createdAt: string
  label: string
  world: WorldState
}

export function isWorldLike(value: unknown): value is Omit<WorldState, 'version' | 'rewards'> & { version?: number; rewards?: WorldState['rewards'] } {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<WorldState>
  return Boolean(candidate.profile)
    && Array.isArray(candidate.campaigns)
    && Array.isArray(candidate.sessions)
    && Array.isArray(candidate.evidence)
    && Array.isArray(candidate.events)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function assertNormalizedWorld(world: WorldState): void {
  if (!isRecord(world.profile) || typeof world.profile.id !== 'string' || typeof world.profile.timezone !== 'string') {
    throw new Error('指挥官资料不完整。')
  }
  if (world.campaigns.length > 100 || world.sessions.length > 50_000 || world.evidence.length > 50_000 || world.events.length > 100_000) {
    throw new Error('存档记录数量超过安全限制。')
  }

  const campaignIds = new Set<string>()
  const nodeIds = new Set<string>()
  world.campaigns.forEach((campaign) => {
    if (!isRecord(campaign) || typeof campaign.id !== 'string' || !campaign.id || campaignIds.has(campaign.id)) {
      throw new Error('战役标识无效或重复。')
    }
    campaignIds.add(campaign.id)
    if (!Array.isArray(campaign.nodes) || !Array.isArray(campaign.edges) || campaign.nodes.length > 100) {
      throw new Error(`战役「${campaign.title || campaign.id}」的版图无效。`)
    }
    const localNodeIds = new Set<string>()
    campaign.nodes.forEach((node) => {
      if (!isRecord(node) || typeof node.id !== 'string' || !node.id || localNodeIds.has(node.id) || nodeIds.has(node.id)) {
        throw new Error('城池标识无效或重复。')
      }
      if (node.campaignId !== campaign.id || typeof node.title !== 'string' || !isRecord(node.review)) {
        throw new Error(`城池「${String(node.title ?? node.id)}」的数据不完整。`)
      }
      localNodeIds.add(node.id)
      nodeIds.add(node.id)
    })
    const edgeIds = new Set<string>()
    campaign.edges.forEach((edge) => {
      if (!isRecord(edge) || typeof edge.id !== 'string' || edgeIds.has(edge.id) || edge.campaignId !== campaign.id) {
        throw new Error('道路标识无效或重复。')
      }
      if (!localNodeIds.has(String(edge.from)) || !localNodeIds.has(String(edge.to))) {
        throw new Error('道路连接了不存在的城池。')
      }
      edgeIds.add(edge.id)
    })
  })

  const sessionIds = new Set<string>()
  world.sessions.forEach((session) => {
    if (!isRecord(session) || typeof session.id !== 'string' || sessionIds.has(session.id) || !nodeIds.has(String(session.nodeId))) {
      throw new Error('学习记录引用了不存在的行动或城池。')
    }
    sessionIds.add(session.id)
  })
  const evidenceIds = new Set<string>()
  world.evidence.forEach((evidence) => {
    if (!isRecord(evidence) || typeof evidence.id !== 'string' || evidenceIds.has(evidence.id) || !sessionIds.has(String(evidence.sessionId))) {
      throw new Error('成果证据引用了不存在的学习记录。')
    }
    if (typeof evidence.content !== 'string' || evidence.content.length > 8 * 1024 * 1024) {
      throw new Error('成果证据内容无效或超过安全限制。')
    }
    evidenceIds.add(evidence.id)
  })
}

export function normalizeWorldState(value: unknown): WorldState {
  if (!isWorldLike(value)) throw new Error('备份内容不是有效的知域存档。')
  if (typeof value.version === 'number' && value.version > CURRENT_WORLD_VERSION) {
    throw new Error(`该存档来自更高版本（v${value.version}），当前应用暂不支持。`)
  }
  try {
    const world = upgradeWorldState(value)
    assertNormalizedWorld(world)
    return world
  } catch (error) {
    if (error instanceof Error && error.message.includes('更高版本')) throw error
    throw new Error(`备份内容损坏：${error instanceof Error ? error.message : '无法读取领域数据。'}`)
  }
}

export function normalizeSnapshotList(value: unknown): WorldSnapshot[] {
  if (!Array.isArray(value)) return []
  const snapshots: WorldSnapshot[] = []
  value.forEach((item) => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.createdAt !== 'string' || typeof item.label !== 'string' || !('world' in item)) return
    try {
      snapshots.push({ id: item.id, createdAt: item.createdAt, label: item.label, world: normalizeWorldState(item.world) })
    } catch {
      // 单份快照损坏时跳过，继续保留更早的可用快照。
    }
  })
  return snapshots
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, MAX_WORLD_SNAPSHOTS)
}
