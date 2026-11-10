import { useCallback, useEffect, useMemo, useReducer } from 'react'
import Taro from '@tarojs/taro'
import type { BattleDraft } from '../domain/types'
import { BattleDraftBuffer } from './battle-draft-buffer'
import { useWorld } from './world-context'

export function useBattleDraft(sessionId: string) {
  const { world, worldRevision, hydrated, actions } = useWorld()
  const session = world.sessions.find((item) => item.id === sessionId)
  const [, render] = useReducer((value: number) => value + 1, 0)
  // 普通检查点和自动保存不会替换本地编辑；仅切换行动、载入或恢复存档时重建。
  const editor = useMemo(() => ({
    buffer: new BattleDraftBuffer({
      sessionId, revision: worldRevision, draft: session?.draft,
      isCurrentRevision: actions.isCurrentWorldRevision,
      save: actions.saveDraft
    }),
    timer: undefined as ReturnType<typeof setTimeout> | undefined
  }), [sessionId, worldRevision, hydrated, actions])
  const flush = useCallback(() => {
    clearTimeout(editor.timer)
    if (editor.buffer.flush()) render()
  }, [editor])

  useEffect(() => {
    if (!hydrated) return
    editor.buffer.activate()
    const hide = () => flush()
    if (process.env.TARO_ENV === 'weapp') Taro.onAppHide(hide)
    const visibility = () => { if (document.visibilityState === 'hidden') hide() }
    if (process.env.TARO_ENV === 'h5') {
      document.addEventListener('visibilitychange', visibility)
      window.addEventListener('pagehide', hide)
    }
    return () => {
      clearTimeout(editor.timer)
      editor.buffer.deactivate()
      editor.buffer.flush()
      if (process.env.TARO_ENV === 'weapp') Taro.offAppHide(hide)
      if (process.env.TARO_ENV === 'h5') {
        document.removeEventListener('visibilitychange', visibility)
        window.removeEventListener('pagehide', hide)
      }
    }
  }, [hydrated, editor, flush])

  const updateDraft = useCallback((patch: Partial<BattleDraft>) => {
    if (!editor.buffer.update(patch)) return
    render()
    clearTimeout(editor.timer)
    editor.timer = setTimeout(flush, 350)
  }, [editor, flush])
  return { draft: editor.buffer.draft, updateDraft, saveStatus: editor.buffer.status }
}
