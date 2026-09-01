import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  abandonSession,
  createCampaignFromTemplate,
  createInitialWorldState,
  checkpointActiveSessions,
  deriveCampaign,
  getDailyTroopStatus,
  pauseSession,
  pauseInterruptedSessions,
  planSession,
  setTruce,
  settleSession,
  startSession
} from '../src/domain/engine'
import {
  addDependencyToCampaign,
  addOutpostToCampaign,
  addRegionToCampaign,
  autoArrangeCampaignMap,
  getCampaignMapHistoryStatus,
  undoCampaignMapEdit,
  redoCampaignMapEdit,
  updateCampaignNode
} from '../src/domain/map-editor-engine'
import { getTroopAllocationAdvice } from '../src/domain/troop-advice'
import { getTemplate } from '../src/domain/templates'
import { validateCampaignMap } from '../src/domain/map-planning'
import type { CampaignCreationInput, TemplateType, WorldState } from '../src/domain/types'
import { addDays, DAY_MS } from '../src/domain/utils'

const START = '2026-08-09T08:00:00.000Z'
const PROOF = '这是一次满足二十字要求的完整学习成果说明，用于验证领地结算。'

function createWorld(type: TemplateType, importedTemplateKeys: string[] = []): WorldState {
  const template = getTemplate(type)
  const input: CampaignCreationInput = {
    templateType: type,
    title: template.defaultTitle,
    goal: template.defaultGoal,
    capitalCriteria: template.defaultCapitalCriteria,
    capitalScoreTarget: template.defaultScoreTarget,
    dailyTroops: 90,
    importedTemplateKeys
  }
  return createCampaignFromTemplate(createInitialWorldState(START), input, START)
}

function runSession(world: WorldState, nodeId: string, mode: 'attack' | 'review' | 'recover', outcome: 'achieved' | 'partial' | 'failed', score?: number) {
  const planned = planSession(world, nodeId, 25, mode, START, `session_${nodeId}_${mode}`)
  const started = startSession(planned.world, planned.session.id, START)
  return settleSession(started, planned.session.id, {
    outcome,
    evidence: [{ type: 'text', content: PROOF }],
    clientMutationId: `mutation_${nodeId}_${mode}_${outcome}`,
    score
  }, new Date(new Date(START).getTime() + 61_000).toISOString())
}

describe('战役生成与前置解锁', () => {
  it('操作系统默认地图按八章生成连续战区', () => {
    const template = getTemplate('operating-system')
    assert.equal(template.nodes.filter((node) => node.kind !== 'capital').length, 8)
    assert.deepEqual(
      template.nodes.filter((node) => node.kind !== 'capital').map((node) => node.region),
      ['第一章·概论', '第二章·运行机制', '第三章·进程线程', '第四章·调度', '第五章·存储', '第六章·文件', '第七章·设备', '第八章·同步死锁']
    )

    const world = createWorld('operating-system')
    const campaign = deriveCampaign(world.campaigns[0], START)
    assert.equal(campaign.regionCount, 8)
    assert.equal(campaign.nodes.length, 17)
    assert.deepEqual(
      campaign.nodes.filter((node) => node.effectiveState === 'available').map((node) => node.templateKey),
      ['unit-1']
    )
    assert.equal(campaign.nodes.find((node) => node.templateKey === 'unit-2')?.effectiveState, 'locked')
  })

  it('初始地图只开放没有硬前置的城池', () => {
    const world = createWorld('stem')
    const campaign = deriveCampaign(world.campaigns[0], START)
    const available = campaign.nodes.filter((node) => node.effectiveState === 'available').map((node) => node.templateKey).sort()
    assert.deepEqual(available, ['foundation', 'notation'])
    assert.equal(campaign.nodes.find((node) => node.templateKey === 'core-concept')?.effectiveState, 'locked')
  })

  it('区域全部据点完成后解锁主城，攻克主城后开放下一战区', () => {
    let world = createWorld('stem')
    const foundation = world.campaigns[0].nodes.find((node) => node.templateKey === 'foundation')!
    const notation = world.campaigns[0].nodes.find((node) => node.templateKey === 'notation')!
    world = runSession(world, foundation.id, 'attack', 'achieved')
    world = runSession(world, notation.id, 'attack', 'achieved')
    let campaign = deriveCampaign(world.campaigns[0], addDays(START, 0.01))
    const regionalCapital = campaign.nodes.find((node) => node.region === '基础边境' && node.role === 'regional_capital')!
    const coreBefore = campaign.nodes.find((node) => node.templateKey === 'core-concept')!
    assert.equal(regionalCapital.effectiveState, 'available')
    assert.equal(coreBefore.effectiveState, 'locked')
    world = runSession(world, regionalCapital.id, 'attack', 'achieved')
    campaign = deriveCampaign(world.campaigns[0], addDays(START, 0.02))
    assert.equal(campaign.nodes.find((node) => node.templateKey === 'core-concept')?.effectiveState, 'available')
    assert.equal(campaign.controlledRegionCount, 1)
  })
})

