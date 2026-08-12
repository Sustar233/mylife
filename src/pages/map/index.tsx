import { useEffect, useMemo, useState } from 'react'
import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { NodeDossier } from '../../components/NodeDossier'
import { NpcGuide } from '../../components/NpcGuide'
import { TerritoryMap } from '../../components/TerritoryMap'
import type { DerivedTerritoryNode, SessionMode } from '../../domain/types'
import { useWorld } from '../../state/world-context'
import './index.scss'

export default function MapPage() {
  const { campaigns, activeCampaign, hydrated, actions } = useWorld()
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>()
  const visibleCampaigns = campaigns.filter((campaign) => campaign.status !== 'archived')

  useEffect(() => {
    if (!activeCampaign) return
    const stillExists = activeCampaign.nodes.some((node) => node.id === selectedNodeId)
    if (!stillExists) {
      const priority = activeCampaign.nodes.find((node) => node.effectiveState === 'contested' || node.effectiveState === 'lost')
        ?? activeCampaign.nodes.find((node) => node.effectiveState === 'available' || node.effectiveState === 'sieging')
        ?? activeCampaign.nodes[0]
      setSelectedNodeId(priority?.id)
    }
  }, [activeCampaign, selectedNodeId])

  const selectedNode = useMemo(() => activeCampaign?.nodes.find((node) => node.id === selectedNodeId), [activeCampaign, selectedNodeId])

  const start = (node: DerivedTerritoryNode, minutes: number, mode: SessionMode) => {
    const result = actions.beginExpedition(node.id, minutes, mode)
    if (!result.ok) {
      Taro.showToast({ title: result.message, icon: 'none' })
      return
    }
    Taro.navigateTo({ url: `/pages/battle/index?sessionId=${result.sessionId}` })
  }

  if (!hydrated) return <View className='page-shell loading-screen'>正在测绘疆域…</View>

  if (!activeCampaign) {
    return (
      <View className='page-shell empty-map-page'>
        <View className='empty-map-mark'>⌖</View>
        <View className='page-title'>尚无战役地图</View>
        <View className='page-subtitle'>请先前往司令部建立第一条战线。</View>
      </View>
    )
  }

  return (
    <View className='page-shell map-page'>
      <View className='map-header'>
        <View>
          <View className='eyebrow'>WORLD THEATRE · 世界地图</View>
          <View className='page-title'>{activeCampaign.title}</View>
          <View className='page-subtitle'>{activeCampaign.goal}</View>
        </View>
        <View className='campaign-progress-seal'><Text>{activeCampaign.progressPercent}%</Text><small>版图</small></View>
      </View>

      <View className='campaign-tabs'>
        {visibleCampaigns.map((campaign) => (
          <View
            key={campaign.id}
            className={`campaign-tab ${campaign.id === activeCampaign.id ? 'campaign-tab--active' : ''}`}
            onClick={() => actions.selectCampaign(campaign.id)}
          >
            <Text>{campaign.title}</Text><small>{campaign.controlledCount}/{campaign.nodes.length}</small>
          </View>
        ))}
      </View>

      <View className='map-legend'>
        <View><Text className='legend-dot legend-dot--self' />己方</View>
        <View><Text className='legend-dot legend-dot--enemy' />敌方</View>
        <View><Text className='legend-dot legend-dot--rebel' />争夺/叛军</View>
        <View><Text className='legend-dot legend-dot--locked' />封锁</View>
      </View>

      <NpcGuide
        role='courier'
        compact
        line={selectedNode?.effectiveState === 'locked'
          ? `往「${selectedNode.title}」的驿道尚未贯通，请先取下相邻城池。`
          : `疆图已勘定。当前选中「${selectedNode?.title ?? activeCampaign.title}」，随时听候调遣。`}
      />

      <TerritoryMap campaign={activeCampaign} selectedNodeId={selectedNodeId} onSelect={(node) => setSelectedNodeId(node.id)} />
      {selectedNode && <NodeDossier node={selectedNode} onBegin={(minutes, mode) => start(selectedNode, minutes, mode)} />}
    </View>
  )
}
