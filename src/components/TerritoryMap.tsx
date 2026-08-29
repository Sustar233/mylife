import { useEffect, useMemo, useState } from 'react'
import { Canvas, Text, View } from '@tarojs/components'
import type { CommonEvent } from '@tarojs/components/types/common'
import Taro from '@tarojs/taro'
import { getCampaignRegions, type CampaignRegion } from '../domain/regions'
import { createTerritoryCells, THEATRE_OUTLINE, type TerritoryCell } from '../domain/territory-geometry'
import type { DerivedCampaign, DerivedTerritoryNode, MapPosition } from '../domain/types'
import { ownerClass, STATE_LABELS } from '../domain/presentation'
import './TerritoryMap.scss'

interface TerritoryMapProps {
  campaign: DerivedCampaign
  selectedRegion?: string
  selectedNodeId?: string
  onSelectRegion(region: string): void
  onBackToOverview(): void
  onSelectNode(node: DerivedTerritoryNode): void
}

type MapMode = 'control' | 'stability'
type CanvasContext = ReturnType<typeof Taro.createCanvasContext>
type MapTouchEvent = CommonEvent & {
  touches?: Array<{ pageX: number; pageY: number }>
  changedTouches?: Array<{ pageX: number; pageY: number }>
}

const MAP_TOP = 0.17
const MAP_HEIGHT = 0.72

function canvasPoint(point: MapPosition, width: number, height: number): MapPosition {
  return { x: width * point.x / 100, y: height * (MAP_TOP + MAP_HEIGHT * point.y / 100) }
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

function regionColor(region: CampaignRegion, mode: MapMode): string {
  if (region.contested) return '#8a735c'
  if (region.controlled) {
    if (mode === 'stability') return region.stability >= 80 ? '#647a78' : region.stability >= 50 ? '#82908a' : '#a18463'
    return '#71898b'
  }
  if (!region.available) return '#a39d8e'
  return '#7b6660'
}

function nodeColor(node: DerivedTerritoryNode, mode: MapMode): string {
  if (node.effectiveState === 'locked') return '#a39d8e'
  if (node.effectiveOwner === 'rebel' || node.effectiveState === 'contested') return '#9b805c'
  if (node.effectiveOwner === 'enemy') return '#7b6660'
  if (mode === 'stability') return node.effectiveStability >= 80 ? '#647a78' : node.effectiveStability >= 50 ? '#82908a' : '#a18463'
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
    context.beginPath(); context.moveTo(x, height); context.lineTo(x + height, 0); context.stroke()
  }
  context.restore()
}

function drawChartBase(context: CanvasContext, width: number, height: number) {
  context.clearRect(0, 0, width, height)
  context.setFillStyle('#cbbd9b')
  context.fillRect(0, 0, width, height)
  context.setStrokeStyle('rgba(50, 55, 51, .09)')
  context.setLineWidth(1)
  for (let x = 0; x <= width; x += 38) {
    context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke()
  }
  for (let y = 0; y <= height; y += 38) {
    context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke()
  }
}

function localNodePositions(region: CampaignRegion): Map<string, MapPosition> {
  const result = new Map<string, MapPosition>()
  if (region.finalRegion) {
    result.set(region.capital.id, { x: 50, y: 50 })
    return result
  }
  const columns = region.outposts.length > 8 ? 3 : 2
  const rows = Math.max(1, Math.ceil(region.outposts.length / columns))
  region.outposts.forEach((node, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    result.set(node.id, node.tacticalPosition ?? {
      x: columns === 3 ? 14 + column * 22 : 18 + column * 29,
      y: rows === 1 ? 50 : 20 + row * (60 / Math.max(1, rows - 1))
    })
  })
  result.set(region.capital.id, region.capital.tacticalPosition ?? { x: 82, y: 50 })
  return result
}

function transformMapPoint(point: MapPosition, zoom: number, pan: MapPosition): MapPosition {
  return {
    x: 50 + (point.x - 50) * zoom + pan.x,
    y: 50 + (point.y - 50) * zoom + pan.y
  }
}

function nodeSymbol(node: DerivedTerritoryNode): string {
  if (node.role === 'campaign_capital') return '★'
  if (node.role === 'regional_capital') return '♜'
  return node.kind === 'fortress' ? '◆' : '●'
}

function shortHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function campaignDrawingRevision(campaign: DerivedCampaign): string {
  const nodes = campaign.nodes.map((node) => [
    node.id,
    node.region,
    node.title,
    node.description,
    node.kind,
    node.role,
    node.estimatedMinutes,
    node.victoryCriteria,
    node.scoreTarget ?? '',
    node.effectiveOwner,
    node.effectiveState,
    node.effectiveStability,
    node.position.x,
    node.position.y,
    node.tacticalPosition?.x ?? '',
    node.tacticalPosition?.y ?? ''
  ].join(':')).join('|')
  const edges = campaign.edges.map((edge) => `${edge.from}>${edge.to}:${edge.kind}`).join('|')
  return shortHash(`${nodes}#${edges}`)
}