describe('结算、首都和幂等', () => {
  it('部分达成保留围城投入但不改变归属', () => {
    const world = createWorld('language')
    const target = world.campaigns[0].nodes.find((node) => node.templateKey === 'word-camp')!
    const settled = runSession(world, target.id, 'attack', 'partial')
    const node = settled.campaigns[0].nodes.find((item) => item.id === target.id)!
    assert.equal(node.owner, 'enemy')
    assert.equal(node.state, 'sieging')
    assert.ok(node.accumulatedMinutes >= 1)
  })

  it('考试首都未达目标分数不能攻克', () => {
    const template = getTemplate('exam')
    const allNonCapital = template.nodes.filter((node) => node.kind !== 'capital').map((node) => node.key)
    let world = createWorld('exam', allNonCapital)
    const regionalCapitals = world.campaigns[0].nodes.filter((node) => node.role === 'regional_capital')
    regionalCapitals.forEach((regionalCapital) => {
      world = runSession(world, regionalCapital.id, 'attack', 'achieved')
    })
    const capital = world.campaigns[0].nodes.find((node) => node.kind === 'capital')!
    assert.throws(() => runSession(world, capital.id, 'attack', 'achieved', 79), /80 分/)
    const captured = runSession(world, capital.id, 'attack', 'achieved', 80)
    assert.equal(captured.campaigns[0].status, 'victorious')
  })

  it('重复提交同一行动不会重复增加证据与事件', () => {
    const world = createWorld('language')
    const target = world.campaigns[0].nodes.find((node) => node.templateKey === 'word-camp')!
    const planned = planSession(world, target.id, 25, 'attack', START, 'idempotent_session')
    const started = startSession(planned.world, planned.session.id, START)
    const input = {
      outcome: 'achieved' as const,
      evidence: [{ type: 'text' as const, content: PROOF }],
      clientMutationId: 'same_mutation'
    }
    const once = settleSession(started, planned.session.id, input, addDays(START, 0.01))
    const twice = settleSession(once, planned.session.id, input, addDays(START, 0.02))
    assert.equal(twice.evidence.length, once.evidence.length)
    assert.equal(twice.events.length, once.events.length)
    assert.equal(twice.rewards.coins, once.rewards.coins)
    assert.equal(twice.rewards.transactions.length, once.rewards.transactions.length)
  })

  it('行动模式必须与领地状态匹配', () => {
    const world = createWorld('stem')
    const available = world.campaigns[0].nodes.find((node) => node.templateKey === 'foundation')!
    assert.throws(() => planSession(world, available.id, 25, 'recover', START), /只有失守领地/)

    const controlledWorld = createWorld('stem', ['foundation'])
    const controlled = controlledWorld.campaigns[0].nodes.find((node) => node.templateKey === 'foundation')!
    const lostWorld: WorldState = {
      ...controlledWorld,
      campaigns: controlledWorld.campaigns.map((campaign) => ({
        ...campaign,
        nodes: campaign.nodes.map((node) => node.id === controlled.id
          ? { ...node, review: { ...node.review, nextReviewAt: addDays(START, -40) } }
          : node)
      }))
    }
    assert.throws(() => planSession(lostWorld, controlled.id, 25, 'attack', START), /使用收复行动/)
  })

  it('已经撤回的行动不能重新结算', () => {
    const world = createWorld('language')
    const target = world.campaigns[0].nodes.find((node) => node.templateKey === 'word-camp')!
    const planned = planSession(world, target.id, 25, 'attack', START, 'abandoned-session')
    const started = startSession(planned.world, planned.session.id, START)
    const abandoned = abandonSession(started, planned.session.id, addDays(START, 0.01))
    assert.throws(() => settleSession(abandoned, planned.session.id, {
      outcome: 'partial',
      evidence: [{ type: 'text', content: PROOF }],
      clientMutationId: 'abandoned-mutation'
    }, addDays(START, 0.02)), /已经撤回/)
  })
})

