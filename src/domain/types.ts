export type TemplateType = 'operating-system' | 'language' | 'exam' | 'stem'
export type CampaignStatus = 'active' | 'archived' | 'victorious'
export type NodeState = 'locked' | 'available' | 'sieging' | 'controlled' | 'contested' | 'lost'
export type TerritoryOwner = 'self' | 'enemy' | 'rebel'
export type OriginOwner = 'self' | 'enemy'
export type NodeKind = 'city' | 'fortress' | 'regional_capital' | 'capital'
export type NodeRole = 'outpost' | 'regional_capital' | 'campaign_capital'
export type EdgeKind = 'hard' | 'soft'
export type SessionMode = 'attack' | 'review' | 'recover'
export type SessionStatus = 'planned' | 'active' | 'paused' | 'settled' | 'abandoned'
export type SessionOutcome = 'achieved' | 'partial' | 'failed'
export type ReviewRating = 'again' | 'hard' | 'good' | 'easy'
export type EvidenceType = 'text' | 'link' | 'image'
export type RewardTransactionKind = 'battle' | 'redemption' | 'fulfillment'
export type NpcDuty = 'strategist' | 'historian' | 'courier'
export type NpcCharacterId = string

export type NpcAssignments = Record<NpcDuty, NpcCharacterId>

export interface CustomNpcCharacter {
  id: NpcCharacterId
  name: string
  trait: string
  description: string
  image: string
  createdAt: string
}

export interface NpcCharacterInput {
  name: string
  trait: string
  description?: string
  image: string
}
export type EventType =
  | 'campaign_created'
  | 'session_planned'
  | 'session_started'
  | 'siege_progress'
  | 'territory_captured'
  | 'territory_reviewed'
  | 'territory_recovered'
  | 'truce_started'
  | 'map_edited'
  | 'campaign_archived'

export interface MapPosition {
  x: number
  y: number
}

export interface ReviewState {
  baseStability: number
  nextReviewAt?: string
  step: number
  intervalDays?: number
  ease?: number
  successfulReviews?: number
  lapses?: number
}

export interface TerritoryNode {
  id: string
  campaignId: string
  templateKey: string
  region: string
  title: string
  description: string
  kind: NodeKind
  role: NodeRole
  owner: TerritoryOwner
  originOwner: OriginOwner
  state: NodeState
  estimatedMinutes: number
  accumulatedMinutes: number
  victoryCriteria: string
  scoreTarget?: number
  position: MapPosition
  tacticalPosition?: MapPosition
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
  dailyTroops: number
  weeklyBudget?: number
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
  reviewRating?: ReviewRating
  reward?: SessionReward
}

export interface SessionReward {
  coins: number
  merit: number
  randomBonus: number
  breakdown: string[]
}

export interface RewardItem {
  id: string
  title: string
  description: string
  cost: number
  createdAt: string
  archivedAt?: string
}

export interface RewardTransaction {
  id: string
  kind: RewardTransactionKind
  title: string
  detail: string
  coinDelta: number
  meritDelta: number
  createdAt: string
  sessionId?: string
  rewardItemId?: string
  redemptionId?: string
}

export interface RewardRedemption {
  id: string
  rewardItemId: string
  title: string
  cost: number
  redeemedAt: string
  fulfilledAt?: string
}

export interface RewardSystem {
  coins: number
  merit: number
  items: RewardItem[]
  transactions: RewardTransaction[]
  redemptions: RewardRedemption[]
}

export interface RewardItemInput {
  title: string
  description?: string
  cost: number
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

export interface CampaignMapSnapshot {
  label: string
  createdAt: string
  nodes: TerritoryNode[]
  edges: DependencyEdge[]
}

export interface CampaignMapHistory {
  campaignId: string
  past: CampaignMapSnapshot[]
  future: CampaignMapSnapshot[]
}

export interface TrucePeriod {
  startAt: string
  endAt: string
}

export interface UserProfile {
  id: string
  displayName: string
  timezone: string
  dailyTroops: number
  weeklyBudget?: number
  activeCampaignId?: string
  truce?: TrucePeriod
  reminders?: ReminderSettings
  npcAssignments?: NpcAssignments
  customNpcCharacters?: CustomNpcCharacter[]
}

export interface ReminderSettings {
  enabled: boolean
  dueSoonHours: 24 | 48 | 72
  dailyBriefHour: number
}

export interface WorldState {
  version: 3
  profile: UserProfile
  campaigns: Campaign[]
  sessions: StudySession[]
  evidence: Evidence[]
  events: TerritoryEvent[]
  mapHistories?: CampaignMapHistory[]
  rewards: RewardSystem
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
  controlledRegionCount: number
  regionCount: number
}

export interface CampaignCreationInput {
  templateType: TemplateType
  title: string
  goal: string
  capitalCriteria: string
  capitalScoreTarget?: number
  dailyTroops: number
  importedTemplateKeys: string[]
}

export interface RegionCreationInput {
  name: string
  outpostTitle: string
  capitalTitle: string
  victoryCriteria: string
  estimatedMinutes: number
}

export interface OutpostCreationInput {
  region: string
  title: string
  description: string
  victoryCriteria: string
  estimatedMinutes: number
}

export interface TerritoryNodeUpdateInput {
  title: string
  description: string
  victoryCriteria: string
  estimatedMinutes: number
}

export interface DependencyCreationInput {
  from: string
  to: string
  kind: EdgeKind
}

export type MapValidationSeverity = 'error' | 'warning'

export interface MapValidationIssue {
  code: string
  severity: MapValidationSeverity
  message: string
  nodeIds: string[]
}

export interface MapHistoryStatus {
  undoCount: number
  redoCount: number
  lastLabel?: string
}

export interface DailyTroopStatus {
  quotaMinutes: number
  spentMinutes: number
  remainingMinutes: number
  percentRemaining: number
  dayKey: string
}

export interface TroopAllocationItem {
  key: 'recover' | 'review' | 'attack'
  label: string
  minutes: number
  reason: string
  nodeIds: string[]
}

export interface TroopAllocationAdvice {
  remainingMinutes: number
  allocatedMinutes: number
  items: TroopAllocationItem[]
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
  reviewRating?: ReviewRating
}
