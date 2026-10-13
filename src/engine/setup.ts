/**
 * 开局设置、阶段设置、轮设置、回合推进。
 *
 * 对应规则：rules/规则规格.md 第 2、3、4 节。
 *
 * 所有函数都是纯函数：输入 state 返回新 state，随机全部来自 state.rng。
 * 注意：**必须克隆 rng 再推进**，直接改 state.rng 会污染旧状态，
 * 那样撤销（快照栈）与 AI 克隆（structuredClone）都会失效。
 */

import { activeSlots } from './gameBoard'
import { isCastleSpace } from './board'
import { axialKey, type Axial } from './hex'
import { createRng, rollDie, shuffle } from './rng'
import { applyPhaseEnd } from './scoring'
import { currentRoundGoods, type GameState, type RulesetConfig } from './state'
import { buildTilePool } from './tiles'
import { ROUNDS_PER_PHASE, TOTAL_PHASES } from './data/scoring'
import { GOODS_KINDS, type BonusTileSize, type DieState, type DieValue, type GoodsKind, type HexTile, type PlayerId, type PlayerState, type TileColor } from './types'

/** 官方：42 枚货物 = 6 色 × 7 枚。 */
export const GOODS_TOTAL = 42
/** 官方：洗混后分成 5 堆，每堆 5 枚，放在 A–E 阶段格上。 */
export const GOODS_PILE_SIZE = 5
/** 官方：每位玩家从剩余 17 枚里拿 3 枚。 */
export const GOODS_PER_PLAYER = 3
/** 顺位轨：第 1/2/3/4 位分别拿 1/2/3/4 个工人。 */
export const WORKERS_BY_TURN_ORDER = [1, 2, 3, 4] as const
/** 官方：每人起始 1 银币。 */
export const STARTING_SILVERLINGS = 1

type Supply = Record<string, HexTile[]>

function pushToSupply(supply: Supply, tile: HexTile): void {
  const list = supply[tile.color] ?? []
  list.push(tile)
  supply[tile.color] = list
}

function splitPoolByColor(pool: readonly HexTile[]): Supply {
  const supply: Supply = {}
  for (const tile of pool) pushToSupply(supply, tile)
  return supply
}

function cloneSupply(supply: Readonly<Record<string, readonly HexTile[]>>): Supply {
  const clone: Supply = {}
  for (const [color, tiles] of Object.entries(supply)) clone[color] = [...tiles]
  return clone
}

/** 从某个颜色的供应堆顶部抽一枚（抽不到返回 undefined）。 */
function drawByColor(supply: Supply, color: TileColor): HexTile | undefined {
  const list = supply[color]
  if (list === undefined || list.length === 0) return undefined
  return list.shift()
}

/** 每种颜色的玩家版图空格总数（判定"某色是否全部铺满"要用）。 */
export function colorSpaceTotals(config: RulesetConfig, boardId: string): Record<TileColor, number> {
  const board = config.playerBoards[boardId]
  if (board === undefined) throw new Error(`找不到玩家版图 ${boardId}`)
  const totals = {} as Record<TileColor, number>
  for (const space of board.spaces) totals[space.color] = (totals[space.color] ?? 0) + 1
  return totals
}

/**
 * 板块总数守恒检查：供应堆 + 仓库 + 黑洞 + 黑牌堆 + 领地 + 仓储 + 已移除
 * 必须等于两张库存表之和。
 */
export function countAllTiles(state: GameState): number {
  let total = 0
  for (const tiles of Object.values(state.supply)) total += tiles.length
  for (const tile of Object.values(state.depotSlots)) if (tile !== null) total += 1
  total += state.blackDepot.length
  total += state.blackSupply.length
  total += state.removedFromGame.length
  for (const player of state.players) {
    total += Object.keys(player.estate).length
    total += player.storage.length
  }
  return total
}

/** 掷骰决定先手：每人一颗，最大者为先手；平手重掷。 */
function rollOff(rng: { s: number }, players: readonly PlayerId[]): PlayerId[] {
  let contenders = [...players]
  for (let guard = 0; guard < 100; guard += 1) {
    const rolls = contenders.map(() => rollDie(rng))
    const best = Math.max(...rolls)
    const winners = contenders.filter((_, index) => rolls[index] === best)
    if (winners.length === 1) {
      const winner = winners[0]
      if (winner === undefined) break
      return [winner, ...players.filter((id) => id !== winner)]
    }
    contenders = winners
  }
  throw new Error('掷骰定先手连续平手，种子可能异常')
}

