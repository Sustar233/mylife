import { EMPTY_BATTLE_DRAFT } from '../domain/battle-draft'
import type { BattleDraft } from '../domain/types'

type SaveResult = { ok: true } | { ok: false; message: string }

interface DraftBufferOptions {
  sessionId: string
  revision: number
  draft?: BattleDraft
  isCurrentRevision(revision: number): boolean
  save(sessionId: string, draft: BattleDraft, revision: number): SaveResult
}

/** 一个缓冲区只属于一场行动和一次存档版本，迟到的回调无法跨版本写入。 */
export class BattleDraftBuffer {
  draft: BattleDraft
  status: string
  private dirty = false
  private active = true

  constructor(private readonly options: DraftBufferOptions) {
    this.draft = options.draft ?? EMPTY_BATTLE_DRAFT
    this.status = options.draft ? '已恢复上次未提交的草稿' : ''
  }

  activate(): void { this.active = true }
  deactivate(): void { this.active = false }

  update(patch: Partial<BattleDraft>): boolean {
    if (!this.active || !this.options.isCurrentRevision(this.options.revision)) return false
    this.draft = { ...this.draft, ...patch }
    this.dirty = true
    this.status = '正在保存草稿…'
    return true
  }

  flush(): boolean {
    if (!this.dirty) return false
    if (!this.options.isCurrentRevision(this.options.revision)) {
      this.dirty = false
      return false
    }
    const result = this.options.save(this.options.sessionId, this.draft, this.options.revision)
    if (result.ok) this.dirty = false
    this.status = result.ok ? '草稿已保存在本机' : result.message
    return true
  }
}
