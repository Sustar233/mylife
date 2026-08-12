export type TemplateType = 'language' | 'exam' | 'stem'
export type CampaignStatus = 'active' | 'archived' | 'victorious'
export type NodeState = 'locked' | 'available' | 'sieging' | 'controlled' | 'contested' | 'lost'
export type TerritoryOwner = 'self' | 'enemy' | 'rebel'
export type OriginOwner = 'self' | 'enemy'
export type NodeKind = 'city' | 'fortress' | 'capital'
export type EdgeKind = 'hard' | 'soft'
export type SessionMode = 'attack' | 'review' | 'recover'
export type SessionStatus = 'planned' | 'active' | 'paused' | 'settled' | 'abandoned'
export type SessionOutcome = 'achieved' | 'partial' | 'failed'
export type EvidenceType = 'text' | 'link' | 'image'
export type EventType =
  | 'campaign_created'
  | 'session_planned'
  | 'session_started'
  | 'siege_progress'
  | 'territory_captured'
  | 'territory_reviewed'
  | 'territory_recovered'
  | 'truce_started'
  | 'campaign_archived'

export interface MapPosition {
  x: number
  y: number
}

export interface ReviewState {
  baseStability: number
  nextReviewAt?: string
  step: number
}

export interface TerritoryNode {
  id: string
  campaignId: string
  templateKey: string
  region: string
  title: string
  description: string
  kind: NodeKind
  owner: TerritoryOwner
  originOwner: OriginOwner
  state: NodeState
  estimatedMinutes: number
  accumulatedMinutes: number
  victoryCriteria: string
  scoreTarget?: number
  position: MapPosition
  review: ReviewState
}

export interface DependencyEdge {
  id: string
  campaignId: string
  from: string
  to: string
  kind: EdgeKind
}

export interface Campaign {
  id: string
  title: string
  templateType: TemplateType
  goal: string
  capitalCriteria: string
  capitalScoreTarget?: number
  weeklyBudget: number
  status: CampaignStatus
  createdAt: string
  nodes: TerritoryNode[]
  edges: DependencyEdge[]
}

export interface StudySession {
  id: string
  campaignId: string
  nodeId: string
  mode: SessionMode
  plannedMinutes: number
  scheduledAt: string
  status: SessionStatus
  startedAt?: string
  lastResumedAt?: string
  pausedAt?: string
  accumulatedSeconds: number
  endedAt?: string
  outcome?: SessionOutcome
  evidenceIds: string[]
  clientMutationId?: string
  score?: number
}

export interface Evidence {
  id: string
  sessionId: string
  type: EvidenceType
  content: string
  createdAt: string
}

export interface TerritoryEvent {
  id: string
  campaignId?: string
  nodeId?: string
  sessionId?: string
  type: EventType
  title: string
  detail: string
  occurredAt: string
}

export interface TrucePeriod {
  startAt: string
  endAt: string
}

export interface UserProfile {
  id: string
  displayName: string
  timezone: string
  weeklyBudget: number
  activeCampaignId?: string
  truce?: TrucePeriod
}

export interface WorldState {
  version: 1
  profile: UserProfile
  campaigns: Campaign[]
  sessions: StudySession[]
  evidence: Evidence[]
  events: TerritoryEvent[]
}

export interface DerivedTerritoryNode extends TerritoryNode {
  effectiveOwner: TerritoryOwner
  effectiveState: NodeState
  effectiveStability: number
  supplyCut: boolean
  effortPercent: number
  overdue: boolean
}

export interface DerivedCampaign extends Omit<Campaign, 'nodes'> {
  nodes: DerivedTerritoryNode[]
  controlledCount: number
  contestedCount: number
  progressPercent: number
}

export interface CampaignCreationInput {
  templateType: TemplateType
  title: string
  goal: string
  capitalCriteria: string
  capitalScoreTarget?: number
  weeklyBudget: number
  importedTemplateKeys: string[]
}

export interface EvidenceDraft {
  type: EvidenceType
  content: string
}

export interface SettlementInput {
  outcome: SessionOutcome
  evidence: EvidenceDraft[]
  clientMutationId: string
  score?: number
}
