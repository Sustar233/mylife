import Taro from '@tarojs/taro'
import type { WorldState } from '../domain/types'
import { formatWorldBackup, readWorldBackupPayload } from '../domain/backup-format'
import { normalizeWorldState } from './world-normalization'
import { portableWorld, prepareWorldMedia, type PreparedWorldImport } from './backup-media'
import { registerManagedFile } from './evidence-storage'
import { makeId } from '../domain/utils'

function backupFileName(): string {
  return `知域备份-${new Date().toISOString().slice(0, 10)}.json`
}

function readMiniProgramFile(path: string, encoding?: 'utf8' | 'base64'): Promise<string> {
  return new Promise((resolve, reject) => {
    Taro.getFileSystemManager().readFile({
      filePath: path,
      encoding,
      success: (result) => resolve(String(result.data)),
      fail: reject
    })
  })
}

function writeMiniProgramFile(path: string, data: string, encoding?: 'utf8' | 'base64'): Promise<void> {
  return new Promise((resolve, reject) => {
    Taro.getFileSystemManager().writeFile({
      filePath: path,
      data,
      encoding,
      success: () => resolve(),
      fail: reject
    })
  })
}

function imageMime(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase()
  if (extension === 'png') return 'image/png'
  if (extension === 'webp') return 'image/webp'
  return 'image/jpeg'
}

export async function prepareImportedWorld(world: WorldState): Promise<PreparedWorldImport> {
  if (process.env.TARO_ENV !== 'weapp') return { world, rollback: async () => undefined }
  return prepareWorldMedia(world, {
    write: async (dataUrl) => {
      const match = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/)!
      const extension = match[1] === 'jpeg' ? 'jpg' : match[1]
      // 路径仅由本地随机 ID 生成，不采用备份中的 ID，更不会覆盖旧图片。
      const tempPath = `${Taro.env.USER_DATA_PATH}/${makeId('zhiyu-import')}.${extension}`
      try {
        await writeMiniProgramFile(tempPath, match[2], 'base64')
        const result = await Taro.saveFile({ tempFilePath: tempPath })
        if (!('savedFilePath' in result) || !result.savedFilePath) throw new Error('导入图片未能持久保存。')
        return registerManagedFile(result.savedFilePath)
      } finally {
        await new Promise<void>((resolve) => Taro.getFileSystemManager().unlink({ filePath: tempPath, complete: () => resolve() }))
      }
    },
    remove: async (path) => { await Taro.removeSavedFile({ filePath: path }) }
  })
}

export async function serializeWorldBackup(world: WorldState): Promise<string> {
  const portable = process.env.TARO_ENV === 'weapp'
    ? await portableWorld(world, async (path) => {
        try {
          return `data:${imageMime(path)};base64,${await readMiniProgramFile(path, 'base64')}`
        } catch { throw new Error('成果、头像或草稿图片已丢失，备份未生成。') }
      })
    : world
  return formatWorldBackup(portable)
}
export async function parseWorldBackup(text: string): Promise<WorldState> {
  return normalizeWorldState(readWorldBackupPayload(text))
}

export async function exportWorldBackup(world: WorldState): Promise<void> {
  const content = await serializeWorldBackup(world)
  const name = backupFileName()
  if (process.env.TARO_ENV === 'h5') {
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = name
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return
  }
  if (process.env.TARO_ENV === 'weapp') {
    const filePath = `${Taro.env.USER_DATA_PATH}/${name}`
    await writeMiniProgramFile(filePath, content, 'utf8')
    await Taro.shareFileMessage({ filePath, fileName: name })
    return
  }
  await Taro.setClipboardData({ data: content })
}

function chooseH5Backup(): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    let settled = false
    const finish = (operation: () => void) => {
      if (settled) return
      settled = true
      window.removeEventListener('focus', handleFocus)
      operation()
    }
    const cancel = () => finish(() => reject(new Error('cancel')))
    const handleFocus = () => setTimeout(() => {
      if (!input.files?.length) cancel()
    }, 300)
    input.type = 'file'
    input.accept = '.json,application/json'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return cancel()
      const reader = new FileReader()
      reader.onload = () => finish(() => resolve(String(reader.result)))
      reader.onerror = () => finish(() => reject(reader.error ?? new Error('读取备份失败。')))
      reader.readAsText(file)
    }
    input.addEventListener('cancel', cancel)
    window.addEventListener('focus', handleFocus, { once: true })
    input.click()
  })
}

export async function chooseAndParseWorldBackup(): Promise<WorldState> {
  if (process.env.TARO_ENV === 'h5') return parseWorldBackup(await chooseH5Backup())
  if (process.env.TARO_ENV === 'weapp') {
    const result = await Taro.chooseMessageFile({ count: 1, type: 'file', extension: ['json'] })
    const path = result.tempFiles[0]?.path
    if (!path) throw new Error('未读取到备份文件。')
    return parseWorldBackup(await readMiniProgramFile(path, 'utf8'))
  }
  throw new Error('当前平台暂不支持选择备份文件。')
}
