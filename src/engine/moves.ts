/**
 * 合法行动生成。
 *
 * 设计要点：
 * 1. **动作空间始终扁平。** 效果引起的子选择不进 Move，而是变成 state.pending 里的一项，
 *    由后续的 "resolve*" 动作解决。否则"放船 → 选货物格 × 5 号知识板块 → 选相邻格"
 *    这种链条会让动作数组合爆炸，AI 也没法给单个动作打分。
 * 2. **回合结束是显式动作。** 官方允许"在回合中任意时点"从黑洞购买（包括两个骰子行动之后），
 *    所以不能在用完两个骰子时自动结束回合 —— 否则玩家永远买不了。`endTurn` 只在
 *    两个骰子行动都用完、且没有待执行的城堡额外行动时才合法。
 * 3. **点数可达性统一走 dieOptions。** 免费调整（9/10/11/12 号）与工人调整一起算，
 *    所以这里只关心"目标点数能不能达到"，不重复实现调整规则。
 */

import { boardIndexOf, isAdjacentToAny, regionsOf } from './board'
import { dieOptions, type Capabilities, type DieOption } from './capabilities'
import { ACTIONS_PER_TURN, GOODS_STORAGE_TYPES, STORAGE_CAPACITY } from './data/scoring'
import { activeSlots, activeSlotsFor } from './gameBoard'
import { axialKey, type Axial } from './hex'
import { capabilitiesOf } from './scoring'
import {
  currentPending,
  currentPlayer,
  type GameState,
  type PendingChoice,
  type RulesetConfig,
} from './state'
import { DIE_VALUES, type DieValue, type GoodsKind, type PlayerState } from './types'

export type DieIndex = 0 | 1

/**
 * 用哪颗骰子。
 * `virtual` = 城堡给的额外行动（"相当于多一颗任选点数的骰子"）：不占用真骰子、
 * 不花工人、也不计入每回合的两个行动。
 */
export type DieRef =
  | { readonly kind: 'die'; readonly index: DieIndex }
  | { readonly kind: 'virtual' }

/** 购买来源：中央黑洞，或（6 号知识板块）任意编号仓库。 */
export type BuySource =
  | { readonly kind: 'black'; readonly tileId: string }
  | { readonly kind: 'depot'; readonly slotId: string }

export type Move =
  | {
      readonly kind: 'takeTile'
      readonly die: DieRef
      readonly slotId: string
      readonly discardStorageIndex?: number
    }
  | {
      readonly kind: 'placeTile'
      readonly die: DieRef
      readonly storageIndex: number
      readonly to: Axial
    }
  | { readonly kind: 'sellGoods'; readonly die: DieRef; readonly goods: GoodsKind }
  | { readonly kind: 'takeWorkers'; readonly die: DieRef }
  | { readonly kind: 'buyTile'; readonly source: BuySource; readonly discardStorageIndex?: number }
  | { readonly kind: 'resolveShipGoodsSpace'; readonly space: DieValue }
  | { readonly kind: 'resolveShipGoodsSecondSpace'; readonly space: DieValue }
  | { readonly kind: 'resolveWarehouseSellGoods'; readonly goods: GoodsKind }
  | {
      readonly kind: 'resolveTakeTileFromAnyDepot'
      readonly slotId: string
      readonly discardStorageIndex?: number
    }
  | { readonly kind: 'resolveCityHallPlace'; readonly storageIndex: number; readonly to: Axial }
  | { readonly kind: 'endTurn' }

/**
 * 6 个货物格的相邻关系（供 5 号知识板块"取两个相邻货物格"使用）。
 *
 * ⚠️ 官方只说"two neighbouring goods spaces"，没说相邻的判定方式。
 * 这里按**线性相邻**实现（1-2-3-4-5-6）。若实物版图上它们排成环，改这一个函数即可。
 */
export function goodsSpaceNeighbours(space: DieValue): DieValue[] {
  const result: DieValue[] = []
  if (space > 1) result.push((space - 1) as DieValue)
  if (space < 6) result.push((space + 1) as DieValue)
  return result
}

// ---------------------------------------------------------------------------
// 点数可达性
// ---------------------------------------------------------------------------

export function capabilitiesOfCurrent(state: GameState): Capabilities {
  return capabilitiesOf(currentPlayer(state))
}

function optionsForDie(
  state: GameState,
  player: PlayerState,
  die: DieRef,
  freeAdjust: boolean,
): DieOption[] {
  if (die.kind === 'virtual') {
    return DIE_VALUES.map((value) => ({ value, workersSpent: 0 }))
  }
  const dieState = state.dice[player.id]?.[die.index]
  if (dieState === undefined) return []
  return dieOptions({
    die: dieState.value,
    workers: player.workers,
    freeAdjust,
    stepsPerWorker: capabilitiesOf(player).dieStepsPerWorker,
  })
}

