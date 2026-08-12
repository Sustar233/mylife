import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createCampaignFromTemplate,
  createInitialWorldState,
  deriveCampaign,
  pauseSession,
  planSession,
  setTruce,
  settleSession,
  startSession
} from '../src/domain/engine'
import { getTemplate } from '../src/domain/templates'
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
    weeklyBudget: 300,
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
  it('初始地图只开放没有硬前置的城池', () => {
    const world = createWorld('stem')
    const campaign = deriveCampaign(world.campaigns[0], START)
    const available = campaign.nodes.filter((node) => node.effectiveState === 'available').map((node) => node.templateKey).sort()
    assert.deepEqual(available, ['foundation', 'notation'])
    assert.equal(campaign.nodes.find((node) => node.templateKey === 'core-concept')?.effectiveState, 'locked')
  })

  it('取得成果后占领城池并解锁下一条道路', () => {
    let world = createWorld('stem')
    const foundation = world.campaigns[0].nodes.find((node) => node.templateKey === 'foundation')!
    const notation = world.campaigns[0].nodes.find((node) => node.templateKey === 'notation')!
    world = runSession(world, foundation.id, 'attack', 'achieved')
    world = runSession(world, notation.id, 'attack', 'achieved')
    const campaign = deriveCampaign(world.campaigns[0], addDays(START, 0.01))
    const core = campaign.nodes.find((node) => node.templateKey === 'core-concept')!
    assert.equal(core.effectiveState, 'available')
    assert.equal(campaign.controlledCount, 2)
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
    const world = createWorld('exam', allNonCapital)
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
})
