import type {
  NodeRole,
  RewardItemInput,
  RewardSystem,
  SessionMode,
  SessionOutcome,
  SessionReward,
  WorldState
} from './types'
import { clamp, makeId } from './utils'

const STARTER_REWARDS: Array<Omit<RewardSystem['items'][number], 'createdAt'>> = [
  { id: 'reward_milk_tea', title: '喝杯奶茶', description: '完成一次小小犒赏，记得按自己的生活预算兑换。', cost: 80 },
  { id: 'reward_movie', title: '看场电影', description: '留出一个晚上，安心享受自己的休息时间。', cost: 180 },
  { id: 'reward_trip', title: '短途出游', description: '为一次周末远行积攒军饷。', cost: 800 }
]

export function createInitialRewardSystem(now = new Date().toISOString()): RewardSystem {
  return {
    coins: 0,
    merit: 0,
    items: STARTER_REWARDS.map((item) => ({ ...item, createdAt: now })),
    transactions: [],
    redemptions: []
  }
}

export function upgradeRewardSystem(value: RewardSystem | undefined, now = new Date().toISOString()): RewardSystem {
  if (!value) return createInitialRewardSystem(now)
  return {
    coins: Math.max(0, Math.floor(Number(value.coins) || 0)),
    merit: Math.max(0, Math.floor(Number(value.merit) || 0)),
    items: Array.isArray(value.items) ? value.items : [],
    transactions: Array.isArray(value.transactions) ? value.transactions : [],
    redemptions: Array.isArray(value.redemptions) ? value.redemptions : []
  }
}

