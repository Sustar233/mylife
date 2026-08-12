import type { DerivedTerritoryNode, EventType, NodeState, SessionMode, TerritoryOwner } from './types'

export const STATE_LABELS: Record<NodeState, string> = {
  locked: '封锁',
  available: '可进攻',
  sieging: '围城中',
  controlled: '已控制',
  contested: '争夺中',
  lost: '已失守'
}

export const OWNER_LABELS: Record<TerritoryOwner, string> = {
  self: '己方',
  enemy: '敌方',
  rebel: '叛军'
}

export const EVENT_ICONS: Record<EventType, string> = {
  campaign_created: '⚑',
  session_planned: '⌁',
  session_started: '➜',
  siege_progress: '◌',
  territory_captured: '⚐',
  territory_reviewed: '◆',
  territory_recovered: '✦',
  truce_started: '☾',
  campaign_archived: '▣'
}

export function actionForNode(node: DerivedTerritoryNode): { mode: SessionMode; label: string } {
  if (node.effectiveState === 'lost') return { mode: 'recover', label: '发动收复' }
  if (node.effectiveOwner === 'self') return { mode: 'review', label: node.effectiveState === 'contested' ? '紧急防守' : '巩固领地' }
  return { mode: 'attack', label: node.effectiveState === 'sieging' ? '继续围城' : '发起进攻' }
}

export function ownerClass(node: DerivedTerritoryNode): string {
  if (node.effectiveState === 'locked') return 'locked'
  if (node.effectiveState === 'contested') return 'contested'
  if (node.effectiveOwner === 'rebel') return 'rebel'
  return node.effectiveOwner
}
