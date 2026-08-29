import { useEffect, useState } from 'react'
import { Button, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { chooseAndParseWorldBackup, exportWorldBackup, prepareImportedWorld } from '../services/backup-service'
import {
  cleanupOrphanedEvidence,
  formatStorageSize,
  getEvidenceStorageStats,
  type EvidenceStorageStats
} from '../services/evidence-storage'
import { worldRepository, type WorldSnapshot, type WorldStorageStats } from '../services/world-repository'
import { formatDateTime } from '../domain/utils'
import { useWorld } from '../state/world-context'
import './DataManagement.scss'

const EMPTY_STORAGE: WorldStorageStats = { worldBytes: 0, snapshotBytes: 0, snapshotCount: 0, storageUsedKB: 0, storageLimitKB: 0 }
const EMPTY_EVIDENCE: EvidenceStorageStats = { imageCount: 0, imageBytes: 0, orphanCount: 0, orphanBytes: 0 }

export function DataManagement() {
  const { world, actions } = useWorld()
  const [storage, setStorage] = useState(EMPTY_STORAGE)
  const [evidence, setEvidence] = useState(EMPTY_EVIDENCE)
  const [snapshots, setSnapshots] = useState<WorldSnapshot[]>([])
  const [busy, setBusy] = useState(false)

  const refresh = async () => {
    setStorage(worldRepository.getStats())
    setSnapshots(worldRepository.listSnapshots())
    setEvidence(await getEvidenceStorageStats(world))
  }

  useEffect(() => { refresh().catch(() => undefined) }, [world])

  const exportBackup = async () => {
    setBusy(true)
    try {
      await exportWorldBackup(world)
      Taro.showToast({ title: '备份已经生成', icon: 'success' })
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '导出失败', icon: 'none' })
    } finally {
      setBusy(false)
    }
  }

  const importBackup = async () => {
    setBusy(true)
    try {
      const imported = await chooseAndParseWorldBackup()
      const result = await Taro.showModal({
        title: '恢复这份备份？',
        content: `将导入 ${imported.campaigns.length} 场战役、${imported.evidence.length} 份成果。当前存档会先生成快照。`,
        confirmText: '确认恢复',
        confirmColor: '#50666a'
      })
      if (!result.confirm) return
      actions.replaceWorld(await prepareImportedWorld(imported))
      Taro.showToast({ title: '备份恢复成功', icon: 'success' })
    } catch (error) {
      const message = error instanceof Error ? error.message : '导入失败'
      if (!/cancel/i.test(message)) Taro.showToast({ title: message, icon: 'none' })
    } finally {
      setBusy(false)
    }
  }

  const restore = async (snapshot: WorldSnapshot) => {
    const result = await Taro.showModal({
      title: `恢复${snapshot.label}？`,
      content: `快照生成于 ${formatDateTime(snapshot.createdAt)}。当前数据会先另存一份快照。`,
      confirmText: '恢复快照',
      confirmColor: '#50666a'
    })
    if (!result.confirm) return
    const restored = actions.restoreSnapshot(snapshot.id)
    Taro.showToast({ title: restored.ok ? '快照已恢复' : restored.message, icon: restored.ok ? 'success' : 'none' })
  }

  const cleanup = async () => {
    const count = await cleanupOrphanedEvidence(world)
    await refresh()
    Taro.showToast({ title: count ? `已清理 ${count} 个文件` : '没有无用文件', icon: count ? 'success' : 'none' })
  }

  return (
    <View className='paper-card data-management'>
      <View className='data-head'>
        <View>
          <View className='eyebrow'>DATA QUARTERMASTER · 辎重管理</View>
          <View className='section-title'>数据与备份</View>
        </View>
        <View className='data-version'>存档 v{world.version}</View>
      </View>

      <View className='data-stat-grid'>
        <View><Text>{formatStorageSize(storage.worldBytes)}</Text><small>主存档</small></View>
        <View><Text>{evidence.imageCount}</Text><small>成果图片</small></View>
        <View><Text>{formatStorageSize(evidence.imageBytes)}</Text><small>图片体积</small></View>
        <View><Text>{storage.snapshotCount}/3</Text><small>安全快照</small></View>
      </View>

      <View className='data-actions'>
        <Button className='primary-button data-button' loading={busy} disabled={busy} onClick={exportBackup}>导出完整备份</Button>
        <Button className='secondary-button data-button' loading={busy} disabled={busy} onClick={importBackup}>从文件恢复</Button>
        <Button className='secondary-button data-button' onClick={cleanup}>清理无用图片</Button>
      </View>

      <View className='snapshot-list'>
        <View className='data-subtitle'>最近安全快照</View>
        {snapshots.length === 0 ? <View className='muted data-empty'>发生有效修改后会自动保留快照。</View> : snapshots.map((snapshot) => (
          <View key={snapshot.id} className='snapshot-row' onClick={() => restore(snapshot)}>
            <View><Text>{snapshot.label}</Text><small>{formatDateTime(snapshot.createdAt)}</small></View>
            <Text className='snapshot-action'>恢复 ›</Text>
          </View>
        ))}
      </View>
      {evidence.orphanCount > 0 && <View className='storage-warning'>发现 {evidence.orphanCount} 个未被战史引用的图片，占用 {formatStorageSize(evidence.orphanBytes)}。</View>}
    </View>
  )
}