export interface CreateGameOptions {
  readonly seed: number
  /** 每位玩家使用的玩家版图 id。默认全部用 '1'（两人同版图，公平且是常见玩法）。 */
  readonly boardIds?: readonly string[]
  /**
   * 每位玩家开局城堡所在的深红格。
   *
   * 官方规则是**选定**一个深红格（不是固定中央格）；缺省时用版图给出的推荐格
   * （也就是中央那个 6 号格，规则书对"第一次玩"的推荐）。
   */
  readonly startingSpaces?: Readonly<Partial<Record<PlayerId, Axial>>>
}

export function createGame(config: RulesetConfig, options: CreateGameOptions): GameState {
  const { playerCount } = config
  const rng = createRng(options.seed)

  const playerIds: PlayerId[] = playerCount === 2 ? ['p1', 'p2'] : ['p1', 'p2', 'p3', 'p4']
  const turnOrder = rollOff(rng, playerIds)
  const startPlayerId = turnOrder[0]
  if (startPlayerId === undefined) throw new Error('先手未确定')

  // --- 货物：42 枚洗混 → 5 堆 × 5 枚 → 每人 3 枚 → 其余本局不用 ---
  const allGoods: GoodsKind[] = []
  for (const kind of GOODS_KINDS) {
    for (let i = 0; i < 7; i += 1) allGoods.push(kind)
  }
  const shuffledGoods = shuffle(rng, allGoods)
  if (shuffledGoods.length !== GOODS_TOTAL) throw new Error('货物总数不是 42')

  const phaseGoodsPiles: GoodsKind[][] = []
  for (let i = 0; i < TOTAL_PHASES; i += 1) {
    phaseGoodsPiles.push(shuffledGoods.slice(i * GOODS_PILE_SIZE, (i + 1) * GOODS_PILE_SIZE))
  }
  const goodsForPlayers = shuffledGoods.slice(TOTAL_PHASES * GOODS_PILE_SIZE)

  // --- 板块：先整体洗混，再按颜色分层作为供应堆 ---
  const supply = splitPoolByColor(buildTilePool(config.tileInventory, rng))
  // 黑背面是独立的一堆，必须用不同 id 前缀，否则会和有色背面撞 id
  const blackSupply = buildTilePool(config.blackTileInventory, rng, 'black-')

  // --- 玩家 ---
  const boardIds = options.boardIds ?? playerIds.map(() => '1')
  const players: PlayerState[] = turnOrder.map((id, index) => {
    const boardId = boardIds[index]
    if (boardId === undefined) throw new Error(`第 ${index + 1} 位玩家没有指定版图`)
    const board = config.playerBoards[boardId]
    if (board === undefined) throw new Error(`找不到玩家版图 ${boardId}`)

    const start: Axial = options.startingSpaces?.[id] ?? board.startingSpace
    if (!isCastleSpace(board, start)) {
      throw new Error(
        `玩家 ${id} 的开局城堡格 ${axialKey(start)} 不是深红格（开局城堡必须放在深红格上）`,
      )
    }
    const castle = drawByColor(supply, 'castle')
    if (castle === undefined) throw new Error('供应堆里没有城堡板块，无法完成开局')

    const goods: Record<string, number> = {}
    for (let i = 0; i < GOODS_PER_PLAYER; i += 1) {
      const kind = goodsForPlayers[index * GOODS_PER_PLAYER + i]
      if (kind === undefined) throw new Error('货物不足以发给玩家')
      goods[String(kind)] = (goods[String(kind)] ?? 0) + 1
    }

    const workers = WORKERS_BY_TURN_ORDER[index]
    if (workers === undefined) throw new Error(`顺位 ${index} 没有对应的起始工人数`)

    return {
      id,
      boardId,
      // 起始城堡开局就放好：官方明确放在深绿中央格（点数 6），且不计分、不触发效果
      estate: { [axialKey(start)]: castle },
      storage: [],
      goods,
      soldGoods: {},
      silverlings: STARTING_SILVERLINGS,
      workers,
      vp: 0,
      bonusTiles: {},
    }
  })

  const bonusTilesClaimed: Record<string, BonusTileSize[]> = {}
  for (const color of ['castle', 'animal', 'building', 'mine', 'ship', 'knowledge']) {
    bonusTilesClaimed[color] = []
  }

  const base: GameState = {
    rulesetVersion: config.version,
    seed: options.seed,
    rng,
    playerCount,
    phaseIndex: 0,
    roundIndex: 0,
    players,
    turnOrder,
    turnIndex: 0,
    startPlayerId,
    whiteDie: 1,
    activePlayerId: startPlayerId,
    actionsTakenThisTurn: 0,
    pendingExtraActions: 0,
    purchasedThisTurn: false,
    usedWorkerTakeThisTurn: false,
    dice: {},
    phaseGoodsPiles,
    depotSlots: {},
    blackDepot: [],
    blackSupply,
    removedFromGame: [],
    goodsSpaces: {},
    bonusTilesClaimed,
    supply,
    pending: [],
    finished: false,
  }

  return setupRound(setupPhase(base, config), config)
}

