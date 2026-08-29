import type {
  CustomNpcCharacter,
  NpcAssignments,
  NpcCharacterId,
  NpcCharacterInput,
  NpcDuty,
  WorldState
} from './types'
import { makeId } from './utils'

export const NPC_DUTIES: NpcDuty[] = ['strategist', 'historian', 'courier']
export const DEFAULT_NPC_CHARACTER_IDS: NpcCharacterId[] = [
  'xie_xuance',
  'shen_yanqiu',
  'lu_jinghong',
  'lin_zhaoyue',
  'han_dingchuan'
]

export const DEFAULT_NPC_ASSIGNMENTS: NpcAssignments = {
  strategist: 'xie_xuance',
  historian: 'shen_yanqiu',
  courier: 'lu_jinghong'
}

export function normalizeCustomNpcCharacters(value?: CustomNpcCharacter[]): CustomNpcCharacter[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.flatMap((character) => {
    const id = typeof character?.id === 'string' ? character.id.trim() : ''
    const name = typeof character?.name === 'string' ? character.name.trim() : ''
    const trait = typeof character?.trait === 'string' ? character.trait.trim() : ''
    const image = typeof character?.image === 'string' ? character.image.trim() : ''
    if (!id || !name || !trait || !image || DEFAULT_NPC_CHARACTER_IDS.includes(id) || seen.has(id)) return []
    seen.add(id)
    return [{
      id,
      name: name.slice(0, 12),
      trait: trait.slice(0, 16),
      description: typeof character.description === 'string' ? character.description.trim().slice(0, 80) : '',
      image,
      createdAt: typeof character.createdAt === 'string' ? character.createdAt : new Date(0).toISOString()
    }]
  })
}

export function getNpcCharacterIds(customCharacters?: CustomNpcCharacter[]): NpcCharacterId[] {
  return [
    ...DEFAULT_NPC_CHARACTER_IDS,
    ...normalizeCustomNpcCharacters(customCharacters).map((character) => character.id)
  ]
}

export function normalizeNpcAssignments(
  value?: Partial<NpcAssignments>,
  characterIds: NpcCharacterId[] = DEFAULT_NPC_CHARACTER_IDS
): NpcAssignments {
  const next: NpcAssignments = { ...DEFAULT_NPC_ASSIGNMENTS }
  const availableIds = [...new Set([...DEFAULT_NPC_CHARACTER_IDS, ...characterIds])]
  const used = new Set<NpcCharacterId>()

  NPC_DUTIES.forEach((duty) => {
    const candidate = value?.[duty]
    if (candidate && availableIds.includes(candidate) && !used.has(candidate)) {
      next[duty] = candidate
      used.add(candidate)
      return
    }
    const fallback = availableIds.find((characterId) => !used.has(characterId))!
    next[duty] = fallback
    used.add(fallback)
  })
  return next
}

export function assignNpcToDuty(world: WorldState, duty: NpcDuty, characterId: NpcCharacterId): WorldState {
  const characterIds = getNpcCharacterIds(world.profile.customNpcCharacters)
  if (!NPC_DUTIES.includes(duty) || !characterIds.includes(characterId)) throw new Error('幕僚任命无效。')
  const assignments = normalizeNpcAssignments(world.profile.npcAssignments, characterIds)
  if (assignments[duty] === characterId) return world
  const previousCharacter = assignments[duty]
  const occupiedDuty = NPC_DUTIES.find((candidateDuty) => assignments[candidateDuty] === characterId)
  const next = { ...assignments, [duty]: characterId }
  if (occupiedDuty && occupiedDuty !== duty) next[occupiedDuty] = previousCharacter
  return {
    ...world,
    profile: { ...world.profile, npcAssignments: next }
  }
}

export function createNpcCharacter(
  world: WorldState,
  input: NpcCharacterInput,
  now = new Date().toISOString(),
  characterId = makeId('npc')
): WorldState {
  const name = input.name.trim()
  const trait = input.trait.trim()
  const description = input.description?.trim() ?? ''
  const image = input.image.trim()
  if (!name || name.length > 12) throw new Error('角色姓名需要填写，且不能超过 12 个字。')
  if (!trait || trait.length > 16) throw new Error('角色特质需要填写，且不能超过 16 个字。')
  if (description.length > 80) throw new Error('角色简介不能超过 80 个字。')
  if (!image) throw new Error('请为角色选择一张头像。')
  const customNpcCharacters = normalizeCustomNpcCharacters(world.profile.customNpcCharacters)
  if (customNpcCharacters.some((character) => character.name === name)) throw new Error('名册中已有同名的自定义角色。')
  if (getNpcCharacterIds(customNpcCharacters).includes(characterId)) throw new Error('角色编号重复，请重试。')
  return {
    ...world,
    profile: {
      ...world.profile,
      customNpcCharacters: [
        ...customNpcCharacters,
        { id: characterId, name, trait, description, image, createdAt: now }
      ]
    }
  }
}

export function deleteNpcCharacter(world: WorldState, characterId: NpcCharacterId): WorldState {
  const customNpcCharacters = normalizeCustomNpcCharacters(world.profile.customNpcCharacters)
  if (!customNpcCharacters.some((character) => character.id === characterId)) throw new Error('默认角色不能删除。')
  const assignments = normalizeNpcAssignments(
    world.profile.npcAssignments,
    getNpcCharacterIds(customNpcCharacters)
  )
  if (Object.values(assignments).includes(characterId)) throw new Error('该角色正在任职，请先任命其他幕僚。')
  return {
    ...world,
    profile: {
      ...world.profile,
      customNpcCharacters: customNpcCharacters.filter((character) => character.id !== characterId)
    }
  }
}
