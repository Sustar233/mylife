import { Image, Text, View } from '@tarojs/components'
import { getNpcCharacterIds, normalizeNpcAssignments } from '../domain/npcs'
import type { NpcDuty } from '../domain/types'
import { useWorld } from '../state/world-context'
import { getNpcCharacter, NPC_DUTY_META } from './npc-roster'
import './NpcGuide.scss'

interface NpcGuideProps {
  role: NpcDuty
  line: string
  compact?: boolean
}

export function NpcGuide({ role, line, compact = false }: NpcGuideProps) {
  const { world } = useWorld()
  const characters = world.profile.customNpcCharacters ?? []
  const assignments = normalizeNpcAssignments(world.profile.npcAssignments, getNpcCharacterIds(characters))
  const npc = getNpcCharacter(assignments[role], characters)
  const duty = NPC_DUTY_META[role]

  return (
    <View className={`npc-guide npc-guide--${role} ${compact ? 'npc-guide--compact' : ''}`}>
      <View className='npc-portrait-frame'>
        <Image className='npc-portrait' src={npc.image} mode='aspectFill' />
        <Text className='npc-seal'>{duty.seal}</Text>
      </View>
      <View className='npc-copy'>
        <View className='npc-identity'><Text>{npc.name}</Text><small>{duty.title}</small></View>
        <View className='npc-line'>「{line}」</View>
      </View>
    </View>
  )
}
