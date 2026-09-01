import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getTodayAgenda, getReminderCount } from '../src/domain/agenda'
import { getLearningAnalytics } from '../src/domain/analytics'
import {
  createCampaignFromTemplate,
  createInitialWorldState,
  deriveWorld,
  scheduleAdaptiveReview,
  upgradeWorldState
} from '../src/domain/engine'
import type { CampaignCreationInput, WorldState } from '../src/domain/types'
import { addDays, DAY_MS } from '../src/domain/utils'
import { formatWorldBackup, readWorldBackupPayload } from '../src/domain/backup-format'
import { normalizeSnapshotList, normalizeWorldState } from '../src/services/world-normalization'
import {
  calculateSessionReward,
  creditSessionReward,
  createRewardItem,
  fulfillRewardRedemption,
  redeemRewardItem
} from '../src/domain/rewards'
import {
  assignNpcToDuty,
  createNpcCharacter,
  DEFAULT_NPC_ASSIGNMENTS,
  DEFAULT_NPC_CHARACTER_IDS,
  deleteNpcCharacter
} from '../src/domain/npcs'

const NOW = '2026-08-19T08:00:00.000Z'

function createWorld(): WorldState {
  const input: CampaignCreationInput = {
    templateType: 'stem',
    title: '算法诸国',
    goal: '掌握算法',
    capitalCriteria: '完成综合项目',
    dailyTroops: 90,
    importedTemplateKeys: ['foundation']
  }
  return createCampaignFromTemplate(createInitialWorldState(NOW), input, NOW)
}

describe('自适应复习', () => {
  it('轻松反馈会比吃力反馈安排更长的间隔', () => {
    const review = { baseStability: 60, step: 1, intervalDays: 3, ease: 2.3, successfulReviews: 1, lapses: 0 }
    const hard = scheduleAdaptiveReview(review, 'hard', NOW, 60)
    const easy = scheduleAdaptiveReview(review, 'easy', NOW, 60)
    assert.ok((easy.intervalDays ?? 0) > (hard.intervalDays ?? 0))
    assert.ok(easy.baseStability > hard.baseStability)
  })

  it('忘记反馈会在次日重排并累计遗忘次数', () => {
    const result = scheduleAdaptiveReview({ baseStability: 70, step: 3, intervalDays: 14, lapses: 2 }, 'again', NOW, 70)
    assert.equal(result.intervalDays, 1)
    assert.equal(result.lapses, 3)
    assert.equal(new Date(result.nextReviewAt!).getTime() - new Date(NOW).getTime(), DAY_MS)
  })
})

