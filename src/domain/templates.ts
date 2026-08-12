import type { EdgeKind, MapPosition, NodeKind, TemplateType } from './types'

export interface TemplateNodeDefinition {
  key: string
  region: string
  title: string
  description: string
  kind: NodeKind
  estimatedMinutes: number
  victoryCriteria: string
  position: MapPosition
}

export interface TemplateEdgeDefinition {
  from: string
  to: string
  kind?: EdgeKind
}

export interface CampaignTemplateDefinition {
  type: TemplateType
  name: string
  icon: string
  tagline: string
  defaultTitle: string
  defaultGoal: string
  defaultCapitalCriteria: string
  defaultScoreTarget?: number
  nodes: TemplateNodeDefinition[]
  edges: TemplateEdgeDefinition[]
}

const language: CampaignTemplateDefinition = {
  type: 'language',
  name: '语言远征',
  icon: '舶',
  tagline: '词汇、输入与表达彼此支援',
  defaultTitle: '英语联邦',
  defaultGoal: '能够在真实场景中独立理解并表达观点',
  defaultCapitalCriteria: '完成一次 10 分钟自由表达，并提交文字或录音说明',
  nodes: [
    { key: 'word-camp', region: '词汇边境', title: '核心词营', description: '建立第一批高频词汇补给。', kind: 'city', estimatedMinutes: 120, victoryCriteria: '主动使用 30 个核心词完成一段表达', position: { x: 11, y: 20 } },
    { key: 'sound-port', region: '听力海岸', title: '辨音港', description: '熟悉连读、弱读和常见语音变化。', kind: 'city', estimatedMinutes: 90, victoryCriteria: '听写一段 60 秒材料并说明主要语音现象', position: { x: 11, y: 69 } },
    { key: 'reading-town', region: '阅读平原', title: '短文镇', description: '用语境理解句子和段落。', kind: 'city', estimatedMinutes: 150, victoryCriteria: '不查词完成一篇短文摘要', position: { x: 31, y: 13 } },
    { key: 'listening-fort', region: '听力海岸', title: '精听堡', description: '从声音中稳定提取关键信息。', kind: 'fortress', estimatedMinutes: 180, victoryCriteria: '精听一段 3 分钟材料并复述核心信息', position: { x: 31, y: 73 } },
    { key: 'journal-city', region: '写作丘陵', title: '日记城', description: '把词汇转化为日常书面输出。', kind: 'city', estimatedMinutes: 160, victoryCriteria: '连续完成 3 篇不少于 120 词的短文', position: { x: 51, y: 15 } },
    { key: 'retell-pass', region: '口语山脉', title: '复述关', description: '将输入转化为自己的语言。', kind: 'fortress', estimatedMinutes: 150, victoryCriteria: '脱稿复述一段学习材料并记录问题', position: { x: 51, y: 67 } },
    { key: 'longread-province', region: '阅读平原', title: '长文省', description: '保持长篇阅读中的理解和注意力。', kind: 'city', estimatedMinutes: 240, victoryCriteria: '完成一篇长文结构图和观点摘要', position: { x: 68, y: 18 } },
    { key: 'dialogue-fort', region: '口语山脉', title: '对话要塞', description: '在互动中即时组织语言。', kind: 'fortress', estimatedMinutes: 240, victoryCriteria: '完成一次 10 分钟真实或模拟对话并复盘', position: { x: 69, y: 68 } },
    { key: 'essay-city', region: '写作丘陵', title: '议论文城', description: '形成结构清晰的完整观点。', kind: 'fortress', estimatedMinutes: 300, victoryCriteria: '完成一篇结构完整的议论文并自行修订', position: { x: 82, y: 28 } },
    { key: 'capital', region: '联合王都', title: '独立表达王都', description: '综合听说读写能力的最终验收。', kind: 'capital', estimatedMinutes: 360, victoryCriteria: '完成一次 10 分钟自由表达，并提交文字或录音说明', position: { x: 90, y: 52 } }
  ],
  edges: [
    { from: 'word-camp', to: 'reading-town' },
    { from: 'sound-port', to: 'listening-fort' },
    { from: 'word-camp', to: 'journal-city' },
    { from: 'reading-town', to: 'journal-city' },
    { from: 'word-camp', to: 'retell-pass' },
    { from: 'listening-fort', to: 'retell-pass' },
    { from: 'reading-town', to: 'longread-province' },
    { from: 'retell-pass', to: 'dialogue-fort' },
    { from: 'journal-city', to: 'essay-city' },
    { from: 'longread-province', to: 'essay-city' },
    { from: 'dialogue-fort', to: 'capital' },
    { from: 'essay-city', to: 'capital' }
  ]
}

