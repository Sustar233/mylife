import { useMemo } from 'react'
import { Button, Image, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { EVENT_ICONS } from '../../domain/presentation'
import { NpcGuide } from '../../components/NpcGuide'
import { NpcRosterSettings } from '../../components/NpcRosterSettings'
import { DataManagement } from '../../components/DataManagement'
import { RewardStore } from '../../components/RewardStore'
import { getLearningAnalytics } from '../../domain/analytics'
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
  const analytics = useMemo(() => getLearningAnalytics(world, campaigns, now), [world, campaigns, now])
  const reminderSettings = world.profile.reminders ?? { enabled: true, dueSoonHours: 48 as const, dailyBriefHour: 8 }
  const chartMax = Math.max(1, ...analytics.daily.map((point) => point.minutes))

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

      <View className='paper-card reminder-card'>
        <View className='reminder-copy'>
          <View className='eyebrow'>WAR DRUM · 应用内提醒</View>
          <View className='section-title'>每日军报</View>
          <View className='muted'>司令部角标会显示即将到期和已经失守的领地。正式微信推送仍需配置订阅消息模板。</View>
        </View>
        <View className='reminder-settings'>
          <View className='setting-row'><Text>提醒状态</Text><View className='chip-row'><View className={`chip ${reminderSettings.enabled ? 'chip--active' : ''}`} onClick={() => actions.updateReminders({ enabled: true })}>开启</View><View className={`chip ${!reminderSettings.enabled ? 'chip--active' : ''}`} onClick={() => actions.updateReminders({ enabled: false })}>关闭</View></View></View>
          <View className='setting-row'><Text>提前预警</Text><View className='chip-row'>{([24, 48, 72] as const).map((hours) => <View key={hours} className={`chip ${reminderSettings.dueSoonHours === hours ? 'chip--active' : ''}`} onClick={() => actions.updateReminders({ dueSoonHours: hours })}>{hours}h</View>)}</View></View>
          <View className='setting-row'><Text>军报时刻</Text><View className='chip-row'>{[8, 12, 20].map((hour) => <View key={hour} className={`chip ${reminderSettings.dailyBriefHour === hour ? 'chip--active' : ''}`} onClick={() => actions.updateReminders({ dailyBriefHour: hour })}>{hour}:00</View>)}</View></View>
        </View>
      </View>

      <NpcRosterSettings />

      <RewardStore />

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

      <DataManagement />

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
