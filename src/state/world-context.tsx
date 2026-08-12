import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren
} from 'react'
import {
  abandonSession,
  archiveCampaign,
  createCampaignFromTemplate,
  createInitialWorldState,
  deriveWorld,
  pauseSession,
  planSession,
  setActiveCampaign,
  setTruce,
  settleSession,
  startSession
} from '../domain/engine'
import type {
  CampaignCreationInput,
  DerivedCampaign,
  SessionMode,
  SettlementInput,
  WorldState
} from '../domain/types'
import { makeId } from '../domain/utils'
import { worldRepository } from '../services/world-repository'

interface WorldActions {
  createCampaign(input: CampaignCreationInput): void
  selectCampaign(campaignId: string): void
  beginExpedition(nodeId: string, minutes: number, mode: SessionMode): ExpeditionStartResult
  pauseExpedition(sessionId: string): void
  resumeExpedition(sessionId: string): void
  abandonExpedition(sessionId: string): void
  settleExpedition(sessionId: string, input: Omit<SettlementInput, 'clientMutationId'>): void
  beginTruce(days: number): void
  archive(campaignId: string): void
}

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
  const [hydrated, setHydrated] = useState(false)
  const [now, setNow] = useState(() => new Date().toISOString())

  useEffect(() => {
    const saved = worldRepository.load()
    if (saved) setWorld(saved)
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (hydrated) worldRepository.save(world)
  }, [world, hydrated])

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date().toISOString()), 30_000)
    return () => clearInterval(timer)
  }, [])

  const createCampaign = useCallback((input: CampaignCreationInput) => {
    const timestamp = new Date().toISOString()
    setNow(timestamp)
    setWorld((current) => createCampaignFromTemplate(current, input, timestamp))
  }, [])

  const selectCampaign = useCallback((campaignId: string) => {
    setWorld((current) => setActiveCampaign(current, campaignId))
  }, [])

  const beginExpedition = useCallback((nodeId: string, minutes: number, mode: SessionMode): ExpeditionStartResult => {
    const existing = world.sessions.find((session) => session.status === 'active' || session.status === 'paused')
    if (existing) return { ok: true, sessionId: existing.id }
    const timestamp = new Date().toISOString()
    const sessionId = makeId('session')
    try {
      const planned = planSession(world, nodeId, minutes, mode, timestamp, sessionId)
      const started = startSession(planned.world, sessionId, timestamp)
      setNow(timestamp)
      setWorld(started)
      return { ok: true, sessionId }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : '暂时无法发起这次行动。'
      }
    }
  }, [world])

  const pauseExpedition = useCallback((sessionId: string) => {
    const timestamp = new Date().toISOString()
    setNow(timestamp)
    setWorld((current) => pauseSession(current, sessionId, timestamp))
  }, [])

  const resumeExpedition = useCallback((sessionId: string) => {
    const timestamp = new Date().toISOString()
    setNow(timestamp)
    setWorld((current) => startSession(current, sessionId, timestamp))
  }, [])

  const abandonExpedition = useCallback((sessionId: string) => {
    const timestamp = new Date().toISOString()
    setNow(timestamp)
    setWorld((current) => abandonSession(current, sessionId, timestamp))
  }, [])

  const settleExpedition = useCallback((sessionId: string, input: Omit<SettlementInput, 'clientMutationId'>) => {
    const timestamp = new Date().toISOString()
    setNow(timestamp)
    setWorld((current) => settleSession(current, sessionId, {
      ...input,
      clientMutationId: makeId('mutation')
    }, timestamp))
  }, [])

  const beginTruce = useCallback((days: number) => {
    const start = new Date()
    const end = new Date(start.getTime() + days * 24 * 60 * 60 * 1000)
    const timestamp = start.toISOString()
    setNow(timestamp)
    setWorld((current) => setTruce(current, timestamp, end.toISOString(), timestamp))
  }, [])

  const archive = useCallback((campaignId: string) => {
    const timestamp = new Date().toISOString()
    setWorld((current) => archiveCampaign(current, campaignId, timestamp))
  }, [])

  const campaigns = useMemo(() => deriveWorld(world, now), [world, now])
  const activeCampaign = campaigns.find((campaign) => campaign.id === world.profile.activeCampaignId)
    ?? campaigns.find((campaign) => campaign.status !== 'archived')

  const actions = useMemo<WorldActions>(() => ({
    createCampaign,
    selectCampaign,
    beginExpedition,
    pauseExpedition,
    resumeExpedition,
    abandonExpedition,
    settleExpedition,
    beginTruce,
    archive
  }), [
    createCampaign,
    selectCampaign,
    beginExpedition,
    pauseExpedition,
    resumeExpedition,
    abandonExpedition,
    settleExpedition,
    beginTruce,
    archive
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
