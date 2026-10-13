/**
 * 引擎核心类型。
 *
 * 硬约束（见 README「三条架构红线」）：
 * - 这里的每一个类型都必须 100% JSON 可序列化：不允许 Map / Set / 类实例 / 函数。
 *   Set 只在 capabilities 这种"派生视图"里出现，不进 GameState。
 * - 引擎不引用 React / DOM。
 */

import type { Axial } from './hex'

/** 六种板块颜色。 */
export type TileColor = 'castle' | 'animal' | 'building' | 'mine' | 'ship' | 'knowledge'

export const TILE_COLORS: readonly TileColor[] = [
  'castle',
  'animal',
  'building',
  'mine',
  'ship',
  'knowledge',
]

/** 骰子点数。同时用作编号仓库的编号（1–6）。 */
export type DieValue = 1 | 2 | 3 | 4 | 5 | 6

export const DIE_VALUES: readonly DieValue[] = [1, 2, 3, 4, 5, 6]

/** 货物类型，与骰子点数（= 仓库编号）一一对应。 */
export type GoodsKind = DieValue

export const GOODS_KINDS: readonly GoodsKind[] = DIE_VALUES

/** 四种动物（浅绿板块）。 */
export type AnimalKind = 'chicken' | 'sheep' | 'pig' | 'cow'

export const ANIMAL_KINDS: readonly AnimalKind[] = ['chicken', 'sheep', 'pig', 'cow']

/** 八种建筑（米色板块）。 */
export type BuildingKind =
  | 'warehouse'
  | 'carpenter'
  | 'church'
  | 'market'
  | 'boardingHouse'
  | 'bank'
  | 'cityHall'
  | 'watchtower'

export const BUILDING_KINDS: readonly BuildingKind[] = [
  'warehouse',
  'carpenter',
  'church',
  'market',
  'boardingHouse',
  'bank',
  'cityHall',
  'watchtower',
]

/** 知识（黄）板块编号 1–26。效果表见 rules/规则规格.md 第 9 节。 */
export type KnowledgeId = number

/** 奖励板块的大小。 */
export type BonusTileSize = 'large' | 'small'

/**
 * 六边形板块。
 *
 * 用 `color` 做判别字段，所以 `tile.color` 既是颜色也是 tag，不需要额外字段。
 * 每种颜色都导出了具名类型，方便在函数签名里精确表达"这里要的是动物板块"。
 *
 * 注意：板块**没有**点数属性。船/矿/城堡在实物上完全相同，动物/建筑/知识靠正面区分；
 * "这块板块能用哪个点数"完全由它当前所在的编号仓库（或所在的骰子点数）决定。
 */
export interface CastleTile {
  readonly id: string
  readonly color: 'castle'
}

export interface MineTile {
  readonly id: string
  readonly color: 'mine'
}

export interface ShipTile {
  readonly id: string
  readonly color: 'ship'
}

export interface AnimalTile {
  readonly id: string
  readonly color: 'animal'
  readonly animal: AnimalKind
  /** 板块上画了几只动物，2–4 */
  readonly animals: 2 | 3 | 4
}

export interface BuildingTile {
  readonly id: string
  readonly color: 'building'
  readonly building: BuildingKind
}

export interface KnowledgeTile {
  readonly id: string
  readonly color: 'knowledge'
  readonly knowledge: KnowledgeId
}

export type HexTile =
  | CastleTile
  | MineTile
  | ShipTile
  | AnimalTile
  | BuildingTile
  | KnowledgeTile

export function tileColorOf(tile: HexTile): TileColor {
  return tile.color
}

/** 玩家领地上的一个已放置板块。 */
export interface PlacedTile {
  readonly space: Axial
  readonly tile: HexTile
}

/**
 * 玩家版图上的一个格位。
 *
 * `regionId` 是**版图上印刷的连通区域**，不靠运行时推算。
 * 理由：区域 / 城市 / 牧场在实物上都是印刷的连通区域，虽然绝大多数情况下等于
 * "同色相邻连通块"，但用数据显式表达能避免边界情况出错，也便于对照实物核对。
 */
export interface BoardSpace {
  readonly q: number
  readonly r: number
  readonly color: TileColor
  /** 该格要求的骰子点数。*/
  readonly number: DieValue
  /** 所属的印刷区域 id；同一 id 的格必须同色且连通。 */
  readonly regionId: string
}

/** 一个区域的汇总信息（由版图数据派生，不入 GameState）。 */
export interface RegionInfo {
  readonly regionId: string
  readonly color: TileColor
  readonly spaces: readonly Axial[]
  readonly size: number
}

/** 一张玩家领地版图（No.1–No.9）。 */
export interface PlayerBoardDef {
  readonly id: string
  readonly name: string
  readonly spaces: readonly BoardSpace[]
  /** 起始城堡所在格：必须是 castle 色、点数 6。开局已放置，且不计分、不触发效果。 */
  readonly startingSpace: Axial
}

/** 中央版图上的一个仓库格位。 */
export interface DepotSlotDef {
  readonly depot: DieValue
  readonly color: TileColor
  /** 该格位在几人才局启用（2 / 3 / 4）。 */
  readonly playerCount: 2 | 3 | 4
}

/**
 * 中央版图定义。
 *
 * 重要（来自官方规则）：仓库格位是**印了颜色**的，抽到的板块必须放到同色格位上。
 * 所以每个点数上有哪些颜色是版图决定的，不是随机的。
 * 另外第 6 号仓库有一个深绿格位（3 人局的 B/D 阶段例外换成矿）。
 */
export interface GameBoardDef {
  readonly depotSlots: readonly DepotSlotDef[]
  /** 黑洞在 2 人局开局抽几枚 ⚠️ 待确认（Q3）。 */
  readonly blackDepotDrawByPlayerCount: Readonly<Record<2 | 3 | 4, number>>
  /** 每阶段每个编号仓库铺几枚（2 人局为 2）。 */
  readonly tilesPerDepotByPlayerCount: Readonly<Record<2 | 3 | 4, number>>
}

/**
 * 玩家 id。
 *
 * 虽然是 2 人局优先，但类型上直接留出 3/4 人的位置 —— 官方规则里大量数值
 * （卖货每枚分数、奖励板块分值、仓库格位数）都按人数变化，提前把人数做成一等公民，
 * 远期做"更多对手"时不用回来改类型。
 */
export type PlayerId = 'p1' | 'p2' | 'p3' | 'p4'

export interface DieState {
  readonly value: DieValue
  readonly used: boolean
}

/** 一名玩家的完整状态（全部字段都是纯数据）。 */
export interface PlayerState {
  readonly id: PlayerId
  readonly boardId: string
  /** 领地：坐标键（axialKey）→ 已放置的板块。 */
  readonly estate: Readonly<Record<string, HexTile>>
  /** 板块仓储（左下 3 格）。 */
  readonly storage: readonly HexTile[]
  /** 货物仓储：货物类型 → 枚数。最多 3 种不同颜色（键数 ≤ 3）。 */
  readonly goods: Readonly<Record<string, number>>
  /** 已卖出的货物：货物类型 → 枚数（暗置堆放，仍可查看）。 */
  readonly soldGoods: Readonly<Record<string, number>>
  readonly silverlings: number
  readonly workers: number
  readonly vp: number
  /** 已获得的奖励板块：颜色 → 大小。每种颜色最多一枚（首杀大、次杀小）。 */
  readonly bonusTiles: Readonly<Record<string, BonusTileSize>>
}
