import { Text, View } from '@tarojs/components'
import { RewardStore } from '../../components/RewardStore'
import { useWorld } from '../../state/world-context'
import './index.scss'

export default function TreasuryPage() {
  const { hydrated } = useWorld()

  if (!hydrated) return <View className='page-shell loading-screen'>正在清点国库…</View>

  return (
    <View className='page-shell treasury-page'>
      <View className='treasury-page-header'>
        <View>
          <View className='eyebrow'>TREASURY · 国库</View>
          <View className='page-title'>军饷与犒赏</View>
          <View className='page-subtitle'>把每一次真实投入，兑换成值得期待的休息与奖励。</View>
        </View>
        <View className='treasury-page-seal'><Text>赏</Text><small>有功必录</small></View>
      </View>
      <RewardStore />
    </View>
  )
}