const exam: CampaignTemplateDefinition = {
  type: 'exam',
  name: '证书攻坚',
  icon: '章',
  tagline: '考纲覆盖、错题清理与模拟验收',
  defaultTitle: '消防中控考区',
  defaultGoal: '系统覆盖考纲并稳定通过模拟考试',
  defaultCapitalCriteria: '完成一套完整模拟卷并达到目标分数',
  defaultScoreTarget: 80,
  nodes: [
    { key: 'regulation', region: '理论战区', title: '法规城', description: '掌握法规、职责与基础概念。', kind: 'city', estimatedMinutes: 180, victoryCriteria: '完成法规章节复盘并达到自定正确率', position: { x: 10, y: 18 } },
    { key: 'equipment', region: '设施战区', title: '设施镇', description: '识别设备、系统和关键参数。', kind: 'city', estimatedMinutes: 210, victoryCriteria: '完成设施分类图并解释主要功能', position: { x: 10, y: 70 } },
    { key: 'safety', region: '理论战区', title: '安全关', description: '掌握安全规范与责任边界。', kind: 'fortress', estimatedMinutes: 150, victoryCriteria: '完成章节练习并整理所有错因', position: { x: 31, y: 18 } },
    { key: 'operation', region: '实操战区', title: '操作堡', description: '熟悉关键操作流程。', kind: 'fortress', estimatedMinutes: 240, victoryCriteria: '不看资料复述完整操作步骤', position: { x: 31, y: 70 } },
    { key: 'chapter-drill', region: '训练战区', title: '章节演武场', description: '通过题目检验考纲覆盖。', kind: 'city', estimatedMinutes: 240, victoryCriteria: '完成章节题并记录正确率与薄弱项', position: { x: 48, y: 35 } },
    { key: 'scenario', region: '实操战区', title: '场景要塞', description: '在综合场景中选择正确处置方案。', kind: 'fortress', estimatedMinutes: 210, victoryCriteria: '完成 5 个综合场景并解释处置依据', position: { x: 51, y: 75 } },
    { key: 'error-book', region: '训练战区', title: '错题清剿区', description: '消灭反复出现的认知漏洞。', kind: 'city', estimatedMinutes: 180, victoryCriteria: '二刷错题并确认同类题不再出错', position: { x: 65, y: 26 } },
    { key: 'mock-one', region: '模拟战区', title: '第一次大会战', description: '进行完整限时模拟。', kind: 'fortress', estimatedMinutes: 150, victoryCriteria: '完成一套限时模拟卷并记录分数', position: { x: 69, y: 65 } },
    { key: 'weakness', region: '模拟战区', title: '薄弱点肃清', description: '针对模拟暴露的问题补强。', kind: 'fortress', estimatedMinutes: 180, victoryCriteria: '完成薄弱知识清单并逐项复测', position: { x: 82, y: 30 } },
    { key: 'capital', region: '认证王都', title: '合格线王都', description: '以完整模拟考试验证应试能力。', kind: 'capital', estimatedMinutes: 150, victoryCriteria: '完成一套完整模拟卷并达到目标分数', position: { x: 91, y: 56 } }
  ],
  edges: [
    { from: 'regulation', to: 'safety' },
    { from: 'equipment', to: 'operation' },
    { from: 'regulation', to: 'chapter-drill' },
    { from: 'equipment', to: 'chapter-drill' },
    { from: 'operation', to: 'scenario' },
    { from: 'safety', to: 'scenario' },
    { from: 'chapter-drill', to: 'error-book' },
    { from: 'error-book', to: 'mock-one' },
    { from: 'scenario', to: 'mock-one' },
    { from: 'mock-one', to: 'weakness' },
    { from: 'weakness', to: 'capital' }
  ]
}

