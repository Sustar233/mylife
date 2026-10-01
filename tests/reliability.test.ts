import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { LocalWorldRepository, IMAGE_PREFIX, SNAPSHOT_KEY, WORLD_KEY, type StorageDriver } from '../src/services/local-world-repository'
import { normalizeWorldState } from '../src/services/world-normalization'
import { prepareWorldMedia, portableWorld } from '../src/services/backup-media'
import { createCampaignFromTemplate, createInitialWorldState, planSession, startSession, pauseSession, checkpointActiveSessions, pauseInterruptedSessions, settleSession, abandonSession, getDailyTroopStatus, deriveWorld } from '../src/domain/engine'
import { sessionSecondsByDay } from '../src/domain/session-time'
import { affordableMinutes } from '../src/domain/session-planning'
import { EMPTY_BATTLE_DRAFT, saveBattleDraft } from '../src/domain/battle-draft'
import { getTodayAgenda, getReminderCount } from '../src/domain/agenda'
import { referencedImages } from '../src/domain/image-references'
import { getLearningAnalytics } from '../src/domain/analytics'
import { autoArrangeCampaignMap, undoCampaignMapEdit } from '../src/domain/map-editor-engine'
import type { WorldState } from '../src/domain/types'

const NOW = '2026-10-01T04:00:00.000Z'
const PHOTO = 'data:image/jpeg;base64,aGVsbG8='
const PORTRAIT = 'data:image/png;base64,d29ybGQ='
const PROOF = '本次测试已经完成完整学习过程，并保留可供验证的成果说明。'
class MemoryStorage implements StorageDriver {
  values = new Map<string, unknown>()
  writes: string[] = []
  reads: string[] = []
  fail?: (key: string, value: unknown) => void
  get(key: string) { this.reads.push(key); return structuredClone(this.values.get(key)) }
  set(key: string, value: unknown) { this.writes.push(key); this.fail?.(key, value); this.values.set(key, structuredClone(value)) }
  remove(key: string) { this.values.delete(key) }
  info() { return { keys: [...this.values.keys()], currentSize: 0, limitSize: 10240 } }
}
function worldAt(at = NOW): WorldState {
  return createCampaignFromTemplate(createInitialWorldState(at), {
    templateType: 'operating-system', title: '回归样例', goal: '完成学习', capitalCriteria: '完成总结', dailyTroops: 90, importedTemplateKeys: []
  }, at)
}
function activeWorld(at = NOW): WorldState {
  const world = worldAt(at)
  const planned = planSession(world, world.campaigns[0].nodes[0].id, 25, 'attack', at, 's1')
  return startSession(planned.world, 's1', at)
}
function mediaWorld(): WorldState {
  let world = activeWorld()
  world = saveBattleDraft(world, 's1', { ...EMPTY_BATTLE_DRAFT, images: [PHOTO], note: PROOF })
  world.profile.customNpcCharacters = [{ id: 'npc_test', name: '测试', trait: '善学', description: '', image: PORTRAIT, createdAt: NOW }]
  return world
}

