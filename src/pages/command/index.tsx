import { useMemo, useState } from 'react'
import { Button, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { CampaignCreator } from '../../components/CampaignCreator'
import { NpcGuide } from '../../components/NpcGuide'
import { getCompletedMinutesThisWeek } from '../../domain/engine'
import { actionForNode, STATE_LABELS } from '../../domain/presentation'
import type { DerivedTerritoryNode } from '../../domain/types'
import { formatCompactDate } from '../../domain/utils'
import { useWorld } from '../../state/world-context'
import './index.scss'

export default function CommandPage() {
  const { world, campaigns, activeCampaign, hydrated, now, actions } = useWorld()
  const [showCreator, setShowCreator] = useState(false)
  const activeCampaigns = campaigns.filter((campaign) => campaign.status !== 'archived')
  const completedMinutes = getCompletedMinutesThisWeek(world, now)
  const budget = activeCampaign?.weeklyBudget ?? world.profile.weeklyBudget
  const budgetPercent = Math.min(100, Math.round((completedMinutes / Math.max(1, budget)) * 100))
  const activeSession = world.sessions.find((session) => session.status === 'active' || session.status === 'paused')

  const riskNodes = useMemo(() => activeCampaign?.nodes
    .filter((node) => node.effectiveState === 'lost' || node.effectiveState === 'contested')
    .sort((a, b) => a.effectiveStability - b.effectiveStability) ?? [], [activeCampaign])
  const attackNodes = useMemo(() => activeCampaign?.nodes
    .filter((node) => node.effectiveState === 'available' || node.effectiveState === 'sieging')
    .slice(0, 3) ?? [], [activeCampaign])
  const priorityNode = riskNodes[0] ?? attackNodes[0]

  const startNode = (node: DerivedTerritoryNode, minutes = 25) => {
    const action = actionForNode(node)
    const result = actions.beginExpedition(node.id, minutes, action.mode)
    if (!result.ok) {
      Taro.showToast({ title: result.message, icon: 'none' })
      return
    }
    Taro.navigateTo({ url: `/pages/battle/index?sessionId=${result.sessionId}` })
  }

  if (!hydrated) {
    return <View className='page-shell loading-screen'>正在展开战略地图…</View>
  }

  if (campaigns.length === 0) {
    return (
      <View className='page-shell command-page'>
        <View className='hero-banner hero-banner--empty'>
          <View className='hero-kicker'>KNOWLEDGE IS TERRITORY</View>
          <View className='hero-title'>让每一次学习，<Text>留下疆界。</Text></View>
          <View className='hero-copy'>时间是你唯一的部队，成果是夺城的军令，复习决定领地能否长久。</View>
        </View>
        <CampaignCreator />
      </View>
    )
  }

  return (
    <View className='page-shell command-page'>
      <View className='command-header'>
        <View>
          <View className='eyebrow'>FIELD COMMAND · 司令部</View>
          <View className='page-title'>今日军令</View>
          <View className='page-subtitle'>{activeCampaign?.title ?? '请选择战役'} · {formatCompactDate(now)}</View>
        </View>
        <View className='commander-seal'>知<small>域</small></View>
      </View>

      <NpcGuide
        role='strategist'
        line={riskNodes.length
          ? `军情有变，${riskNodes.length} 处领地告急。先稳住旧疆，再图新土。`
          : priorityNode
            ? `今日兵锋宜指向「${priorityNode.title}」，积跬步，方能拓千里。`
            : '四境安宁，正宜温故固本，为下一场远征蓄势。'}
      />

      {activeSession && (
        <View className='active-operation' onClick={() => Taro.navigateTo({ url: `/pages/battle/index?sessionId=${activeSession.id}` })}>
          <View className='operation-pulse' />
          <View className='operation-copy'>
            <Text className='operation-label'>前线行动仍在继续</Text>
            <Text className='operation-title'>{activeSession.status === 'active' ? '计时中' : '已暂停'} · 点击返回战场</Text>
          </View>
          <Text className='operation-arrow'>›</Text>
        </View>
      )}

      <View className='metric-grid'>
        <View className='metric-card metric-card--territory'>
          <View className='metric-label'>控制领地</View>
          <View className='metric-value'>{activeCampaign?.controlledCount ?? 0}<Text> / {activeCampaign?.nodes.length ?? 0}</Text></View>
          <View className='metric-foot'>版图完成 {activeCampaign?.progressPercent ?? 0}%</View>
        </View>
        <View className='metric-card metric-card--time'>
          <View className='metric-label'>本周兵力</View>
          <View className='metric-value'>{completedMinutes}<Text> / {budget} 分</Text></View>
          <View className='progress-track'><View className='progress-fill' style={{ width: `${budgetPercent}%` }} /></View>
        </View>
        <View className='metric-card metric-card--risk'>
          <View className='metric-label'>风险警报</View>
          <View className='metric-value'>{riskNodes.length}<Text> 处</Text></View>
          <View className='metric-foot'>{riskNodes.length ? '需要立即增援' : '全境补给稳定'}</View>
        </View>
      </View>

      {priorityNode ? (
        <View className={`priority-order paper-card ${riskNodes.length ? 'priority-order--danger' : ''}`}>
          <View className='order-ribbon'>{riskNodes.length ? '最高优先级 · 防守' : '最高优先级 · 进攻'}</View>
          <View className='order-main'>
            <View className='order-map-mark'>{priorityNode.kind === 'capital' ? '★' : '◆'}</View>
            <View className='order-copy'>
              <View className='order-meta'>{priorityNode.region} · {STATE_LABELS[priorityNode.effectiveState]}</View>
              <View className='order-title'>{priorityNode.title}</View>
              <View className='order-criteria'>{priorityNode.victoryCriteria}</View>
            </View>
          </View>
          <Button className='primary-button order-button' disabled={Boolean(activeSession)} onClick={() => startNode(priorityNode)}>
            {activeSession ? '先处理当前行动' : `${actionForNode(priorityNode).label} · 25 分钟`}
          </Button>
        </View>
      ) : (
        <View className='paper-card all-clear'>
          <View className='all-clear-mark'>✓</View>
          <View><View className='section-title'>今日全境无战事</View><View className='muted'>可以复习任一领地，或者查看世界地图调整下一条战线。</View></View>
        </View>
      )}

      <View className='command-columns'>
        <View className='paper-card command-list'>
          <View className='list-head'><View className='section-title'>待防守领地</View><Text>{riskNodes.length}</Text></View>
          {riskNodes.length === 0 ? <View className='empty-line'>目前没有争夺或失守领地。</View> : riskNodes.slice(0, 4).map((node) => (
            <View key={node.id} className='order-row' onClick={() => startNode(node, 15)}>
              <View className='row-marker row-marker--risk'>!</View>
              <View className='row-copy'><View className='row-title'>{node.title}</View><View className='row-meta'>稳定度 {node.effectiveStability} · {STATE_LABELS[node.effectiveState]}</View></View>
              <Text className='row-arrow'>›</Text>
            </View>
          ))}
        </View>

        <View className='paper-card command-list'>
          <View className='list-head'><View className='section-title'>可进攻前线</View><Text>{attackNodes.length}</Text></View>
          {attackNodes.length === 0 ? <View className='empty-line'>当前没有已解锁的新前线。</View> : attackNodes.map((node) => (
            <View key={node.id} className='order-row' onClick={() => startNode(node, 25)}>
              <View className='row-marker'>➜</View>
              <View className='row-copy'><View className='row-title'>{node.title}</View><View className='row-meta'>{node.effortPercent}% 围城投入 · 预计 {node.estimatedMinutes} 分</View></View>
              <Text className='row-arrow'>›</Text>
            </View>
          ))}
        </View>
      </View>

      <View className='paper-card campaign-switcher'>
        <View className='list-head'>
          <View className='section-title'>进行中的战役</View>
          {activeCampaigns.length < 3 && <Text className='text-link' onClick={() => setShowCreator((value) => !value)}>{showCreator ? '收起' : '+ 新战线'}</Text>}
        </View>
        <View className='campaign-mini-grid'>
          {activeCampaigns.map((campaign) => (
            <View
              key={campaign.id}
              className={`campaign-mini ${campaign.id === activeCampaign?.id ? 'campaign-mini--active' : ''}`}
              onClick={() => actions.selectCampaign(campaign.id)}
            >
              <View className='campaign-mini-name'>{campaign.title}</View>
              <View className='campaign-mini-meta'>{campaign.progressPercent}% · {campaign.status === 'victorious' ? '已凯旋' : '推进中'}</View>
            </View>
          ))}
        </View>
      </View>

      {showCreator && <CampaignCreator onCreated={() => setShowCreator(false)} />}
    </View>
  )
}
