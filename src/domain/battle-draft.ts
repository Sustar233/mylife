import type { BattleDraft, WorldState } from './types'

export const EMPTY_BATTLE_DRAFT: BattleDraft = { outcome: 'partial', note: '', link: '', images: [], score: '', reviewRating: 'good' }

export function saveBattleDraft(world: WorldState, sessionId: string, draft: BattleDraft): WorldState {
  const session = world.sessions.find((item) => item.id === sessionId)
  if (!session || !['active', 'paused'].includes(session.status)) return world
  if (JSON.stringify(session.draft) === JSON.stringify(draft)) return world
  return { ...world, sessions: world.sessions.map((item) => item.id === sessionId ? { ...item, draft } : item) }
}
