import type { WorldState } from './types'

export interface BackupEnvelope {
  format: 'zhiyu-world-backup'
  formatVersion: 1
  exportedAt: string
  world: WorldState
}

export function formatWorldBackup(world: WorldState, exportedAt = new Date().toISOString()): string {
  const envelope: BackupEnvelope = {
    format: 'zhiyu-world-backup',
    formatVersion: 1,
    exportedAt,
    world
  }
  return JSON.stringify(envelope, null, 2)
}

export function readWorldBackupPayload(text: string): unknown {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('备份文件不是有效的 JSON。')
  }
  if (parsed && typeof parsed === 'object' && 'format' in parsed) {
    const envelope = parsed as Partial<BackupEnvelope>
    if (envelope.format !== 'zhiyu-world-backup') throw new Error('这不是知域存档备份。')
    if (envelope.formatVersion !== 1) throw new Error('备份格式版本暂不受支持。')
    return envelope.world
  }
  return parsed
}
