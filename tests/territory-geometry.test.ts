import assert from 'node:assert/strict'
import test from 'node:test'
import { createTerritoryCells, createTerritoryCellSelector, isPointInPolygon, polygonCentroid, THEATRE_OUTLINE } from '../src/domain/territory-geometry'
import { CAMPAIGN_TEMPLATES } from '../src/domain/templates'

test('每个模板节点都会生成有效的连片行政区', () => {
  CAMPAIGN_TEMPLATES.forEach((template) => {
    const cells = createTerritoryCells(template.nodes.map((node) => ({ id: node.key, position: node.position })))
    assert.equal(cells.length, template.nodes.length)
    cells.forEach((cell) => {
      assert.ok(cell.points.length >= 3, `${template.type}/${cell.id} 缺少有效多边形`)
      assert.ok(isPointInPolygon(cell.centroid, cell.points), `${template.type}/${cell.id} 质心不在行政区内`)
      cell.points.forEach((point) => assert.ok(isPointInPolygon(point, THEATRE_OUTLINE) || THEATRE_OUTLINE.some((vertex) => Math.abs(vertex.x - point.x) < 1e-6 && Math.abs(vertex.y - point.y) < 1e-6)))
    })
  })
})

test('多边形质心计算稳定', () => {
  assert.deepEqual(polygonCentroid([
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 }
  ]), { x: 5, y: 5 })
})

test('地图状态更新复用边界，移动、折叠或切换节点重新生成边界', () => {
  const selectCells = createTerritoryCellSelector()
  const sites = [
    { id: 'west', position: { x: 25, y: 50 }, stability: 90 },
    { id: 'east', position: { x: 75, y: 50 }, stability: 80 }
  ]
  const initial = selectCells(sites)
  const updated = sites.map((site) => ({ ...site, position: { ...site.position }, stability: 50 }))
  assert.strictEqual(selectCells(updated), initial)

  updated[0].position.x = 35
  const moved = selectCells(updated)
  assert.notStrictEqual(moved, initial)
  assert.deepEqual(moved, createTerritoryCells(updated))
  assert.equal(initial[0].site.x, 25)

  const collapsed = selectCells(updated.slice(1))
  assert.equal(collapsed.length, 1)
  assert.deepEqual(collapsed[0].points, THEATRE_OUTLINE)
  const renamed = selectCells([{ ...updated[1], id: 'new-region' }])
  assert.notStrictEqual(renamed, collapsed)
  assert.equal(renamed[0].id, 'new-region')
  assert.deepEqual(selectCells([]), [])
})

test('重复顶点和退化边不会使多边形外的点被误判为内部', () => {
  const closedSquare = [
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 },
    { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 0 }
  ]
  assert.equal(isPointInPolygon({ x: 50, y: 50 }, closedSquare), false)
  assert.equal(isPointInPolygon({ x: 5, y: 5 }, closedSquare), true)
  assert.equal(isPointInPolygon({ x: 10, y: 5 }, closedSquare), true)
  assert.equal(isPointInPolygon({ x: 0, y: 0 }, closedSquare), true)
  assert.equal(isPointInPolygon({ x: 50, y: 50 }, [{ x: 0, y: 0 }]), false)
  assert.equal(isPointInPolygon({ x: 0, y: 0 }, []), false)
})
