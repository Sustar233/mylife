import Taro from '@tarojs/taro'
import type { WorldState } from '../domain/types'
import { LocalWorldRepository, type WorldRepository, type WorldStorageStats, type StorageDriver } from './local-world-repository'
import type { WorldSnapshot } from './world-normalization'
export { LocalWorldRepository } from './local-world-repository'
export type { WorldRepository, WorldStorageStats } from './local-world-repository'
export { normalizeSnapshotList, normalizeWorldState } from './world-normalization'
export type { WorldSnapshot } from './world-normalization'
const taroStorage: StorageDriver = {
  get: (key) => Taro.getStorageSync(key),
  set: (key, value) => Taro.setStorageSync(key, value),
  remove: (key) => Taro.removeStorageSync(key),
  info: () => Taro.getStorageInfoSync()
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
  cleanupImages(): number { return 0 }
  getStats(): WorldStorageStats { return { worldBytes: 0, snapshotBytes: 0, snapshotCount: 0, storageUsedKB: 0, storageLimitKB: 0 } }
}

export const worldRepository: WorldRepository = new LocalWorldRepository(taroStorage)