export function TerritoryMap({
  campaign,
  selectedRegion,
  selectedNodeId,
  onSelectRegion,
  onBackToOverview,
  onSelectNode
}: TerritoryMapProps) {
  const [mode, setMode] = useState<MapMode>('control')
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState<MapPosition>({ x: 0, y: 0 })
  const [hideControlled, setHideControlled] = useState(false)
  const [touchStart, setTouchStart] = useState<MapPosition | undefined>()
  const drawingRevision = campaignDrawingRevision(campaign)
  const regions = useMemo(() => getCampaignRegions(campaign), [campaign.id, drawingRevision])
  const focusedRegion = regions.find((region) => region.name === selectedRegion)
  const overviewRegions = useMemo(() => regions.filter((region) => region.finalRegion || !hideControlled || !region.controlled), [hideControlled, regions])
  const overviewCells = useMemo(() => createTerritoryCells(overviewRegions.map((region) => ({ id: region.id, position: region.position }))), [overviewRegions])
  const renderedOverviewCells = useMemo(() => overviewCells.map((cell) => ({
    ...cell,
    points: cell.points.map((point) => transformMapPoint(point, zoom, pan)),
    centroid: transformMapPoint(cell.centroid, zoom, pan)
  })), [overviewCells, pan, zoom])
  const renderedOutline = useMemo(() => THEATRE_OUTLINE.map((point) => transformMapPoint(point, zoom, pan)), [pan, zoom])
  const cellsById = useMemo(() => new Map(renderedOverviewCells.map((cell) => [cell.id, cell])), [renderedOverviewCells])
  const overviewRegionById = useMemo(() => new Map(overviewRegions.map((region) => [region.id, region])), [overviewRegions])
  const overviewRegionByNodeId = useMemo(() => {
    const index = new Map<string, CampaignRegion>()
    overviewRegions.forEach((region) => region.nodes.forEach((node) => index.set(node.id, region)))
    return index
  }, [overviewRegions])
  const baseLocalPositions = useMemo(() => focusedRegion ? localNodePositions(focusedRegion) : new Map<string, MapPosition>(), [focusedRegion])
  const localPositions = useMemo(() => new Map([...baseLocalPositions].map(([id, position]) => [id, transformMapPoint(position, zoom, pan)])), [baseLocalPositions, pan, zoom])
  const viewKey = focusedRegion?.id ?? 'overview'
  const canvasId = useMemo(
    () => `theatre_${shortHash(`${campaign.id}_${viewKey}`)}`,
    [campaign.id, viewKey]
  )

  useEffect(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setTouchStart(undefined)
    Taro.pageScrollTo({ scrollTop: 0, duration: 160 }).catch(() => undefined)
  }, [viewKey])

  useEffect(() => {
    const timer = setTimeout(() => {
      Taro.createSelectorQuery().select(`#${canvasId}`).boundingClientRect((rect) => {
        if (!rect || Array.isArray(rect)) return
        const context = Taro.createCanvasContext(canvasId)
        drawChartBase(context, rect.width, rect.height)

        if (!focusedRegion) {
          context.save()
          context.setShadow(0, 10, 24, 'rgba(49, 45, 37, .28)')
          tracePolygon(context, renderedOutline, rect.width, rect.height)
          context.setFillStyle('#b8aa89'); context.fill(); context.restore()

          renderedOverviewCells.forEach((cell) => {
            const region = overviewRegionById.get(cell.id)
            if (!region) return
            tracePolygon(context, cell.points, rect.width, rect.height)
            context.setFillStyle(regionColor(region, mode)); context.fill()
            context.setStrokeStyle('rgba(48, 48, 43, .72)'); context.setLineWidth(2); context.stroke()
            if (!region.available && !region.controlled) drawHatching(context, cell, rect.width, rect.height, '#665f56')
            if (region.contested) drawHatching(context, cell, rect.width, rect.height, '#765e38')
          })

          const seenRoutes = new Set<string>()
          campaign.edges.forEach((edge) => {
            const fromRegion = overviewRegionByNodeId.get(edge.from)
            const toRegion = overviewRegionByNodeId.get(edge.to)
            if (!fromRegion || !toRegion || fromRegion.id === toRegion.id) return
            const routeKey = `${fromRegion.id}>${toRegion.id}`
            if (seenRoutes.has(routeKey)) return
            seenRoutes.add(routeKey)
            const aCell = cellsById.get(fromRegion.id)
            const bCell = cellsById.get(toRegion.id)
            if (!aCell || !bCell) return
            const a = canvasPoint(aCell.centroid, rect.width, rect.height)
            const b = canvasPoint(bCell.centroid, rect.width, rect.height)
            context.beginPath(); context.setStrokeStyle('rgba(65, 63, 55, .42)'); context.setLineWidth(3)
            context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke()
          })
          tracePolygon(context, renderedOutline, rect.width, rect.height)
          context.setStrokeStyle('#3f4540'); context.setLineWidth(4); context.stroke()
        } else {
          const positions = localPositions
          focusedRegion.nodes.forEach((node) => {
            if (node.id === focusedRegion.capital.id) return
            const from = positions.get(node.id)
            const to = positions.get(focusedRegion.capital.id)
            if (!from || !to) return
            const a = canvasPoint(from, rect.width, rect.height)
            const b = canvasPoint(to, rect.width, rect.height)
            context.beginPath()
            context.setStrokeStyle(node.effectiveOwner === 'self' ? '#496e6e' : 'rgba(70, 66, 56, .48)')
            context.setLineWidth(node.effectiveOwner === 'self' ? 4 : 2)
            if (node.effectiveOwner !== 'self') context.setLineDash([7, 6], 0)
            context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke(); context.setLineDash([], 0)
          })
          focusedRegion.nodes.forEach((node) => {
            const position = positions.get(node.id)
            if (!position) return
            const target = canvasPoint(position, rect.width, rect.height)
            const radius = node.role === 'regional_capital' || node.role === 'campaign_capital' ? 38 : 27
            context.beginPath(); context.arc(target.x, target.y, radius, 0, Math.PI * 2)
            context.setFillStyle(nodeColor(node, mode)); context.fill()
            context.setStrokeStyle(node.id === selectedNodeId ? '#344f55' : '#454943')
            context.setLineWidth(node.id === selectedNodeId ? 6 : 3); context.stroke()
          })
        }
        context.draw()
      }).exec()
    }, 60)
    return () => clearTimeout(timer)
  }, [canvasId, cellsById, drawingRevision, focusedRegion, localPositions, mode, overviewRegionById, overviewRegionByNodeId, renderedOutline, renderedOverviewCells, selectedNodeId])

  const ordinaryRegions = regions.filter((region) => !region.finalRegion)
  const controlledRegions = ordinaryRegions.filter((region) => region.controlled).length
  const threatenedRegions = ordinaryRegions.filter((region) => region.contested).length

  const changeZoom = (delta: number) => setZoom((current) => Math.max(1, Math.min(1.8, Math.round((current + delta) * 10) / 10)))
  const movePan = (x: number, y: number) => setPan((current) => ({
    x: Math.max(-35, Math.min(35, current.x + x)),
    y: Math.max(-30, Math.min(30, current.y + y))
  }))
  const resetView = () => { setZoom(1); setPan({ x: 0, y: 0 }) }
  const beginPan = (event: CommonEvent) => {
    const touch = (event as MapTouchEvent).touches?.[0]
    if (touch) setTouchStart({ x: touch.pageX, y: touch.pageY })
  }
  const finishPan = (event: CommonEvent) => {
    const touch = (event as MapTouchEvent).changedTouches?.[0]
    if (!touch || !touchStart || zoom <= 1) { setTouchStart(undefined); return }
    const dx = touch.pageX - touchStart.x
    const dy = touch.pageY - touchStart.y
    if (Math.abs(dx) + Math.abs(dy) > 18) movePan(dx / 7, dy / 7)
    setTouchStart(undefined)
  }

  return (
    <View className={`territory-map ${focusedRegion ? 'territory-map--region' : ''}`} onTouchStart={beginPan} onTouchEnd={finishPan}>
      <Canvas key={canvasId} id={canvasId} canvasId={canvasId} className='territory-canvas' />

      <View className='map-command-bar'>
        <View className='map-command-copy'>
          {focusedRegion && <Text className='map-back' onClick={onBackToOverview}>‹ 返回战区总览</Text>}
          <Text className='map-command-kicker'>{focusedRegion ? 'REGIONAL OPERATION' : 'THEATRE CONTROL'}</Text>
          <Text className='map-command-title'>{focusedRegion ? focusedRegion.name : '战区态势图'}</Text>
          <Text className='map-command-meta'>
            {focusedRegion
              ? focusedRegion.finalRegion ? '最终首都 · 全区域主城控制后解锁' : `${focusedRegion.outposts.length} 个据点 · 1 座区域主城`
              : `${ordinaryRegions.length} 个区域 · 1 座最终首都 · 点击进入查看`}
          </Text>
        </View>
        <View className='map-mode-switch'>
          <View className={mode === 'control' ? 'map-mode map-mode--active' : 'map-mode'} onClick={() => setMode('control')}>政治</View>
          <View className={mode === 'stability' ? 'map-mode map-mode--active' : 'map-mode'} onClick={() => setMode('stability')}>稳定</View>
        </View>
      </View>

      <View className='map-navigation'>
        {!focusedRegion && <Text className={hideControlled ? 'map-navigation-toggle map-navigation-toggle--active' : 'map-navigation-toggle'} onClick={() => setHideControlled((value) => !value)}>{hideControlled ? '显示已控区' : '折叠已控区'}</Text>}
        <View className='map-navigation-buttons'>
          <Text onClick={() => changeZoom(-0.2)}>−</Text>
          <Text className='map-zoom-readout'>{Math.round(zoom * 100)}%</Text>
          <Text onClick={() => changeZoom(0.2)}>＋</Text>
          <Text onClick={() => movePan(0, 8)}>↑</Text>
          <Text onClick={() => movePan(8, 0)}>←</Text>
          <Text onClick={resetView}>◎</Text>
          <Text onClick={() => movePan(-8, 0)}>→</Text>
          <Text onClick={() => movePan(0, -8)}>↓</Text>
        </View>
      </View>

      {!focusedRegion && overviewRegions.map((region, index) => {
        const cell = cellsById.get(region.id)
        if (!cell) return null
        const top = (MAP_TOP + MAP_HEIGHT * cell.centroid.y / 100) * 100
        return (
          <View key={region.id} role='button' ariaLabel={`进入${region.name}，当前进度${region.progressPercent}%`} className={`territory-node region-marker ${region.controlled ? 'territory-node--self' : region.contested ? 'territory-node--contested' : region.available ? 'territory-node--enemy' : 'territory-node--locked'}`} style={{ left: `${cell.centroid.x}%`, top: `${top}%` }} onClick={() => onSelectRegion(region.name)}>
            <View className='node-designation'>{region.finalRegion ? 'HQ' : `R-${String(index + 1).padStart(2, '0')}`}</View>
            <View className='node-label-row'><Text className='node-symbol'>{region.finalRegion ? '★' : '▰'}</Text><Text className='node-name'>{region.name}</Text></View>
            <View className='node-state'>{region.controlled ? '已控制' : region.contested ? '战况告急' : `${region.progressPercent}% · 进入区域`}</View>
          </View>
        )
      })}

      {focusedRegion && focusedRegion.nodes.map((node, index) => {
        const position = localPositions.get(node.id)
        if (!position) return null
        const top = (MAP_TOP + MAP_HEIGHT * position.y / 100) * 100
        return (
          <View key={node.id} role='button' ariaLabel={`${node.title}，${STATE_LABELS[node.effectiveState]}`} className={`territory-node region-node territory-node--${ownerClass(node)} ${node.id === selectedNodeId ? 'territory-node--selected' : ''}`} style={{ left: `${position.x}%`, top: `${top}%` }} onClick={() => onSelectNode(node)}>
            <View className='node-designation'>{node.role === 'outpost' ? `B-${String(index + 1).padStart(2, '0')}` : node.role === 'campaign_capital' ? 'CAPITAL' : 'CITY'}</View>
            <View className='node-label-row'><Text className='node-symbol'>{nodeSymbol(node)}</Text><Text className='node-name'>{node.title}</Text>{node.supplyCut && <Text className='supply-alert'>!</Text>}</View>
            <View className='node-state'>{mode === 'stability' && node.effectiveOwner === 'self' ? `稳定 ${node.effectiveStability}` : STATE_LABELS[node.effectiveState]}</View>
          </View>
        )
      })}

      <View className='map-sitrep'>
        {focusedRegion ? (
          <>
            <View><Text>{focusedRegion.controlledNodeCount}</Text><small>已攻克</small></View>
            <View><Text>{focusedRegion.nodes.length}</Text><small>总目标</small></View>
            <View className={focusedRegion.contested ? 'map-sitrep--danger' : ''}><Text>{focusedRegion.progressPercent}%</Text><small>区域进度</small></View>
          </>
        ) : (
          <>
            <View><Text>{controlledRegions}</Text><small>控制区域</small></View>
            <View><Text>{ordinaryRegions.length}</Text><small>总区域</small></View>
            <View className={threatenedRegions ? 'map-sitrep--danger' : ''}><Text>{threatenedRegions}</Text><small>告急区域</small></View>
          </>
        )}
      </View>
      <View className='map-scale'><Text>0</Text><View /><Text>100 KM</Text></View>
      <View className='map-compass'><Text>N</Text><View>▲</View><small>GRID 01</small></View>
    </View>
  )
}
