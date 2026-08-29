import strategistPortrait from '../assets/npc/strategist-ink.webp'
import historianPortrait from '../assets/npc/historian-ink.webp'
import courierPortrait from '../assets/npc/courier-ink.webp'
import quartermasterPortrait from '../assets/npc/quartermaster-lin-ink.webp'
import trainerPortrait from '../assets/npc/trainer-han-ink.webp'
import type { CustomNpcCharacter, NpcCharacterId, NpcDuty } from '../domain/types'

export interface NpcCharacterView {
  id: NpcCharacterId
  image: string
  name: string
  trait: string
  description: string
  custom: boolean
}

export const DEFAULT_NPC_CHARACTERS: NpcCharacterView[] = [
  {
    id: 'xie_xuance',
    image: strategistPortrait,
    name: '谢玄策',
    trait: '沉着筹谋',
    description: '善于梳理前置关系与长期进军路线。',
    custom: false
  },
  {
    id: 'shen_yanqiu',
    image: historianPortrait,
    name: '沈砚秋',
    trait: '谨慎治档',
    description: '重视证据、复盘与每一段真实投入。',
    custom: false
  },
  {
    id: 'lu_jinghong',
    image: courierPortrait,
    name: '陆惊鸿',
    trait: '敏锐巡疆',
    description: '擅长发现告急领地并传递前线军情。',
    custom: false
  },
  {
    id: 'lin_zhaoyue',
    image: quartermasterPortrait,
    name: '林照月',
    trait: '精于筹运',
    description: '擅长盘点资源、安排节奏并维持长期补给。',
    custom: false
  },
  {
    id: 'han_dingchuan',
    image: trainerPortrait,
    name: '韩定川',
    trait: '治军严整',
    description: '善于拆解训练计划，让每次操练都有明确标准。',
    custom: false
  }
]

export const NPC_DUTY_META = {
  strategist: { label: '军师', title: '帐前军师', seal: '谋', description: '负责司令部军令与每日部署。' },
  historian: { label: '史官', title: '兰台史官', seal: '史', description: '负责战史、成果与国库记录。' },
  courier: { label: '驿使', title: '巡疆驿使', seal: '驿', description: '负责地图军情与领地告警。' }
} satisfies Record<NpcDuty, { label: string; title: string; seal: string; description: string }>

export function getNpcCharacters(customCharacters: CustomNpcCharacter[] = []): NpcCharacterView[] {
  return [
    ...DEFAULT_NPC_CHARACTERS,
    ...customCharacters.map((character) => ({ ...character, custom: true }))
  ]
}

export function getNpcCharacter(characterId: NpcCharacterId, customCharacters: CustomNpcCharacter[] = []) {
  return getNpcCharacters(customCharacters).find((character) => character.id === characterId)
    ?? DEFAULT_NPC_CHARACTERS[0]
}
