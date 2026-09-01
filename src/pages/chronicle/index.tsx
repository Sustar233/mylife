import { useMemo, useState } from 'react'
import { Image, Text, View } from '@tarojs/components'
import { EVENT_ICONS } from '../../domain/presentation'
import { NpcGuide } from '../../components/NpcGuide'
import { getLearningAnalytics } from '../../domain/analytics'
import { formatDateTime } from '../../domain/utils'
import { copyText } from '../../services/taro-ui'
import { useWorld } from '../../state/world-context'
import './index.scss'

export default function ChroniclePage() {
  const { world, campaigns, hydrated, now } = useWorld()
  const [archiveView, setArchiveView] = useState<'timeline' | 'evidence'>('timeline')
  const [eventLimit, setEventLimit] = useState(8)
  const [evidenceLimit, setEvidenceLimit] = useState(8)
  const settledSessions = world.sessions.filter((session) => session.status === 'settled')
  const achievedSessions = settledSessions.filter((session) => session.outcome === 'achieved')
  const totalMinutes = settledSessions.reduce((total, session) => total + Math.max(1, Math.ceil(session.accumulatedSeconds / 60)), 0)
  const completionRate = settledSessions.length ? Math.round((achievedSessions.length / settledSessions.length) * 100) : 0
  const controlledTotal = campaigns.flatMap((campaign) => campaign.nodes).filter((node) => node.effectiveOwner === 'self').length
  const analytics = useMemo(() => getLearningAnalytics(world, campaigns, now), [world, campaigns, now])
  const chartMax = Math.max(1, ...analytics.daily.map((point) => point.minutes))

  const evidenceWithContext = useMemo(() => world.evidence.slice(0, evidenceLimit).map((item) => {
    const session = world.sessions.find((candidate) => candidate.id === item.sessionId)
    const campaign = campaigns.find((candidate) => candidate.id === session?.campaignId)
    const node = campaign?.nodes.find((candidate) => candidate.id === session?.nodeId)
    return { item, node, session }
  }), [world.evidence, world.sessions, campaigns, evidenceLimit])
  const visibleEvents = world.events.slice(0, eventLimit)
  const remainingEvents = Math.max(0, world.events.length - visibleEvents.length)
  const remainingEvidence = Math.max(0, world.evidence.length - evidenceWithContext.length)

  if (!hydrated) return <View className='page-shell loading-screen'>正在整理战史…</View>

  return (
    <View className='page-shell chronicle-page'>
      <View className='chronicle-header'>
        <View>
          <View className='eyebrow'>THE GRAND CHRONICLE · 战史</View>
          <View className='page-title'>疆域纪年</View>
          <View className='page-subtitle'>所有投入与成果都保留，即使领地暂时失守。</View>
        </View>
        <View className='storage-badge'><Text>安全</Text><small>存档 v{world.version}</small></View>
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

      <View className='paper-card analytics-card'>
        <View className='analytics-head'>
          <View><View className='eyebrow'>INTELLIGENCE REPORT · 军情分析</View><View className='section-title'>近七日战况</View></View>
          <View className={`analytics-trend ${analytics.trendPercent < 0 ? 'analytics-trend--down' : ''}`}>{analytics.trendPercent >= 0 ? '+' : ''}{analytics.trendPercent}%</View>
        </View>
        <View className='analytics-summary'>
          <View><Text>{analytics.last7Minutes}</Text><small>七日分钟</small></View>
          <View><Text>{analytics.currentStreak}</Text><small>连续作战天数</small></View>
          <View><Text>{analytics.dueNext7Days}</Text><small>七日内待复习</small></View>
          <View><Text>{analytics.overdueCount}</Text><small>告急领地</small></View>
        </View>
        <View className='learning-chart'>
          {analytics.daily.map((point) => (
            <View key={point.day} className='chart-column'>
              <View className='chart-value'>{point.minutes || ''}</View>
              <View className='chart-track'><View className='chart-bar' style={{ height: `${Math.max(point.minutes ? 8 : 0, point.minutes / chartMax * 100)}%` }} /></View>
              <View className='chart-label'>{point.label}</View>
            </View>
          ))}
        </View>
        {analytics.weakTerritories.length > 0 && (
          <View className='weak-list'>
            <View className='analytics-subtitle'>薄弱领地</View>
            {analytics.weakTerritories.slice(0, 3).map((item) => (
              <View key={item.nodeId} className='weak-row'>
                <View><Text>{item.title}</Text><small>{item.campaignTitle} · 未达成 {item.failures} 次</small></View>
                <Text>稳定 {item.stability}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      <View className='chronicle-mobile-tabs'>
        <View className={archiveView === 'timeline' ? 'chronicle-mobile-tab chronicle-mobile-tab--active' : 'chronicle-mobile-tab'} onClick={() => setArchiveView('timeline')}>
          <Text>领土大事记</Text><small>{world.events.length} 则纪事</small>
        </View>
        <View className={archiveView === 'evidence' ? 'chronicle-mobile-tab chronicle-mobile-tab--active' : 'chronicle-mobile-tab'} onClick={() => setArchiveView('evidence')}>
          <Text>成果档案</Text><small>{world.evidence.length} 份成果</small>
        </View>
      </View>

      <View className='chronicle-columns'>
        <View className={`paper-card timeline-card ${archiveView !== 'timeline' ? 'chronicle-panel--mobile-hidden' : ''}`}>
          <View className='section-title'>领土大事记</View>
          <View className='timeline'>
            {visibleEvents.map((entry, index) => (
              <View key={entry.id} className='timeline-item'>
                <View className='timeline-rail'><Text className='timeline-icon'>{EVENT_ICONS[entry.type]}</Text>{index < visibleEvents.length - 1 && <View className='timeline-line' />}</View>
                <View className='timeline-copy'>
                  <View className='timeline-title'>{entry.title}</View>
                  <View className='timeline-detail'>{entry.detail}</View>
                  <View className='timeline-date'>{formatDateTime(entry.occurredAt)}</View>
                </View>
              </View>
            ))}
          </View>
          {world.events.length > 8 && (
            <View className='chronicle-load-more' onClick={() => setEventLimit((current) => remainingEvents ? Math.min(world.events.length, current + 22) : 8)}>
              {remainingEvents ? `查看较早纪事（${Math.min(22, remainingEvents)}）` : '收起较早纪事'}
            </View>
          )}
        </View>

        <View className={`paper-card evidence-card ${archiveView !== 'evidence' ? 'chronicle-panel--mobile-hidden' : ''}`}>
          <View className='section-title'>成果档案</View>
          {evidenceWithContext.length === 0 ? (
            <View className='empty-evidence'>完成第一次出征后，成果证据会永久陈列在这里。</View>
          ) : evidenceWithContext.map(({ item, node }) => (
            <View key={item.id} className='evidence-entry'>
              <View className='evidence-meta'>{node?.title ?? '未知战场'} · {formatDateTime(item.createdAt)}</View>
              {item.type === 'image'
                ? <Image className='evidence-image' src={item.content} mode='aspectFill' />
                : <View className={`evidence-content evidence-content--${item.type}`} onClick={() => item.type === 'link' && void copyText(item.content)}>{item.content}</View>}
            </View>
          ))}
          {world.evidence.length > 8 && (
            <View className='chronicle-load-more' onClick={() => setEvidenceLimit((current) => remainingEvidence ? Math.min(world.evidence.length, current + 12) : 8)}>
              {remainingEvidence ? `查看更多成果（${Math.min(12, remainingEvidence)}）` : '收起较早成果'}
            </View>
          )}
        </View>
      </View>
    </View>
  )
}
