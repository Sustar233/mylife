import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { NodeDossier } from '../../components/NodeDossier'
import { NpcGuide } from '../../components/NpcGuide'
import { TerritoryMap } from '../../components/TerritoryMap'
import type { DerivedTerritoryNode, SessionMode } from '../../domain/types'
import { useWorld } from '../../state/world-context'
import './index.scss'

const MapEditor = lazy(() => import('../../components/MapEditor').then((module) => ({ default: module.MapEditor })))

export default function MapPage() {
  const { campaigns, activeCampaign, hydrated, actions } = useWorld()
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>()
  const [selectedRegion, setSelectedRegion] = useState<string | undefined>()
  const [showEditor, setShowEditor] = useState(false)
  const visibleCampaigns = campaigns.filter((campaign) => campaign.status !== 'archived')

  useEffect(() => {
    if (!activeCampaign || !selectedRegion) {
      setSelectedNodeId(undefined)
      return
    }
    const regionNodes = activeCampaign.nodes.filter((node) => node.region === selectedRegion)
    if (!regionNodes.length) {
      setSelectedRegion(undefined)
      setSelectedNodeId(undefined)
      return
    }
    const stillExists = regionNodes.some((node) => node.id === selectedNodeId)
    if (!stillExists) {
      const priority = regionNodes.find((node) => node.effectiveState === 'contested' || node.effectiveState === 'lost')
        ?? regionNodes.find((node) => node.effectiveState === 'available' || node.effectiveState === 'sieging')
        ?? regionNodes[0]
      setSelectedNodeId(priority?.id)
    }
  }, [activeCampaign, selectedNodeId, selectedRegion])

  const selectedNode = useMemo(() => activeCampaign?.nodes.find((node) => node.id === selectedNodeId), [activeCampaign, selectedNodeId])

  const start = (node: DerivedTerritoryNode, minutes: number, mode: SessionMode) => {
    const result = actions.beginExpedition(node.id, minutes, mode)
    if (!result.ok) {
      Taro.showToast({ title: result.message, icon: 'none' })
      return
    }
    Taro.navigateTo({ url: `/subpackages/battle/index?sessionId=${result.sessionId}` })
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
        <View className='map-header-actions'>
          <View className={`map-edit-toggle ${showEditor ? 'map-edit-toggle--active' : ''}`} onClick={() => setShowEditor((value) => !value)}>{showEditor ? '退出规划' : '编辑版图'}</View>
          <View className='campaign-progress-seal'><Text>{activeCampaign.progressPercent}%</Text><small>版图</small></View>
        </View>
      </View>

      <View className='campaign-tabs'>
        {visibleCampaigns.map((campaign) => (
          <View
            key={campaign.id}
            className={`campaign-tab ${campaign.id === activeCampaign.id ? 'campaign-tab--active' : ''}`}
            onClick={() => { actions.selectCampaign(campaign.id); setSelectedRegion(undefined); setSelectedNodeId(undefined) }}
          >
            <Text>{campaign.title}</Text><small>{campaign.controlledRegionCount}/{campaign.regionCount}</small>
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
        line={!selectedRegion
          ? '先选择一片区域进入。肃清全部分支据点后，区域主城才会开放。'
          : selectedNode?.effectiveState === 'locked'
            ? `往「${selectedNode.title}」的驿道尚未贯通，请先完成区域内前置据点。`
            : `已进入「${selectedRegion}」。当前选中「${selectedNode?.title ?? selectedRegion}」。`}
      />

      <TerritoryMap
        campaign={activeCampaign}
        selectedRegion={selectedRegion}
        selectedNodeId={selectedNodeId}
        onSelectRegion={(region) => { setSelectedRegion(region); setSelectedNodeId(undefined) }}
        onBackToOverview={() => { setSelectedRegion(undefined); setSelectedNodeId(undefined) }}
        onSelectNode={(node) => setSelectedNodeId(node.id)}
      />
      {showEditor && (
        <Suspense fallback={<View className='paper-card editor-loading'>正在展开版图规划台…</View>}>
          <MapEditor campaign={activeCampaign} selectedRegion={selectedRegion} selectedNode={selectedNode} onClose={() => setShowEditor(false)} />
        </Suspense>
      )}
      {selectedNode && <NodeDossier node={selectedNode} onBegin={(minutes, mode) => start(selectedNode, minutes, mode)} />}
    </View>
  )
}
