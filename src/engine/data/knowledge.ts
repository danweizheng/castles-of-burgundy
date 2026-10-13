/**
 * 26 张知识（黄）板块的效果表。
 *
 * 来源：官方规则转写（rules/规则规格.md 第 9 节）。
 *
 * 设计取舍：这个文件只声明"这张板块是什么、属于哪一类、官方原文要点"，
 * 以及**分发表**（哪张板块负责哪类骰子调整、哪张对应哪种建筑）。
 * 真正的行为实现在 capabilities.ts（派生能力）与 effects/moves（结算）。
 *
 * 这么分的原因：26 张里有 13 张是"改规则"而不是"加分数"，把它们统一翻译成
 * 一组布尔值/数值能力（capabilities），规则代码里就只出现 `caps.xxx`，
 * 不会到处 if (knowledgeId === 7)。
 */

import type { BuildingKind, KnowledgeId, TileColor } from '../types'

/** 知识板块的生效方式。 */
export type KnowledgeKind =
  /** 持续型：从放置起持续改变规则 */
  | 'continuous'
  /** 阶段结束时结算 */
  | 'phaseEnd'
  /** 只在终局计分 */
  | 'finalScoring'

/** 按编号命名的常量，避免代码里出现裸数字。 */
export const K = {
  ignoreBuildingLimitPerCity: 1,
  workerPerMineAtPhaseEnd: 2,
  extraSilverlingPerSell: 3,
  workerPerSell: 4,
  shipTakesTwoGoodsSpaces: 5,
  buyFromAllDepots: 6,
  extraVpPerScoringAnimalTile: 7,
  dieAdjustTwoPerWorker: 8,
  freeAdjustBuildings: 9,
  freeAdjustShipsAndAnimals: 10,
  freeAdjustCastlesMinesKnowledge: 11,
  freeAdjustTakingTiles: 12,
  silverlingOnTakeWorkers: 13,
  fourWorkersOnTakeWorkers: 14,
  finalVpPerSoldGoodsType: 15,
  finalVpPerAnimalType: 24,
  finalVpPerSoldGoodsTile: 25,
  finalVpPerBonusTile: 26,
} as const satisfies Record<string, KnowledgeId>

/** 16–23 号是 8 张"终局按对应建筑计 4 分"的板块。 */
export const BUILDING_SCORING_KNOWLEDGE_IDS: readonly KnowledgeId[] = [16, 17, 18, 19, 20, 21, 22, 23]

/**
 * 16–23 号与八种建筑的对应关系。
 *
 * ⚠️ 官方例子确认了两处锚点：**17 = 瞭望塔**、**22 = 银行**。
 * 其余 6 个顺序是占位，需要看实物板块上的印刷图案核对（见 rules/规则规格.md）。
 * 改这里只影响终局计分，不会影响对局流程。
 */
export const BUILDING_SCORING_KNOWLEDGE: Readonly<Record<number, BuildingKind>> = {
  16: 'warehouse',
  17: 'watchtower',
  18: 'carpenter',
  19: 'church',
  20: 'market',
  21: 'boardingHouse',
  22: 'bank',
  23: 'cityHall',
}

/**
 * 反面查询：哪种建筑对应哪张知识板块。
 *
 * 这里手写一遍是为了拿到精确的字面量类型；测试里有一条断言它和
 * BUILDING_SCORING_KNOWLEDGE 完全一致，防止两处漂移。
 */
export const SCORING_KNOWLEDGE_BY_BUILDING: Readonly<Partial<Record<BuildingKind, KnowledgeId>>> = {
  warehouse: 16,
  watchtower: 17,
  carpenter: 18,
  church: 19,
  market: 20,
  boardingHouse: 21,
  bank: 22,
  cityHall: 23,
}

/**
 * 9 / 10 / 11 号：放置某几类板块时，所用的骰子可以免费 ±1。
 * 键是板块颜色。
 */
export const FREE_DIE_ADJUST_KNOWLEDGE: Readonly<Record<TileColor, KnowledgeId>> = {
  building: K.freeAdjustBuildings,
  ship: K.freeAdjustShipsAndAnimals,
  animal: K.freeAdjustShipsAndAnimals,
  castle: K.freeAdjustCastlesMinesKnowledge,
  mine: K.freeAdjustCastlesMinesKnowledge,
  knowledge: K.freeAdjustCastlesMinesKnowledge,
}

export interface KnowledgeDef {
  readonly id: KnowledgeId
  readonly name: string
  readonly kind: KnowledgeKind
  /** 官方效果要点（中文概述）。 */
  readonly text: string
}