describe('每日兵力与自定义版图', () => {
  it('兵力按用户时区在次日恢复', () => {
    let world = createWorld('language')
    const target = world.campaigns[0].nodes.find((node) => node.templateKey === 'word-camp')!
    world = runSession(world, target.id, 'attack', 'partial')
    const today = getDailyTroopStatus(world, addDays(START, 0.01), 90)
    const tomorrow = getDailyTroopStatus(world, addDays(START, 1.01), 90)
    assert.ok(today.spentMinutes >= 1)
    assert.equal(tomorrow.remainingMinutes, 90)
  })

  it('自定义区域自动包含据点、主城及锁定关系', () => {
    let world = createWorld('stem')
    const campaignId = world.campaigns[0].id
    world = addRegionToCampaign(world, campaignId, {
      name: '动态规划战区',
      outpostTitle: '状态定义营地',
      capitalTitle: '动态规划主城',
      victoryCriteria: '独立解决一道完整动态规划题',
      estimatedMinutes: 60
    }, START)
    const campaign = deriveCampaign(world.campaigns[0], START)
    const outpost = campaign.nodes.find((node) => node.region === '动态规划战区' && node.role === 'outpost')!
    const capital = campaign.nodes.find((node) => node.region === '动态规划战区' && node.role === 'regional_capital')!
    assert.equal(outpost.effectiveState, 'available')
    assert.equal(capital.effectiveState, 'locked')

    world = addOutpostToCampaign(world, campaignId, {
      region: '动态规划战区',
      title: '状态转移据点',
      description: '练习状态转移方程',
      victoryCriteria: '写出三道题的状态转移方程',
      estimatedMinutes: 45
    }, START)
    assert.equal(world.campaigns[0].nodes.filter((node) => node.region === '动态规划战区' && node.role === 'outpost').length, 2)
  })

  it('参谋分配会用完今日剩余兵力并给出目标', () => {
    const world = createWorld('stem')
    const campaign = deriveCampaign(world.campaigns[0], START)
    const advice = getTroopAllocationAdvice(world, campaign, START)
    assert.equal(advice.allocatedMinutes, advice.remainingMinutes)
    assert.equal(advice.remainingMinutes, 90)
    assert.ok(advice.items.some((item) => item.key === 'attack' && item.nodeIds.length > 0))
  })
})

