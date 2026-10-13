/**
 * 对局状态与规则集配置。
 *
 * 硬约束：GameState 必须 100% JSON 可序列化 —— 不存 Map / Set / 类实例 / 函数。
 * 因此所有"表"都用 Record 表示，所有引用都用字符串 id。
 *
 * 规则集（版图、板块库存等静态数据）**不放进 GameState**，而是作为参数显式传入
 * 各个纯函数。好处：存档只存对局本身；同一份存档可以配合静态数据做校验与回放。
 * 代价是每个入口函数都要带 config —— 用起来啰嗦一点，但换来的是没有隐藏全局状态。
 */

import type { Axial } from './hex'
import type { GameBoardDef } from './gameBoard'
import type { TileFaceSpec } from './tiles'
import type {
  BonusTileSize,
  DieState,
  DieValue,
  GoodsKind,
  HexTile,
  PlayerBoardDef,
  PlayerId,
  PlayerState,
  TileColor,
} from './types'

export const RULESET_VERSION = 'v0.1.0-placeholder-data'

/**
 * 待处理的选择。
 *
 * 为什么需要它：区域完成、船只取货、仓库卖货、木工坊取板块、市政厅再放一枚
 * 这些效果会在一个行动中间蹦出新的子选择。如果把它们全部编进"动作"里，
 * 动作空间会组合爆炸，AI 也很难评估。
 * 改成"先落地效果、再要求补一个选择"，动作空间始终扁平。
 *
 * `pending[0]` 是当前必须解决的选择；嵌套效果产生的新选择会插到队首（深度优先）。
 */
export type PendingChoice =
  /** 放置船只后：选择从哪个货物格取货（与骰子点数无关）。 */
  | { readonly kind: 'shipGoodsSpace'; readonly exclude: readonly DieValue[] }
  /** 5 号知识板块：再选一个相邻的货物格。 */
  | { readonly kind: 'shipGoodsSecondSpace'; readonly firstSpace: DieValue }
  /** 仓库：立即卖出一种自选货物。 */
  | { readonly kind: 'warehouseSellGoods' }
  /** 木工坊 / 教堂 / 市场：从任意编号仓库取一枚指定颜色的板块。 */
  | {
      readonly kind: 'takeTileFromAnyDepot'
      readonly colors: readonly TileColor[]
    }
  /**
   * 市政厅：从仓储再放一枚板块进领地。
   * `requiredNumber` 为 null 表示数字不受限制（见 scoring.ts 的 RULES 开关与 Q8）。
   */
  | { readonly kind: 'cityHallPlace'; readonly requiredNumber: DieValue | null }

export interface GameState {
  readonly rulesetVersion: string

  /** 对局种子。与 rng 一起保证整局可复现。 */
  readonly seed: number
  readonly rng: { s: number }

  readonly playerCount: 2 | 3 | 4
  /** 0 起算的阶段序号（0..4 对应 A..E）。 */
  readonly phaseIndex: number
  /** 0 起算的轮序号（0..4）。 */
  readonly roundIndex: number

  readonly players: readonly PlayerState[]

  /** 顺位轨：索引 0 是最前（下一轮先手）。 */
  readonly turnOrder: readonly PlayerId[]
  /** 本轮轮到顺位轨上的第几位（0 起算）。 */
  readonly turnIndex: number
  readonly startPlayerId: PlayerId
  /** 本轮货物格上的白骰结果（每轮设置时确定）。 */
  readonly whiteDie: DieValue

  readonly activePlayerId: PlayerId
  /** 当前玩家本回合已用掉的行动数（0..2）。 */
  readonly actionsTakenThisTurn: number
  /** 城堡给的额外行动，待执行次数。 */
  readonly pendingExtraActions: number
  /** 当前玩家本回合是否已买过板块（每回合限一次）。 */
  readonly purchasedThisTurn: boolean
  /** 6 号知识板块的"花 2 个工人取一枚建筑"本回合是否已用过（每回合限一次）。 */
  readonly usedWorkerTakeThisTurn: boolean

  readonly dice: Readonly<Record<string, readonly DieState[]>>

  /** 5 个阶段的货物堆（每堆 5 枚，索引 0 是最上面那枚）。 */
  readonly phaseGoodsPiles: readonly (readonly GoodsKind[])[]

