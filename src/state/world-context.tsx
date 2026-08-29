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
import {
  abandonSession,
  archiveCampaign,
  checkpointActiveSessions,
  createCampaignFromTemplate,
  createInitialWorldState,
  deriveWorld,
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
import { makeId } from '../domain/utils'
import { normalizeWorldState, worldRepository } from '../services/world-repository'

interface WorldActions {
  createCampaign(input: CampaignCreationInput): MapEditResult
  selectCampaign(campaignId: string): void
  beginExpedition(nodeId: string, minutes: number, mode: SessionMode): ExpeditionStartResult
  pauseExpedition(sessionId: string): void
  resumeExpedition(sessionId: string): void
  abandonExpedition(sessionId: string): void
  settleExpedition(sessionId: string, input: Omit<SettlementInput, 'clientMutationId'>): MapEditResult
  beginTruce(days: number): void
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
  const [now, setNow] = useState(() => new Date().toISOString())

  const commitWorld = useCallback((next: WorldState) => {
    worldRef.current = next
    setWorld(next)
  }, [])

  const checkpointWorld = useCallback((persistImmediately = false) => {
    const timestamp = new Date().toISOString()
    const next = checkpointActiveSessions(worldRef.current, timestamp)
    setNow(timestamp)
    if (next === worldRef.current) return
    commitWorld(next)
    if (persistImmediately) {
      try {
        worldRepository.save(next)
      } catch {
        // 正常保存副作用会继续提示空间不足，此处只尽力保存离开前检查点。
      }
    }
  }, [commitWorld])

  useEffect(() => {
    const saved = worldRepository.load()
    if (saved) commitWorld(pauseInterruptedSessions(saved))
    setHydrated(true)
  }, [commitWorld])

  useEffect(() => {
    if (!hydrated) return
    try {
      worldRepository.save(world)
    } catch {
      Taro.showToast({ title: '本地空间不足，存档未能保存', icon: 'none' })
    }
  }, [world, hydrated])

  useEffect(() => {
    const timer = setInterval(() => checkpointWorld(), 30_000)
    return () => clearInterval(timer)
  }, [checkpointWorld])

  useEffect(() => {
    const handleHide = () => checkpointWorld(true)
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

  const createCampaign = useCallback((input: CampaignCreationInput): MapEditResult => {
    const timestamp = new Date().toISOString()
    try {
      const next = createCampaignFromTemplate(worldRef.current, input, timestamp)
      setNow(timestamp)
      commitWorld(next)
      return { ok: true }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : '战役创建失败。' }
    }
  }, [commitWorld])

  const selectCampaign = useCallback((campaignId: string) => {
    commitWorld(setActiveCampaign(worldRef.current, campaignId))
  }, [commitWorld])

  const beginExpedition = useCallback((nodeId: string, minutes: number, mode: SessionMode): ExpeditionStartResult => {
    const current = worldRef.current
    const existing = current.sessions.find((session) => session.status === 'active' || session.status === 'paused')
    if (existing) return { ok: true, sessionId: existing.id }
    const timestamp = new Date().toISOString()
    const sessionId = makeId('session')
    try {
      const planned = planSession(current, nodeId, minutes, mode, timestamp, sessionId)
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
    const timestamp = new Date().toISOString()
    setNow(timestamp)
    commitWorld(pauseSession(worldRef.current, sessionId, timestamp))
  }, [commitWorld])

  const resumeExpedition = useCallback((sessionId: string) => {
    const timestamp = new Date().toISOString()
    setNow(timestamp)
    try {
      commitWorld(startSession(worldRef.current, sessionId, timestamp))
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '暂时无法继续行动', icon: 'none' })
    }
  }, [commitWorld])

  const abandonExpedition = useCallback((sessionId: string) => {
    const timestamp = new Date().toISOString()
    setNow(timestamp)
    commitWorld(abandonSession(worldRef.current, sessionId, timestamp))
  }, [commitWorld])

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
    commitWorld(setTruce(worldRef.current, timestamp, end.toISOString(), timestamp))
  }, [commitWorld])

  const archive = useCallback((campaignId: string) => {
    const timestamp = new Date().toISOString()
    commitWorld(archiveCampaign(worldRef.current, campaignId, timestamp))
  }, [commitWorld])

  const applyMapOperation = useCallback((operation: (current: WorldState, timestamp: string) => WorldState): MapEditResult => {
    const timestamp = new Date().toISOString()
    try {
      const next = operation(worldRef.current, timestamp)
      setNow(timestamp)
      commitWorld(next)
      return { ok: true }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : '地图修改失败。' }
    }
  }, [commitWorld])

  const replaceWorld = useCallback((nextWorld: WorldState, snapshotLabel = '导入前存档') => {
    const normalized = normalizeWorldState(nextWorld)
    try {
      worldRepository.createSnapshot(worldRef.current, snapshotLabel)
    } catch {
      // 快照空间不足不应阻断用户主动导入的有效备份。
    }
    setNow(new Date().toISOString())
    commitWorld(normalized)
  }, [commitWorld])

  const restoreSnapshot = useCallback((snapshotId: string): MapEditResult => {
    const restored = worldRepository.restoreSnapshot(snapshotId)
    if (!restored) return { ok: false, message: '没有找到这份自动快照。' }
    try {
      worldRepository.createSnapshot(worldRef.current, '恢复前存档')
    } catch {
      // 当前快照已经校验可用，空间不足时仍应允许恢复。
    }
    setNow(new Date().toISOString())
    commitWorld(restored)
    return { ok: true }
  }, [commitWorld])

  const updateReminders = useCallback((patch: Partial<ReminderSettings>) => {
    commitWorld({
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
    })
  }, [commitWorld])

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

  const campaigns = useMemo(() => deriveWorld(world, now), [world, now])
  const activeCampaign = campaigns.find((campaign) => campaign.id === world.profile.activeCampaignId)
    ?? campaigns.find((campaign) => campaign.status !== 'archived')

  useEffect(() => {
    const count = getReminderCount(world, campaigns, now)
    if (count > 0) {
      Taro.setTabBarBadge({ index: 0, text: count > 99 ? '99+' : String(count) }).catch(() => undefined)
    } else {
      Taro.removeTabBarBadge({ index: 0 }).catch(() => undefined)
    }
  }, [world, campaigns, now])

  const actions = useMemo<WorldActions>(() => ({
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
      {children}
    </WorldContext.Provider>
  )
}

export function useWorld(): WorldContextValue {
  const value = useContext(WorldContext)
  if (!value) throw new Error('useWorld 必须在 WorldProvider 中使用。')
  return value
}
