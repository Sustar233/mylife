import { useMemo } from 'react'
import { Button, Image, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { EVENT_ICONS } from '../../domain/presentation'
import { NpcGuide } from '../../components/NpcGuide'
import { formatDateTime } from '../../domain/utils'
import { useWorld } from '../../state/world-context'
import './index.scss'

export default function ChroniclePage() {
  const { world, campaigns, activeCampaign, hydrated, now, actions } = useWorld()
  const settledSessions = world.sessions.filter((session) => session.status === 'settled')
  const achievedSessions = settledSessions.filter((session) => session.outcome === 'achieved')
  const totalMinutes = settledSessions.reduce((total, session) => total + Math.max(1, Math.ceil(session.accumulatedSeconds / 60)), 0)
  const completionRate = settledSessions.length ? Math.round((achievedSessions.length / settledSessions.length) * 100) : 0
  const controlledTotal = campaigns.flatMap((campaign) => campaign.nodes).filter((node) => node.effectiveOwner === 'self').length
  const activeTruce = world.profile.truce && new Date(world.profile.truce.endAt) > new Date(now) ? world.profile.truce : undefined

  const evidenceWithContext = useMemo(() => world.evidence.slice(0, 12).map((item) => {
    const session = world.sessions.find((candidate) => candidate.id === item.sessionId)
    const campaign = campaigns.find((candidate) => candidate.id === session?.campaignId)
    const node = campaign?.nodes.find((candidate) => candidate.id === session?.nodeId)
    return { item, node, session }
  }), [world.evidence, world.sessions, campaigns])

  const startTruce = async (days: number) => {
    const result = await Taro.showModal({
      title: `休整 ${days} 天？`,
      content: '所有已安排复习会整体顺延，休整记录将写入战史。',
      confirmText: '发布休整令',
      confirmColor: '#50666a'
    })
    if (result.confirm) {
      actions.beginTruce(days)
      Taro.showToast({ title: '全境已进入休整', icon: 'success' })
    }
  }

  const archiveCurrent = async () => {
    if (!activeCampaign) return
    const result = await Taro.showModal({
      title: `归档「${activeCampaign.title}」？`,
      content: '地图、证据和战史都会保留，同时会释放一个战役名额。',
      confirmText: '转入档案',
      confirmColor: '#50666a'
    })
    if (result.confirm) actions.archive(activeCampaign.id)
  }

  if (!hydrated) return <View className='page-shell loading-screen'>正在整理战史…</View>

  return (
    <View className='page-shell chronicle-page'>
      <View className='chronicle-header'>
        <View>
          <View className='eyebrow'>THE GRAND CHRONICLE · 战史</View>
          <View className='page-title'>疆域纪年</View>
          <View className='page-subtitle'>所有投入与成果都保留，即使领地暂时失守。</View>
        </View>
        <View className='storage-badge'><Text>本地</Text><small>持久化</small></View>
      </View>

      <NpcGuide
        role='historian'
        line={world.events.length
          ? `已录下 ${world.events.length} 则纪事、${world.evidence.length} 份成果。每一次用功，皆有迹可循。`
          : '新卷已备，只待阁下写下第一场出征。'}
      />

      <View className='chronicle-metrics'>
        <View><Text>{totalMinutes}</Text><small>有效学习分钟</small></View>
        <View><Text>{controlledTotal}</Text><small>当前控制领地</small></View>
        <View><Text>{completionRate}%</Text><small>行动达成率</small></View>
      </View>

      <View className='paper-card truce-card'>
        <View className='truce-copy'>
          <View className='section-title'>{activeTruce ? '全境休整中' : '发布休整令'}</View>
          <View className='muted'>{activeTruce
            ? `复习期限已顺延，休整将在 ${formatDateTime(activeTruce.endAt)} 结束。`
            : '旅行、生病或集中冲刺其他任务时，可暂停衰减并顺延复习期限。'}</View>
        </View>
        {!activeTruce && (
          <View className='chip-row truce-actions'>
            {[3, 7, 14].map((days) => <View key={days} className='chip' onClick={() => startTruce(days)}>{days} 天</View>)}
          </View>
        )}
      </View>

      <View className='chronicle-columns'>
        <View className='paper-card timeline-card'>
          <View className='section-title'>领土大事记</View>
          <View className='timeline'>
            {world.events.slice(0, 30).map((entry, index) => (
              <View key={entry.id} className='timeline-item'>
                <View className='timeline-rail'><Text className='timeline-icon'>{EVENT_ICONS[entry.type]}</Text>{index < Math.min(29, world.events.length - 1) && <View className='timeline-line' />}</View>
                <View className='timeline-copy'>
                  <View className='timeline-title'>{entry.title}</View>
                  <View className='timeline-detail'>{entry.detail}</View>
                  <View className='timeline-date'>{formatDateTime(entry.occurredAt)}</View>
                </View>
              </View>
            ))}
          </View>
        </View>

        <View className='paper-card evidence-card'>
          <View className='section-title'>成果档案</View>
          {evidenceWithContext.length === 0 ? (
            <View className='empty-evidence'>完成第一次出征后，成果证据会永久陈列在这里。</View>
          ) : evidenceWithContext.map(({ item, node }) => (
            <View key={item.id} className='evidence-entry'>
              <View className='evidence-meta'>{node?.title ?? '未知战场'} · {formatDateTime(item.createdAt)}</View>
              {item.type === 'image'
                ? <Image className='evidence-image' src={item.content} mode='aspectFill' />
                : <View className={`evidence-content evidence-content--${item.type}`} onClick={() => item.type === 'link' && Taro.setClipboardData({ data: item.content })}>{item.content}</View>}
            </View>
          ))}
        </View>
      </View>

      <View className='paper-card archive-card'>
        <View className='archive-copy'>
          <View className='section-title'>战役管理</View>
          <View className='muted'>最多同时进行 3 场战役。归档只释放名额，不会删除任何记录。</View>
          {activeCampaign && <View className='archive-current'>当前卷宗 · {activeCampaign.title}</View>}
        </View>
        <Button className='secondary-button archive-button' disabled={!activeCampaign} onClick={archiveCurrent}>归档当前战役</Button>
      </View>
    </View>
  )
}
