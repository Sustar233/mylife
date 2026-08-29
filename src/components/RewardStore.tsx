import { useState } from 'react'
import { Button, Input, Text, Textarea, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { formatDateTime } from '../domain/utils'
import { useWorld } from '../state/world-context'
import './RewardStore.scss'

export function RewardStore() {
  const { world, actions } = useWorld()
  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [cost, setCost] = useState('80')
  const rewards = world.rewards
  const activeItems = rewards.items.filter((item) => !item.archivedAt)
  const pendingRedemptions = rewards.redemptions.filter((item) => !item.fulfilledAt)

  const showToast = (message: string, icon: 'success' | 'none' = 'none') => {
    void Taro.showToast({ title: message, icon }).catch(() => undefined)
  }

  const showConfirmation = async (options: {
    title: string
    content: string
    confirmText: string
    confirmColor: string
  }) => {
    try {
      return (await Taro.showModal(options)).confirm
    } catch {
      showToast('确认窗口打开失败')
      return false
    }
  }

  const createItem = () => {
    const result = actions.createReward({ title, description, cost: Number(cost) })
    if (!result.ok) {
      showToast(result.message)
      return
    }
    setTitle('')
    setDescription('')
    setCost('80')
    setShowForm(false)
    showToast('新犒赏已上架', 'success')
  }

  const redeem = async (itemId: string, itemTitle: string, itemCost: number) => {
    if (rewards.coins < itemCost) return

    const confirmed = await showConfirmation({
      title: `兑换「${itemTitle}」？`,
      content: `将从国库支付 ${itemCost} 枚铜钱，并生成一张待兑现犒赏令。`,
      confirmText: '确认兑换',
      confirmColor: '#50666a'
    })
    if (!confirmed) return
    const result = actions.redeemReward(itemId)
    showToast(result.ok ? '犒赏令已签发' : result.message, result.ok ? 'success' : 'none')
  }

  const archive = async (itemId: string, itemTitle: string) => {
    const confirmed = await showConfirmation({
      title: `下架「${itemTitle}」？`,
      content: '已经兑换的犒赏令和历史流水不会被删除。',
      confirmText: '确认下架',
      confirmColor: '#6d6358'
    })
    if (!confirmed) return
    const result = actions.archiveReward(itemId)
    if (!result.ok) showToast(result.message)
  }

  const fulfill = async (redemptionId: string, itemTitle: string) => {
    const confirmed = await showConfirmation({
      title: `已经兑现「${itemTitle}」？`,
      content: '确认后会将这张犒赏令收入历史记录。',
      confirmText: '已经享用',
      confirmColor: '#50666a'
    })
    if (!confirmed) return
    const result = actions.fulfillReward(redemptionId)
    showToast(result.ok ? '犒赏已兑现' : result.message, result.ok ? 'success' : 'none')
  }

  return (
    <View className='paper-card reward-store'>
      <View className='reward-store-head'>
        <View>
          <View className='eyebrow'>TREASURY & REWARDS · 国库犒赏</View>
          <View className='section-title'>犒赏商店</View>
        </View>
        <View className='reward-wallet'>
          <View><Text>{rewards.coins}</Text><small>铜钱</small></View>
          <View><Text>{rewards.merit}</Text><small>功勋</small></View>
        </View>
      </View>

      <View className='reward-principle'>有效学习每 5 分钟获得 1 枚基础军饷；战果、证据和按期守城会追加奖励。未达成不会扣除已经投入的军饷。</View>

      {pendingRedemptions.length > 0 && (
        <View className='reward-voucher-section'>
          <View className='reward-subtitle'>待兑现犒赏令</View>
          <View className='reward-voucher-list'>
            {pendingRedemptions.map((item) => (
              <View key={item.id} className='reward-voucher' onClick={() => fulfill(item.id, item.title)}>
                <View className='reward-voucher-seal'>令</View>
                <View><Text>{item.title}</Text><small>{formatDateTime(item.redeemedAt)} · 点击确认兑现</small></View>
                <Text className='reward-voucher-arrow'>›</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      <View className='reward-catalog-head'>
        <View className='reward-subtitle'>可兑换犒赏</View>
        <Text className='text-link' onClick={() => setShowForm((current) => !current)}>{showForm ? '收起新增' : '＋ 自定义犒赏'}</Text>
      </View>

      {showForm && (
        <View className='reward-create-form'>
          <View className='reward-create-grid'>
            <View>
              <Text className='field-label'>犒赏名称</Text>
              <Input className='text-input' value={title} maxlength={30} placeholder='例如：买一本喜欢的书' onInput={(event) => setTitle(event.detail.value)} />
            </View>
            <View>
              <Text className='field-label'>兑换铜钱</Text>
              <Input className='text-input' type='number' value={cost} placeholder='80' onInput={(event) => setCost(event.detail.value)} />
            </View>
          </View>
          <Text className='field-label'>给自己的约定（可选）</Text>
          <Textarea className='text-area reward-description-input' value={description} maxlength={120} placeholder='说明什么时候、以什么方式兑现这份奖励…' onInput={(event) => setDescription(event.detail.value)} />
          <Button className='primary-button reward-create-button' onClick={createItem}>上架这项犒赏</Button>
        </View>
      )}

      <View className='reward-item-grid'>
        {activeItems.map((item) => (
          <View key={item.id} className='reward-item'>
            <View className='reward-item-top'>
              <View className='reward-item-icon'>{item.title.slice(0, 1)}</View>
              <Text className='reward-item-remove' onClick={() => archive(item.id, item.title)}>下架</Text>
            </View>
            <View className='reward-item-title'>{item.title}</View>
            <View className='reward-item-description'>{item.description || '这是给认真完成行动的自己准备的一份奖励。'}</View>
            <View className='reward-item-foot'>
              <View className='reward-price'><Text>{item.cost}</Text><small>铜钱</small></View>
              <Button className='secondary-button reward-redeem-button' disabled={rewards.coins < item.cost} onClick={rewards.coins < item.cost ? undefined : () => void redeem(item.id, item.title, item.cost)}>{rewards.coins < item.cost ? '继续积攒' : '兑换'}</Button>
            </View>
          </View>
        ))}
      </View>

      {rewards.transactions.length > 0 && (
        <View className='reward-ledger'>
          <View className='reward-subtitle'>最近国库流水</View>
          {rewards.transactions.slice(0, 5).map((transaction) => (
            <View key={transaction.id} className='reward-ledger-row'>
              <View><Text>{transaction.title}</Text><small>{formatDateTime(transaction.createdAt)} · {transaction.detail}</small></View>
              <Text className={transaction.coinDelta >= 0 ? 'reward-delta--gain' : 'reward-delta--spend'}>{transaction.kind === 'fulfillment' ? '已兑现' : `${transaction.coinDelta >= 0 ? '+' : ''}${transaction.coinDelta}`}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  )
}