describe('存档故障与媒体存储', () => {
  it('空存储可以初始化，损坏主存档不会被当成新用户', () => {
    const storage = new MemoryStorage()
    const repo = new LocalWorldRepository(storage)
    assert.equal(repo.load(), null)
    storage.set(WORLD_KEY, { version: 3, sessions: 'broken' })
    assert.throws(() => repo.load(), /原数据未被覆盖/)
    assert.deepEqual(storage.get(WORLD_KEY), { version: 3, sessions: 'broken' })
    repo.createSnapshot(worldAt(), '恢复点')
    assert.equal(repo.load()!.campaigns[0].title, '回归样例')
  })

  it('主存档持续写入失败时仍保留最后一份有效快照', () => {
    const storage = new MemoryStorage()
    let time = Date.parse(NOW)
    const repo = new LocalWorldRepository(storage, () => time)
    const world = worldAt()
    repo.save(world)
    for (let i = 0; i < 3; i++) { time++; repo.createSnapshot(world, `快照${i}`) }
    const previous = storage.get(WORLD_KEY)
    storage.fail = (key) => { if (key === WORLD_KEY) throw new Error('QuotaExceededError') }
    assert.throws(() => repo.save({ ...world, events: [...world.events] }), /Quota/)
    assert.equal(repo.listSnapshots().length, 1)
    assert.equal(repo.listSnapshots()[0].label, '快照2')
    assert.deepEqual(storage.get(WORLD_KEY), previous)
  })

  it('释放一份旧快照足够时立即停止淘汰', () => {
    const storage = new MemoryStorage()
    const repo = new LocalWorldRepository(storage, () => Date.parse(NOW))
    const world = worldAt()
    repo.save(world)
    repo.createSnapshot(world, '旧')
    repo.createSnapshot(world, '新')
    let attempts = 0
    storage.fail = (key) => { if (key === WORLD_KEY && attempts++ === 0) throw new Error('storage quota exceeded') }
    repo.save({ ...world, events: [...world.events] })
    assert.equal(repo.listSnapshots().length, 1)
    assert.equal(attempts, 2)
  })

  it('权限等非配额错误不会删除或重写快照', () => {
    const storage = new MemoryStorage()
    const repo = new LocalWorldRepository(storage, () => Date.parse(NOW))
    const world = worldAt()
    repo.save(world)
    repo.createSnapshot(world, '安全')
    const previous = storage.get(SNAPSHOT_KEY)
    storage.fail = (key) => { if (key === WORLD_KEY) throw new Error('Permission denied') }
    assert.throws(() => repo.save({ ...world, events: [...world.events] }), /Permission/)
    assert.deepEqual(storage.get(SNAPSHOT_KEY), previous)
  })

  it('图片与草稿只存一份，检查点不重写图片或读取历史快照', () => {
    const storage = new MemoryStorage()
    const repo = new LocalWorldRepository(storage, () => Date.parse(NOW))
    const world = mediaWorld()
    repo.save(world)
    repo.createSnapshot(world, '图片快照')
    assert.equal([...storage.values.keys()].filter((key) => key.startsWith(IMAGE_PREFIX)).length, 2)
    assert.ok(!JSON.stringify(storage.get(WORLD_KEY)).includes('base64'))
    assert.ok(!JSON.stringify(storage.get(SNAPSHOT_KEY)).includes('base64'))
    storage.writes = []
    storage.reads = []
    repo.save(checkpointActiveSessions(world, '2026-10-01T04:00:30.000Z'))
    assert.deepEqual(storage.writes, [WORLD_KEY])
    assert.ok(!storage.reads.includes(SNAPSHOT_KEY))
    const restored = new LocalWorldRepository(storage).load()!
    assert.equal(restored.sessions[0].draft?.images[0], PHOTO)
    assert.equal(restored.profile.customNpcCharacters?.[0].image, PORTRAIT)
  })

  it('旧版内嵌图片可读取，下次保存自动分离', () => {
    const storage = new MemoryStorage()
    const world = mediaWorld()
    storage.set(WORLD_KEY, world)
    const repo = new LocalWorldRepository(storage, () => Date.parse(NOW))
    const restored = repo.load()!
    assert.equal(restored.sessions[0].draft?.images[0], PHOTO)
    repo.save(restored)
    assert.ok(!JSON.stringify(storage.get(WORLD_KEY)).includes('base64'))
    assert.equal(repo.load()!.sessions[0].draft?.images[0], PHOTO)
  })

  it('图片写入失败不替换主存档或清理快照', () => {
    const storage = new MemoryStorage()
    const repo = new LocalWorldRepository(storage)
    const world = worldAt()
    repo.save(world)
    repo.createSnapshot(world, '安全')
    const previous = storage.get(WORLD_KEY)
    storage.fail = (key) => { if (key.startsWith(IMAGE_PREFIX)) throw new Error('quota') }
    assert.throws(() => repo.save(mediaWorld()), /quota/)
    assert.deepEqual(storage.get(WORLD_KEY), previous)
    assert.equal(repo.listSnapshots().length, 1)
  })

  it('清理独立图片时保护快照与草稿引用', () => {
    const storage = new MemoryStorage()
    const repo = new LocalWorldRepository(storage)
    const world = mediaWorld()
    repo.save(world)
    repo.createSnapshot(world, '保留图片')
    storage.set(`${IMAGE_PREFIX}orphan`, PHOTO)
    assert.equal(repo.cleanupImages(), 1)
    assert.equal(repo.load()!.sessions[0].draft?.images[0], PHOTO)
    assert.equal(repo.listSnapshots()[0].world.profile.customNpcCharacters?.[0].image, PORTRAIT)
  })
})

