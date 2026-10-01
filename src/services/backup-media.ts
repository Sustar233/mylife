import type { WorldState } from '../domain/types'
import { referencedImages } from '../domain/image-references'
import { mapWorldImages } from '../domain/world-media'

export interface ImportImageStorage {
  write(dataUrl: string): Promise<string>
  remove(path: string): Promise<void>
}
export interface PreparedWorldImport {
  world: WorldState
  rollback(): Promise<void>
}

export async function portableWorld(world: WorldState, read: (path: string) => Promise<string>): Promise<WorldState> {
  const replacements = new Map<string, string>()
  for (const path of referencedImages([world])) {
    if (!/^(data:image\/|https?:\/\/)/i.test(path)) replacements.set(path, await read(path))
  }
  return mapWorldImages(world, (path) => replacements.get(path) ?? path)
}

/** 图片以全新路径暂存；只有上层成功保存新存档后，导入才算完成。 */
export async function prepareWorldMedia(world: WorldState, storage: ImportImageStorage): Promise<PreparedWorldImport> {
  const replacements = new Map<string, string>()
  const created: string[] = []
  const rollback = async () => {
    await Promise.allSettled(created.map((path) => storage.remove(path)))
    // 清理失败不掩盖导入失败；已登记的剩余文件可由无用图片清理再次处理。
  }
  try {
    for (const path of referencedImages([world])) {
      if (!path.startsWith('data:image/')) continue
      if (!/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(path)) throw new Error('备份包含无法解码的图片。')
      const saved = await storage.write(path)
      created.push(saved)
      replacements.set(path, saved)
    }
    return { world: mapWorldImages(world, (path) => replacements.get(path) ?? path), rollback }
  } catch (error) {
    await rollback()
    throw error
  }
}
