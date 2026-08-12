import Taro from '@tarojs/taro'
import type { WorldState } from '../domain/types'

export interface WorldRepository {
  load(): WorldState | null
  save(world: WorldState): void
}

const STORAGE_KEY = 'zhiyu_world_v1'

export class LocalWorldRepository implements WorldRepository {
  load(): WorldState | null {
    try {
      const value = Taro.getStorageSync<WorldState>(STORAGE_KEY)
      return value && value.version === 1 ? value : null
    } catch {
      return null
    }
  }

  save(world: WorldState): void {
    Taro.setStorageSync(STORAGE_KEY, world)
  }
}

/**
 * CloudBase 接入点。
 *
 * 领域层只依赖 WorldRepository；获得 CloudBase 环境 ID 与登录配置后，
 * 在这里实现按 UID 的读取、幂等云函数结算和证据上传即可，无需改动页面与规则引擎。
 */
export interface CloudWorldRepositoryConfig {
  envId: string
  userId: string
}

export class CloudWorldRepository implements WorldRepository {
  constructor(private readonly config: CloudWorldRepositoryConfig) {}

  load(): WorldState | null {
    throw new Error(`CloudBase 环境 ${this.config.envId} 尚未配置客户端适配器。`)
  }

  save(_world: WorldState): void {
    throw new Error(`CloudBase 环境 ${this.config.envId} 尚未配置客户端适配器。`)
  }
}

export const worldRepository: WorldRepository = new LocalWorldRepository()
