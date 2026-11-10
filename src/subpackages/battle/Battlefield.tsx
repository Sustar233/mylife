import { memo, useEffect, useState } from 'react'
import { Button, Image, Text, View } from '@tarojs/components'
import { getSessionActiveSeconds } from '../../domain/engine'
import type { StudySession } from '../../domain/types'
import { formatDuration } from '../../domain/utils'
import marchBackground from './assets/march.jpg'
import clashBackground from './assets/clash.jpg'
import siegeBackground from './assets/siege.jpg'

const BATTLE_PHASES = [
  { key: 'march', image: marchBackground },
  { key: 'clash', image: clashBackground },
  { key: 'siege', image: siegeBackground }
] as const

const PHASE_LABELS = {
  attack: ['整军出兵', '前线交战', '合围攻城'],
  review: ['巡查城防', '据城固守', '巩固防线'],
  recover: ['挥师收复', '争夺失地', '重整城防']
} as const

interface BattlefieldProps {
  session: StudySession
  campaignTitle: string
  region: string
  title: string
  victoryCriteria: string
  onPause(sessionId: string): void
  onResume(sessionId: string): void
  onAbandon(): void
  choosingImages: boolean
}

// 秒级计时仅刷新战场，避免每秒重新渲染成果表单。
export const Battlefield = memo(function Battlefield({
  session, campaignTitle, region, title, victoryCriteria, onPause, onResume, onAbandon, choosingImages
}: BattlefieldProps) {
  const [tick, setTick] = useState(() => new Date().toISOString())
  useEffect(() => {
    if (session.status !== 'active') return
    setTick(new Date().toISOString())
    const timer = setInterval(() => setTick(new Date().toISOString()), 1000)
    return () => clearInterval(timer)
  }, [session.id, session.status])

  const elapsedSeconds = getSessionActiveSeconds(session, tick)
  const plannedSeconds = session.plannedMinutes * 60
  const timePercent = Math.min(100, Math.round(elapsedSeconds / Math.max(1, plannedSeconds) * 100))
  const remainingSeconds = Math.max(0, plannedSeconds - elapsedSeconds)
  const phaseIndex = timePercent < 30 ? 0 : timePercent < 75 ? 1 : 2
  const phase = BATTLE_PHASES[phaseIndex]

  return (
    <View className='battlefield-card'>
      <View className='battle-phase-art-layer'>
        {BATTLE_PHASES.map((item) => (
          <Image key={item.key} className={`battle-phase-art ${phase.key === item.key ? 'battle-phase-art--active' : ''}`} src={item.image} mode='aspectFill' />
        ))}
        <View className='battle-phase-veil' />
      </View>
      <View className='battlefield-content'>
        <View className='battle-phase-label'><Text>{String(phaseIndex + 1).padStart(2, '0')}</Text>{PHASE_LABELS[session.mode][phaseIndex]}</View>
        <View className='battlefield-region'>{campaignTitle} · {region}</View>
        <View className='battlefield-title'>{title}</View>
        <View className='battlefield-criteria'><Text>本次军令</Text>{victoryCriteria}</View>
        <View className='timer-wrap'>
          <View className='timer-ring' style={{ background: `conic-gradient(#536b70 ${timePercent}%, rgba(72,78,72,.12) ${timePercent}%)` }}>
            <View className='timer-inner'>
              <Text className='timer-value'>{formatDuration(remainingSeconds)}</Text>
              <Text className='timer-plan'>{remainingSeconds > 0 ? `已投入 ${formatDuration(elapsedSeconds)}` : '计划完成 · 可提交战果'}</Text>
            </View>
          </View>
        </View>
        <View className='timer-actions'>
          {session.status === 'active'
            ? <Button className='secondary-button timer-button' onClick={() => onPause(session.id)}>暂停整队</Button>
            : <Button className='primary-button timer-button' onClick={() => onResume(session.id)}>继续行动</Button>}
          <Button className='secondary-button timer-button timer-button--withdraw' disabled={choosingImages} onClick={onAbandon}>撤回</Button>
        </View>
      </View>
    </View>
  )
})