describe('版图校验、版本历史与自动布局', () => {
  it('新增据点可以撤销并重做且不会影响战史', () => {
    let world = createWorld('stem')
    const campaignId = world.campaigns[0].id
    const beforeCount = world.campaigns[0].nodes.length
    world = addOutpostToCampaign(world, campaignId, {
      region: '基础边境',
      title: '复杂度侦察站',
      description: '识别复杂度',
      victoryCriteria: '独立分析三个算法的复杂度',
      estimatedMinutes: 45
    }, START)
    assert.equal(getCampaignMapHistoryStatus(world, campaignId).undoCount, 1)
    assert.equal(world.campaigns[0].nodes.length, beforeCount + 1)
    const eventCount = world.events.length

    world = undoCampaignMapEdit(world, campaignId, START)
    assert.equal(world.campaigns[0].nodes.length, beforeCount)
    assert.equal(world.events.length, eventCount + 1)
    assert.equal(getCampaignMapHistoryStatus(world, campaignId).redoCount, 1)

    world = redoCampaignMapEdit(world, campaignId, START)
    assert.equal(world.campaigns[0].nodes.length, beforeCount + 1)
  })

  it('撤销版图只恢复结构字段，不回滚之后产生的学习成果', () => {
    let world = createWorld('stem')
    const campaignId = world.campaigns[0].id
    const target = world.campaigns[0].nodes.find((node) => node.templateKey === 'foundation')!
    const originalTitle = target.title
    world = updateCampaignNode(world, campaignId, target.id, {
      title: '重新命名的基础营地',
      description: target.description,
      victoryCriteria: target.victoryCriteria,
      estimatedMinutes: target.estimatedMinutes
    }, START)
    world = runSession(world, target.id, 'attack', 'achieved')

    world = undoCampaignMapEdit(world, campaignId, addDays(START, 0.02))
    const restored = world.campaigns[0].nodes.find((node) => node.id === target.id)!
    assert.equal(restored.title, originalTitle)
    assert.equal(restored.owner, 'self')
    assert.equal(restored.state, 'controlled')
    assert.ok(restored.accumulatedMinutes > 0)
    assert.ok(restored.review.nextReviewAt)
  })

  it('已有学习记录的自定义据点不能被地图撤销移除', () => {
    let world = createWorld('stem')
    const campaignId = world.campaigns[0].id
    world = addOutpostToCampaign(world, campaignId, {
      region: '基础边境',
      title: '不可丢失的学习据点',
      description: '验证地图历史不会删除成果',
      victoryCriteria: '提交一份完整成果',
      estimatedMinutes: 25
    }, START)
    const customNode = world.campaigns[0].nodes.find((node) => node.title === '不可丢失的学习据点')!
    world = runSession(world, customNode.id, 'attack', 'achieved')

    assert.throws(
      () => undoCampaignMapEdit(world, campaignId, addDays(START, 0.02)),
      /已有学习记录/
    )
  })

  it('循环前置和区域内重名会在提交前被阻断', () => {
    const world = createWorld('stem')
    const campaign = world.campaigns[0]
    const foundation = campaign.nodes.find((node) => node.templateKey === 'foundation')!
    const core = campaign.nodes.find((node) => node.templateKey === 'core-concept')!
    const notation = campaign.nodes.find((node) => node.templateKey === 'notation')!
    assert.throws(() => addDependencyToCampaign(world, campaign.id, {
      from: core.id,
      to: foundation.id,
      kind: 'hard'
    }, START), /循环/)
    assert.throws(() => updateCampaignNode(world, campaign.id, notation.id, {
      title: foundation.title,
      description: notation.description,
      victoryCriteria: notation.victoryCriteria,
      estimatedMinutes: notation.estimatedMinutes
    }, START), /重复节点名称/)
  })

  it('自动布局为所有据点生成边界内坐标并保持结构合法', () => {
    const world = createWorld('language')
    const arranged = autoArrangeCampaignMap(world, world.campaigns[0].id, START)
    const campaign = arranged.campaigns[0]
    assert.equal(validateCampaignMap(campaign).filter((item) => item.severity === 'error').length, 0)
    assert.ok(campaign.nodes.every((node) => node.position.x >= 0 && node.position.x <= 100 && node.position.y >= 0 && node.position.y <= 100))
    assert.ok(campaign.nodes.filter((node) => node.role === 'outpost').every((node) => node.tacticalPosition))
  })
})

