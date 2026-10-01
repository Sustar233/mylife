import type { WorldState } from './types'

/** 所有用户图片使用同一遍历入口，备份、存储与清理不再各自遗漏字段。 */
export function mapWorldImages(world: WorldState, transform: (path: string) => string): WorldState {
  return {
    ...world,
    evidence: world.evidence.map((item) => item.type === 'image' ? { ...item, content: transform(item.content) } : item),
    profile: { ...world.profile, customNpcCharacters: world.profile.customNpcCharacters?.map((item) => ({ ...item, image: transform(item.image) })) },
    sessions: world.sessions.map((session) => session.draft ? { ...session, draft: { ...session.draft, images: session.draft.images.map(transform) } } : session)
  }
}