export function optionValues(
  state: GameState,
  player: PlayerState,
  die: DieRef,
  freeAdjust: boolean,
): Set<DieValue> {
  return new Set(optionsForDie(state, player, die, freeAdjust).map((o) => o.value))
}

// ---------------------------------------------------------------------------
// 放置合法性
// ---------------------------------------------------------------------------

export interface PlacementCheck {
  readonly storageIndex: number
  readonly to: Axial
  /** 市政厅的额外放置忽略颜色 */
  readonly ignoreColor: boolean
  /** 必须匹配的点数；null 表示不受点数限制 */
  readonly requiredNumber: DieValue | null
}

/** 返回阻止这次放置的原因；可以放置时返回 undefined。 */
export function placementProblem(
  config: RulesetConfig,
  state: GameState,
  player: PlayerState,
  check: PlacementCheck,
): string | undefined {
  void state
  const board = config.playerBoards[player.boardId]
  if (board === undefined) return `找不到玩家版图 ${player.boardId}`

  const key = axialKey(check.to)
  const space = boardIndexOf(board).get(key)
  if (space === undefined) return `目标格 ${key} 不在版图上`
  if (player.estate[key] !== undefined) return `目标格 ${key} 已经有板块`

  const tile = player.storage[check.storageIndex]
  if (tile === undefined) return `仓储第 ${check.storageIndex} 格是空的`

  if (!check.ignoreColor && space.color !== tile.color) {
    return `颜色不匹配：该格是 ${space.color}，板块是 ${tile.color}`
  }
  if (check.requiredNumber !== null && space.number !== check.requiredNumber) {
    return `点数不匹配：需要 ${check.requiredNumber}，该格是 ${space.number}`
  }
  if (!isAdjacentToAny(check.to, new Set(Object.keys(player.estate)))) {
    return '新板块必须与至少一枚已放置板块相邻'
  }

  if (tile.color === 'building') {
    const caps = capabilitiesOf(player)
    if (!caps.ignoreBuildingLimitPerCity) {
      const region = regionsOf(board).find((r) => r.regionId === space.regionId)
      for (const regionSpace of region?.spaces ?? []) {
        const placed = player.estate[axialKey(regionSpace)]
        if (placed !== undefined && placed.color === 'building' && placed.building === tile.building) {
          return `同一个城市里已经有${tile.building}了`
        }
      }
    }
  }

  return undefined
}

// ---------------------------------------------------------------------------
// 合法行动
// ---------------------------------------------------------------------------

export function listLegalMoves(config: RulesetConfig, state: GameState): Move[] {
  if (state.finished) return []
  const pending = currentPending(state)
  const player = currentPlayer(state)
  if (pending !== undefined) return pendingLegalMoves(config, state, player, pending)
  return actionMoves(config, state, player)
}

/** 某个待处理选择当前有哪些解法。恒不为空（apply 层在压入前会先确认，见 canResolvePending）。 */
export function pendingLegalMoves(
  config: RulesetConfig,
  state: GameState,
  player: PlayerState,
  pending: PendingChoice,
): Move[] {
  const moves: Move[] = []

  switch (pending.kind) {
    case 'shipGoodsSpace': {
      // 即使货物格是空的也允许选（拿不到东西而已）；否则所有格子都空时会卡死
      for (const space of DIE_VALUES) {
        if (pending.exclude.includes(space)) continue
        moves.push({ kind: 'resolveShipGoodsSpace', space })
      }
      return moves
    }
    case 'shipGoodsSecondSpace': {
      for (const space of goodsSpaceNeighbours(pending.firstSpace)) {
        moves.push({ kind: 'resolveShipGoodsSecondSpace', space })
      }
      return moves
    }
    case 'warehouseSellGoods': {
      for (const goods of DIE_VALUES) {
        if ((player.goods[String(goods)] ?? 0) > 0) {
          moves.push({ kind: 'resolveWarehouseSellGoods', goods })
        }
      }
      return moves
    }
    case 'takeTileFromAnyDepot': {
      const needsDiscard = player.storage.length >= STORAGE_CAPACITY
      for (const slot of activeSlots(config.gameBoard, state.playerCount)) {
        if (!pending.colors.includes(slot.color)) continue
        if ((state.depotSlots[slot.id] ?? null) === null) continue
        if (needsDiscard) {
          for (let i = 0; i < player.storage.length; i += 1) {
            moves.push({ kind: 'resolveTakeTileFromAnyDepot', slotId: slot.id, discardStorageIndex: i })
          }
        } else {
          moves.push({ kind: 'resolveTakeTileFromAnyDepot', slotId: slot.id })
        }
      }
      return moves
    }
    case 'cityHallPlace': {
      const board = config.playerBoards[player.boardId]
      if (board === undefined) return moves
      for (let storageIndex = 0; storageIndex < player.storage.length; storageIndex += 1) {
        for (const space of board.spaces) {
          const to = { q: space.q, r: space.r }
          const problem = placementProblem(config, state, player, {
            storageIndex,
            to,
            ignoreColor: true,
            requiredNumber: pending.requiredNumber,
          })
          if (problem !== undefined) continue
          moves.push({ kind: 'resolveCityHallPlace', storageIndex, to })
        }
      }
      return moves
    }
  }
}

