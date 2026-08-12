import { useEffect, useMemo, useState } from 'react'
import { Canvas, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { createTerritoryCells, THEATRE_OUTLINE, type TerritoryCell } from '../domain/territory-geometry'
import type { DerivedCampaign, DerivedTerritoryNode, MapPosition } from '../domain/types'
import { ownerClass, STATE_LABELS } from '../domain/presentation'
import './TerritoryMap.scss'

interface TerritoryMapProps {
  campaign: DerivedCampaign
  selectedNodeId?: string
  onSelect(node: DerivedTerritoryNode): void
}

type MapMode = 'control' | 'stability'
type CanvasContext = ReturnType<typeof Taro.createCanvasContext>

const MAP_TOP = 0.13
const MAP_HEIGHT = 0.78

function canvasPoint(point: MapPosition, width: number, height: number): MapPosition {
  return {
    x: width * point.x / 100,
    y: height * (MAP_TOP + MAP_HEIGHT * point.y / 100)
  }
}

function tracePolygon(context: CanvasContext, points: MapPosition[], width: number, height: number) {
  if (!points.length) return
  const first = canvasPoint(points[0], width, height)
  context.beginPath()
  context.moveTo(first.x, first.y)
  points.slice(1).forEach((point) => {
    const target = canvasPoint(point, width, height)
    context.lineTo(target.x, target.y)
  })
  context.closePath()
}

function provinceColor(node: DerivedTerritoryNode, mode: MapMode): string {
  if (node.effectiveState === 'locked') return '#a39d8e'
  if (node.effectiveOwner === 'rebel') return '#a28a62'
  if (node.effectiveState === 'contested') return '#8a735c'
  if (node.effectiveOwner === 'enemy') return node.effectiveState === 'lost' ? '#665b5a' : '#7b6660'
  if (mode === 'stability') {
    if (node.effectiveStability >= 80) return '#647a78'
    if (node.effectiveStability >= 50) return '#82908a'
    return '#a18463'
  }
  return '#71898b'
}

function drawHatching(context: CanvasContext, cell: TerritoryCell, width: number, height: number, color: string) {
  context.save()
  tracePolygon(context, cell.points, width, height)
  context.clip()
  context.setStrokeStyle(color)
  context.setLineWidth(1)
  context.setGlobalAlpha(0.3)
  for (let x = -height; x < width + height; x += 16) {
    context.beginPath()
    context.moveTo(x, height)
    context.lineTo(x + height, 0)
    context.stroke()
  }
  context.restore()
}

export function TerritoryMap({ campaign, selectedNodeId, onSelect }: TerritoryMapProps) {
  const [mode, setMode] = useState<MapMode>('control')
  const mapRevision = campaign.nodes
    .map((node) => `${node.effectiveOwner[0]}${node.effectiveState[0]}${node.effectiveStability}`)
    .join('_')
  const canvasId = useMemo(
    () => `theatre_${campaign.id.replace(/[^a-zA-Z0-9_]/g, '')}_${mode}_${mapRevision}`,
    [campaign.id, mapRevision, mode]
  )
  const cells = useMemo(() => createTerritoryCells(campaign.nodes), [campaign.nodes])
  const cellsById = useMemo(() => new Map(cells.map((cell) => [cell.id, cell])), [cells])
  const contested = campaign.nodes.filter((node) => node.effectiveState === 'contested' || node.effectiveState === 'lost').length
  const available = campaign.nodes.filter((node) => node.effectiveState === 'available' || node.effectiveState === 'sieging').length

  useEffect(() => {
    const timer = setTimeout(() => {
      const query = Taro.createSelectorQuery()
      query.select(`#${canvasId}`).boundingClientRect((rect) => {
        if (!rect || Array.isArray(rect)) return
        const context = Taro.createCanvasContext(canvasId)
        const byId = new Map(campaign.nodes.map((node) => [node.id, node]))
        context.clearRect(0, 0, rect.width, rect.height)

        // Tactical chart background and coordinate grid.
        context.setFillStyle('#cbbd9b')
        context.fillRect(0, 0, rect.width, rect.height)
        context.setStrokeStyle('rgba(50, 55, 51, .09)')
        context.setLineWidth(1)
        for (let x = 0; x <= rect.width; x += 38) {
          context.beginPath(); context.moveTo(x, 0); context.lineTo(x, rect.height); context.stroke()
        }
        for (let y = 0; y <= rect.height; y += 38) {
          context.beginPath(); context.moveTo(0, y); context.lineTo(rect.width, y); context.stroke()
        }

        // Coast shadow gives the collection of provinces one readable national silhouette.
        context.save()
        context.setShadow(0, 10, 24, 'rgba(49, 45, 37, .28)')
        tracePolygon(context, THEATRE_OUTLINE, rect.width, rect.height)
        context.setFillStyle('#b8aa89')
        context.fill()
        context.restore()

        cells.forEach((cell) => {
          const node = byId.get(cell.id)
          if (!node) return
          tracePolygon(context, cell.points, rect.width, rect.height)
          context.setFillStyle(provinceColor(node, mode))
          context.fill()
          context.setStrokeStyle('rgba(48, 48, 43, .72)')
          context.setLineWidth(2)
          context.stroke()

          if (node.effectiveState === 'locked') drawHatching(context, cell, rect.width, rect.height, '#665f56')
          if (node.effectiveState === 'contested' || node.effectiveState === 'lost') drawHatching(context, cell, rect.width, rect.height, '#765e38')
        })

        // Supply roads sit above political color; gold segments mark an active front.
        campaign.edges.forEach((edge) => {
          const from = byId.get(edge.from)
          const to = byId.get(edge.to)
          const fromCell = cellsById.get(edge.from)
          const toCell = cellsById.get(edge.to)
          if (!from || !to || !fromCell || !toCell) return
          const a = canvasPoint(fromCell.centroid, rect.width, rect.height)
          const b = canvasPoint(toCell.centroid, rect.width, rect.height)
          const frontline = from.effectiveOwner !== to.effectiveOwner && (from.effectiveOwner === 'self' || to.effectiveOwner === 'self')
          const selectedRoute = edge.from === selectedNodeId || edge.to === selectedNodeId
          context.beginPath()
          context.setStrokeStyle(frontline ? '#765e3d' : selectedRoute ? 'rgba(48, 68, 72, .8)' : 'rgba(65, 63, 55, .35)')
          context.setLineWidth(frontline ? 4 : selectedRoute ? 3 : 2)
          context.setLineDash(edge.kind === 'soft' ? [7, 7] : [], 0)
          context.moveTo(a.x, a.y)
          context.lineTo(b.x, b.y)
          context.stroke()
        })
        context.setLineDash([], 0)

        // Coastline and selected province are the strongest hierarchy lines.
        tracePolygon(context, THEATRE_OUTLINE, rect.width, rect.height)
        context.setStrokeStyle('#3f4540')
        context.setLineWidth(4)
        context.stroke()
        const selectedCell = selectedNodeId ? cellsById.get(selectedNodeId) : undefined
        if (selectedCell) {
          tracePolygon(context, selectedCell.points, rect.width, rect.height)
          context.setStrokeStyle('#344f55')
          context.setLineWidth(6)
          context.stroke()
        }
        context.draw()
      }).exec()
    }, 60)
    return () => clearTimeout(timer)
  }, [campaign, canvasId, cells, cellsById, mode, selectedNodeId])

  return (
    <View className='territory-map'>
      <Canvas key={canvasId} id={canvasId} canvasId={canvasId} className='territory-canvas' />

      <View className='map-command-bar'>
        <View className='map-command-copy'>
          <Text className='map-command-kicker'>THEATRE CONTROL</Text>
          <Text className='map-command-title'>战区态势图</Text>
          <Text className='map-command-meta'>{campaign.nodes.length} 行政区 · {campaign.edges.length} 条补给线</Text>
        </View>
        <View className='map-mode-switch'>
          <View className={mode === 'control' ? 'map-mode map-mode--active' : 'map-mode'} onClick={() => setMode('control')}>政治</View>
          <View className={mode === 'stability' ? 'map-mode map-mode--active' : 'map-mode'} onClick={() => setMode('stability')}>稳定</View>
        </View>
      </View>

      {campaign.nodes.map((node, index) => {
        const cell = cellsById.get(node.id)
        if (!cell) return null
        const left = cell.centroid.x
        const top = (MAP_TOP + MAP_HEIGHT * cell.centroid.y / 100) * 100
        return (
          <View
            key={node.id}
            className={`territory-node territory-node--${ownerClass(node)} territory-node--${node.kind} ${selectedNodeId === node.id ? 'territory-node--selected' : ''}`}
            style={{ left: `${left}%`, top: `${top}%` }}
            onClick={() => onSelect(node)}
          >
            <View className='node-designation'>P-{String(index + 1).padStart(2, '0')}</View>
            <View className='node-label-row'>
              <Text className='node-symbol'>{node.kind === 'capital' ? '★' : node.kind === 'fortress' ? '◆' : '●'}</Text>
              <Text className='node-name'>{node.title}</Text>
              {node.supplyCut && <Text className='supply-alert'>!</Text>}
            </View>
            <View className='node-state'>
              {mode === 'stability' && node.effectiveOwner === 'self' ? `稳定 ${node.effectiveStability}` : STATE_LABELS[node.effectiveState]}
            </View>
          </View>
        )
      })}

      <View className='map-sitrep'>
        <View><Text>{campaign.controlledCount}</Text><small>我方控制</small></View>
        <View><Text>{available}</Text><small>可进攻</small></View>
        <View className={contested ? 'map-sitrep--danger' : ''}><Text>{contested}</Text><small>争夺/失守</small></View>
      </View>
      <View className='map-scale'><Text>0</Text><View /><Text>100 KM</Text></View>
      <View className='map-compass'><Text>N</Text><View>▲</View><small>GRID 01</small></View>
    </View>
  )
}
