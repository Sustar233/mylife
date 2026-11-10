import { useState } from 'react'
import { Button, Input, Text, View } from '@tarojs/components'
import { TOUR_GUIDE_TEMPLATE } from '../domain/templates'
import { showUserToast } from '../services/taro-ui'
import { useWorld } from '../state/world-context'
import './CampaignCreator.scss'

interface CampaignCreatorProps {
  onCreated?: () => void
}

export function CampaignCreator({ onCreated }: CampaignCreatorProps) {
  const { actions } = useWorld()
  const template = TOUR_GUIDE_TEMPLATE
  const [title, setTitle] = useState(template.defaultTitle)
  const [goal, setGoal] = useState(template.defaultGoal)
  const [capitalCriteria, setCapitalCriteria] = useState(template.defaultCapitalCriteria)
  const [dailyTroops, setDailyTroops] = useState(420)
  const [mode, setMode] = useState<'standard' | 'assault'>('assault')
  const [importedKeys, setImportedKeys] = useState<string[]>([])

  const toggleImported = (key: string) => {
    setImportedKeys((current) => current.includes(key)
      ? current.filter((item) => item !== key)
      : [...current, key])
  }

  const create = () => {
    if (!title.trim() || !goal.trim() || !capitalCriteria.trim()) {
      showUserToast('请补全战役目标')
      return
    }
    const result = actions.createCampaign({
      templateType: template.type,
      title,
      goal,
      capitalCriteria,
      dailyTroops,
      mode,
      importedTemplateKeys: importedKeys
    })
    if (!result.ok) {
      showUserToast(result.message)
      return
    }
    showUserToast('战役地图已生成', 'success')
    onCreated?.()
  }

  return (
    <View className='campaign-creator paper-card'>
      <View className='creator-head'>
        <View>
          <View className='eyebrow'>ESTABLISH THE FRONT</View>
          <View className='section-title'>建立新战线</View>
        </View>
        <Text className='creator-step'>约 3 分钟</Text>
      </View>

      <Text className='field-label'>战役模板</Text>
      <View className='template-card'>
        <Text className='template-seal'>{template.icon}</Text>
        <View>
          <View className='template-name'>{template.name}</View>
          <View className='template-tagline'>{template.tagline}</View>
        </View>
      </View>

      <Text className='field-label'>敌对势力名称</Text>
      <Input className='text-input' value={title} maxlength={24} onInput={(event) => setTitle(event.detail.value)} />

      <Text className='field-label'>最终学习目标</Text>
      <Input className='text-input' value={goal} maxlength={80} onInput={(event) => setGoal(event.detail.value)} />

      <Text className='field-label'>首都胜利标准</Text>
      <Input className='text-input' value={capitalCriteria} maxlength={100} onInput={(event) => setCapitalCriteria(event.detail.value)} />

      <Text className='field-label'>战役模式</Text>
      <View className='chip-row'>
        <Button onClick={() => { setMode('assault'); setDailyTroops(420) }}>突击模式{mode === 'assault' ? ' ✓' : ''}</Button>
        <Button onClick={() => setMode('standard')}>常规模式{mode === 'standard' ? ' ✓' : ''}</Button>
      </View>
      {mode === 'assault' && <View className='import-hint'>11 月 21 日 00:00 截止 · 每日目标 7 小时 · 共 70 小时且全部节点验收通过。复习到期后每 6 小时侵蚀 15 稳定度。</View>}
      <Text className='field-label'>每日恢复兵力</Text>
      <View className='chip-row'>
        {[60, 120, 240, 420, 540, 720].map((minutes) => (
          <View
            key={minutes}
            className={`chip ${dailyTroops === minutes ? 'chip--active' : ''}`}
            onClick={() => setDailyTroops(minutes)}
          >
            {minutes} 分钟/日
          </View>
        ))}
      </View>

      <Text className='field-label'>导入已有能力（可选）</Text>
      <View className='import-hint'>这些节点会成为初始领地，稳定度为 80；长期不复习会出现叛军。</View>
      <View className='chip-row import-list'>
        {template.nodes.filter((node) => node.kind !== 'capital').map((node) => (
          <View
            key={node.key}
            className={`chip ${importedKeys.includes(node.key) ? 'chip--active' : ''}`}
            onClick={() => toggleImported(node.key)}
          >
            {importedKeys.includes(node.key) ? '✓ ' : ''}{node.title}
          </View>
        ))}
      </View>

      <Button className='primary-button create-button' onClick={create}>生成战役地图</Button>
    </View>
  )
}