const stem: CampaignTemplateDefinition = {
  type: 'stem',
  name: '数理与编程',
  icon: '算',
  tagline: '概念、例题、练习与应用逐层推进',
  defaultTitle: '算法诸国',
  defaultGoal: '建立可解释、可练习、可应用的知识体系',
  defaultCapitalCriteria: '独立完成一个综合项目或一套综合题并复盘',
  nodes: [
    { key: 'foundation', region: '基础边境', title: '基础概念城', description: '明确术语、对象和基本约束。', kind: 'city', estimatedMinutes: 150, victoryCriteria: '不用资料解释核心术语并举例', position: { x: 10, y: 22 } },
    { key: 'notation', region: '基础边境', title: '符号与工具港', description: '掌握必要的符号、语言或工具。', kind: 'city', estimatedMinutes: 120, victoryCriteria: '完成一页符号或工具速查表', position: { x: 12, y: 72 } },
    { key: 'core-concept', region: '概念腹地', title: '核心原理堡', description: '理解原理以及成立条件。', kind: 'fortress', estimatedMinutes: 210, victoryCriteria: '独立推导或解释核心原理与边界', position: { x: 34, y: 34 } },
    { key: 'worked-example', region: '范例平原', title: '典型例题城', description: '观察完整解题或实现过程。', kind: 'city', estimatedMinutes: 150, victoryCriteria: '遮住答案后重做两个典型例题', position: { x: 49, y: 18 } },
    { key: 'basic-practice', region: '训练战区', title: '基础练兵场', description: '稳定完成基本题型。', kind: 'city', estimatedMinutes: 240, victoryCriteria: '独立完成一组基础练习并订正', position: { x: 50, y: 70 } },
    { key: 'advanced-practice', region: '训练战区', title: '进阶要塞', description: '处理变式、组合与边界情况。', kind: 'fortress', estimatedMinutes: 300, victoryCriteria: '完成三道进阶题并解释关键选择', position: { x: 68, y: 35 } },
    { key: 'error-review', region: '修整战区', title: '错因清剿城', description: '识别错误背后的知识缺口。', kind: 'city', estimatedMinutes: 150, victoryCriteria: '建立错因清单并完成同类复测', position: { x: 68, y: 76 } },
    { key: 'application', region: '应用前线', title: '真实应用关', description: '把知识用于项目或综合题。', kind: 'fortress', estimatedMinutes: 360, victoryCriteria: '完成一个可运行实现或完整综合题', position: { x: 83, y: 23 } },
    { key: 'capital', region: '知识王都', title: '综合能力王都', description: '通过综合成果确认真正掌握。', kind: 'capital', estimatedMinutes: 480, victoryCriteria: '独立完成一个综合项目或一套综合题并复盘', position: { x: 91, y: 57 } }
  ],
  edges: [
    { from: 'foundation', to: 'core-concept' },
    { from: 'notation', to: 'core-concept' },
    { from: 'core-concept', to: 'worked-example' },
    { from: 'core-concept', to: 'basic-practice' },
    { from: 'worked-example', to: 'advanced-practice' },
    { from: 'basic-practice', to: 'advanced-practice' },
    { from: 'advanced-practice', to: 'error-review' },
    { from: 'advanced-practice', to: 'application' },
    { from: 'error-review', to: 'capital' },
    { from: 'application', to: 'capital' }
  ]
}

export const CAMPAIGN_TEMPLATES: CampaignTemplateDefinition[] = [language, exam, stem]

export function getTemplate(type: TemplateType): CampaignTemplateDefinition {
  const template = CAMPAIGN_TEMPLATES.find((item) => item.type === type)
  if (!template) throw new Error(`未知战役模板：${type}`)
  return template
}
