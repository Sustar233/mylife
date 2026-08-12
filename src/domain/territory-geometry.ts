import type { MapPosition } from './types'

export interface TerritoryCell {
  id: string
  site: MapPosition
  centroid: MapPosition
  points: MapPosition[]
}

// A deliberately irregular coastline keeps the atlas from reading as a board or chart.
export const THEATRE_OUTLINE: MapPosition[] = [
  { x: 5, y: 26 },
  { x: 12, y: 11 },
  { x: 27, y: 6 },
  { x: 42, y: 10 },
  { x: 55, y: 4 },
  { x: 72, y: 9 },
  { x: 89, y: 20 },
  { x: 96, y: 38 },
  { x: 92, y: 55 },
  { x: 96, y: 72 },
  { x: 84, y: 88 },
  { x: 66, y: 94 },
  { x: 51, y: 90 },
  { x: 35, y: 97 },
  { x: 18, y: 89 },
  { x: 7, y: 73 },
  { x: 9, y: 55 },
  { x: 3, y: 40 }
]

function halfPlaneValue(point: MapPosition, site: MapPosition, rival: MapPosition): number {
  const dx = rival.x - site.x
  const dy = rival.y - site.y
  const midX = (site.x + rival.x) / 2
  const midY = (site.y + rival.y) / 2
  return (point.x - midX) * dx + (point.y - midY) * dy
}

function clipToNearestSite(polygon: MapPosition[], site: MapPosition, rival: MapPosition): MapPosition[] {
  if (polygon.length === 0) return polygon
  const clipped: MapPosition[] = []

  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index]
    const next = polygon[(index + 1) % polygon.length]
    const currentValue = halfPlaneValue(current, site, rival)
    const nextValue = halfPlaneValue(next, site, rival)
    const currentInside = currentValue <= 0
    const nextInside = nextValue <= 0

    if (currentInside) clipped.push(current)
    if (currentInside === nextInside) continue

    const denominator = currentValue - nextValue
    if (Math.abs(denominator) < 1e-9) continue
    const ratio = currentValue / denominator
    clipped.push({
      x: current.x + (next.x - current.x) * ratio,
      y: current.y + (next.y - current.y) * ratio
    })
  }

  return clipped
}

export function polygonCentroid(points: MapPosition[]): MapPosition {
  if (points.length < 3) return points[0] ?? { x: 50, y: 50 }
  let twiceArea = 0
  let weightedX = 0
  let weightedY = 0

  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length]
    const cross = point.x * next.y - next.x * point.y
    twiceArea += cross
    weightedX += (point.x + next.x) * cross
    weightedY += (point.y + next.y) * cross
  })

  if (Math.abs(twiceArea) < 1e-9) return points[0]
  return {
    x: weightedX / (3 * twiceArea),
    y: weightedY / (3 * twiceArea)
  }
}

export function createTerritoryCells(nodes: Array<{ id: string; position: MapPosition }>): TerritoryCell[] {
  return nodes.map((node) => {
    const points = nodes.reduce<MapPosition[]>((polygon, rival) => {
      if (rival.id === node.id) return polygon
      return clipToNearestSite(polygon, node.position, rival.position)
    }, THEATRE_OUTLINE.map((point) => ({ ...point })))

    return {
      id: node.id,
      site: node.position,
      centroid: polygonCentroid(points),
      points
    }
  })
}

export function isPointInPolygon(point: MapPosition, polygon: MapPosition[]): boolean {
  const onBoundary = polygon.some((start, index) => {
    const end = polygon[(index + 1) % polygon.length]
    const cross = (point.y - start.y) * (end.x - start.x) - (point.x - start.x) * (end.y - start.y)
    if (Math.abs(cross) > 1e-6) return false
    const dot = (point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y)
    const squaredLength = (end.x - start.x) ** 2 + (end.y - start.y) ** 2
    return dot >= -1e-6 && dot <= squaredLength + 1e-6
  })
  if (onBoundary) return true

  let inside = false
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current, current += 1) {
    const a = polygon[current]
    const b = polygon[previous]
    const crosses = (a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || 1e-9) + a.x
    if (crosses) inside = !inside
  }
  return inside
}
