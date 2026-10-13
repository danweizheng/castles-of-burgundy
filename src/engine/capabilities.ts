/**
 * 能力派生：把"已放置的知识板块"翻译成一组布尔值/数值。
 *
 * 这是整个引擎里最省事的一个设计决定。26 张知识板块里有 13 张是"改规则"，
 * 如果到处写 `if (hasKnowledge(player, 7))`，规则代码会被编号污染且极难审计。
 * 改成派生能力之后，规则代码里只出现 `caps.xxx`，而"哪张板块产生哪个能力"
 * 全部集中在 data/knowledge.ts 的几张表里。
 *
 * 注意：Capabilities 里用了 Set / Map，它是**派生视图**，不进 GameState，
 * 因此不违反"GameState 必须 JSON 可序列化"的约束。
 */

import { BUILDING_SCORING_KNOWLEDGE, FREE_DIE_ADJUST_KNOWLEDGE, K } from './data/knowledge'
import {
  DIE_VALUES,
  type BuildingKind,
  type DieValue,
  type HexTile,
  type KnowledgeId,
  type TileColor,
} from './types'

/** 终局计分型知识板块每单位的分值（官方规则书第 12 页）。 */
const BUILDING_SCORING_VP = 4
/** 15 号：每种已卖出的货物类型 2 分（规则书原文 "4 types x 2 = 8 victory points"）。 */
const SOLD_GOODS_TYPE_VP = 2
const ANIMAL_TYPE_VP = 4
const SOLD_GOODS_TILE_VP = 1
/** 26 号：每枚奖励板块 3 分。 */
const BONUS_TILE_VP = 3
/** 6 号：花几个工人从任意编号仓库取一枚建筑。 */
const WORKERS_FOR_BUILDING_TILE = 2

export interface Capabilities {
  /** 1 号：忽略"每个城市每种建筑只能 1 座"。 */
  readonly ignoreBuildingLimitPerCity: boolean
  /** 2 号：阶段结束时每座矿额外给 1 工人。 */
  readonly workerPerMineAtPhaseEnd: boolean
  /** 3 号：卖货物得 2 银币（否则 1）。 */
  readonly silverlingsPerSell: number
  /** 4 号：卖货物额外得 1 工人（否则 0）。 */
  readonly workersPerSell: number
  /** 5 号：摆船时可取两个相邻货物格。 */
  readonly shipTakesTwoGoodsSpaces: boolean
  /**
   * 6 号（Special Edition）：每回合限一次，可花 2 个工人从任意编号仓库取一枚米色建筑。
   * 用 `takeBuildingWithWorkersCost` 表示需要几个工人；0 表示没有这张板块。
   */
  readonly takeBuildingWithWorkersCost: number
  /** 7 号：每枚计分的动物板块额外 +1 分（否则 0）。 */
  readonly animalTileBonusVp: number
  /** 8 号：每个工人可调整 ±2（否则 ±1）。 */
  readonly dieStepsPerWorker: number
  /** 9/10/11 号：放置这些颜色的板块时骰子可免费 ±1。 */
  readonly freeDieAdjustColors: ReadonlySet<TileColor>
  /** 12 号：从版图取板块时骰子可免费 ±1。 */
  readonly freeDieAdjustOnTake: boolean
  /** 13 号："取 2 个工人"额外得 1 银币（否则 0）。 */
  readonly silverlingsOnTakeWorkers: number
  /** 14 号："取 2 个工人"得 4 个工人（否则 2）。 */
  readonly workersOnTakeWorkers: number
  /** 15 号：终局每种已卖出的货物类型 3 分（否则 0）。 */
  readonly finalVpPerSoldGoodsType: number
  /** 16–23 号：终局每座对应建筑 4 分（键不存在表示没有该板块）。 */
  readonly finalVpPerBuilding: ReadonlyMap<BuildingKind, number>
  /** 24 号：终局每类已放置动物类型 4 分（否则 0）。 */
  readonly finalVpPerAnimalType: number
  /** 25 号：终局每枚已卖出货物 1 分（否则 0）。 */
  readonly finalVpPerSoldGoodsTile: number
  /** 26 号：终局每枚奖励板块 2 分（否则 0）。 */
  readonly finalVpPerBonusTile: number
}