function seedHash(seed: string): number {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export interface SessionRewardInput {
  mode: SessionMode
  outcome: SessionOutcome
  nodeRole: NodeRole
  earnedMinutes: number
  evidenceCount: number
  seed: string
}

export function calculateSessionReward(input: SessionRewardInput): SessionReward {
  const eligible = input.earnedMinutes >= 5
  const baseCoins = Math.floor(input.earnedMinutes / 5)
  const evidenceBonus = eligible && input.evidenceCount > 0 ? 2 : 0
  const outcomeBonus = eligible ? input.outcome === 'achieved' ? 3 : input.outcome === 'partial' ? 1 : 0 : 0
  const dutyBonus = eligible && input.outcome === 'achieved' && input.mode !== 'attack' ? 2 : 0
  const capitalBonus = eligible && input.outcome === 'achieved'
    ? input.nodeRole === 'campaign_capital' ? 20 : input.nodeRole === 'regional_capital' ? 10 : 0
    : 0
  const hash = seedHash(input.seed)
  const randomBonus = eligible && input.outcome === 'achieved' && hash % 100 < 20 ? 2 + hash % 4 : 0
  const merit = Math.floor(input.earnedMinutes / 10)
    + (eligible ? input.outcome === 'achieved' ? 2 : input.outcome === 'partial' ? 1 : 0 : 0)
    + Math.floor(capitalBonus / 5)
  const breakdown = [
    ...(baseCoins ? [`有效投入 +${baseCoins}`] : []),
    ...(evidenceBonus ? [`成果证据 +${evidenceBonus}`] : []),
    ...(outcomeBonus ? [`行动战果 +${outcomeBonus}`] : []),
    ...(dutyBonus ? [`守土尽责 +${dutyBonus}`] : []),
    ...(capitalBonus ? [`攻克重镇 +${capitalBonus}`] : []),
    ...(randomBonus ? [`随机战利品 +${randomBonus}`] : [])
  ]
  return {
    coins: baseCoins + evidenceBonus + outcomeBonus + dutyBonus + capitalBonus + randomBonus,
    merit,
    randomBonus,
    breakdown: breakdown.length ? breakdown : ['本次投入不足 5 分钟，不发放军饷']
  }
}

export function creditSessionReward(
  world: WorldState,
  sessionId: string,
  reward: SessionReward,
  title: string,
  now = new Date().toISOString(),
  transactionId = makeId('reward_tx')
): WorldState {
  const rewards = upgradeRewardSystem(world.rewards, now)
  if (rewards.transactions.some((transaction) => transaction.sessionId === sessionId)) return world
  return {
    ...world,
    rewards: {
      ...rewards,
      coins: rewards.coins + reward.coins,
      merit: rewards.merit + reward.merit,
      transactions: [{
        id: transactionId,
        kind: 'battle',
        title,
        detail: reward.breakdown.join(' · '),
        coinDelta: reward.coins,
        meritDelta: reward.merit,
        createdAt: now,
        sessionId
      }, ...rewards.transactions]
    }
  }
}

export function createRewardItem(
  world: WorldState,
  input: RewardItemInput,
  now = new Date().toISOString(),
  itemId = makeId('reward_item')
): WorldState {
  const title = input.title.trim()
  const description = input.description?.trim() ?? ''
  const cost = Math.floor(Number(input.cost))
  if (!title || title.length > 30) throw new Error('犒赏名称应为 1 到 30 个字。')
  if (description.length > 120) throw new Error('犒赏说明不能超过 120 个字。')
  if (!Number.isFinite(cost) || cost < 1 || cost > 99999) throw new Error('兑换价格应为 1 到 99999 铜钱。')
  const rewards = upgradeRewardSystem(world.rewards, now)
  return {
    ...world,
    rewards: {
      ...rewards,
      items: [{ id: itemId, title, description, cost, createdAt: now }, ...rewards.items]
    }
  }
}

export function archiveRewardItem(world: WorldState, itemId: string, now = new Date().toISOString()): WorldState {
  const rewards = upgradeRewardSystem(world.rewards, now)
  if (!rewards.items.some((item) => item.id === itemId)) throw new Error('没有找到这项犒赏。')
  return {
    ...world,
    rewards: {
      ...rewards,
      items: rewards.items.map((item) => item.id === itemId ? { ...item, archivedAt: now } : item)
    }
  }
}

export function redeemRewardItem(
  world: WorldState,
  itemId: string,
  now = new Date().toISOString(),
  redemptionId = makeId('redemption'),
  transactionId = makeId('reward_tx')
): WorldState {
  const rewards = upgradeRewardSystem(world.rewards, now)
  const item = rewards.items.find((candidate) => candidate.id === itemId && !candidate.archivedAt)
  if (!item) throw new Error('这项犒赏已经下架。')
  if (rewards.coins < item.cost) throw new Error(`还差 ${item.cost - rewards.coins} 枚铜钱。`)
  return {
    ...world,
    rewards: {
      ...rewards,
      coins: clamp(rewards.coins - item.cost, 0, Number.MAX_SAFE_INTEGER),
      redemptions: [{
        id: redemptionId,
        rewardItemId: item.id,
        title: item.title,
        cost: item.cost,
        redeemedAt: now
      }, ...rewards.redemptions],
      transactions: [{
        id: transactionId,
        kind: 'redemption',
        title: `兑换「${item.title}」`,
        detail: '犒赏令已签发，等待兑现。',
        coinDelta: -item.cost,
        meritDelta: 0,
        createdAt: now,
        rewardItemId: item.id,
        redemptionId
      }, ...rewards.transactions]
    }
  }
}

export function fulfillRewardRedemption(
  world: WorldState,
  redemptionId: string,
  now = new Date().toISOString(),
  transactionId = makeId('reward_tx')
): WorldState {
  const rewards = upgradeRewardSystem(world.rewards, now)
  const redemption = rewards.redemptions.find((item) => item.id === redemptionId)
  if (!redemption) throw new Error('没有找到这张犒赏令。')
  if (redemption.fulfilledAt) return world
  return {
    ...world,
    rewards: {
      ...rewards,
      redemptions: rewards.redemptions.map((item) => item.id === redemptionId && !item.fulfilledAt
        ? { ...item, fulfilledAt: now }
        : item),
      transactions: [{
        id: transactionId,
        kind: 'fulfillment',
        title: `兑现「${redemption.title}」`,
        detail: '这份给自己的奖励已经完成。',
        coinDelta: 0,
        meritDelta: 0,
        createdAt: now,
        rewardItemId: redemption.rewardItemId,
        redemptionId
      }, ...rewards.transactions]
    }
  }
}
