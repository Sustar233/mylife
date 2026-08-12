import { useEffect, useMemo, useState } from 'react'
import { Button, Image, Input, Text, Textarea, View } from '@tarojs/components'
import Taro, { useRouter } from '@tarojs/taro'
import { getSessionActiveSeconds } from '../../domain/engine'
import type { SessionOutcome } from '../../domain/types'
import { formatDuration, isValidUrl } from '../../domain/utils'
import { persistEvidenceImage } from '../../services/evidence-storage'
import { useWorld } from '../../state/world-context'
import './index.scss'

const OUTCOMES: Array<{ value: SessionOutcome; title: string; description: string }> = [
  { value: 'achieved', title: '达成', description: '满足胜利标准，可占领或巩固领地' },
  { value: 'partial', title: '部分达成', description: '保留投入，继续围城或防守' },
  { value: 'failed', title: '未达成', description: '记录侦察经历，不宣告胜利' }
]

export default function BattlePage() {
  const router = useRouter()
  const sessionId = router.params.sessionId ?? ''
  const { world, campaigns, hydrated, actions } = useWorld()
  const [tick, setTick] = useState(() => new Date().toISOString())
  const [outcome, setOutcome] = useState<SessionOutcome>('partial')
  const [note, setNote] = useState('')
  const [link, setLink] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [score, setScore] = useState('')

  const session = world.sessions.find((item) => item.id === sessionId)
  const campaign = campaigns.find((item) => item.id === session?.campaignId)
  const node = campaign?.nodes.find((item) => item.id === session?.nodeId)

  useEffect(() => {
    const timer = setInterval(() => setTick(new Date().toISOString()), 1000)
    return () => clearInterval(timer)
  }, [])

  const elapsedSeconds = session ? getSessionActiveSeconds(session, tick) : 0
  const plannedSeconds = (session?.plannedMinutes ?? 25) * 60
  const timePercent = Math.min(100, Math.round((elapsedSeconds / Math.max(1, plannedSeconds)) * 100))
  const modeCopy = session?.mode === 'review'
    ? { eyebrow: 'DEFENCE OPERATION', title: '领地防守' }
    : session?.mode === 'recover'
      ? { eyebrow: 'RECONQUEST OPERATION', title: '失地收复' }
      : { eyebrow: 'SIEGE OPERATION', title: '攻城行动' }

  const sessionEvidence = useMemo(() => world.evidence.filter((item) => session?.evidenceIds.includes(item.id)), [world.evidence, session])

  const chooseImages = async () => {
    try {
      const result = await Taro.chooseImage({ count: Math.max(1, 3 - images.length), sizeType: ['compressed'], sourceType: ['album', 'camera'] })
      const persistentPaths = await Promise.all(result.tempFilePaths.map(persistEvidenceImage))
      setImages((current) => [...current, ...persistentPaths].slice(0, 3))
    } catch {
      // 用户取消选择时无需提示。
    }
  }

  const submit = () => {
    const hasEvidence = note.trim().length >= 20 || isValidUrl(link) || images.length > 0
    if (!hasEvidence) {
      Taro.showToast({ title: '请写满 20 字，或添加链接/图片', icon: 'none' })
      return
    }
    if (link.trim() && !isValidUrl(link)) {
      Taro.showToast({ title: '成果链接需以 http:// 或 https:// 开头', icon: 'none' })
      return
    }
    const numericScore = score ? Number(score) : undefined
    if (node?.scoreTarget != null && outcome === 'achieved' && (numericScore == null || numericScore < node.scoreTarget)) {
      Taro.showToast({ title: `首都线为 ${node.scoreTarget} 分`, icon: 'none' })
      return
    }

    actions.settleExpedition(sessionId, {
      outcome,
      evidence: [
        ...(note.trim() ? [{ type: 'text' as const, content: note.trim() }] : []),
        ...(link.trim() ? [{ type: 'link' as const, content: link.trim() }] : []),
        ...images.map((path) => ({ type: 'image' as const, content: path }))
      ],
      score: numericScore
    })
    Taro.showToast({ title: outcome === 'achieved' ? '战果已确认' : '战史已记录', icon: 'success' })
  }

  const abandon = async () => {
    const result = await Taro.showModal({ title: '撤回部队？', content: '有效时间会保留在本次行动中，但不会提交成果证据。', confirmColor: '#50666a' })
    if (!result.confirm) return
    actions.abandonExpedition(sessionId)
    Taro.navigateBack()
  }

  if (!hydrated || !session || !node || !campaign) {
    return <View className='page-shell battle-loading'>{hydrated ? '未找到这次出征记录。' : '正在联络前线…'}</View>
  }

  if (session.status === 'settled') {
    return (
      <View className='page-shell result-page'>
        <View className='result-seal'>{session.outcome === 'achieved' ? '捷' : '记'}</View>
        <View className='eyebrow'>BATTLE REPORT · 战后结算</View>
        <View className='page-title'>{session.outcome === 'achieved' ? '战果已确认' : '本次行动已归档'}</View>
        <View className='page-subtitle'>{node.title} · 有效投入 {Math.max(1, Math.ceil(session.accumulatedSeconds / 60))} 分钟</View>

        <View className='paper-card result-card'>
          <View className='section-title'>领地现状</View>
          <View className='result-status-row'><Text>归属</Text><Text>{node.effectiveOwner === 'self' ? '己方控制' : node.effectiveOwner === 'rebel' ? '叛军盘踞' : '敌方控制'}</Text></View>
          <View className='result-status-row'><Text>状态</Text><Text>{node.effectiveState === 'controlled' ? '防线稳定' : node.effectiveState === 'sieging' ? '围城继续' : '等待下一次行动'}</Text></View>
          <View className='result-status-row'><Text>稳定度</Text><Text>{node.effectiveOwner === 'self' ? node.effectiveStability : '—'}</Text></View>
        </View>

        <View className='paper-card result-card'>
          <View className='section-title'>成果证据</View>
          {sessionEvidence.map((item) => item.type === 'image'
            ? <Image key={item.id} className='result-image' src={item.content} mode='aspectFill' />
            : <View key={item.id} className='result-evidence'>{item.content}</View>)}
        </View>

        <Button className='primary-button' onClick={() => Taro.switchTab({ url: '/pages/map/index' })}>返回世界地图</Button>
        <Button className='secondary-button result-secondary' onClick={() => Taro.switchTab({ url: '/pages/command/index' })}>查看今日军令</Button>
      </View>
    )
  }

  return (
    <View className='page-shell battle-page'>
      <View className='battle-topline'>
        <View>
          <View className='eyebrow'>{modeCopy.eyebrow}</View>
          <View className='page-title'>{modeCopy.title}</View>
        </View>
        <View className='battle-status'>{session.status === 'active' ? '行动中' : '已暂停'}</View>
      </View>

      <View className='battlefield-card'>
        <View className='battlefield-region'>{campaign.title} · {node.region}</View>
        <View className='battlefield-title'>{node.title}</View>
        <View className='battlefield-criteria'><Text>本次军令</Text>{node.victoryCriteria}</View>

        <View className='timer-wrap'>
          <View className='timer-ring' style={{ background: `conic-gradient(#536b70 ${timePercent}%, rgba(72,78,72,.12) ${timePercent}%)` }}>
            <View className='timer-inner'>
              <Text className='timer-value'>{formatDuration(elapsedSeconds)}</Text>
              <Text className='timer-plan'>计划 {session.plannedMinutes} 分钟</Text>
            </View>
          </View>
        </View>

        <View className='timer-actions'>
          {session.status === 'active'
            ? <Button className='secondary-button timer-button' onClick={() => actions.pauseExpedition(sessionId)}>暂停整队</Button>
            : <Button className='primary-button timer-button' onClick={() => actions.resumeExpedition(sessionId)}>继续行动</Button>}
          <Button className='secondary-button timer-button timer-button--withdraw' onClick={abandon}>撤回</Button>
        </View>
      </View>

      <View className='paper-card settlement-card'>
        <View className='eyebrow'>SETTLEMENT · 战果判定</View>
        <View className='section-title'>这次行动取得了什么？</View>
        <View className='outcome-grid'>
          {OUTCOMES.map((item) => (
            <View key={item.value} className={`outcome-card ${outcome === item.value ? 'outcome-card--active' : ''}`} onClick={() => setOutcome(item.value)}>
              <View className='outcome-title'>{item.title}</View>
              <View className='outcome-description'>{item.description}</View>
            </View>
          ))}
        </View>

        <Text className='field-label'>成果说明（不少于 20 字）</Text>
        <Textarea
          className='text-area evidence-note'
          maxlength={500}
          value={note}
          placeholder='例如：我已独立实现二叉树前中后序遍历，并解释了三种遍历的使用场景…'
          onInput={(event) => setNote(event.detail.value)}
        />
        <View className={`character-count ${note.trim().length >= 20 ? 'character-count--ok' : ''}`}>{note.trim().length}/20</View>

        <Text className='field-label'>成果链接（可选）</Text>
        <Input className='text-input' value={link} placeholder='https://...' onInput={(event) => setLink(event.detail.value)} />

        {node.scoreTarget != null && (
          <>
            <Text className='field-label'>本次模拟分数 · 首都线 {node.scoreTarget}</Text>
            <Input className='text-input score-field' type='number' value={score} placeholder='输入分数' onInput={(event) => setScore(event.detail.value)} />
          </>
        )}

        <Text className='field-label'>成果图片（可选，最多 3 张）</Text>
        <View className='image-grid'>
          {images.map((path) => (
            <View key={path} className='image-tile'>
              <Image src={path} mode='aspectFill' />
              <Text onClick={() => setImages((current) => current.filter((item) => item !== path))}>×</Text>
            </View>
          ))}
          {images.length < 3 && <View className='image-add' onClick={chooseImages}><Text>＋</Text><small>添加证据</small></View>}
        </View>

        <Button className='primary-button settlement-submit' onClick={submit}>提交战果并结算</Button>
      </View>
    </View>
  )
}
