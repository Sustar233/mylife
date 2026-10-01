import { assertNormalizedWorld } from './world-validation'
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

export function normalizeWorldState(value: unknown): WorldState {
  if (!isWorldLike(value)) throw new Error('备份内容不是有效的知域存档。')
  if (value.version != null && (!Number.isInteger(value.version) || typeof value.version !== 'number' || value.version < 1)) throw new Error('备份版本无效。')
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
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.createdAt !== 'string' || !Number.isFinite(Date.parse(item.createdAt)) || typeof item.label !== 'string' || !('world' in item)) return
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
