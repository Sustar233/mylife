import { Text, View } from '@tarojs/components'
import { assaultProgress, isAssault } from '../domain/assault'
import { useWorld } from '../state/world-context'

export function AssaultBrief() {
  const { world, activeCampaign, now } = useWorld()
  if (!activeCampaign || !isAssault(activeCampaign)) return null
  const progress = assaultProgress(world, activeCampaign, now)
  const completed = activeCampaign.nodes.filter((node) => node.owner === 'self').length
  return <View className='paper-card assault-brief'>
    <View className='section-title'>导游证突击 · {activeCampaign.status === 'failed' ? '未按期完成，战役失败' : activeCampaign.status === 'victorious' ? '已完成备考目标' : '限时备考中'}</View>
    <View>截止：2026 年 11 月 21 日 00:00（北京时间）</View>
    <View><Text>今日已提交 {Math.floor(progress.todaySeconds / 60)} / 420 分钟</Text> · 总学习 {(progress.seconds / 3600).toFixed(1)} / 70 小时</View>
    <View>已验收 {completed}/{activeCampaign.nodes.length} 个节点 · 还需 {progress.remainingMinutes} 分钟学习</View>
    <View className='muted'>每天目标 7 小时，可补进度；进攻、复习与御敌的已提交有效计时均计入。70 小时与全部节点验收缺一不可。</View>
    <View className='muted'>敌军：防守间隔 12 小时，到期后每 6 小时侵蚀 15 稳定度。休整不延长考试期限。</View>
  </View>
}
