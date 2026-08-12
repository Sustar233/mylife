import assert from 'node:assert/strict'
import test from 'node:test'
import { createTerritoryCells, isPointInPolygon, polygonCentroid, THEATRE_OUTLINE } from '../src/domain/territory-geometry'
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