describe('今日作战与军情分析', () => {
  it('即将到期的领地会进入今日作战日历并产生提醒角标', () => {
    let world = createWorld()
    world = {
      ...world,
      campaigns: world.campaigns.map((campaign) => ({
        ...campaign,
        nodes: campaign.nodes.map((node) => node.templateKey === 'foundation'
          ? { ...node, review: { ...node.review, nextReviewAt: addDays(NOW, 1) } }
          : node)
      }))
    }
    const campaigns = deriveWorld(world, NOW)
    const agenda = getTodayAgenda(world, campaigns, NOW)
    assert.ok(agenda.some((item) => item.title === '基础概念城' && item.mode === 'review'))
    assert.equal(getReminderCount(world, campaigns, NOW), 1)
  })

  it('已有进行中行动时不会再推荐无法启动的新前线', () => {
    const world = createWorld()
    const node = world.campaigns[0].nodes.find((item) => item.templateKey === 'foundation')!
    const activeWorld: WorldState = {
      ...world,
      sessions: [{
        id: 'active-session',
        campaignId: node.campaignId,
        nodeId: node.id,
        mode: 'review',
        plannedMinutes: 25,
        scheduledAt: NOW,
        status: 'active',
        startedAt: NOW,
        lastResumedAt: NOW,
        accumulatedSeconds: 0,
        evidenceIds: []
      }]
    }
    const agenda = getTodayAgenda(activeWorld, deriveWorld(activeWorld, NOW), NOW)
    assert.deepEqual(agenda.map((item) => item.id), ['session:active-session'])
  })

  it('七日分析会汇总投入、达成率和薄弱领地', () => {
    const world = createWorld()
    const node = world.campaigns[0].nodes[0]
    const analyzed: WorldState = {
      ...world,
      sessions: [
        { id: 's1', campaignId: node.campaignId, nodeId: node.id, mode: 'review', plannedMinutes: 25, scheduledAt: NOW, status: 'settled', accumulatedSeconds: 1500, endedAt: NOW, outcome: 'achieved', evidenceIds: [] },
        { id: 's2', campaignId: node.campaignId, nodeId: node.id, mode: 'review', plannedMinutes: 15, scheduledAt: addDays(NOW, -1), status: 'settled', accumulatedSeconds: 900, endedAt: addDays(NOW, -1), outcome: 'failed', evidenceIds: [] }
      ]
    }
    const analytics = getLearningAnalytics(analyzed, deriveWorld(analyzed, NOW), NOW)
    assert.equal(analytics.last7Minutes, 40)
    assert.equal(analytics.achievedRate, 50)
    assert.equal(analytics.currentStreak, 2)
    assert.ok(analytics.weakTerritories.some((item) => item.failures === 1))
  })

  it('连续作战天数不会被七日图表截断', () => {
    const world = createWorld()
    const node = world.campaigns[0].nodes[0]
    const analyzed: WorldState = {
      ...world,
      sessions: Array.from({ length: 10 }, (_, index) => ({
        id: `streak-${index}`,
        campaignId: node.campaignId,
        nodeId: node.id,
        mode: 'review' as const,
        plannedMinutes: 15,
        scheduledAt: addDays(NOW, -index),
        status: 'settled' as const,
        accumulatedSeconds: 900,
        endedAt: addDays(NOW, -index),
        outcome: 'achieved' as const,
        evidenceIds: []
      }))
    }
    const analytics = getLearningAnalytics(analyzed, deriveWorld(analyzed, NOW), NOW)
    assert.equal(analytics.currentStreak, 10)
  })
})

describe('存档迁移', () => {
  it('版本 1 存档会补齐提醒和自适应复习字段', () => {
    const current = createWorld()
    const legacy = { ...current, version: 1, profile: { ...current.profile, reminders: undefined, npcAssignments: undefined, customNpcCharacters: undefined }, rewards: undefined }
    const upgraded = upgradeWorldState(legacy)
    assert.equal(upgraded.version, 3)
    assert.equal(upgraded.profile.reminders?.enabled, true)
    assert.equal(upgraded.campaigns[0].nodes[0].review.ease, 2.3)
    assert.equal(upgraded.rewards.items.length, 3)
    assert.deepEqual(upgraded.profile.npcAssignments, DEFAULT_NPC_ASSIGNMENTS)
    assert.deepEqual(upgraded.profile.customNpcCharacters, [])
  })

  it('完整备份可以导出并无损恢复核心记录', async () => {
    const world = createWorld()
    const serialized = formatWorldBackup(world, NOW)
    const restored = upgradeWorldState(readWorldBackupPayload(serialized) as WorldState)
    assert.equal(restored.version, 3)
    assert.equal(restored.campaigns[0].title, world.campaigns[0].title)
    assert.equal(restored.campaigns[0].nodes.length, world.campaigns[0].nodes.length)
    assert.equal(restored.events.length, world.events.length)
  })

  it('会拒绝伪造或不受支持的备份信封', () => {
    assert.throws(
      () => readWorldBackupPayload(JSON.stringify({ format: 'unknown-backup', formatVersion: 1, world: createWorld() })),
      /不是知域存档/
    )
    assert.throws(
      () => readWorldBackupPayload(JSON.stringify({ format: 'zhiyu-world-backup', formatVersion: 99, world: createWorld() })),
      /暂不受支持/
    )
  })

  it('会拒绝未来版本和断裂引用的存档', () => {
    const world = createWorld()
    assert.throws(() => normalizeWorldState({ ...world, version: 99 }), /更高版本/)
    assert.throws(() => normalizeWorldState({
      ...world,
      sessions: [{
        id: 'orphan_session',
        campaignId: world.campaigns[0].id,
        nodeId: 'missing_node',
        mode: 'attack',
        plannedMinutes: 25,
        scheduledAt: NOW,
        status: 'planned',
        accumulatedSeconds: 0,
        evidenceIds: []
      }]
    }), /不存在/)
  })

  it('最新快照损坏时仍能恢复更早的有效快照', () => {
    const world = createWorld()
    const snapshots = normalizeSnapshotList([
      { id: 'broken', createdAt: addDays(NOW, 1), label: '损坏快照', world: { invalid: true } },
      { id: 'safe', createdAt: NOW, label: '安全快照', world }
    ])
    assert.equal(snapshots.length, 1)
    assert.equal(snapshots[0].id, 'safe')
  })
})

