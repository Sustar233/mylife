import { useEffect, useState } from 'react'
import { Button, Input, Picker, Text, Textarea, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import type { DerivedCampaign, DerivedTerritoryNode } from '../domain/types'
import {
  addDependencyToCampaign,
  addOutpostToCampaign,
  addRegionToCampaign,
  autoArrangeCampaignMap,
  getCampaignMapHistoryStatus,
  redoCampaignMapEdit,
  removeCustomOutpost,
  removeDependencyFromCampaign,
  undoCampaignMapEdit,
  updateCampaignNode
} from '../domain/map-editor-engine'
import { isStructuralDependency, validateCampaignMap } from '../domain/map-planning'
import { confirmAction, showUserToast } from '../services/taro-ui'
import { useWorld } from '../state/world-context'
import './MapEditor.scss'

interface MapEditorProps {
  campaign: DerivedCampaign
  selectedRegion?: string
  selectedNode?: DerivedTerritoryNode
  onClose(): void
}

export function MapEditor({ campaign, selectedRegion, selectedNode, onClose }: MapEditorProps) {
  const { world, actions } = useWorld()
  const [regionName, setRegionName] = useState('')
  const [regionOutpost, setRegionOutpost] = useState('起始据点')
  const [regionCapital, setRegionCapital] = useState('区域主城')
  const [regionCriteria, setRegionCriteria] = useState('完成本区域全部分支并提交一份综合成果')
  const [regionMinutes, setRegionMinutes] = useState(60)
  const [outpostTitle, setOutpostTitle] = useState('')
  const [outpostDescription, setOutpostDescription] = useState('')
  const [outpostCriteria, setOutpostCriteria] = useState('')
  const [outpostMinutes, setOutpostMinutes] = useState(25)
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editCriteria, setEditCriteria] = useState('')
  const [editMinutes, setEditMinutes] = useState(25)
  const [fromIndex, setFromIndex] = useState(0)
  const [toIndex, setToIndex] = useState(0)
  const [edgeKind, setEdgeKind] = useState<'hard' | 'soft'>('hard')
  const [dragSourceId, setDragSourceId] = useState<string | undefined>()

  useEffect(() => {
    if (!selectedNode) return
    setEditTitle(selectedNode.title)
    setEditDescription(selectedNode.description)
    setEditCriteria(selectedNode.victoryCriteria)
    setEditMinutes(selectedNode.estimatedMinutes)
  }, [selectedNode])

  const notify = (result: { ok: true } | { ok: false; message: string }, success: string) => {
    showUserToast(result.ok ? success : result.message, result.ok ? 'success' : 'none')
    return result.ok
  }

  const addRegion = () => {
    const ok = notify(actions.applyMapOperation((current, timestamp) => addRegionToCampaign(current, campaign.id, {
      name: regionName,
      outpostTitle: regionOutpost,
      capitalTitle: regionCapital,
      victoryCriteria: regionCriteria,
      estimatedMinutes: regionMinutes
    }, timestamp)), '新区域已建立')
    if (ok) setRegionName('')
  }

  const addOutpost = () => {
    if (!selectedRegion) return
    const ok = notify(actions.applyMapOperation((current, timestamp) => addOutpostToCampaign(current, campaign.id, {
      region: selectedRegion,
      title: outpostTitle,
      description: outpostDescription,
      victoryCriteria: outpostCriteria,
      estimatedMinutes: outpostMinutes
    }, timestamp)), '据点已加入')
    if (ok) {
      setOutpostTitle('')
      setOutpostDescription('')
      setOutpostCriteria('')
    }
  }

  const updateNode = () => {
    if (!selectedNode) return
    notify(actions.applyMapOperation((current, timestamp) => updateCampaignNode(current, campaign.id, selectedNode.id, {
      title: editTitle,
      description: editDescription,
      victoryCriteria: editCriteria,
      estimatedMinutes: editMinutes
    }, timestamp)), '军令已更新')
  }

  const removeNode = async () => {
    if (!selectedNode) return
    const confirmed = await confirmAction({
      title: '撤销这个据点？',
      content: '仅尚未学习的自定义据点可以撤销，区域和历史记录不会受影响。',
      confirmColor: '#76534a'
    })
    if (!confirmed) return
    notify(actions.applyMapOperation((current, timestamp) => removeCustomOutpost(current, campaign.id, selectedNode.id, timestamp)), '据点已撤销')
  }

  const selectedIsFinal = selectedNode?.role === 'campaign_capital'
  const canDelete = selectedNode?.role === 'outpost' && selectedNode.templateKey.startsWith('custom-')
  const sourceNodes = campaign.nodes.filter((node) => node.role !== 'campaign_capital')
  const targetNodes = campaign.nodes.filter((node) => node.role === 'outpost')
  const editableEdges = campaign.edges.filter((edge) => !isStructuralDependency(campaign, edge))
  const validationIssues = validateCampaignMap(campaign)
  const history = getCampaignMapHistoryStatus(world, campaign.id)

  const applyHistory = (direction: 'undo' | 'redo') => {
    const result = actions.applyMapOperation((current, timestamp) => direction === 'undo'
      ? undoCampaignMapEdit(current, campaign.id, timestamp)
      : redoCampaignMapEdit(current, campaign.id, timestamp))
    notify(result, direction === 'undo' ? '已撤销上次修改' : '已恢复修改')
  }

  const autoArrange = () => notify(actions.applyMapOperation((current, timestamp) => autoArrangeCampaignMap(current, campaign.id, timestamp)), '版图已自动排布')

  const addDependencyByIds = (fromId?: string, toId?: string) => {
    const from = campaign.nodes.find((node) => node.id === fromId)
    const to = campaign.nodes.find((node) => node.id === toId)
    if (!from || !to) return
    const ok = notify(actions.applyMapOperation((current, timestamp) => addDependencyToCampaign(current, campaign.id, { from: from.id, to: to.id, kind: edgeKind }, timestamp)), '前置道路已建立')
    if (ok) setDragSourceId(undefined)
  }

  const addDependency = () => addDependencyByIds(sourceNodes[fromIndex]?.id, targetNodes[toIndex]?.id)

  const finishDependencyDrag = (event: any) => {
    if (!dragSourceId) return
    const touch = event.changedTouches?.[0]
    if (!touch) return
    const clientX = touch.clientX ?? touch.pageX
    const clientY = touch.clientY ?? touch.pageY
    Taro.createSelectorQuery().selectAll('.dependency-drop-node').boundingClientRect((rects) => {
      if (!Array.isArray(rects)) return
      const target = rects.find((rect: any) => clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom)
      if (target?.dataset?.nodeId) addDependencyByIds(dragSourceId, target.dataset.nodeId)
      else setDragSourceId(undefined)
    }).exec()
  }

  const removeDependency = (edgeId: string) => notify(actions.applyMapOperation((current, timestamp) => removeDependencyFromCampaign(current, campaign.id, edgeId, timestamp)), '前置道路已撤销')

  const nodeName = (nodeId: string) => campaign.nodes.find((node) => node.id === nodeId)?.title ?? '未知节点'

  return (
    <View className='map-editor paper-card'>
      <View className='editor-head'>
        <View>
          <View className='eyebrow'>CARTOGRAPHY · 版图规划</View>
          <View className='section-title'>编辑学习战区</View>
        </View>
        <View className='editor-head-actions'>
          <Text className={`editor-tool ${history.undoCount ? '' : 'editor-tool--disabled'}`} onClick={() => history.undoCount && applyHistory('undo')}>↶ 撤销 {history.undoCount}</Text>
          <Text className={`editor-tool ${history.redoCount ? '' : 'editor-tool--disabled'}`} onClick={() => history.redoCount && applyHistory('redo')}>↷ 重做 {history.redoCount}</Text>
          <Text className='editor-tool' onClick={autoArrange}>自动布局</Text>
          <Text className='editor-close' onClick={onClose}>完成</Text>
        </View>
      </View>
      <View className='editor-notice'>修改地图不会删除已有战史。区域至少包含一个据点；全部据点攻克后，区域主城才会开放。</View>

      <View className={`editor-validation ${validationIssues.some((item) => item.severity === 'error') ? 'editor-validation--error' : ''}`}>
        <View className='editor-validation-title'>{validationIssues.length ? `版图校验 · ${validationIssues.length} 项` : '✓ 版图结构校验通过'}</View>
        {validationIssues.map((item) => <View key={`${item.code}-${item.nodeIds.join('-')}`} className={`editor-validation-item editor-validation-item--${item.severity}`}>{item.severity === 'error' ? '阻断' : '建议'} · {item.message}</View>)}
        <View className='editor-validation-meta'>保存最近 {12} 次修改；每次提交都会先检查循环前置、重名、孤立道路和主城结构。</View>
      </View>

      <View className='editor-grid'>
        <View className='editor-section'>
          <View className='editor-section-title'>＋ 新建区域</View>
          <Text className='field-label'>区域名称</Text>
          <Input className='text-input' value={regionName} placeholder='例如：动态规划战区' onInput={(event) => setRegionName(event.detail.value)} />
          <View className='editor-two-columns'>
            <View><Text className='field-label'>首个据点</Text><Input className='text-input' value={regionOutpost} onInput={(event) => setRegionOutpost(event.detail.value)} /></View>
            <View><Text className='field-label'>区域主城</Text><Input className='text-input' value={regionCapital} onInput={(event) => setRegionCapital(event.detail.value)} /></View>
          </View>
          <Text className='field-label'>主城胜利标准</Text>
          <Textarea className='text-area editor-area' value={regionCriteria} maxlength={140} onInput={(event) => setRegionCriteria(event.detail.value)} />
          <Text className='field-label'>预计投入（分钟）</Text>
          <Input className='text-input editor-number' type='number' value={`${regionMinutes}`} onInput={(event) => setRegionMinutes(Number(event.detail.value) || 60)} />
          <Button className='secondary-button editor-action' onClick={addRegion}>建立区域</Button>
        </View>

        <View className='editor-section'>
          <View className='editor-section-title'>＋ 当前区域新增据点</View>
          {!selectedRegion || selectedIsFinal ? (
            <View className='editor-empty'>请先进入一个普通区域，再为它规划分支据点。</View>
          ) : (
            <>
              <View className='editor-current'>当前区域 · {selectedRegion}</View>
              <Text className='field-label'>据点名称</Text>
              <Input className='text-input' value={outpostTitle} placeholder='例如：状态转移营地' onInput={(event) => setOutpostTitle(event.detail.value)} />
              <Text className='field-label'>学习说明</Text>
              <Input className='text-input' value={outpostDescription} placeholder='要学习什么？' onInput={(event) => setOutpostDescription(event.detail.value)} />
              <Text className='field-label'>胜利标准</Text>
              <Textarea className='text-area editor-area' value={outpostCriteria} placeholder='如何证明已经掌握？' maxlength={140} onInput={(event) => setOutpostCriteria(event.detail.value)} />
              <Text className='field-label'>预计投入（分钟）</Text>
              <Input className='text-input editor-number' type='number' value={`${outpostMinutes}`} onInput={(event) => setOutpostMinutes(Number(event.detail.value) || 25)} />
              <Button className='secondary-button editor-action' onClick={addOutpost}>部署据点</Button>
            </>
          )}
        </View>
      </View>

      <View className='editor-section editor-section--dependency'>
        <View className='editor-section-title'>⇢ 编辑前置道路</View>
        <View className='editor-dependency-help'>从左侧节点拖到右侧据点即可连线；桌面端也可依次点击起点与目标。硬前置会锁定目标，提示关系只作战术标记。</View>
        <View className='dependency-drag-board'>
          <View className='dependency-drag-column'>
            <View className='field-label'>拖动前置起点</View>
            <View className='dependency-drag-list'>
              {sourceNodes.map((node) => (
                <View
                  key={node.id}
                  className={`dependency-drag-node ${dragSourceId === node.id ? 'dependency-drag-node--active' : ''}`}
                  onTouchStart={() => setDragSourceId(node.id)}
                  onTouchEnd={finishDependencyDrag}
                  onClick={() => setDragSourceId(node.id)}
                >
                  <Text>{node.title}</Text><small>{node.region}</small>
                </View>
              ))}
            </View>
          </View>
          <View className='dependency-drag-arrow'>→</View>
          <View className='dependency-drag-column'>
            <View className='field-label'>放到解锁目标</View>
            <View className='dependency-drag-list'>
              {targetNodes.map((node) => (
                <View
                  key={node.id}
                  id={`dependency_drop_${node.id.replace(/[^a-zA-Z0-9_]/g, '')}`}
                  data-node-id={node.id}
                  className='dependency-drag-node dependency-drop-node'
                  onClick={() => dragSourceId && addDependencyByIds(dragSourceId, node.id)}
                >
                  <Text>{node.title}</Text><small>{node.region}</small>
                </View>
              ))}
            </View>
          </View>
        </View>
        <View className='editor-dependency-grid'>
          <View>
            <Text className='field-label'>前置起点</Text>
            <Picker mode='selector' range={sourceNodes.map((node) => `${node.region} · ${node.title}`)} value={fromIndex} onChange={(event) => setFromIndex(Number(event.detail.value))}>
              <View className='editor-picker'>{sourceNodes[fromIndex] ? `${sourceNodes[fromIndex].region} · ${sourceNodes[fromIndex].title}` : '选择起点'}<Text>⌄</Text></View>
            </Picker>
          </View>
          <View>
            <Text className='field-label'>解锁目标</Text>
            <Picker mode='selector' range={targetNodes.map((node) => `${node.region} · ${node.title}`)} value={toIndex} onChange={(event) => setToIndex(Number(event.detail.value))}>
              <View className='editor-picker'>{targetNodes[toIndex] ? `${targetNodes[toIndex].region} · ${targetNodes[toIndex].title}` : '选择目标'}<Text>⌄</Text></View>
            </Picker>
          </View>
        </View>
        <View className='editor-edge-kinds'>
          <Text className={edgeKind === 'hard' ? 'editor-edge-kind editor-edge-kind--active' : 'editor-edge-kind'} onClick={() => setEdgeKind('hard')}>硬前置 · 阻断解锁</Text>
          <Text className={edgeKind === 'soft' ? 'editor-edge-kind editor-edge-kind--active' : 'editor-edge-kind'} onClick={() => setEdgeKind('soft')}>提示关系 · 不阻断</Text>
        </View>
        <Button className='secondary-button editor-action' disabled={!sourceNodes.length || !targetNodes.length} onClick={addDependency}>部署前置道路</Button>

        <View className='editor-edge-list'>
          <View className='field-label'>可编辑道路 · {editableEdges.length}</View>
          {editableEdges.length === 0 ? <View className='editor-empty editor-empty--compact'>尚未添加额外前置关系。</View> : editableEdges.map((edge) => (
            <View key={edge.id} className='editor-edge-row'>
              <View><Text>{nodeName(edge.from)} → {nodeName(edge.to)}</Text><small>{edge.kind === 'hard' ? '硬前置' : '提示关系'}</small></View>
              <Text className='editor-edge-remove' onClick={() => removeDependency(edge.id)}>撤销</Text>
            </View>
          ))}
        </View>
      </View>

      <View className='editor-section editor-section--node'>
        <View className='editor-section-title'>✎ 修改选中节点</View>
        {!selectedNode ? <View className='editor-empty'>在区域内部选择一个据点或主城后，可修改它的学习军令。</View> : (
          <>
            <View className='editor-current'>{selectedNode.region} · {selectedNode.role === 'outpost' ? '据点' : selectedNode.role === 'regional_capital' ? '区域主城' : '最终首都'}</View>
            <Text className='field-label'>节点名称</Text>
            <Input className='text-input' value={editTitle} onInput={(event) => setEditTitle(event.detail.value)} />
            <Text className='field-label'>学习说明</Text>
            <Input className='text-input' value={editDescription} onInput={(event) => setEditDescription(event.detail.value)} />
            <Text className='field-label'>胜利标准</Text>
            <Textarea className='text-area editor-area' value={editCriteria} maxlength={160} onInput={(event) => setEditCriteria(event.detail.value)} />
            <Text className='field-label'>预计投入（分钟）</Text>
            <Input className='text-input editor-number' type='number' value={`${editMinutes}`} onInput={(event) => setEditMinutes(Number(event.detail.value) || 25)} />
            <View className='editor-node-actions'>
              <Button className='primary-button' onClick={updateNode}>保存节点军令</Button>
              {canDelete && <Button className='danger-button' onClick={removeNode}>撤销自定义据点</Button>}
            </View>
          </>
        )}
      </View>
    </View>
  )
}
