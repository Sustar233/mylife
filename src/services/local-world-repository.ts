import type { WorldState } from '../domain/types'
import { mapWorldImages } from '../domain/world-media'
import { referencedImages } from '../domain/image-references'
import { MAX_WORLD_SNAPSHOTS, normalizeSnapshotList, normalizeWorldState, type WorldSnapshot } from './world-normalization'

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
  cleanupImages(): number
  getStats(): WorldStorageStats
}
export interface StorageDriver {
  get(key: string): unknown
  set(key: string, value: unknown): void
  remove(key: string): void
  info(): { keys: string[]; currentSize?: number; limitSize?: number }
}
export const WORLD_KEY = 'zhiyu_world_v1'
export const SNAPSHOT_KEY = 'zhiyu_world_snapshots_v1'
export const IMAGE_PREFIX = 'zhiyu_image_v1:'
const AUTO_SNAPSHOT_INTERVAL_MS = 6 * 60 * 60 * 1000

function isQuotaError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String((error as { errMsg?: string })?.errMsg ?? error)
  return /quota|exceed.*(?:storage|limit)|storage.*(?:limit|full)|空间不足|超出.*限制/i.test(message)
}
function byteLength(value: unknown): number {
  const serialized = JSON.stringify(value ?? '')
  let bytes = 0
  for (const char of serialized) {
    const code = char.codePointAt(0)!
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
  }
  return bytes
}
function imageHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619)
  return `${(hash >>> 0).toString(36)}-${value.length}`
}

/** 无平台依赖，可用内存驱动测试写入失败、迁移和恢复。 */
export class LocalWorldRepository implements WorldRepository {
  private lastSaved?: WorldState
  private nextSnapshotCheck = 0
  private readonly imageKeys = new Map<string, string>()

  constructor(private readonly storage: StorageDriver, private readonly clock: () => number = Date.now) {}

  private encode(world: WorldState): WorldState {
    return mapWorldImages(world, (path) => {
      if (!path.startsWith('data:image/')) return path
      const cached = this.imageKeys.get(path)
      if (cached) return cached
      const base = `${IMAGE_PREFIX}${imageHash(path)}`
      let key = base
      let suffix = 0
      let existing = this.storage.get(key)
      while (existing && existing !== path) {
        key = `${base}-${++suffix}`
        existing = this.storage.get(key)
      }
      if (existing !== path) this.storage.set(key, path)
      this.imageKeys.set(path, key)
      return key
    })
  }

  private decode(value: unknown): WorldState {
    // 先校验结构，再访问可选媒体字段，损坏存档不会触发不受控的遍历。
    const world = normalizeWorldState(value)
    return mapWorldImages(world, (path) => {
      if (!path.startsWith(IMAGE_PREFIX)) return path
      const image = this.storage.get(path)
      if (typeof image !== 'string' || !image.startsWith('data:image/')) throw new Error('存档图片缺失，请恢复完整备份。')
      this.imageKeys.set(image, path)
      return image
    })
  }

  load(): WorldState | null {
    let failed = false
    try {
      const raw = this.storage.get(WORLD_KEY)
      if (raw) return this.decode(raw)
    } catch {
      failed = true
      // 主存档不可用时按时间顺序寻找有效快照。
    }
    const restored = this.listSnapshots()[0]?.world
    if (restored) return restored
    if (failed) throw new Error('本地存档暂时无法读取，原数据未被覆盖。请重试。')
    return null
  }

  save(world: WorldState): void {
    if (world === this.lastSaved) return
    // 图片先独立写入；失败时主存档与快照保持原状。
    const encoded = this.encode(world)
    const now = this.clock()
    if (now >= this.nextSnapshotCheck) {
      try {
        const snapshots = this.listSnapshots()
        const latest = snapshots[0] ? Date.parse(snapshots[0].createdAt) : 0
        if (now - latest >= AUTO_SNAPSHOT_INTERVAL_MS) {
          const previous = this.storage.get(WORLD_KEY)
          if (previous) this.createSnapshot(this.decode(previous), '自动快照')
        }
        this.nextSnapshotCheck = now + AUTO_SNAPSHOT_INTERVAL_MS
      } catch {
        // 自动快照失败不影响主存档写入，也不删除已有快照。
      }
    }
    try {
      this.storage.set(WORLD_KEY, encoded)
    } catch (error) {
      if (!isQuotaError(error)) throw error
      const snapshots = this.listSnapshots()
      // 只有明确的配额错误才淘汰旧快照，始终保留最后一份有效恢复点。
      while (snapshots.length > 1) {
        snapshots.pop()
        this.storage.set(SNAPSHOT_KEY, snapshots.map((item) => ({ ...item, world: this.encode(item.world) })))
        try {
          this.storage.set(WORLD_KEY, encoded)
          this.lastSaved = world
          return
        } catch (retryError) {
          if (!isQuotaError(retryError)) throw retryError
          error = retryError
        }
      }
      throw error
    }
    this.lastSaved = world
  }

  createSnapshot(world: WorldState, label: string): WorldSnapshot {
    const now = this.clock()
    const snapshot: WorldSnapshot = {
      id: `snapshot_${now}_${Math.random().toString(36).slice(2, 9)}`,
      createdAt: new Date(now).toISOString(), label,
      world: normalizeWorldState(world)
    }
    const next = [snapshot, ...this.listSnapshots()].slice(0, MAX_WORLD_SNAPSHOTS)
    this.storage.set(SNAPSHOT_KEY, next.map((item) => ({ ...item, world: this.encode(item.world) })))
    this.nextSnapshotCheck = now + AUTO_SNAPSHOT_INTERVAL_MS
    return snapshot
  }

  listSnapshots(): WorldSnapshot[] {
    try {
      const raw = this.storage.get(SNAPSHOT_KEY)
      return normalizeSnapshotList(raw).flatMap((item) => {
        try { return [{ ...item, world: this.decode(item.world) }] } catch { return [] }
      })
    } catch { return [] }
  }

  restoreSnapshot(snapshotId: string): WorldState | null {
    return this.listSnapshots().find((item) => item.id === snapshotId)?.world ?? null
  }

  clearSnapshots(): void {
    this.storage.remove(SNAPSHOT_KEY)
    this.nextSnapshotCheck = 0
  }

  cleanupImages(): number {
    const current = this.storage.get(WORLD_KEY)
    if (!current) return 0
    // 清理必须验证所有保留存档；无法确认引用时宁可停止，不猜测图片无用。
    const worlds = [normalizeWorldState(current)]
    const snapshots = this.storage.get(SNAPSHOT_KEY)
    if (snapshots) {
      if (!Array.isArray(snapshots)) throw new Error('快照不可读，暂不清理图片。')
      for (const snapshot of snapshots) worlds.push(normalizeWorldState(snapshot.world))
    }
    const used = referencedImages(worlds)
    let removed = 0
    for (const key of this.storage.info().keys) {
      if (key.startsWith(IMAGE_PREFIX) && !used.has(key)) { this.storage.remove(key); removed++ }
    }
    this.imageKeys.clear()
    return removed
  }

  getStats(): WorldStorageStats {
    const current = this.storage.get(WORLD_KEY)
    const snapshots = this.storage.get(SNAPSHOT_KEY)
    const info = this.storage.info()
    return {
      worldBytes: byteLength(current), snapshotBytes: byteLength(snapshots),
      snapshotCount: this.listSnapshots().length,
      storageUsedKB: Number(info.currentSize ?? 0), storageLimitKB: Number(info.limitSize ?? 0)
    }
  }
}
