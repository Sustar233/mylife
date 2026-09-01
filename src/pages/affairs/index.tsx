import { useState } from 'react'
import { Button, Text, View } from '@tarojs/components'
import { DataManagement } from '../../components/DataManagement'
import { NpcRosterSettings } from '../../components/NpcRosterSettings'
import { formatDateTime } from '../../domain/utils'
import { confirmAction, showUserToast } from '../../services/taro-ui'
import { useWorld } from '../../state/world-context'
import './index.scss'

type AffairsPanel = 'routine' | 'staff' | 'data'

export default function AffairsPage() {
  const { world, activeCampaign, hydrated, now, actions } = useWorld()
  const [panel, setPanel] = useState<AffairsPanel>('routine')
  const activeTruce = world.profile.truce && new Date(world.profile.truce.endAt) > new Date(now) ? world.profile.truce : undefined
  const reminderSettings = world.profile.reminders ?? { enabled: true, dueSoonHours: 48 as const, dailyBriefHour: 8 }

  const startTruce = async (days: number) => {
    const confirmed = await confirmAction({
      title: `休整 ${days} 天？`,
      content: '所有已安排复习会整体顺延，休整记录将写入战史。',
      confirmText: '确认休整',
      confirmColor: '#50666a'
    })
    if (!confirmed) return
    actions.beginTruce(days)
    showUserToast('全境已进入休整', 'success')
  }

  const archiveCurrent = async () => {
    if (!activeCampaign) return
    const confirmed = await confirmAction({
      title: `归档「${activeCampaign.title}」？`,
      content: '地图、证据和战史都会保留，同时会释放一个战役名额。',
      confirmText: '转入档案',
      confirmColor: '#50666a'
    })
    if (confirmed) actions.archive(activeCampaign.id)
  }

  if (!hydrated) return <View className='page-shell loading-screen'>正在整理内务…</View>

  return (
    <View className='page-shell affairs-page'>
      <View className='affairs-header'>
        <View>
          <View className='eyebrow'>DOMESTIC AFFAIRS · 内务</View>
          <View className='page-title'>行营内务</View>
          <View className='page-subtitle'>提醒、幕僚与存档各归其位，需要时再展开处理。</View>
        </View>
        <View className='affairs-seal'><Text>务</Text><small>井然有序</small></View>
      </View>

      <View className='affairs-tabs'>
        {([
          ['routine', '军务', '提醒与休整'],
          ['staff', '幕僚', '任命与名册'],
          ['data', '数据', '备份与恢复']
        ] as const).map(([key, label, detail]) => (
          <View key={key} className={`affairs-tab ${panel === key ? 'affairs-tab--active' : ''}`} onClick={() => setPanel(key)}>
            <Text>{label}</Text>
            <small>{detail}</small>
          </View>
        ))}
      </View>

      {panel === 'routine' && (
        <>
          <View className='paper-card reminder-card'>
            <View className='reminder-copy'>
              <View className='eyebrow'>WAR DRUM · 应用内提醒</View>
              <View className='section-title'>每日军报</View>
              <View className='muted'>司令部角标会显示即将到期和已经失守的领地。</View>
            </View>
            <View className='reminder-settings'>
              <View className='setting-row'><Text>提醒状态</Text><View className='chip-row'><View className={`chip ${reminderSettings.enabled ? 'chip--active' : ''}`} onClick={() => actions.updateReminders({ enabled: true })}>开启</View><View className={`chip ${!reminderSettings.enabled ? 'chip--active' : ''}`} onClick={() => actions.updateReminders({ enabled: false })}>关闭</View></View></View>
              <View className='setting-row'><Text>提前预警</Text><View className='chip-row'>{([24, 48, 72] as const).map((hours) => <View key={hours} className={`chip ${reminderSettings.dueSoonHours === hours ? 'chip--active' : ''}`} onClick={() => actions.updateReminders({ dueSoonHours: hours })}>{hours}h</View>)}</View></View>
              <View className='setting-row'><Text>军报时刻</Text><View className='chip-row'>{[8, 12, 20].map((hour) => <View key={hour} className={`chip ${reminderSettings.dailyBriefHour === hour ? 'chip--active' : ''}`} onClick={() => actions.updateReminders({ dailyBriefHour: hour })}>{hour}:00</View>)}</View></View>
            </View>
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
                {[3, 7, 14].map((days) => <View key={days} className='chip' onClick={() => void startTruce(days)}>{days} 天</View>)}
              </View>
            )}
          </View>

          <View className='paper-card archive-card'>
            <View className='archive-copy'>
              <View className='section-title'>战役管理</View>
              <View className='muted'>归档只释放名额，不会删除地图、成果或战史。</View>
              {activeCampaign && <View className='archive-current'>当前卷宗 · {activeCampaign.title}</View>}
            </View>
            <Button className='secondary-button archive-button' disabled={!activeCampaign} onClick={() => void archiveCurrent()}>归档当前战役</Button>
          </View>
        </>
      )}

      {panel === 'staff' && <NpcRosterSettings />}
      {panel === 'data' && <DataManagement />}
    </View>
  )
}