describe('幕僚任命', () => {
  it('默认角色数量不再限制为三人', () => {
    assert.ok(DEFAULT_NPC_CHARACTER_IDS.length > 3)
  })

  it('把在任人物改任其他岗位时会自动交换原任人物', () => {
    const world = createWorld()
    const reassigned = assignNpcToDuty(world, 'strategist', 'lu_jinghong')
    assert.equal(reassigned.profile.npcAssignments?.strategist, 'lu_jinghong')
    assert.equal(reassigned.profile.npcAssignments?.courier, 'xie_xuance')
    assert.equal(new Set(Object.values(reassigned.profile.npcAssignments ?? {})).size, 3)
  })

  it('重复任命当前幕僚不会产生无意义的状态修改', () => {
    const world = createWorld()
    assert.equal(assignNpcToDuty(world, 'historian', 'shen_yanqiu'), world)
  })

  it('可以新增、任命并移除未在任的自定义角色', () => {
    const world = createWorld()
    const created = createNpcCharacter(world, {
      name: '顾长风',
      trait: '善察军情',
      description: '自定义测试角色',
      image: 'data:image/jpeg;base64,portrait'
    }, NOW, 'npc_custom_test')
    assert.equal(created.profile.customNpcCharacters?.length, 1)

    const assigned = assignNpcToDuty(created, 'strategist', 'npc_custom_test')
    assert.equal(assigned.profile.npcAssignments?.strategist, 'npc_custom_test')
    assert.throws(() => deleteNpcCharacter(assigned, 'npc_custom_test'), /正在任职/)

    const relieved = assignNpcToDuty(assigned, 'strategist', 'xie_xuance')
    const removed = deleteNpcCharacter(relieved, 'npc_custom_test')
    assert.equal(removed.profile.customNpcCharacters?.length, 0)
  })
})

describe('军饷与犒赏', () => {
  it('相同行动种子会得到确定且可幂等入账的军饷', () => {
    const reward = calculateSessionReward({
      mode: 'attack',
      outcome: 'achieved',
      nodeRole: 'outpost',
      earnedMinutes: 25,
      evidenceCount: 1,
      seed: 'fixed-mutation'
    })
    const repeated = calculateSessionReward({
      mode: 'attack',
      outcome: 'achieved',
      nodeRole: 'outpost',
      earnedMinutes: 25,
      evidenceCount: 1,
      seed: 'fixed-mutation'
    })
    assert.deepEqual(repeated, reward)
    assert.ok(reward.coins >= 10)
    const credited = creditSessionReward(createWorld(), 'reward-session', reward, '测试军饷', NOW, 'tx-1')
    const duplicated = creditSessionReward(credited, 'reward-session', reward, '测试军饷', NOW, 'tx-2')
    assert.equal(duplicated.rewards.coins, credited.rewards.coins)
    assert.equal(duplicated.rewards.transactions.length, 1)
  })

  it('可以创建、兑换并兑现自定义犒赏', () => {
    const funded = creditSessionReward(
      createWorld(),
      'funding-session',
      { coins: 100, merit: 5, randomBonus: 0, breakdown: ['测试军饷'] },
      '测试军饷',
      NOW,
      'funding-tx'
    )
    const withItem = createRewardItem(funded, { title: '买一本书', description: '周末去书店挑选', cost: 60 }, NOW, 'book-reward')
    const redeemed = redeemRewardItem(withItem, 'book-reward', NOW, 'book-redemption', 'book-tx')
    assert.equal(redeemed.rewards.coins, 40)
    assert.equal(redeemed.rewards.redemptions[0].fulfilledAt, undefined)
    const fulfilled = fulfillRewardRedemption(redeemed, 'book-redemption', addDays(NOW, 1))
    assert.ok(fulfilled.rewards.redemptions[0].fulfilledAt)
    assert.equal(fulfilled.rewards.transactions[0].kind, 'fulfillment')
  })
})
