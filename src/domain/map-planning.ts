import type {
  Campaign,
  DependencyEdge,
  MapPosition,
  MapValidationIssue,
  TerritoryNode
} from './types'

function issue(
  code: string,
  severity: MapValidationIssue['severity'],
  message: string,
  nodeIds: string[] = []
): MapValidationIssue {
  return { code, severity, message, nodeIds }
}

export function isStructuralDependency(campaign: Pick<Campaign, 'nodes'>, edge: Pick<DependencyEdge, 'from' | 'to'>): boolean {
  const from = campaign.nodes.find((node) => node.id === edge.from)
  const to = campaign.nodes.find((node) => node.id === edge.to)
  if (!from || !to) return false
  if (from.role === 'outpost' && to.role === 'regional_capital' && from.region === to.region) return true
  return from.role === 'regional_capital' && to.role === 'campaign_capital'
}

export function validateCampaignMap(campaign: Pick<Campaign, 'nodes' | 'edges'>): MapValidationIssue[] {
  const issues: MapValidationIssue[] = []
  const nodesById = new Map(campaign.nodes.map((node) => [node.id, node]))
  if (campaign.nodes.length > 100) issues.push(issue('node_limit', 'error', '单场战役最多保留 100 个节点。'))

  const finalCapitals = campaign.nodes.filter((node) => node.role === 'campaign_capital')
  if (finalCapitals.length !== 1) {
    issues.push(issue('final_capital_count', 'error', '版图必须且只能包含一座最终首都。', finalCapitals.map((node) => node.id)))
  }

  const ordinaryRegions = [...new Set(campaign.nodes.filter((node) => node.role !== 'campaign_capital').map((node) => node.region))]
  ordinaryRegions.forEach((region) => {
    const members = campaign.nodes.filter((node) => node.region === region && node.role !== 'campaign_capital')
    const outposts = members.filter((node) => node.role === 'outpost')
    const capitals = members.filter((node) => node.role === 'regional_capital')
    if (outposts.length === 0) issues.push(issue('region_without_outpost', 'error', `「${region}」至少需要一个分支据点。`, members.map((node) => node.id)))
    if (capitals.length !== 1) issues.push(issue('regional_capital_count', 'error', `「${region}」必须且只能包含一座区域主城。`, capitals.map((node) => node.id)))
    if (capitals.length === 1) {
      outposts.forEach((outpost) => {
        const hasGate = campaign.edges.some((edge) => edge.kind === 'hard' && edge.from === outpost.id && edge.to === capitals[0].id)
        if (!hasGate) issues.push(issue('missing_capital_gate', 'error', `据点「${outpost.title}」尚未接入区域主城。`, [outpost.id, capitals[0].id]))
      })
    }

    const titleGroups = new Map<string, TerritoryNode[]>()
    members.forEach((node) => {
      const key = node.title.trim().toLocaleLowerCase()
      titleGroups.set(key, [...(titleGroups.get(key) ?? []), node])
    })
    titleGroups.forEach((duplicates) => {
      if (duplicates.length > 1) issues.push(issue('duplicate_title', 'error', `「${region}」存在重复节点名称「${duplicates[0].title}」。`, duplicates.map((node) => node.id)))
    })
  })

  const seenEdges = new Set<string>()
  campaign.edges.forEach((edge) => {
    const from = nodesById.get(edge.from)
    const to = nodesById.get(edge.to)
    if (!from || !to) {
      issues.push(issue('dangling_edge', 'error', '存在连接到已删除节点的道路。', [edge.from, edge.to]))
      return
    }
    if (edge.from === edge.to) issues.push(issue('self_edge', 'error', `「${from.title}」不能把自己设为前置。`, [from.id]))
    const key = `${edge.from}>${edge.to}:${edge.kind}`
    if (seenEdges.has(key)) issues.push(issue('duplicate_edge', 'error', `「${from.title}」到「${to.title}」的道路重复。`, [from.id, to.id]))
    seenEdges.add(key)
  })

  const hardAdjacency = new Map<string, string[]>()
  campaign.nodes.forEach((node) => hardAdjacency.set(node.id, []))
  campaign.edges.filter((edge) => edge.kind === 'hard' && nodesById.has(edge.from) && nodesById.has(edge.to)).forEach((edge) => {
    hardAdjacency.get(edge.from)!.push(edge.to)
  })
  const visiting = new Set<string>()
  const visited = new Set<string>()
  let cycle: string[] | undefined
  const visit = (nodeId: string, path: string[]) => {
    if (cycle || visited.has(nodeId)) return
    if (visiting.has(nodeId)) {
      const start = path.indexOf(nodeId)
      cycle = [...path.slice(Math.max(0, start)), nodeId]
      return
    }
    visiting.add(nodeId)
    ;(hardAdjacency.get(nodeId) ?? []).forEach((next) => visit(next, [...path, nodeId]))
    visiting.delete(nodeId)
    visited.add(nodeId)
  }
  campaign.nodes.forEach((node) => visit(node.id, []))
  if (cycle) issues.push(issue('hard_cycle', 'error', '硬前置关系形成循环，相关节点将永远无法解锁。', cycle))

  campaign.nodes.forEach((node) => {
    const position = node.position
    if (position.x < 0 || position.x > 100 || position.y < 0 || position.y > 100) {
      issues.push(issue('position_outside', 'warning', `「${node.title}」位于战区边界之外，建议执行自动布局。`, [node.id]))
    }
  })

  return issues
}

function tacticalGrid(count: number): MapPosition[] {
  const columns = count > 8 ? 3 : 2
  const rows = Math.max(1, Math.ceil(count / columns))
  return Array.from({ length: count }, (_, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    return {
      x: columns === 3 ? 14 + column * 22 : 18 + column * 29,
      y: rows === 1 ? 50 : 18 + row * (64 / Math.max(1, rows - 1))
    }
  })
}

export function autoLayoutCampaign(campaign: Campaign): Campaign {
  const regionNames = [...new Set(campaign.nodes.filter((node) => node.role === 'regional_capital').map((node) => node.region))]
  const columns = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(regionNames.length))))
  const rows = Math.max(1, Math.ceil(regionNames.length / columns))
  const regionCenters = new Map<string, MapPosition>()
  regionNames.forEach((region, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    regionCenters.set(region, {
      x: columns === 1 ? 42 : 12 + column * (68 / Math.max(1, columns - 1)),
      y: rows === 1 ? 50 : 18 + row * (64 / Math.max(1, rows - 1))
    })
  })

  const tacticalById = new Map<string, MapPosition>()
  regionNames.forEach((region) => {
    const outposts = campaign.nodes.filter((node) => node.region === region && node.role === 'outpost')
    tacticalGrid(outposts.length).forEach((position, index) => tacticalById.set(outposts[index].id, position))
    const capital = campaign.nodes.find((node) => node.region === region && node.role === 'regional_capital')
    if (capital) tacticalById.set(capital.id, { x: 82, y: 50 })
  })

  return {
    ...campaign,
    nodes: campaign.nodes.map((node) => {
      if (node.role === 'campaign_capital') return { ...node, position: { x: 92, y: 50 }, tacticalPosition: { x: 50, y: 50 } }
      const center = regionCenters.get(node.region) ?? node.position
      const tacticalPosition = tacticalById.get(node.id)
      const offset = node.role === 'regional_capital' ? { x: 3, y: 0 } : { x: -3, y: 0 }
      return {
        ...node,
        position: { x: center.x + offset.x, y: center.y + offset.y },
        tacticalPosition
      }
    })
  }
}
