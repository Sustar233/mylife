import { getDailyTroopStatus } from './engine'
import type { DerivedCampaign, TroopAllocationAdvice, WorldState } from './types'
import { HOUR_MS } from './utils'

export function getTroopAllocationAdvice(world: WorldState, campaign: DerivedCampaign | undefined, now = new Date().toISOString()): TroopAllocationAdvice {
  const status = getDailyTroopStatus(world, now, campaign?.dailyTroops)
  if (!campaign || status.remainingMinutes <= 0) return { remainingMinutes: status.remainingMinutes, allocatedMinutes: 0, items: [] }
  const lost = campaign.nodes.filter((node) => node.effectiveState === 'lost')
  const contested = campaign.nodes.filter((node) => node.effectiveState === 'contested')
  const dueSoon = campaign.nodes.filter((node) => node.effectiveOwner === 'self' && node.review.nextReviewAt && new Date(node.review.nextReviewAt).getTime() - new Date(now).getTime() <= 48 * HOUR_MS)
  const reviewTargets = [...new Map([...contested, ...dueSoon].map((node) => [node.id, node])).values()]
  const attackTargets = campaign.nodes.filter((node) => node.effectiveState === 'available' || node.effectiveState === 'sieging')
  const totalUnits = Math.floor(status.remainingMinutes / 15)
  const tail = status.remainingMinutes % 15
  if (totalUnits === 0) {
    const target = lost[0] ?? reviewTargets[0] ?? attackTargets[0]
    const key = lost.length ? 'recover' as const : reviewTargets.length ? 'review' as const : 'attack' as const
    return { remainingMinutes: status.remainingMinutes, allocatedMinutes: status.remainingMinutes, items: [{ key, label: key === 'recover' ? '收复兵力' : key === 'review' ? '防守兵力' : '进攻兵力', minutes: status.remainingMinutes, reason: '今日兵力不足一个完整时间棋子，建议用于一次快速回忆或战前侦察。', nodeIds: target ? [target.id] : [] }] }
  }
  let availableUnits = totalUnits
  let recoverUnits = lost.length ? Math.min(availableUnits, Math.max(1, Math.ceil(totalUnits * 0.4))) : 0
  availableUnits -= recoverUnits
  let reviewUnits = reviewTargets.length ? Math.min(availableUnits, Math.max(1, Math.ceil(totalUnits * 0.3))) : 0
  availableUnits -= reviewUnits
  let attackUnits = attackTargets.length ? availableUnits : 0
  availableUnits -= attackUnits
  if (availableUnits > 0) {
    if (reviewTargets.length) reviewUnits += availableUnits
    else if (lost.length) recoverUnits += availableUnits
    else attackUnits += availableUnits
  }
  if (!lost.length && !reviewTargets.length && !attackTargets.length) reviewUnits = totalUnits
  const allocations = [
    { key: 'recover' as const, label: '收复兵力', units: recoverUnits, reason: lost.length ? `${lost.length} 处领地已经失守，优先恢复补给线。` : '', nodeIds: lost.slice(0, 3).map((node) => node.id) },
    { key: 'review' as const, label: '防守兵力', units: reviewUnits, reason: reviewTargets.length ? `${reviewTargets.length} 处领地已告急或将在 48 小时内到期。` : '当前没有可扩张前线，用剩余兵力巩固既有领地。', nodeIds: reviewTargets.slice(0, 3).map((node) => node.id) },
    { key: 'attack' as const, label: '进攻兵力', units: attackUnits, reason: attackTargets.length ? `${attackTargets.length} 个前线已经解锁，优先推进围城中的目标。` : '', nodeIds: attackTargets.slice(0, 3).map((node) => node.id) }
  ].filter((item) => item.units > 0)
  const items = allocations.map((item, index) => ({ key: item.key, label: item.label, minutes: item.units * 15 + (index === allocations.length - 1 ? tail : 0), reason: item.reason, nodeIds: item.nodeIds }))
  return { remainingMinutes: status.remainingMinutes, allocatedMinutes: items.reduce((sum, item) => sum + item.minutes, 0), items }
}