describe('完整备份与导入回滚', () => {
  it('成果、头像、草稿一起转换，同一路径只读取一次', async () => {
    const world = mediaWorld()
    world.sessions[0].draft!.images = ['/saved/draft.jpg', '/saved/draft.jpg']
    world.evidence = [{ id: 'proof', sessionId: 's1', type: 'image', content: '/saved/draft.jpg', createdAt: NOW }]
    world.sessions[0].evidenceIds = ['proof']
    world.profile.customNpcCharacters![0].image = '/saved/avatar.png'
    const reads: string[] = []
    const portable = await portableWorld(world, async (path) => { reads.push(path); return path.endsWith('.png') ? PORTRAIT : PHOTO })
    assert.equal(reads.length, 2)
    assert.equal(portable.sessions[0].draft!.images[0], PHOTO)
    assert.equal(portable.evidence[0].content, PHOTO)
    assert.equal(portable.profile.customNpcCharacters![0].image, PORTRAIT)
    assert.equal(world.sessions[0].draft!.images[0], '/saved/draft.jpg')
  })

  it('第二张图片写入失败会回滚第一张，原存档不改变', async () => {
    const world = mediaWorld()
    const original = structuredClone(world)
    const files = new Map<string, string>([['existing', '原始图片']])
    let writes = 0
    await assert.rejects(prepareWorldMedia(world, {
      write: async (image) => { if (++writes === 2) throw new Error('full'); files.set('new', image); return 'new' },
      remove: async (path) => { files.delete(path) }
    }), /full/)
    assert.deepEqual([...files], [['existing', '原始图片']])
    assert.deepEqual(world, original)
  })

  it('存档提交失败时可撤销已准备的全部新文件', async () => {
    const files = new Map<string, string>()
    const prepared = await prepareWorldMedia(mediaWorld(), {
      write: async (image) => { const id = `new-${files.size}`; files.set(id, image); return id },
      remove: async (path) => { files.delete(path) }
    })
    assert.equal(files.size, 2)
    assert.ok(prepared.world.sessions[0].draft!.images[0].startsWith('new-'))
    await prepared.rollback()
    assert.equal(files.size, 0)
  })
})

describe('导入校验', () => {
  it('保留合法的撤销历史，拒绝损坏的历史版图', () => {
    let world = worldAt()
    world = autoArrangeCampaignMap(world, world.campaigns[0].id, NOW)
    world = undoCampaignMapEdit(world, world.campaigns[0].id, NOW)
    assert.equal(normalizeWorldState(world).mapHistories![0].future.length, 1)
    world.mapHistories![0].future[0].nodes[0].position.x = NaN
    assert.throws(() => normalizeWorldState(world), /损坏/)
  })

  it('拒绝缺失成果清单、负数计时、非法状态和跨战役引用', () => {
    for (const patch of [
      { evidenceIds: undefined }, { accumulatedSeconds: -1 }, { accumulatedSeconds: NaN },
      { status: 'unknown' }, { mode: 'invalid' }, { campaignId: 'missing' },
      { lastResumedAt: 'bad-date' }, { evidenceIds: ['nonexistent'] }
    ]) {
      const world = activeWorld()
      Object.assign(world.sessions[0], patch)
      assert.throws(() => normalizeWorldState(world), /损坏/)
    }
  })

  it('合法的创建、暂停、结算、草稿存档均可往返', () => {
    let world = mediaWorld()
    for (const next of [world, pauseSession(world, 's1', '2026-10-01T04:05:00.000Z'), settleSession(world, 's1', { outcome: 'partial', evidence: [{ type: 'text', content: PROOF }], clientMutationId: 'm1' }, '2026-10-01T04:05:00.000Z')]) {
      assert.equal(normalizeWorldState(JSON.parse(JSON.stringify(next))).sessions.length, 1)
    }
  })
})