/**
 * 阶段设置（官方：每阶段开始时执行；第一阶段在开局时执行一次）。
 *
 * - 清空版图上剩余的六边形板块并放回供应堆
 *   官方允许船/矿/城堡「留在原地，因为它们完全相同」。在数字版里「原样保留」与
 *   「收回后重抽等量同色板块」的分布完全等价，所以统一重抽，逻辑更简单。
 * - 按当前人数重新铺满编号仓库的启用格位（**按格位的印色**抽牌）
 * - 黑洞：把上一阶段余牌收回黑牌堆、洗混、重新抽
 */
export function setupPhase(state: GameState, config: RulesetConfig): GameState {
  const rng = { s: state.rng.s }
  const supply = cloneSupply(state.supply)

  // 官方：把棋盘上剩余的六边形板块**收回盒中**（即移出本局），不是放回供应堆。
  // 这条很容易写错 —— 放回供应堆会让板块池永远取之不尽，与实物手感完全不同。
  const removed = [...state.removedFromGame]
  for (const tile of Object.values(state.depotSlots)) {
    if (tile !== null) removed.push(tile)
  }

  const blackSupply = shuffle(rng, [...state.blackSupply, ...state.blackDepot])
  const blackDraw = config.gameBoard.blackDepotDrawByPlayerCount[state.playerCount]

  const depotSlots: Record<string, HexTile | null> = {}
  for (const slot of activeSlots(config.gameBoard, state.playerCount)) {
    depotSlots[slot.id] = drawByColor(supply, slot.color) ?? null
  }

  return {
    ...state,
    rng,
    supply,
    removedFromGame: removed,
    depotSlots,
    blackDepot: blackSupply.slice(0, blackDraw),
    blackSupply: blackSupply.slice(blackDraw),
  }
}

/**
 * 轮设置：所有玩家掷 2 颗骰子；先手掷白骰，并把本轮的货物放到白骰点数对应的货物格。
 */
export function setupRound(state: GameState, _config: RulesetConfig): GameState {
  const rng = { s: state.rng.s }

  const dice: Record<string, DieState[]> = {}
  for (const player of state.players) {
    dice[player.id] = [
      { value: rollDie(rng) as DieValue, used: false },
      { value: rollDie(rng) as DieValue, used: false },
    ]
  }

  const whiteDie = rollDie(rng) as DieValue
  const goods = currentRoundGoods(state)
  const goodsSpaces: Record<string, readonly GoodsKind[]> = { ...state.goodsSpaces }
  if (goods !== undefined) {
    const key = String(whiteDie)
    goodsSpaces[key] = [...(goodsSpaces[key] ?? []), goods]
  }

  return {
    ...state,
    rng,
    dice,
    whiteDie,
    goodsSpaces,
    turnIndex: 0,
    activePlayerId: state.turnOrder[0] ?? state.activePlayerId,
    actionsTakenThisTurn: 0,
    pendingExtraActions: 0,
    purchasedThisTurn: false,
    usedWorkerTakeThisTurn: false,
    pending: [],
  }
}

/**
 * 一位玩家结束回合后的推进：轮到下一位 → 下一轮 → 下一阶段 → 终局。
 *
 * 顺位轨队首（turnOrder[0]）自然成为下一轮先手，这正是官方"最右且最上的玩家
 * 成为下一轮先手并拿走白骰"的等价表述。
 */
export function advanceTurn(state: GameState, config: RulesetConfig): GameState {
  const nextTurnIndex = state.turnIndex + 1
  const nextPlayerId = state.turnOrder[nextTurnIndex]

  if (nextPlayerId !== undefined) {
    return {
      ...state,
      turnIndex: nextTurnIndex,
      activePlayerId: nextPlayerId,
      actionsTakenThisTurn: 0,
      pendingExtraActions: 0,
      purchasedThisTurn: false,
    usedWorkerTakeThisTurn: false,
      pending: [],
    }
  }

  // 本轮结束
  const nextRoundIndex = state.roundIndex + 1
  if (nextRoundIndex < ROUNDS_PER_PHASE) {
    return setupRound({ ...state, roundIndex: nextRoundIndex }, config)
  }

  // 阶段结束：先结算阶段末收益（矿的银币等）
  const afterPhaseEnd = applyPhaseEnd(state, config)
  const nextPhaseIndex = state.phaseIndex + 1
  if (nextPhaseIndex >= TOTAL_PHASES) {
    return { ...afterPhaseEnd, finished: true }
  }

  const nextPhase: GameState = { ...afterPhaseEnd, phaseIndex: nextPhaseIndex, roundIndex: 0 }
  return setupRound(setupPhase(nextPhase, config), config)
}
