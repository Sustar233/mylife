import { getCampaignRegions } from '../../domain/regions'
import { STATE_LABELS } from '../../domain/presentation'
import { AssaultBrief } from '../../components/AssaultBrief'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Text, View } from '@tarojs/components'
import { NodeDossier } from '../../components/NodeDossier'
import { NpcGuide } from '../../components/NpcGuide'
import { TerritoryMap } from '../../components/TerritoryMap'
import type { DerivedTerritoryNode, SessionMode } from '../../domain/types'
import { openPage, showUserToast } from '../../services/taro-ui'
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
      showUserToast(result.message)
      return
    }
    openPage(`/subpackages/battle/index?sessionId=${result.sessionId}`)
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

      <AssaultBrief />

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

      {!selectedRegion && <View className='paper-card study-route'>
        <View className='section-title'>学习路线 · 点击科目展开任务</View>
        <View className='muted'>各科可并行推进：考纲研读 → 专项练习 → 科目验收；全部科目通过后进入综合验收。地图色块表示学习科目，不是地理位置。</View>
        {getCampaignRegions(activeCampaign).map((region, index) => {
          const next = region.nodes.find((node) => ['lost', 'contested'].includes(node.effectiveState))
            ?? region.nodes.find((node) => ['available', 'sieging'].includes(node.effectiveState))
          const names: Record<string, string> = { '全导': '全国导游基础知识', '地导': '地方导游基础知识', '法规': '政策与法律法规', '业务': '导游业务', '英语面试': '英语面试', '综合验收': '综合模拟验收' }
          return <View key={region.id} className='study-route-row' onClick={() => { setSelectedRegion(region.name); setSelectedNodeId(next?.id ?? region.capital.id) }}>
            <View>{index + 1}. {names[region.name] ?? region.name} · 已掌握 {region.controlledNodeCount}/{region.nodes.length}</View>
            <View className='muted'>{next ? `下一步：${next.title} · ${STATE_LABELS[next.effectiveState]}` : region.controlled ? '已完成，按提醒复习' : '待前置科目验收通过'} ›</View>
          </View>
        })}
      </View>}

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