describe('跨日计时、提醒和草稿', () => {
  it('战史按实际学习日期分摊时长，战果记在结算当天', () => {
    let world = activeWorld('2026-09-30T15:50:00.000Z')
    const end = '2026-09-30T16:30:00.000Z'
    world = settleSession(world, 's1', { outcome: 'achieved', evidence: [{ type: 'text', content: PROOF }], clientMutationId: 'cross-day' }, end)
    const stats = getLearningAnalytics(world, deriveWorld(world, end), end)
    assert.equal(stats.daily[5].minutes, 10)
    assert.equal(stats.daily[6].minutes, 30)
    assert.equal(stats.daily[6].achieved, 1)
    assert.equal(stats.last7Minutes, 40)
  })

  it('23:50 到次日 00:30 分别记入 10 与 30 分钟', () => {
    let world = activeWorld('2026-09-30T15:50:00.000Z')
    world = checkpointActiveSessions(world, '2026-09-30T16:10:00.000Z')
    world = pauseSession(world, 's1', '2026-09-30T16:30:00.000Z')
    assert.deepEqual(world.sessions[0].secondsByDay, { '2026-09-30': 600, '2026-10-01': 1800 })
    assert.equal(getDailyTroopStatus(world, '2026-09-30T16:30:00.000Z').spentMinutes, 30)
    assert.equal(normalizeWorldState(world).sessions[0].accumulatedSeconds, 2400)
  })

  it('跨天暂停不累计休息时间，重启不将旧投入搬到今天', () => {
    let world = activeWorld('2026-09-30T15:50:00.000Z')
    world = pauseSession(world, 's1', '2026-09-30T15:55:00.000Z')
    world = startSession(world, 's1', '2026-10-01T00:00:00.000Z')
    world = checkpointActiveSessions(world, '2026-10-01T00:05:00.000Z')
    world = pauseInterruptedSessions(world, '2026-10-02T00:00:00.000Z')
    assert.deepEqual(world.sessions[0].secondsByDay, { '2026-09-30': 300, '2026-10-01': 300 })
    assert.equal(getDailyTroopStatus(world, '2026-10-02T00:00:00.000Z').spentMinutes, 0)
  })

  it('夏令时回拨的一天允许记入 25 小时，后一天单独计时', () => {
    const world = activeWorld('2026-11-01T04:00:00.000Z')
    const days = sessionSecondsByDay(world.sessions[0], 'America/New_York', '2026-11-02T05:30:00.000Z')
    assert.deepEqual(days, { '2026-11-01': 25 * 3600, '2026-11-02': 1800 })
  })

  it('旧存档无分日字段时按最后计时终点估算，不补算离线时间', () => {
    const world = activeWorld('2026-09-30T15:50:00.000Z')
    const session = world.sessions[0]
    delete session.secondsByDay
    Object.assign(session, { status: 'paused', lastResumedAt: undefined, pausedAt: '2026-09-30T16:30:00.000Z', accumulatedSeconds: 2400 })
    assert.equal(getDailyTroopStatus(world, '2026-09-30T16:30:00.000Z').spentMinutes, 30)
  })

  it('17 项到期军务都参与提醒计数，不受首页 8 项预览限制', () => {
    const world = worldAt()
    world.campaigns[0].nodes.forEach((node) => { node.owner = 'self'; node.state = 'controlled'; node.review = { ...node.review, baseStability: 80, nextReviewAt: '2026-09-30T04:00:00.000Z' } })
    const campaigns = deriveWorld(world, NOW)
    assert.equal(getTodayAgenda(world, campaigns, NOW).length, 17)
    assert.equal(getReminderCount(world, campaigns, NOW), 17)
  })

  it('建议时长统一降为可负担棋子，不足 15 分钟时阻断', () => {
    assert.equal(affordableMinutes(20, 25), 15)
    assert.equal(affordableMinutes(14, 25), undefined)
    assert.equal(affordableMinutes(50, 60), 45)
    const world = activeWorld()
    world.sessions[0] = { ...world.sessions[0], status: 'abandoned', accumulatedSeconds: 76 * 60, secondsByDay: { '2026-10-01': 76 * 60 }, endedAt: NOW }
    assert.match(getTodayAgenda(world, deriveWorld(world, NOW), NOW)[0].blockedReason!, /兵力不足/)
  })

  it('草稿图片纳入保护，结算或撤回清空草稿且迟到保存不会复活它', () => {
    const world = mediaWorld()
    assert.ok(referencedImages([world]).has(PHOTO))
    const abandoned = abandonSession(world, 's1', NOW)
    assert.equal(abandoned.sessions[0].draft, undefined)
    assert.equal(saveBattleDraft(abandoned, 's1', EMPTY_BATTLE_DRAFT), abandoned)
    const settled = settleSession(world, 's1', { outcome: 'partial', evidence: [{ type: 'text', content: PROOF }], clientMutationId: 'm1' }, '2026-10-01T04:05:00.000Z')
    assert.equal(settled.sessions[0].draft, undefined)
    assert.equal(saveBattleDraft(settled, 's1', EMPTY_BATTLE_DRAFT), settled)
  })
})