  /** 编号仓库：格位 id → 板块（沿用中央版图的格位定义）。 */
  readonly depotSlots: Readonly<Record<string, HexTile | null>>
  /** 中央黑洞当前展示的板块。 */
  readonly blackDepot: readonly HexTile[]
  /** 黑背面板块尚未抽出的部分（官方：黑背面是独立的一堆）。 */
  readonly blackSupply: readonly HexTile[]

  /**
   * 已从游戏中移除的板块（仓储满时被迫弃掉的）。
   * 单独记一份是为了让"板块守恒"可以被精确断言。
   */
  readonly removedFromGame: readonly HexTile[]

  /** 货物格：仓库编号（'1'..'6'）→ 堆叠的货物。 */
  readonly goodsSpaces: Readonly<Record<string, readonly GoodsKind[]>>

  /** 奖励板块已被谁领走：颜色 → 依次领走的大小（[大, 小]）。 */
  readonly bonusTilesClaimed: Readonly<Record<string, readonly BonusTileSize[]>>

  /** 板块供应堆，按颜色分开（颜色只用于校验与显示，抽取时按颜色分层）。 */
  readonly supply: Readonly<Record<string, readonly HexTile[]>>

  /** 待处理的选择队列，`pending[0]` 是当前选择。 */
  readonly pending: readonly PendingChoice[]

  readonly finished: boolean
}

/** 静态数据：版图与板块库存。 */
export interface RulesetConfig {
  readonly version: string
  readonly playerCount: 2 | 3 | 4
  readonly playerBoards: Readonly<Record<string, PlayerBoardDef>>
  readonly gameBoard: GameBoardDef
  readonly tileInventory: readonly TileFaceSpec[]
  /** 黑背面板块的独立库存（官方：黑背面是单独一堆）。 */
  readonly blackTileInventory: readonly TileFaceSpec[]
}

// ---------------------------------------------------------------------------
// 访问器
// ---------------------------------------------------------------------------

export function playerById(state: GameState, id: PlayerId): PlayerState {
  const player = state.players.find((p) => p.id === id)
  if (player === undefined) throw new Error(`找不到玩家 ${id}`)
  return player
}

export function currentPlayer(state: GameState): PlayerState {
  return playerById(state, state.activePlayerId)
}

export function opponentOf(state: GameState, id: PlayerId): PlayerState {
  const other = state.players.find((p) => p.id !== id)
  if (other === undefined) throw new Error(`找不到 ${id} 的对手`)
  return other
}

export function playerBoardOf(config: RulesetConfig, player: PlayerState): PlayerBoardDef {
  const board = config.playerBoards[player.boardId]
  if (board === undefined) throw new Error(`找不到版图 ${player.boardId}`)
  return board
}

/** 本轮尚未使用的骰子索引。 */
export function unusedDieIndexes(state: GameState, id: PlayerId): number[] {
  const dice = state.dice[id] ?? []
  const indexes: number[] = []
  dice.forEach((die, index) => {
    if (!die.used) indexes.push(index)
  })
  return indexes
}

/** 当前必须解决的选择（没有则返回 undefined）。 */
export function currentPending(state: GameState): PendingChoice | undefined {
  return state.pending[0]
}

/** 本轮货物格当前最上面那枚（第 roundIndex 枚）。 */
export function currentRoundGoods(state: GameState): GoodsKind | undefined {
  return state.phaseGoodsPiles[state.phaseIndex]?.[state.roundIndex]
}

/** 玩家领地上已放置板块的坐标键集合（放置合法性判定要用）。 */
export function estateKeys(player: PlayerState): Set<string> {
  return new Set(Object.keys(player.estate))
}

/** 把仓储里被弃掉的板块从游戏中移除（不回到供应堆）。 */
export function withoutStorageTile(player: PlayerState, index: number): PlayerState {
  if (index < 0 || index >= player.storage.length) {
    throw new Error(`仓储下标越界：${index}`)
  }
  return { ...player, storage: player.storage.filter((_, i) => i !== index) }
}

export function withPlayer(state: GameState, player: PlayerState): GameState {
  return { ...state, players: state.players.map((p) => (p.id === player.id ? player : p)) }
}

export function updatePlayer(
  state: GameState,
  id: PlayerId,
  patch: (player: PlayerState) => PlayerState,
): GameState {
  return withPlayer(state, patch(playerById(state, id)))
}

/** 领地里的坐标列表（用于区域完成判定）。 */
export function estateSpaces(player: PlayerState): Axial[] {
  return Object.keys(player.estate).map((key) => {
    const [q, r] = key.split(',')
    return { q: Number(q), r: Number(r) }
  })
}
