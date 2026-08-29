import type { Campaign, DependencyEdge, DerivedCampaign, DerivedTerritoryNode, MapPosition, TerritoryNode } from './types'

export interface CampaignRegion {
  id: string
  name: string
  position: MapPosition
  nodes: DerivedTerritoryNode[]
  outposts: DerivedTerritoryNode[]
  capital: DerivedTerritoryNode
  finalRegion: boolean
  controlled: boolean
  controlledNodeCount: number
  progressPercent: number
  contested: boolean
  available: boolean
  stability: number
}

function averagePosition(nodes: Array<{ position: MapPosition }>): MapPosition {
  if (!nodes.length) return { x: 50, y: 50 }
  return {
    x: nodes.reduce((sum, node) => sum + node.position.x, 0) / nodes.length,
    y: nodes.reduce((sum, node) => sum + node.position.y, 0) / nodes.length
  }
}

function edgeKey(edge: Pick<DependencyEdge, 'from' | 'to' | 'kind'>): string {
  return `${edge.from}>${edge.to}:${edge.kind}`
}

/**
 * Idempotently upgrades legacy one-node-per-province campaigns into a two-level
 * region structure. Existing nodes, sessions and evidence keep their IDs.
 */
export function upgradeCampaignHierarchy(campaign: Campaign): Campaign {
  const alreadyUpgraded = campaign.nodes.some((node) => node.role === 'regional_capital' || node.kind === 'regional_capital')
  if (alreadyUpgraded) {
    return {
      ...campaign,
      dailyTroops: campaign.dailyTroops ?? Math.max(30, Math.round((campaign.weeklyBudget ?? 300) / 5 / 15) * 15),
      nodes: campaign.nodes.map((node) => ({
        ...node,
        role: node.role ?? (node.kind === 'capital' ? 'campaign_capital' : node.kind === 'regional_capital' ? 'regional_capital' : 'outpost')
      }))
    }
  }

  const normalized = campaign.nodes.map((node) => ({
    ...node,
    role: node.kind === 'capital' ? 'campaign_capital' as const : 'outpost' as const
  }))
  const globalCapital = normalized.find((node) => node.role === 'campaign_capital')
  const outposts = normalized.filter((node) => node.role === 'outpost')
  const regionNames = [...new Set(outposts.map((node) => node.region))]
  const capitalByRegion = new Map<string, TerritoryNode>()

  regionNames.forEach((region, index) => {
    const members = outposts.filter((node) => node.region === region)
    const basePosition = averagePosition(members)
    const regionalCapital: TerritoryNode = {
      id: `${campaign.id}_regional_capital_${index + 1}`,
      campaignId: campaign.id,
      templateKey: `regional-capital-${index + 1}`,
      region,
      title: `${region}主城`,
      description: `统合${region}全部分支能力的区域验收。`,
      kind: 'regional_capital',
      role: 'regional_capital',
      owner: 'enemy',
      originOwner: 'enemy',
      state: 'locked',
      estimatedMinutes: Math.max(60, Math.round(members.reduce((sum, node) => sum + node.estimatedMinutes, 0) / Math.max(1, members.length) / 15) * 15),
      accumulatedMinutes: 0,
      victoryCriteria: `综合运用${region}的全部据点能力，提交一份可验证成果`,
      position: {
        x: Math.min(92, Math.max(8, basePosition.x + 5)),
        y: Math.min(90, Math.max(10, basePosition.y))
      },
      review: { baseStability: 0, step: 0 }
    }
    capitalByRegion.set(region, regionalCapital)
  })

  const edges: DependencyEdge[] = []
  const seen = new Set<string>()
  const addEdge = (from: string, to: string, kind: DependencyEdge['kind'] = 'hard') => {
    if (from === to) return
    const candidate: DependencyEdge = { id: `edge_${campaign.id}_${edges.length + 1}`, campaignId: campaign.id, from, to, kind }
    const key = edgeKey(candidate)
    if (seen.has(key)) return
    seen.add(key)
    edges.push(candidate)
  }

  campaign.edges.forEach((edge) => {
    const from = normalized.find((node) => node.id === edge.from)
    const to = normalized.find((node) => node.id === edge.to)
    if (!from || !to || to.role === 'campaign_capital') return
    if (from.region === to.region) addEdge(from.id, to.id, edge.kind)
    else {
      const sourceCapital = capitalByRegion.get(from.region)
      if (sourceCapital) addEdge(sourceCapital.id, to.id, edge.kind)
    }
  })

  outposts.forEach((node) => {
    const regionalCapital = capitalByRegion.get(node.region)
    if (regionalCapital) addEdge(node.id, regionalCapital.id, 'hard')
  })
  if (globalCapital) {
    capitalByRegion.forEach((regionalCapital) => addEdge(regionalCapital.id, globalCapital.id, 'hard'))
  }

  return {
    ...campaign,
    dailyTroops: campaign.dailyTroops ?? Math.max(30, Math.round((campaign.weeklyBudget ?? 300) / 5 / 15) * 15),
    nodes: [...normalized, ...capitalByRegion.values()],
    edges
  }
}

export function getCampaignRegions(campaign: DerivedCampaign): CampaignRegion[] {
  const regionCapitals = campaign.nodes.filter((node) => node.role === 'regional_capital')
  const regions = regionCapitals.map((capital, index) => {
    const nodes = campaign.nodes.filter((node) => node.region === capital.region && node.role !== 'campaign_capital')
    const outposts = nodes.filter((node) => node.role === 'outpost')
    const controlledNodeCount = nodes.filter((node) => node.effectiveOwner === 'self').length
    return {
      id: `region_${index + 1}_${capital.id}`,
      name: capital.region,
      position: capital.position,
      nodes,
      outposts,
      capital,
      finalRegion: false,
      controlled: capital.effectiveOwner === 'self',
      controlledNodeCount,
      progressPercent: Math.round(controlledNodeCount / Math.max(1, nodes.length) * 100),
      contested: nodes.some((node) => node.effectiveState === 'contested' || node.effectiveState === 'lost'),
      available: nodes.some((node) => node.effectiveState === 'available' || node.effectiveState === 'sieging'),
      stability: capital.effectiveOwner === 'self' ? capital.effectiveStability : 0
    }
  })

  const finalCapital = campaign.nodes.find((node) => node.role === 'campaign_capital')
  if (finalCapital) {
    regions.push({
      id: `region_final_${finalCapital.id}`,
      name: finalCapital.region,
      position: finalCapital.position,
      nodes: [finalCapital],
      outposts: [],
      capital: finalCapital,
      finalRegion: true,
      controlled: finalCapital.effectiveOwner === 'self',
      controlledNodeCount: finalCapital.effectiveOwner === 'self' ? 1 : 0,
      progressPercent: finalCapital.effectiveOwner === 'self' ? 100 : 0,
      contested: finalCapital.effectiveState === 'contested' || finalCapital.effectiveState === 'lost',
      available: finalCapital.effectiveState === 'available' || finalCapital.effectiveState === 'sieging',
      stability: finalCapital.effectiveOwner === 'self' ? finalCapital.effectiveStability : 0
    })
  }
  return regions
}
