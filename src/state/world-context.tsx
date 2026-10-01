import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren
} from 'react'
import Taro from '@tarojs/taro'
import { Button, View } from '@tarojs/components'
import {
  abandonSession,
  archiveCampaign,
  checkpointActiveSessions,
  createCampaignFromTemplate,
  createInitialWorldState,
  deriveCampaign,
  findNode,
  getDailyTroopStatus,
  pauseSession,
  pauseInterruptedSessions,
  planSession,
  setActiveCampaign,
  setTruce,
  settleSession,
  startSession
} from '../domain/engine'
import { getReminderCount } from '../domain/agenda'
import { assignNpcToDuty, createNpcCharacter, deleteNpcCharacter } from '../domain/npcs'
import {
  archiveRewardItem,
  createRewardItem,
  fulfillRewardRedemption,
  redeemRewardItem
} from '../domain/rewards'
import type {
  CampaignCreationInput,
  DerivedCampaign,
  SessionMode,
  SettlementInput,
  ReminderSettings,
  NpcCharacterId,
  NpcCharacterInput,
  NpcDuty,
  RewardItemInput,
  WorldState
} from '../domain/types'
import type { BattleDraft } from '../domain/types'
import { saveBattleDraft } from '../domain/battle-draft'
import { affordableMinutes } from '../domain/session-planning'
import { makeId } from '../domain/utils'
import { showUserToast } from '../services/taro-ui'
import { normalizeWorldState, worldRepository } from '../services/world-repository'

interface WorldActions {
  createCampaign(input: CampaignCreationInput): MapEditResult
  selectCampaign(campaignId: string): void
  beginExpedition(nodeId: string, minutes: number, mode: SessionMode): ExpeditionStartResult
  pauseExpedition(sessionId: string): void
  resumeExpedition(sessionId: string): void
  abandonExpedition(sessionId: string): MapEditResult
  settleExpedition(sessionId: string, input: Omit<SettlementInput, 'clientMutationId'>): MapEditResult
  beginTruce(days: number): MapEditResult
  archive(campaignId: string): void
  applyMapOperation(operation: (current: WorldState, timestamp: string) => WorldState): MapEditResult
  replaceWorld(nextWorld: WorldState, snapshotLabel?: string): void
  restoreSnapshot(snapshotId: string): MapEditResult
  updateReminders(patch: Partial<ReminderSettings>): void
  createReward(input: RewardItemInput): MapEditResult
  archiveReward(itemId: string): MapEditResult
  redeemReward(itemId: string): MapEditResult
  fulfillReward(redemptionId: string): MapEditResult
  assignNpc(duty: NpcDuty, characterId: NpcCharacterId): MapEditResult
  createNpc(input: NpcCharacterInput): MapEditResult
  deleteNpc(characterId: NpcCharacterId): MapEditResult
  saveDraft(sessionId: string, draft: BattleDraft): MapEditResult
}

export type MapEditResult = { ok: true } | { ok: false; message: string }

export type ExpeditionStartResult =
  | { ok: true; sessionId: string }
  | { ok: false; message: string }

interface WorldContextValue {
  world: WorldState
  campaigns: DerivedCampaign[]
  activeCampaign?: DerivedCampaign
  hydrated: boolean
  now: string
  actions: WorldActions
}

const WorldContext = createContext<WorldContextValue | undefined>(undefined)

