import type { WorldState } from './types'

/** 清理文件前同时保护当前存档和可恢复快照中的成果与头像。 */
export function referencedImages(worlds: readonly WorldState[]): Set<string> {
  return new Set(worlds.flatMap((world) => [
    ...world.evidence.filter((item) => item.type === 'image').map((item) => item.content),
    ...(world.profile.customNpcCharacters ?? []).map((character) => character.image),
    ...world.sessions.flatMap((session) => session.draft?.images ?? [])
  ]))
}
