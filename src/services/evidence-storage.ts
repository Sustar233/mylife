import Taro from '@tarojs/taro'
import type { WorldState } from '../domain/types'
import { referencedImages } from '../domain/image-references'

const MAX_IMAGE_EDGE = 1280
const JPEG_QUALITY = 0.76
const NPC_PORTRAIT_EDGE = 640
const NPC_PORTRAIT_QUALITY = 0.78
const MANAGED_FILE_KEY = 'zhiyu_managed_files_v1'

function getManagedFiles(): Set<string> {
  try {
    const value = Taro.getStorageSync<unknown>(MANAGED_FILE_KEY)
    return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [])
  } catch {
    return new Set()
  }
}

function setManagedFiles(files: Set<string>): void {
  Taro.setStorageSync(MANAGED_FILE_KEY, [...files])
}

export function registerManagedFile(filePath: string): string {
  try {
    const files = getManagedFiles()
    files.add(filePath)
    setManagedFiles(files)
  } catch {
    // 文件本身已经持久化成功；清理清单写入失败不能把它降级为临时路径。
  }
  return filePath
}

async function compressH5Image(tempPath: string, maxEdge = MAX_IMAGE_EDGE, quality = JPEG_QUALITY): Promise<string> {
  const response = await fetch(tempPath)
  if (!response.ok) throw new Error('图片读取失败，请重新选择。')
  const objectUrl = URL.createObjectURL(await response.blob())
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new window.Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error('图片解码失败。'))
      element.src = objectUrl
    })
    const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('当前环境无法处理图片，请重试。')
    context.fillStyle = '#eee5cf'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', quality)
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

/**
 * 把成果图片限制到 1280px，并保存为跨重启可读取的地址。
 * H5 使用压缩 JPEG data URL，微信端使用 compressImage 后的持久文件。
 */
async function persistImage(tempPath: string, maxEdge: number, quality: number): Promise<string> {
  if (process.env.TARO_ENV === 'h5') return compressH5Image(tempPath, maxEdge, quality)
  if (process.env.TARO_ENV === 'weapp') {
    const compressed = await Taro.compressImage({
      src: tempPath,
      quality: Math.round(quality * 100),
      compressedWidth: maxEdge,
      compressedHeight: maxEdge
    })
    const result = await Taro.saveFile({ tempFilePath: compressed.tempFilePath })
    if ('savedFilePath' in result && result.savedFilePath) return registerManagedFile(String(result.savedFilePath))
    throw new Error('图片未能保存，请检查本地存储空间。')
  }
  throw new Error('当前平台暂不支持保存图片。')
}

export function persistEvidenceImage(tempPath: string): Promise<string> {
  return persistImage(tempPath, MAX_IMAGE_EDGE, JPEG_QUALITY)
}

/** 压缩并持久化用户自定义幕僚头像。 */
export function persistNpcPortrait(tempPath: string): Promise<string> {
  return persistImage(tempPath, NPC_PORTRAIT_EDGE, NPC_PORTRAIT_QUALITY)
}

export interface EvidenceStorageStats {
  imageCount: number
  imageBytes: number
  orphanCount: number
  orphanBytes: number
}

function approximateDataUrlBytes(value: string): number {
  const payload = value.split(',')[1]
  return payload ? Math.floor(payload.length * 0.75) : value.length
}

export async function getEvidenceStorageStats(world: WorldState, snapshotWorlds: WorldState[] = []): Promise<EvidenceStorageStats> {
  const referenced = new Set(world.evidence.filter((item) => item.type === 'image').map((item) => item.content))
  if (process.env.TARO_ENV === 'weapp') {
    const protectedPaths = referencedImages([world, ...snapshotWorlds])
    const managed = getManagedFiles()
    const saved = await Taro.getSavedFileList()
    const imageBytes = saved.fileList.filter((file) => referenced.has(file.filePath)).reduce((sum, file) => sum + file.size, 0)
    const orphans = saved.fileList.filter((file) => managed.has(file.filePath) && !protectedPaths.has(file.filePath))
    return {
      imageCount: referenced.size,
      imageBytes,
      orphanCount: orphans.length,
      orphanBytes: orphans.reduce((sum, file) => sum + file.size, 0)
    }
  }
  const imageBytes = [...referenced].reduce((sum, path) => sum + approximateDataUrlBytes(path), 0)
  return { imageCount: referenced.size, imageBytes, orphanCount: 0, orphanBytes: 0 }
}

export async function cleanupOrphanedEvidence(world: WorldState, snapshotWorlds: WorldState[] = []): Promise<number> {
  if (process.env.TARO_ENV !== 'weapp') return 0
  const referenced = referencedImages([world, ...snapshotWorlds])
  const managed = getManagedFiles()
  const saved = await Taro.getSavedFileList()
  const orphans = saved.fileList.filter((file) => managed.has(file.filePath) && !referenced.has(file.filePath))
  await Promise.all(orphans.map((file) => Taro.removeSavedFile({ filePath: file.filePath })))
  orphans.forEach((file) => managed.delete(file.filePath))
  setManagedFiles(managed)
  return orphans.length
}

export function formatStorageSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}
