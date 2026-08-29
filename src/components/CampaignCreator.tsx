import { useMemo, useState } from 'react'
import { Button, Input, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { CAMPAIGN_TEMPLATES, getTemplate } from '../domain/templates'
import type { TemplateType } from '../domain/types'
import { useWorld } from '../state/world-context'
import './CampaignCreator.scss'

interface CampaignCreatorProps {
  onCreated?: () => void
}

export function CampaignCreator({ onCreated }: CampaignCreatorProps) {
  const { actions } = useWorld()
  const [templateType, setTemplateType] = useState<TemplateType>('stem')
  const template = useMemo(() => getTemplate(templateType), [templateType])
  const [title, setTitle] = useState(template.defaultTitle)
  const [goal, setGoal] = useState(template.defaultGoal)
  const [capitalCriteria, setCapitalCriteria] = useState(template.defaultCapitalCriteria)
  const [scoreTarget, setScoreTarget] = useState(template.defaultScoreTarget ?? 80)
  const [dailyTroops, setDailyTroops] = useState(90)
  const [importedKeys, setImportedKeys] = useState<string[]>([])

  const selectTemplate = (type: TemplateType) => {
    const next = getTemplate(type)
    setTemplateType(type)
    setTitle(next.defaultTitle)
    setGoal(next.defaultGoal)
    setCapitalCriteria(next.defaultCapitalCriteria)
    setScoreTarget(next.defaultScoreTarget ?? 80)
    setImportedKeys([])
  }

  const toggleImported = (key: string) => {
    setImportedKeys((current) => current.includes(key)
      ? current.filter((item) => item !== key)
      : [...current, key])
  }

  const create = () => {
    if (!title.trim() || !goal.trim() || !capitalCriteria.trim()) {
      Taro.showToast({ title: '请补全战役目标', icon: 'none' })
      return
    }
    const result = actions.createCampaign({
      templateType,
      title,
      goal,
      capitalCriteria,
      capitalScoreTarget: templateType === 'exam' ? scoreTarget : undefined,
      dailyTroops,
      importedTemplateKeys: importedKeys
    })
    if (!result.ok) {
      Taro.showToast({ title: result.message, icon: 'none' })
      return
    }
    Taro.showToast({ title: '战役地图已生成', icon: 'success' })
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

      <Text className='field-label'>选择战役模板</Text>
      <View className='template-grid'>
        {CAMPAIGN_TEMPLATES.map((item) => (
          <View
            key={item.type}
            className={`template-card ${templateType === item.type ? 'template-card--active' : ''}`}
            onClick={() => selectTemplate(item.type)}
          >
            <Text className='template-seal'>{item.icon}</Text>
            <View className='template-name'>{item.name}</View>
            <View className='template-tagline'>{item.tagline}</View>
          </View>
        ))}
      </View>

      <Text className='field-label'>敌对势力名称</Text>
      <Input className='text-input' value={title} maxlength={24} onInput={(event) => setTitle(event.detail.value)} />

      <Text className='field-label'>最终学习目标</Text>
      <Input className='text-input' value={goal} maxlength={80} onInput={(event) => setGoal(event.detail.value)} />

      <Text className='field-label'>首都胜利标准</Text>
      <Input className='text-input' value={capitalCriteria} maxlength={100} onInput={(event) => setCapitalCriteria(event.detail.value)} />

      {templateType === 'exam' && (
        <>
          <Text className='field-label'>目标分数</Text>
          <Input
            className='text-input score-input'
            type='number'
            value={`${scoreTarget}`}
            onInput={(event) => setScoreTarget(Math.max(1, Number(event.detail.value) || 0))}
          />
        </>
      )}

      <Text className='field-label'>每日恢复兵力</Text>
      <View className='chip-row'>
        {[30, 60, 90, 120].map((minutes) => (
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
