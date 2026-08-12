import { Image, Text, View } from '@tarojs/components'
import strategistPortrait from '../assets/npc/strategist-ink.webp'
import historianPortrait from '../assets/npc/historian-ink.webp'
import courierPortrait from '../assets/npc/courier-ink.webp'
import './NpcGuide.scss'

type NpcRole = 'strategist' | 'historian' | 'courier'

interface NpcGuideProps {
  role: NpcRole
  line: string
  compact?: boolean
}

const NPCS = {
  strategist: {
    image: strategistPortrait,
    name: '谢玄策',
    title: '帐前军师',
    seal: '谋'
  },
  historian: {
    image: historianPortrait,
    name: '沈砚秋',
    title: '兰台史官',
    seal: '史'
  },
  courier: {
    image: courierPortrait,
    name: '陆惊鸿',
    title: '巡疆驿使',
    seal: '驿'
  }
} satisfies Record<NpcRole, { image: string; name: string; title: string; seal: string }>

export function NpcGuide({ role, line, compact = false }: NpcGuideProps) {
  const npc = NPCS[role]

  return (
    <View className={`npc-guide npc-guide--${role} ${compact ? 'npc-guide--compact' : ''}`}>
      <View className='npc-portrait-frame'>
        <Image className='npc-portrait' src={npc.image} mode='aspectFill' />
        <Text className='npc-seal'>{npc.seal}</Text>
      </View>
      <View className='npc-copy'>
        <View className='npc-identity'><Text>{npc.name}</Text><small>{npc.title}</small></View>
        <View className='npc-line'>「{line}」</View>
      </View>
    </View>
  )
}
