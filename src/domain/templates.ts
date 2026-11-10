import type { CampaignCreationInput, EdgeKind, MapPosition, NodeKind, TemplateType } from './types'

interface TemplateNodeDefinition {
  key: string
  region: string
  title: string
  description: string
  kind: NodeKind
  estimatedMinutes: number
  victoryCriteria: string
  position: MapPosition
}

interface CampaignTemplateDefinition {
  type: CampaignCreationInput['templateType']
  name: string
  icon: string
  tagline: string
  defaultTitle: string
  defaultGoal: string
  defaultCapitalCriteria: string
  nodes: TemplateNodeDefinition[]
  edges: { from: string; to: string; kind?: EdgeKind }[]
}

const capitalCriteria = '完成两张限时笔试模拟卷和一次英语模拟面试，记录成绩与改进项'

export const TOUR_GUIDE_TEMPLATE: CampaignTemplateDefinition = {
  type: 'tour-guide',
  name: '导游证',
  icon: '导',
  tagline: '全导 · 法规 · 地导 · 业务 · 英语面试',
  defaultTitle: '导游证备考战图',
  defaultGoal: '完成四门笔试科目与英语面试的学习、练习和模拟验收',
  defaultCapitalCriteria: capitalCriteria,
  nodes: [
    {
      key: 'national-study', region: '全导', title: '全导考纲研读', kind: 'city',
      description: '梳理全国导游基础知识的考纲范围。',
      estimatedMinutes: 120, victoryCriteria: '整理一份全导考纲提纲', position: { x: 18, y: 28 }
    },
    {
      key: 'national-practice', region: '全导', title: '全导专项练习', kind: 'fortress',
      description: '通过专项题检查全国导游基础知识的掌握情况。',
      estimatedMinutes: 90, victoryCriteria: '完成一组全导专项题并订正', position: { x: 24, y: 36 }
    },
    {
      key: 'law-study', region: '法规', title: '法规考纲研读', kind: 'city',
      description: '梳理政策与法律法规的考纲范围。',
      estimatedMinutes: 120, victoryCriteria: '整理一份法规考纲提纲', position: { x: 44, y: 14 }
    },
    {
      key: 'law-practice', region: '法规', title: '法规专项练习', kind: 'fortress',
      description: '用专项题和案例练习巩固法规知识。',
      estimatedMinutes: 90, victoryCriteria: '完成一组法规专项题并记录错因', position: { x: 50, y: 22 }
    },
    {
      key: 'local-study', region: '地导', title: '地导考纲研读', kind: 'city',
      description: '梳理地方导游基础知识的考纲范围。',
      estimatedMinutes: 120, victoryCriteria: '整理一份地导考纲提纲', position: { x: 73, y: 28 }
    },
    {
      key: 'local-practice', region: '地导', title: '地导专项练习', kind: 'fortress',
      description: '通过专项题巩固各地概况和旅游资源。',
      estimatedMinutes: 90, victoryCriteria: '完成一组地导专项题并订正', position: { x: 79, y: 36 }
    },
    {
      key: 'service-study', region: '业务', title: '业务考纲研读', kind: 'city',
      description: '梳理导游业务的服务流程和技能要求。',
      estimatedMinutes: 120, victoryCriteria: '整理一份导游服务流程提纲', position: { x: 74, y: 64 }
    },
    {
      key: 'service-practice', region: '业务', title: '业务情景练习', kind: 'fortress',
      description: '练习带团服务、安全与应变处置。',
      estimatedMinutes: 90, victoryCriteria: '完成一组业务情景题并复盘处置步骤', position: { x: 80, y: 72 }
    },
    {
      key: 'english-commentary', region: '英语面试', title: '英语景点讲解', kind: 'city',
      description: '按报考地现场考试要求准备英语景点讲解。',
      estimatedMinutes: 120, victoryCriteria: '完成一份英语导游词并进行一次口头讲解', position: { x: 17, y: 64 }
    },
    {
      key: 'english-practice', region: '英语面试', title: '英语面试演练', kind: 'fortress',
      description: '练习英语问答、情景应对与口译。',
      estimatedMinutes: 90, victoryCriteria: '完成一次英语模拟面试并记录改进项', position: { x: 23, y: 72 }
    },
    {
      key: 'capital', region: '综合验收', title: '导游证综合验收', kind: 'capital',
      description: '完成五个分支后的笔试与英语面试综合模拟。',
      estimatedMinutes: 210, victoryCriteria: capitalCriteria, position: { x: 51, y: 82 }
    }
  ],
  edges: [
    { from: 'national-study', to: 'national-practice' },
    { from: 'law-study', to: 'law-practice' },
    { from: 'local-study', to: 'local-practice' },
    { from: 'service-study', to: 'service-practice' },
    { from: 'english-commentary', to: 'english-practice' }
  ]
}

export const CAMPAIGN_TEMPLATES = [TOUR_GUIDE_TEMPLATE]

export function getTemplate(type: TemplateType): CampaignTemplateDefinition {
  const template = CAMPAIGN_TEMPLATES.find((item) => item.type === type)
  if (!template) throw new Error(`未知战役模板：${type}`)
  return template
}
