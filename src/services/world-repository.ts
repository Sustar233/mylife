import Taro from '@tarojs/taro'
import { upgradeWorldState } from '../domain/engine'
import type { WorldState } from '../domain/types'
import {
  isWorldLike,
  MAX_WORLD_SNAPSHOTS,
  normalizeSnapshotList,
  normalizeWorldState,
  type WorldSnapshot
} from './world-normalization'

export { normalizeSnapshotList, normalizeWorldState } from './world-normalization'
export type { WorldSnapshot } from './world-normalization'

export interface WorldStorageStats {
  worldBytes: number
  snapshotBytes: number
  snapshotCount: number
  storageUsedKB: number
  storageLimitKB: number
}

export interface WorldRepository {
  load(): WorldState | null
  save(world: WorldState): void
  createSnapshot(world: WorldState, label: string): WorldSnapshot
  listSnapshots(): WorldSnapshot[]
  restoreSnapshot(snapshotId: string): WorldState | null
  clearSnapshots(): void
  getStats(): WorldStorageStats
}

const STORAGE_KEY = 'zhiyu_world_v1'
const SNAPSHOT_KEY = 'zhiyu_world_snapshots_v1'
const MAX_SNAPSHOTS = MAX_WORLD_SNAPSHOTS
const AUTO_SNAPSHOT_INTERVAL_MS = 6 * 60 * 60 * 1000

function byteLength(value: string): number {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code >= 0xd800 && code <= 0xdbff ? 4 : 3
    if (code >= 0xd800 && code <= 0xdbff) index += 1
  }
  return bytes
}

export class LocalWorldRepository implements WorldRepository {
  load(): WorldState | null {
    try {
      const value = Taro.getStorageSync<unknown>(STORAGE_KEY)
      if (value) return normalizeWorldState(value)
    } catch {
      // 主存档损坏时继续尝试最近快照。
    }
    return this.listSnapshots()[0]?.world ?? null
  }

  save(world: WorldState): void {
    try {
      const previous = Taro.getStorageSync<unknown>(STORAGE_KEY)
      const previousWorld = isWorldLike(previous) ? upgradeWorldState(previous) : null
      const snapshots = this.listSnapshots()
      const lastSnapshotAt = snapshots[0] ? new Date(snapshots[0].createdAt).getTime() : 0
      if (previousWorld && Date.now() - lastSnapshotAt >= AUTO_SNAPSHOT_INTERVAL_MS) {
        this.createSnapshot(previousWorld, '自动快照')
      }
      Taro.setStorageSync(STORAGE_KEY, world)
    } catch {
      // 空间不足时优先舍弃可再生成的快照，确保当前主存档仍有机会落盘。
      try {
        this.clearSnapshots()
      } catch {
        // 即使快照区无法清理，也继续尝试保存更重要的主存档。
      }
      Taro.setStorageSync(STORAGE_KEY, world)
    }
  }

  createSnapshot(world: WorldState, label: string): WorldSnapshot {
    const snapshot: WorldSnapshot = {
      id: `snapshot_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date().toISOString(),
      label,
      world
    }
    const next = [snapshot, ...this.listSnapshots()].slice(0, MAX_SNAPSHOTS)
    Taro.setStorageSync(SNAPSHOT_KEY, next)
    return snapshot
  }

  listSnapshots(): WorldSnapshot[] {
    try {
      const value = Taro.getStorageSync<unknown>(SNAPSHOT_KEY)
      return normalizeSnapshotList(value)
    } catch {
      return []
    }
  }

  restoreSnapshot(snapshotId: string): WorldState | null {
    const snapshot = this.listSnapshots().find((item) => item.id === snapshotId)
    return snapshot ? normalizeWorldState(snapshot.world) : null
  }

  clearSnapshots(): void {
    Taro.removeStorageSync(SNAPSHOT_KEY)
  }

  getStats(): WorldStorageStats {
    const worldValue = Taro.getStorageSync<unknown>(STORAGE_KEY)
    const snapshotValue = Taro.getStorageSync<unknown>(SNAPSHOT_KEY)
    const storage = Taro.getStorageInfoSync()
    return {
      worldBytes: byteLength(JSON.stringify(worldValue ?? '')),
      snapshotBytes: byteLength(JSON.stringify(snapshotValue ?? '')),
      snapshotCount: this.listSnapshots().length,
      storageUsedKB: Number(storage.currentSize ?? 0),
      storageLimitKB: Number(storage.limitSize ?? 0)
    }
  }
}

/**
 * CloudBase 接入点。配置真实环境后，应由云端按 UID 保存当前版本存档，
 * 并用 clientMutationId 保证结算幂等。
 */
export interface CloudWorldRepositoryConfig {
  envId: string
  userId: string
}

export class CloudWorldRepository implements WorldRepository {
  constructor(private readonly config: CloudWorldRepositoryConfig) {}

  load(): WorldState | null { throw new Error(`CloudBase 环境 ${this.config.envId} 尚未配置客户端适配器。`) }
  save(_world: WorldState): void { throw new Error(`CloudBase 环境 ${this.config.envId} 尚未配置客户端适配器。`) }
  createSnapshot(_world: WorldState, _label: string): WorldSnapshot { throw new Error('云端快照尚未配置。') }
  listSnapshots(): WorldSnapshot[] { return [] }
  restoreSnapshot(_snapshotId: string): WorldState | null { return null }
  clearSnapshots(): void {}
  getStats(): WorldStorageStats { return { worldBytes: 0, snapshotBytes: 0, snapshotCount: 0, storageUsedKB: 0, storageLimitKB: 0 } }
}

export const worldRepository: WorldRepository = new LocalWorldRepository()