export function WorldProvider({ children }: PropsWithChildren) {
  const [world, setWorld] = useState<WorldState>(() => createInitialWorldState())
  const worldRef = useRef(world)
  const [hydrated, setHydrated] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [now, setNow] = useState(() => new Date().toISOString())

  const commitWorld = useCallback((next: WorldState, persist = true) => {
    if (next === worldRef.current) return
    if (persist) worldRepository.save(next)
    worldRef.current = next
    setWorld(next)
  }, [])

  const checkpointWorld = useCallback(() => {
    const timestamp = new Date().toISOString()
    const next = checkpointActiveSessions(worldRef.current, timestamp)
    setNow(timestamp)
    if (next === worldRef.current) return
    try { commitWorld(next) } catch { showUserToast('计时未能保存，请检查本地空间') }
  }, [commitWorld])

  const loadWorld = useCallback(() => {
    try {
      const saved = worldRepository.load()
      if (saved) commitWorld(pauseInterruptedSessions(saved), false)
      setLoadError('')
      setHydrated(true)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '存档读取失败，请重试。')
    }
  }, [commitWorld])
  useEffect(() => { loadWorld() }, [loadWorld])

  useEffect(() => {
    const timer = setInterval(() => checkpointWorld(), 30_000)
    return () => clearInterval(timer)
  }, [checkpointWorld])

  useEffect(() => {
    const handleHide = () => checkpointWorld()
    if (process.env.TARO_ENV === 'weapp') Taro.onAppHide(handleHide)
    if (process.env.TARO_ENV === 'h5') {
      const handleVisibility = () => {
        if (document.visibilityState === 'hidden') handleHide()
      }
      document.addEventListener('visibilitychange', handleVisibility)
      return () => document.removeEventListener('visibilitychange', handleVisibility)
    }
    return () => {
      if (process.env.TARO_ENV === 'weapp') Taro.offAppHide(handleHide)
    }
  }, [checkpointWorld])

  const runWorldOperation = useCallback((operation: (current: WorldState, timestamp: string) => WorldState): MapEditResult => {
    const timestamp = new Date().toISOString()
    try {
      const next = operation(worldRef.current, timestamp)
      setNow(timestamp)
      commitWorld(next)
      return { ok: true }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : '操作失败，请稍后重试。' }
    }
  }, [commitWorld])

  const createCampaign = useCallback((input: CampaignCreationInput) => runWorldOperation(
    (current, timestamp) => createCampaignFromTemplate(current, input, timestamp)
  ), [runWorldOperation])

  const selectCampaign = useCallback((campaignId: string) => {
    const result = runWorldOperation((current) => setActiveCampaign(current, campaignId))
    if (!result.ok) showUserToast(result.message)
  }, [runWorldOperation])

  const beginExpedition = useCallback((nodeId: string, minutes: number, mode: SessionMode): ExpeditionStartResult => {
    const current = worldRef.current
    const existing = current.sessions.find((session) => session.status === 'active' || session.status === 'paused')
    if (existing) return { ok: true, sessionId: existing.id }
    const timestamp = new Date().toISOString()
    const sessionId = makeId('session')
    try {
      const { campaign } = findNode(current, nodeId)
      const remaining = getDailyTroopStatus(current, timestamp, campaign.dailyTroops).remainingMinutes
      const chosenMinutes = affordableMinutes(remaining, minutes)
      if (chosenMinutes == null) return { ok: false, message: '今日兵力不足，次日 00:00 自动恢复。' }
      const planned = planSession(current, nodeId, chosenMinutes, mode, timestamp, sessionId)
      const started = startSession(planned.world, sessionId, timestamp)
      setNow(timestamp)
      commitWorld(started)
      return { ok: true, sessionId }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : '暂时无法发起这次行动。'
      }
    }
  }, [commitWorld])

  const pauseExpedition = useCallback((sessionId: string) => {
    const result = runWorldOperation((current, timestamp) => pauseSession(current, sessionId, timestamp))
    if (!result.ok) showUserToast(result.message)
  }, [runWorldOperation])

  const resumeExpedition = useCallback((sessionId: string) => {
    const timestamp = new Date().toISOString()
    setNow(timestamp)
    try {
      commitWorld(startSession(worldRef.current, sessionId, timestamp))
    } catch (error) {
      showUserToast(error instanceof Error ? error.message : '暂时无法继续行动')
    }
  }, [commitWorld])

  const abandonExpedition = useCallback((sessionId: string) => {
    return runWorldOperation((current, timestamp) => abandonSession(current, sessionId, timestamp))
  }, [runWorldOperation])

  const settleExpedition = useCallback((sessionId: string, input: Omit<SettlementInput, 'clientMutationId'>): MapEditResult => {
    const timestamp = new Date().toISOString()
    try {
      const next = settleSession(worldRef.current, sessionId, {
        ...input,
        clientMutationId: makeId('mutation')
      }, timestamp)
      setNow(timestamp)
      commitWorld(next)
      return { ok: true }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : '战果结算失败。' }
    }
  }, [commitWorld])

  const beginTruce = useCallback((days: number) => {
    const start = new Date()
    const end = new Date(start.getTime() + days * 24 * 60 * 60 * 1000)
    const timestamp = start.toISOString()
    setNow(timestamp)
    return runWorldOperation((current) => setTruce(current, timestamp, end.toISOString(), timestamp))
  }, [runWorldOperation])

  const archive = useCallback((campaignId: string) => {
    const result = runWorldOperation((current, timestamp) => archiveCampaign(current, campaignId, timestamp))
    if (!result.ok) showUserToast(result.message)
  }, [runWorldOperation])

  const applyMapOperation = runWorldOperation

  const replaceWorld = useCallback((nextWorld: WorldState, snapshotLabel = '导入前存档') => {
    const normalized = pauseInterruptedSessions(normalizeWorldState(nextWorld))
    worldRepository.createSnapshot(worldRef.current, snapshotLabel)
    setNow(new Date().toISOString())
    commitWorld(normalized)
  }, [commitWorld])

  const restoreSnapshot = useCallback((snapshotId: string): MapEditResult => {
    const restored = worldRepository.restoreSnapshot(snapshotId)
    if (!restored) return { ok: false, message: '没有找到这份自动快照。' }
    return runWorldOperation((current) => {
      worldRepository.createSnapshot(current, '恢复前存档')
      return pauseInterruptedSessions(restored)
    })
  }, [runWorldOperation])

  const updateReminders = useCallback((patch: Partial<ReminderSettings>) => {
    const result = runWorldOperation(() => ({
      ...worldRef.current,
      profile: {
        ...worldRef.current.profile,
        reminders: {
          enabled: true,
          dueSoonHours: 48,
          dailyBriefHour: 8,
          ...worldRef.current.profile.reminders,
          ...patch
        }
      }
    }))
    if (!result.ok) showUserToast(result.message)
  }, [runWorldOperation])

  const saveDraft = useCallback((sessionId: string, draft: BattleDraft): MapEditResult => {
    try {
      commitWorld(saveBattleDraft(worldRef.current, sessionId, draft))
      return { ok: true }
    } catch { return { ok: false, message: '草稿未能保存，请检查本地空间' } }
  }, [commitWorld])

  const createReward = useCallback((input: RewardItemInput) => runWorldOperation(
    (current, timestamp) => createRewardItem(current, input, timestamp)
  ), [runWorldOperation])

  const archiveReward = useCallback((itemId: string) => runWorldOperation(
    (current, timestamp) => archiveRewardItem(current, itemId, timestamp)
  ), [runWorldOperation])

  const redeemReward = useCallback((itemId: string) => runWorldOperation(
    (current, timestamp) => redeemRewardItem(current, itemId, timestamp)
  ), [runWorldOperation])

  const fulfillReward = useCallback((redemptionId: string) => runWorldOperation(
    (current, timestamp) => fulfillRewardRedemption(current, redemptionId, timestamp)
  ), [runWorldOperation])

  const assignNpc = useCallback((duty: NpcDuty, characterId: NpcCharacterId) => runWorldOperation(
    (current) => assignNpcToDuty(current, duty, characterId)
  ), [runWorldOperation])

  const createNpc = useCallback((input: NpcCharacterInput) => runWorldOperation(
    (current, timestamp) => createNpcCharacter(current, input, timestamp)
  ), [runWorldOperation])

  const deleteNpc = useCallback((characterId: NpcCharacterId) => runWorldOperation(
    (current) => deleteNpcCharacter(current, characterId)
  ), [runWorldOperation])

  const campaigns = useMemo(() => world.campaigns.map((campaign) => deriveCampaign(campaign, now)), [world.campaigns, now])
  const activeCampaign = campaigns.find((campaign) => campaign.id === world.profile.activeCampaignId && campaign.status !== 'archived')
    ?? campaigns.find((campaign) => campaign.status !== 'archived')

  const reminderCount = useMemo(() => getReminderCount(world, campaigns, now), [world, campaigns, now])
  useEffect(() => {
    const count = reminderCount
    if (count > 0) {
      Taro.setTabBarBadge({ index: 0, text: count > 99 ? '99+' : String(count) }).catch(() => undefined)
    } else {
      Taro.removeTabBarBadge({ index: 0 }).catch(() => undefined)
    }
  }, [reminderCount])

  const actions = useMemo<WorldActions>(() => ({
    saveDraft,
    createCampaign,
    selectCampaign,
    beginExpedition,
    pauseExpedition,
    resumeExpedition,
    abandonExpedition,
    settleExpedition,
    beginTruce,
    archive,
    applyMapOperation,
    replaceWorld,
    restoreSnapshot,
    updateReminders,
    createReward,
    archiveReward,
    redeemReward,
    fulfillReward,
    assignNpc,
    createNpc,
    deleteNpc
  }), [
    saveDraft,
    createCampaign,
    selectCampaign,
    beginExpedition,
    pauseExpedition,
    resumeExpedition,
    abandonExpedition,
    settleExpedition,
    beginTruce,
    archive,
    applyMapOperation,
    replaceWorld,
    restoreSnapshot,
    updateReminders,
    createReward,
    archiveReward,
    redeemReward,
    fulfillReward,
    assignNpc,
    createNpc,
    deleteNpc
  ])

  return (
    <WorldContext.Provider value={{ world, campaigns, activeCampaign, hydrated, now, actions }}>
      {loadError ? <View className='page-shell'><View className='paper-card'><View className='section-title'>暂时无法展开存档</View><View>{loadError}</View><Button className='primary-button' onClick={loadWorld}>重新读取</Button></View></View> : children}
    </WorldContext.Provider>
  )
}

export function useWorld(): WorldContextValue {
  const value = useContext(WorldContext)
  if (!value) throw new Error('useWorld 必须在 WorldProvider 中使用。')
  return value
}