describe('衰减、反叛、补给与休整', () => {
  it('既有能力长期不复习会反叛，但下游成果只断供不删除', () => {
    let world = createWorld('stem', ['foundation', 'notation', 'core-concept'])
    const campaign = world.campaigns[0]
    const foundation = campaign.nodes.find((node) => node.templateKey === 'foundation')!
    const core = campaign.nodes.find((node) => node.templateKey === 'core-concept')!
    const farFuture = addDays(START, 180)
    world = {
      ...world,
      campaigns: [{
        ...campaign,
        nodes: campaign.nodes.map((node) => {
          if (node.id === foundation.id) return { ...node, review: { ...node.review, nextReviewAt: addDays(START, -40) } }
          if (node.id === core.id) return { ...node, review: { ...node.review, nextReviewAt: farFuture } }
          return node
        })
      }]
    }
    const derived = deriveCampaign(world.campaigns[0], START)
    const rebel = derived.nodes.find((node) => node.id === foundation.id)!
    const suppliedCore = derived.nodes.find((node) => node.id === core.id)!
    const nextTarget = derived.nodes.find((node) => node.templateKey === 'basic-practice')!
    assert.equal(rebel.effectiveOwner, 'rebel')
    assert.equal(rebel.effectiveState, 'lost')
    assert.equal(suppliedCore.effectiveOwner, 'self')
    assert.equal(suppliedCore.supplyCut, true)
    assert.equal(nextTarget.effectiveState, 'locked')
  })

  it('收复行动恢复控制权并从三天复习间隔开始', () => {
    let world = createWorld('stem', ['foundation'])
    const campaign = world.campaigns[0]
    const node = campaign.nodes.find((item) => item.templateKey === 'foundation')!
    world = {
      ...world,
      campaigns: [{ ...campaign, nodes: campaign.nodes.map((item) => item.id === node.id ? { ...item, review: { ...item.review, nextReviewAt: addDays(START, -40) } } : item) }]
    }
    world = runSession(world, node.id, 'recover', 'achieved')
    const recovered = world.campaigns[0].nodes.find((item) => item.id === node.id)!
    assert.equal(recovered.owner, 'self')
    assert.equal(recovered.review.baseStability, 50)
    const nextMs = new Date(recovered.review.nextReviewAt!).getTime() - (new Date(START).getTime() + 61_000)
    assert.ok(Math.abs(nextMs - 3 * DAY_MS) < 1000)
  })

  it('休整令将所有复习期限等量顺延', () => {
    const world = createWorld('language', ['word-camp', 'sound-port'])
    const before = world.campaigns[0].nodes.find((node) => node.templateKey === 'word-camp')!.review.nextReviewAt!
    const rested = setTruce(world, START, addDays(START, 7), START)
    const after = rested.campaigns[0].nodes.find((node) => node.templateKey === 'word-camp')!.review.nextReviewAt!
    assert.equal(new Date(after).getTime() - new Date(before).getTime(), 7 * DAY_MS)
  })
})

describe('可中断计时', () => {
  it('暂停时准确固化已用秒数', () => {
    const world = createWorld('language')
    const node = world.campaigns[0].nodes.find((item) => item.templateKey === 'word-camp')!
    const planned = planSession(world, node.id, 25, 'attack', START, 'timer_session')
    const started = startSession(planned.world, planned.session.id, START)
    const paused = pauseSession(started, planned.session.id, new Date(new Date(START).getTime() + 95_000).toISOString())
    const session = paused.sessions.find((item) => item.id === planned.session.id)!
    assert.equal(session.status, 'paused')
    assert.equal(session.accumulatedSeconds, 95)
  })

  it('检查点会固化当前时长，重启恢复时不会累计长时间离线时长', () => {
    const world = createWorld('language')
    const target = world.campaigns[0].nodes.find((node) => node.templateKey === 'word-camp')!
    const planned = planSession(world, target.id, 25, 'attack', START, 'checkpoint_session')
    const active = startSession(planned.world, planned.session.id, START)
    const checkpointAt = new Date(new Date(START).getTime() + 30_000).toISOString()
    const checkpointed = checkpointActiveSessions(active, checkpointAt)
    assert.equal(checkpointed.sessions[0].accumulatedSeconds, 30)

    const reopened = pauseInterruptedSessions(checkpointed, addDays(START, 1))
    assert.equal(reopened.sessions[0].status, 'paused')
    assert.equal(reopened.sessions[0].accumulatedSeconds, 120)
    assert.equal(reopened.sessions[0].lastResumedAt, undefined)
  })
})
