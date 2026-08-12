import { useState } from 'react'
import { Button, Text, View } from '@tarojs/components'
import type { DerivedTerritoryNode, SessionMode } from '../domain/types'
import { actionForNode, OWNER_LABELS, STATE_LABELS } from '../domain/presentation'
import { formatCompactDate } from '../domain/utils'
import './NodeDossier.scss'

interface NodeDossierProps {
  node: DerivedTerritoryNode
  onBegin(minutes: number, mode: SessionMode): void
}

export function NodeDossier({ node, onBegin }: NodeDossierProps) {
  const [minutes, setMinutes] = useState(25)
  const action = actionForNode(node)
  const disabled = node.effectiveState === 'locked'

  return (
    <View className='node-dossier paper-card'>
      <View className='dossier-head'>
        <View>
          <View className='dossier-region'>{node.region} · {node.kind === 'capital' ? '首都' : node.kind === 'fortress' ? '要塞' : '城池'}</View>
          <View className='section-title'>{node.title}</View>
        </View>
        <View className={`status-stamp status-stamp--${node.effectiveOwner}`}>
          {OWNER_LABELS[node.effectiveOwner]} · {STATE_LABELS[node.effectiveState]}
        </View>
      </View>

      <View className='dossier-description'>{node.description}</View>
      {node.supplyCut && <View className='supply-warning'>⚠ 补给中断：上游领地已失守，不能继续向更深处扩张。</View>}

      <View className='dossier-grid'>
        <View className='dossier-stat'>
          <Text className='dossier-stat-label'>稳定度</Text>
          <Text className='dossier-stat-value'>{node.effectiveOwner === 'self' ? node.effectiveStability : '—'}</Text>
        </View>
        <View className='dossier-stat'>
          <Text className='dossier-stat-label'>累计投入</Text>
          <Text className='dossier-stat-value'>{node.accumulatedMinutes}m</Text>
        </View>
        <View className='dossier-stat'>
          <Text className='dossier-stat-label'>预计投入</Text>
          <Text className='dossier-stat-value'>{node.estimatedMinutes}m</Text>
        </View>
        <View className='dossier-stat'>
          <Text className='dossier-stat-label'>下次防守</Text>
          <Text className='dossier-stat-value dossier-stat-date'>{formatCompactDate(node.review.nextReviewAt)}</Text>
        </View>
      </View>

      <View className='criteria-box'>
        <View className='criteria-label'>胜利标准</View>
        <View className='criteria-text'>{node.victoryCriteria}</View>
        {node.scoreTarget != null && <View className='score-target'>首都线：{node.scoreTarget} 分</View>}
      </View>

      {node.effectiveOwner !== 'self' && node.effectiveState !== 'lost' && (
        <View className='effort-block'>
          <View className='effort-label'><Text>围城投入</Text><Text>{node.effortPercent}%</Text></View>
          <View className='progress-track'><View className='progress-fill' style={{ width: `${node.effortPercent}%` }} /></View>
        </View>
      )}

      <Text className='field-label'>调遣时间棋子</Text>
      <View className='chip-row'>
        {[15, 25, 45, 60].map((value) => (
          <View key={value} className={`chip ${minutes === value ? 'chip--active' : ''}`} onClick={() => setMinutes(value)}>{value} 分钟</View>
        ))}
      </View>
      <Button
        className='primary-button dossier-action'
        disabled={disabled}
        onClick={() => {
          if (!disabled) onBegin(minutes, action.mode)
        }}
      >
        {disabled ? '前置道路尚未打通' : action.label}
      </Button>
    </View>
  )
}