/** 这个待处理选择在当前局面下是否至少有一个解法（用于判断效果是否作废）。 */
export function canResolvePending(
  config: RulesetConfig,
  state: GameState,
  pending: PendingChoice,
): boolean {
  const candidate: GameState = { ...state, pending: [pending] }
  return pendingLegalMoves(config, candidate, currentPlayer(candidate), pending).length > 0
}

function actionMoves(config: RulesetConfig, state: GameState, player: PlayerState): Move[] {
  const moves: Move[] = []
  const caps = capabilitiesOf(player)
  const canUseRealDice = state.actionsTakenThisTurn < ACTIONS_PER_TURN

  const dieRefs: DieRef[] = []
  if (canUseRealDice) {
    ;(state.dice[player.id] ?? []).forEach((die, index) => {
      if (die.used) return
      if (index === 0 || index === 1) dieRefs.push({ kind: 'die', index })
    })
  }
  if (state.pendingExtraActions > 0) dieRefs.push({ kind: 'virtual' })

  const needsDiscard = player.storage.length >= STORAGE_CAPACITY
  const discardChoices: ReadonlyArray<number | undefined> = needsDiscard
    ? player.storage.map((_, index) => index)
    : [undefined]

  const board = config.playerBoards[player.boardId]

  for (const die of dieRefs) {
    // --- ① 从版图取板块 ---
    for (const value of optionValues(state, player, die, caps.freeDieAdjustOnTake)) {
      for (const slot of activeSlotsFor(config.gameBoard, value, state.playerCount)) {
        if ((state.depotSlots[slot.id] ?? null) === null) continue
        for (const discardStorageIndex of discardChoices) {
          moves.push(
            discardStorageIndex === undefined
              ? { kind: 'takeTile', die, slotId: slot.id }
              : { kind: 'takeTile', die, slotId: slot.id, discardStorageIndex },
          )
        }
      }
    }

    // --- ② 取 2 个工人（点数无意义） ---
    moves.push({ kind: 'takeWorkers', die })

    // --- ③ 卖货物（点数决定卖哪一色） ---
    for (const value of optionValues(state, player, die, false)) {
      if ((player.goods[String(value)] ?? 0) > 0) {
        moves.push({ kind: 'sellGoods', die, goods: value })
      }
    }

    // --- ④ 把仓储里的板块放进领地 ---
    if (board !== undefined) {
      for (let storageIndex = 0; storageIndex < player.storage.length; storageIndex += 1) {
        const tile = player.storage[storageIndex]
        if (tile === undefined) continue
        const values = optionValues(state, player, die, caps.freeDieAdjustColors.has(tile.color))
        for (const space of board.spaces) {
          if (!values.has(space.number)) continue
          const to = { q: space.q, r: space.r }
          const problem = placementProblem(config, state, player, {
            storageIndex,
            to,
            ignoreColor: false,
            requiredNumber: space.number,
          })
          if (problem !== undefined) continue
          moves.push({ kind: 'placeTile', die, storageIndex, to })
        }
      }
    }
  }

  // --- 自由行动：从黑洞买一枚（6 号知识板块后可从全部 7 个仓库买） ---
  if (!state.purchasedThisTurn && player.silverlings >= 2) {
    const sources: BuySource[] = state.blackDepot.map((tile) => ({
      kind: 'black',
      tileId: tile.id,
    }))
    if (caps.buyFromAllDepots) {
      for (const slot of activeSlots(config.gameBoard, state.playerCount)) {
        if ((state.depotSlots[slot.id] ?? null) === null) continue
        sources.push({ kind: 'depot', slotId: slot.id })
      }
    }
    for (const source of sources) {
      for (const discardStorageIndex of discardChoices) {
        moves.push(
          discardStorageIndex === undefined
            ? { kind: 'buyTile', source }
            : { kind: 'buyTile', source, discardStorageIndex },
        )
      }
    }
  }

  // --- 结束回合（必须已经在待处理选择上清空，见 apply 层） ---
  if (state.actionsTakenThisTurn >= ACTIONS_PER_TURN && state.pendingExtraActions === 0) {
    moves.push({ kind: 'endTurn' })
  }

  return moves
}

/** 玩家货物仓储里不同颜色的数量（不应超过 GOODS_STORAGE_TYPES）。 */
export function distinctGoodsKinds(player: PlayerState): number {
  return Object.entries(player.goods).filter(([, count]) => count > 0).length
}

export { GOODS_STORAGE_TYPES }
