import { useState } from 'react'
import { Button, Image, Input, Text, Textarea, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { getNpcCharacterIds, normalizeNpcAssignments, NPC_DUTIES } from '../domain/npcs'
import type { NpcCharacterId, NpcCharacterInput, NpcDuty } from '../domain/types'
import { persistNpcPortrait } from '../services/evidence-storage'
import { confirmAction, showUserToast } from '../services/taro-ui'
import { useWorld } from '../state/world-context'
import { getNpcCharacter, getNpcCharacters, NPC_DUTY_META } from './npc-roster'
import './NpcRosterSettings.scss'

const EMPTY_DRAFT: NpcCharacterInput = { name: '', trait: '', description: '', image: '' }

export function NpcRosterSettings() {
  const { world, actions } = useWorld()
  const [creating, setCreating] = useState(false)
  const [choosingImage, setChoosingImage] = useState(false)
  const [draft, setDraft] = useState<NpcCharacterInput>(EMPTY_DRAFT)
  const customCharacters = world.profile.customNpcCharacters ?? []
  const characters = getNpcCharacters(customCharacters)
  const assignments = normalizeNpcAssignments(
    world.profile.npcAssignments,
    getNpcCharacterIds(customCharacters)
  )

  const assign = (duty: NpcDuty, characterId: NpcCharacterId) => {
    const result = actions.assignNpc(duty, characterId)
    showUserToast(result.ok ? '幕僚任命已更新' : result.message, result.ok ? 'success' : 'none')
  }

  const choosePortrait = async () => {
    setChoosingImage(true)
    try {
      const result = await Taro.chooseImage({ count: 1, sizeType: ['compressed'], sourceType: ['album', 'camera'] })
      const image = result.tempFilePaths[0]
      if (image) {
        const persistentImage = await persistNpcPortrait(image)
        setDraft((current) => ({ ...current, image: persistentImage }))
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!message.toLowerCase().includes('cancel')) {
        showUserToast('头像选择失败，请重试')
      }
    } finally {
      setChoosingImage(false)
    }
  }

  const saveCharacter = () => {
    const result = actions.createNpc(draft)
    showUserToast(result.ok ? '新角色已加入名册' : result.message, result.ok ? 'success' : 'none')
    if (!result.ok) return
    setDraft(EMPTY_DRAFT)
    setCreating(false)
  }

  const removeCharacter = async (characterId: NpcCharacterId, name: string) => {
    const confirmed = await confirmAction({ title: '移出名册', content: `确定移除自定义角色「${name}」吗？` })
    if (!confirmed) return
    const result = actions.deleteNpc(characterId)
    showUserToast(result.ok ? '角色已移出名册' : result.message, result.ok ? 'success' : 'none')
  }

  const cancelCreate = () => {
    setDraft(EMPTY_DRAFT)
    setCreating(false)
  }

  return (
    <View className='paper-card npc-roster-settings'>
      <View className='npc-roster-head'>
        <View>
          <View className='eyebrow'>STAFF APPOINTMENT · 幕僚任命</View>
          <View className='section-title'>配置随军幕僚</View>
        </View>
        <View className='npc-roster-actions'>
          <Text>{characters.length} 位角色</Text>
          <Button size='mini' onClick={() => setCreating((current) => !current)}>
            {creating ? '收起' : '＋ 自定义角色'}
          </Button>
        </View>
      </View>
      <View className='npc-roster-note'>角色名册不设人数上限；任命已在任人物时，两人会自动互换岗位。</View>

      {creating && (
        <View className='npc-create-panel'>
          <View className='npc-create-portrait' onClick={choosePortrait}>
            {draft.image
              ? <Image src={draft.image} mode='aspectFill' />
              : <View><Text>＋</Text><small>选择头像</small></View>}
            {choosingImage && <View className='npc-create-loading'>处理中…</View>}
          </View>
          <View className='npc-create-fields'>
            <View className='npc-create-row'>
              <Input
                maxlength={12}
                value={draft.name}
                placeholder='角色姓名（必填）'
                onInput={(event) => setDraft((current) => ({ ...current, name: event.detail.value }))}
              />
              <Input
                maxlength={16}
                value={draft.trait}
                placeholder='角色特质，如：善断军机'
                onInput={(event) => setDraft((current) => ({ ...current, trait: event.detail.value }))}
              />
            </View>
            <Textarea
              maxlength={80}
              value={draft.description}
              placeholder='角色简介（可选）'
              onInput={(event) => setDraft((current) => ({ ...current, description: event.detail.value }))}
            />
            <View className='npc-create-buttons'>
              <Button size='mini' onClick={cancelCreate}>取消</Button>
              <Button size='mini' className='npc-create-submit' disabled={choosingImage} onClick={saveCharacter}>收入名册</Button>
            </View>
          </View>
        </View>
      )}

      <View className='npc-duty-grid'>
        {NPC_DUTIES.map((duty) => {
          const dutyMeta = NPC_DUTY_META[duty]
          const current = getNpcCharacter(assignments[duty], customCharacters)
          return (
            <View key={duty} className='npc-duty-card'>
              <View className='npc-duty-current'>
                <View className='npc-duty-portrait-wrap'>
                  <Image className='npc-duty-portrait' src={current.image} mode='aspectFill' />
                  <Text>{dutyMeta.seal}</Text>
                </View>
                <View className='npc-duty-copy'>
                  <small>{dutyMeta.label}</small>
                  <Text>{current.name}</Text>
                  <View>{current.trait}</View>
                </View>
              </View>
              <View className='npc-duty-description'>{dutyMeta.description}</View>
              <View className='npc-candidate-list'>
                {characters.map((character) => (
                  <View
                    key={character.id}
                    className={`npc-candidate ${assignments[duty] === character.id ? 'npc-candidate--active' : ''}`}
                    onClick={() => assign(duty, character.id)}
                  >
                    <Image src={character.image} mode='aspectFill' />
                    <Text>{character.name}</Text>
                  </View>
                ))}
              </View>
            </View>
          )
        })}
      </View>

      <View className='npc-library-head'>
        <View>
          <View className='eyebrow'>CHARACTER ARCHIVE · 角色名册</View>
          <View className='npc-library-title'>全部随军人物</View>
        </View>
        <Text>默认 {characters.length - customCharacters.length} · 自定义 {customCharacters.length}</Text>
      </View>
      <View className='npc-library-grid'>
        {characters.map((character) => (
          <View key={character.id} className='npc-library-card'>
            <Image src={character.image} mode='aspectFill' />
            <View className='npc-library-copy'>
              <View><Text>{character.name}</Text><small>{character.custom ? '自定义' : '默认'}</small></View>
              <View className='npc-library-trait'>{character.trait}</View>
              <View className='npc-library-description'>{character.description || '尚未填写人物小传。'}</View>
            </View>
            {character.custom && (
              <Button size='mini' onClick={() => removeCharacter(character.id, character.name)}>移除</Button>
            )}
          </View>
        ))}
      </View>
    </View>
  )
}