export const KNOWLEDGE_TILES: readonly KnowledgeDef[] = [
  {
    id: K.ignoreBuildingLimitPerCity,
    name: '无限制建筑',
    kind: 'continuous',
    text: '可忽略"每个城市每种建筑只能 1 座"的限制，想放多少放多少。',
  },
  {
    id: K.workerPerMineAtPhaseEnd,
    name: '矿工',
    kind: 'phaseEnd',
    text: '每阶段结束时，除每座矿的 1 银币外，额外各得 1 工人。',
  },
  {
    id: K.extraSilverlingPerSell,
    name: '商路',
    kind: 'continuous',
    text: '每次卖货物（骰子行动或仓库效果）得 2 银币而非 1。',
  },
  {
    id: K.workerPerSell,
    name: '货栈',
    kind: 'continuous',
    text: '每次卖货物额外得 1 工人。',
  },
  {
    id: K.shipTakesTwoGoodsSpaces,
    name: '双港',
    kind: 'continuous',
    text: '放置船只时，可取两个相邻货物格的货物。',
  },
  {
    id: K.buyFromAllDepots,
    name: '黑市门路',
    kind: 'continuous',
    text: '可从全部 7 个仓库（含黑洞）购买，但仍每回合限一次。',
  },
  {
    id: K.extraVpPerScoringAnimalTile,
    name: '牧人',
    kind: 'continuous',
    text: '每枚计分的动物板块额外 +1 分（不是每只动物 +1）。',
  },
  {
    id: K.dieAdjustTwoPerWorker,
    name: '巧匠',
    kind: 'continuous',
    text: '每个工人可把骰子调整 ±2。',
  },
  {
    id: K.freeAdjustBuildings,
    name: '建筑学',
    kind: 'continuous',
    text: '放置建筑（米色）所用的骰子可免费 ±1。',
  },
  {
    id: K.freeAdjustShipsAndAnimals,
    name: '航运与畜牧',
    kind: 'continuous',
    text: '放置船 / 动物（蓝 / 浅绿）所用的骰子可免费 ±1。',
  },
  {
    id: K.freeAdjustCastlesMinesKnowledge,
    name: '营造与采矿',
    kind: 'continuous',
    text: '放置城堡 / 矿 / 知识（深绿 / 灰 / 黄）所用的骰子可免费 ±1。',
  },
  {
    id: K.freeAdjustTakingTiles,
    name: '采买',
    kind: 'continuous',
    text: '从版图取新板块所用的骰子可免费 ±1。',
  },
  {
    id: K.silverlingOnTakeWorkers,
    name: '工头',
    kind: 'continuous',
    text: '执行"取 2 个工人"行动时额外得 1 银币。（放置客栈不触发）',
  },
  {
    id: K.fourWorkersOnTakeWorkers,
    name: '招募',
    kind: 'continuous',
    text: '执行"取 2 个工人"行动时得 4 个工人而非 2。',
  },
  {
    id: K.finalVpPerSoldGoodsType,
    name: '贸易关系',
    kind: 'finalScoring',
    text: '终局：每种（至少卖过 1 枚的）货物类型 3 分。',
  },
  ...BUILDING_SCORING_KNOWLEDGE_IDS.map((id) => ({
    id,
    name: `${BUILDING_SCORING_KNOWLEDGE[id] ?? '建筑'}专精`,
    kind: 'finalScoring' as const,
    text: '终局：每座对应建筑 4 分。',
  })),
  {
    id: K.finalVpPerAnimalType,
    name: '牧场',
    kind: 'finalScoring',
    text: '终局：每类（已放置的）动物类型 4 分。',
  },
  {
    id: K.finalVpPerSoldGoodsTile,
    name: '账簿',
    kind: 'finalScoring',
    text: '终局：每枚已卖出货物 1 分。',
  },
  {
    id: K.finalVpPerBonusTile,
    name: '声望',
    kind: 'finalScoring',
    text: '终局：每枚已获得的奖励板块 2 分（大 / 小均可）。',
  },
]

/** 全部 26 个编号，用于校验板块池数据完整性。 */
export const ALL_KNOWLEDGE_IDS: readonly KnowledgeId[] = KNOWLEDGE_TILES.map((k) => k.id)

const KNOWLEDGE_BY_ID = new Map<KnowledgeId, KnowledgeDef>(KNOWLEDGE_TILES.map((k) => [k.id, k]))

export function knowledgeDef(id: KnowledgeId): KnowledgeDef {
  const def = KNOWLEDGE_BY_ID.get(id)
  if (def === undefined) throw new Error(`未知知识板块编号：${id}`)
  return def
}
