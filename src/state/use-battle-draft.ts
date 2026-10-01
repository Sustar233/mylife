import { useCallback, useEffect, useRef, useState } from 'react'
import Taro from '@tarojs/taro'
import type { BattleDraft } from '../domain/types'
import { EMPTY_BATTLE_DRAFT } from '../domain/battle-draft'
import { useWorld } from './world-context'

export function useBattleDraft(sessionId: string) {
  const { world, hydrated, actions } = useWorld()
  const session = world.sessions.find((item) => item.id === sessionId)
  const [draft, setDraft] = useState(session?.draft ?? EMPTY_BATTLE_DRAFT)
  const [saveStatus, setSaveStatus] = useState('')
  const pending = useRef({ sessionId, draft, dirty: false })
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const flush = useCallback(() => {
    clearTimeout(timer.current)
    if (!pending.current.dirty) return
    const result = actions.saveDraft(pending.current.sessionId, pending.current.draft)
    if (result.ok) pending.current.dirty = false
    setSaveStatus(result.ok ? '草稿已保存在本机' : result.message)
  }, [actions])

  useEffect(() => {
    if (!hydrated) return
    if (!pending.current.dirty) {
      const restored = session?.draft ?? EMPTY_BATTLE_DRAFT
      pending.current = { sessionId, draft: restored, dirty: false }
      setDraft(restored)
      setSaveStatus(session?.draft ? '已恢复上次未提交的草稿' : '')
    }
    const hide = () => flush()
    if (process.env.TARO_ENV === 'weapp') Taro.onAppHide(hide)
    const visibility = () => { if (document.visibilityState === 'hidden') hide() }
    if (process.env.TARO_ENV === 'h5') {
      document.addEventListener('visibilitychange', visibility)
      window.addEventListener('pagehide', hide)
    }
    return () => {
      flush()
      if (process.env.TARO_ENV === 'weapp') Taro.offAppHide(hide)
      if (process.env.TARO_ENV === 'h5') {
        document.removeEventListener('visibilitychange', visibility)
        window.removeEventListener('pagehide', hide)
      }
    }
  }, [hydrated, sessionId, flush])

  const updateDraft = useCallback((patch: Partial<BattleDraft>) => {
    const next = { ...pending.current.draft, ...patch }
    pending.current = { sessionId, draft: next, dirty: true }
    setDraft(next)
    setSaveStatus('正在保存草稿…')
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, 350)
  }, [sessionId, flush])
  return { draft, updateDraft, saveStatus }
}