/** 从已放置的知识板块编号集合派生能力。 */
export function deriveCapabilities(placedKnowledgeIds: Iterable<KnowledgeId>): Capabilities {
  const ids = new Set(placedKnowledgeIds)

  const freeDieAdjustColors = new Set<TileColor>()
  for (const [color, knowledgeId] of Object.entries(FREE_DIE_ADJUST_KNOWLEDGE) as [
    TileColor,
    KnowledgeId,
  ][]) {
    if (ids.has(knowledgeId)) freeDieAdjustColors.add(color)
  }

  const finalVpPerBuilding = new Map<BuildingKind, number>()
  for (const [idText, building] of Object.entries(BUILDING_SCORING_KNOWLEDGE)) {
    if (ids.has(Number(idText))) finalVpPerBuilding.set(building, BUILDING_SCORING_VP)
  }

  return {
    ignoreBuildingLimitPerCity: ids.has(K.ignoreBuildingLimitPerCity),
    workerPerMineAtPhaseEnd: ids.has(K.workerPerMineAtPhaseEnd),
    silverlingsPerSell: ids.has(K.extraSilverlingPerSell) ? 2 : 1,
    workersPerSell: ids.has(K.workerPerSell) ? 1 : 0,
    shipTakesTwoGoodsSpaces: ids.has(K.shipTakesTwoGoodsSpaces),
    takeBuildingWithWorkersCost: ids.has(K.takeBuildingWithWorkers)
      ? WORKERS_FOR_BUILDING_TILE
      : 0,
    animalTileBonusVp: ids.has(K.extraVpPerScoringAnimalTile) ? 1 : 0,
    dieStepsPerWorker: ids.has(K.dieAdjustTwoPerWorker) ? 2 : 1,
    freeDieAdjustColors,
    freeDieAdjustOnTake: ids.has(K.freeAdjustTakingTiles),
    silverlingsOnTakeWorkers: ids.has(K.silverlingOnTakeWorkers) ? 1 : 0,
    workersOnTakeWorkers: ids.has(K.fourWorkersOnTakeWorkers) ? 4 : 2,
    finalVpPerSoldGoodsType: ids.has(K.finalVpPerSoldGoodsType) ? SOLD_GOODS_TYPE_VP : 0,
    finalVpPerBuilding,
    finalVpPerAnimalType: ids.has(K.finalVpPerAnimalType) ? ANIMAL_TYPE_VP : 0,
    finalVpPerSoldGoodsTile: ids.has(K.finalVpPerSoldGoodsTile) ? SOLD_GOODS_TILE_VP : 0,
    finalVpPerBonusTile: ids.has(K.finalVpPerBonusTile) ? BONUS_TILE_VP : 0,
  }
}

/** 从领地（estate）里取出已放置的知识板块编号。 */
export function knowledgeIdsInEstate(estate: Readonly<Record<string, HexTile>>): KnowledgeId[] {
  const ids: KnowledgeId[] = []
  for (const tile of Object.values(estate)) {
    if (tile.color === 'knowledge') ids.push(tile.knowledge)
  }
  return ids
}

/** 骰子点数在 1–6 之间环绕。1 往下走就是 6，6 往上走就是 1（官方规则明确允许）。 */
export function wrapDie(value: number): DieValue {
  const wrapped = ((((value - 1) % 6) + 6) % 6) + 1
  return wrapped as DieValue
}

export interface DieOption {
  /** 调整后的点数 */
  readonly value: DieValue
  /** 达成这个点数需要花掉的工人数 */
  readonly workersSpent: number
}

export interface DieOptionParams {
  readonly die: DieValue
  /** 当前可用工人数 */
  readonly workers: number
  /** 是否有该用途的免费 ±1（来自 9/10/11/12 号知识板块） */
  readonly freeAdjust: boolean
  /** 每个工人能调整几格（8 号知识板块为 2） */
  readonly stepsPerWorker: number
}

/**
 * 列出一颗骰子能变成哪些点数，以及各自最少花几个工人。
 *
 * 免费调整（知识板块给的 ±1）与工人调整是叠加的，所以一起枚举。
 * 同一目标点数取工人消耗最小的方案 —— 这是 AI 与提示功能都需要的"最省"信息。
 */
export function dieOptions(params: DieOptionParams): DieOption[] {
  const { die, workers, freeAdjust, stepsPerWorker } = params
  if (!Number.isInteger(workers) || workers < 0) {
    throw new Error(`工人数必须是非负整数，收到 ${workers}`)
  }
  if (!Number.isInteger(stepsPerWorker) || stepsPerWorker < 1) {
    throw new Error(`每个工人的调整幅度必须是正整数，收到 ${stepsPerWorker}`)
  }

  const best = new Map<DieValue, number>()
  const freeOffsets = freeAdjust ? [-1, 0, 1] : [0]
  const maxWorkerOffset = workers * stepsPerWorker

  for (const freeOffset of freeOffsets) {
    for (let offset = -maxWorkerOffset; offset <= maxWorkerOffset; offset += 1) {
      const cost = Math.ceil(Math.abs(offset) / stepsPerWorker)
      const value = wrapDie(die + freeOffset + offset)
      const previous = best.get(value)
      if (previous === undefined || cost < previous) best.set(value, cost)
    }
  }

  return [...best.entries()]
    .map(([value, workersSpent]) => ({ value, workersSpent }))
    .sort((a, b) => DIE_VALUES.indexOf(a.value) - DIE_VALUES.indexOf(b.value))
}
