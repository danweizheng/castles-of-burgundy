/**
 * 从合法行动推导「界面上哪些地方可以点」。
 *
 * 这是 UI 与引擎之间唯一的翻译层，也是**纯函数**：
 * 输入一份 Move 列表，输出一组集合。这样交互逻辑可以脱离 React 单测，
 * 而且"界面能点的地方"永远等于"引擎允许的地方"，不会出现点得动但引擎拒绝的情况。
 *
 * 交互模型：点选 + 高亮 + 确认，全程不做拖拽（手机上拖小六边形极易误操作）。
 */

import type { Axial } from '../engine/hex'
import { axialKey } from '../engine/hex'
import type { BuySource, DieRef, Move } from '../engine/moves'
import type { DieValue, GoodsKind } from '../engine/types'

export function sameDie(a: DieRef, b: DieRef): boolean {
  if (a.kind === 'virtual' || b.kind === 'virtual') return a.kind === b.kind
  return a.index === b.index
}

function dieOf(move: Move): DieRef | undefined {
  return 'die' in move ? move.die : undefined
}

export interface DieAffordances {
  /** 可以取牌的仓库格位 */
  readonly depotSlotIds: ReadonlySet<string>
  /** 可以卖的货物颜色 */
  readonly sellGoods: ReadonlySet<GoodsKind>
  /** 可以放置的落点：坐标键 → 可用的仓储下标列表 */
  readonly placementTargets: ReadonlyMap<string, readonly number[]>
  /** 是否可以用这颗骰子"取 2 个工人" */
  readonly canTakeWorkers: boolean
}

const EMPTY_AFFORDANCES: DieAffordances = {
  depotSlotIds: new Set(),
  sellGoods: new Set(),
  placementTargets: new Map(),
  canTakeWorkers: false,
}

/** 某颗骰子（含城堡的虚拟骰子）能做什么。 */
export function affordancesForDie(moves: readonly Move[], die: DieRef): DieAffordances {
  const depotSlotIds = new Set<string>()
  const sellGoods = new Set<GoodsKind>()
  const placementTargets = new Map<string, number[]>()
  let canTakeWorkers = false

  for (const move of moves) {
    const moveDie = dieOf(move)
    if (moveDie === undefined || !sameDie(moveDie, die)) continue

    switch (move.kind) {
      case 'takeTile':
        depotSlotIds.add(move.slotId)
        break
      case 'sellGoods':
        sellGoods.add(move.goods)
        break
      case 'placeTile': {
        const key = axialKey(move.to)
        const list = placementTargets.get(key) ?? []
        list.push(move.storageIndex)
        placementTargets.set(key, list)
        break
      }
      case 'takeWorkers':
        canTakeWorkers = true
        break
      default:
        break
    }
  }

  if (
    depotSlotIds.size === 0 &&
    sellGoods.size === 0 &&
    placementTargets.size === 0 &&
    !canTakeWorkers
  ) {
    return EMPTY_AFFORDANCES
  }

  return { depotSlotIds, sellGoods, placementTargets, canTakeWorkers }
}

/** 当前回合可以取牌的仓库编号（用于在骰子旁提示"能取哪些点数"）。 */
export function takeTileDepotNumbers(moves: readonly Move[]): ReadonlySet<DieValue> {
  const numbers = new Set<DieValue>()
  for (const move of moves) {
    if (move.kind === 'takeTile') numbers.add(depotNumberFromSlot(move.slotId))
  }
  return numbers
}

/** 格位 id 形如 'd3s2'，从中取出仓库编号。 */
export function depotNumberFromSlot(slotId: string): DieValue {
  const match = /^d(\d)s\d+$/.exec(slotId)
  const value = match?.[1] === undefined ? 1 : Number(match[1])
  return (value >= 1 && value <= 6 ? value : 1) as DieValue
}

/** 格位 id 形如 'd3s2'，从中取出序号。 */
export function slotIndexFromSlot(slotId: string): number {
  const match = /s(\d+)$/.exec(slotId)
  return match?.[1] === undefined ? 0 : Number(match[1])
}

// ---------------------------------------------------------------------------
// 具体动作查找：界面点了一下之后，要找到那一个确切的 Move 交给引擎
// ---------------------------------------------------------------------------

export function takeTileMoves(moves: readonly Move[], die: DieRef, slotId: string): Move[] {
  return moves.filter(
    (move) => move.kind === 'takeTile' && sameDie(move.die, die) && move.slotId === slotId,
  )
}

export function placeTileMoves(moves: readonly Move[], to: Axial, storageIndex?: number): Move[] {
  const key = axialKey(to)
  return moves.filter(
    (move) =>
      move.kind === 'placeTile' &&
      axialKey(move.to) === key &&
      (storageIndex === undefined || move.storageIndex === storageIndex),
  )
}

export function sellGoodsMove(moves: readonly Move[], die: DieRef, goods: GoodsKind): Move | undefined {
  return moves.find(
    (move) => move.kind === 'sellGoods' && sameDie(move.die, die) && move.goods === goods,
  )
}

export function takeWorkersMove(moves: readonly Move[], die: DieRef): Move | undefined {
  return moves.find((move) => move.kind === 'takeWorkers' && sameDie(move.die, die))
}

export function endTurnMove(moves: readonly Move[]): Move | undefined {
  return moves.find((move) => move.kind === 'endTurn')
}

export function buyMoves(moves: readonly Move[]): Move[] {
  return moves.filter((move) => move.kind === 'buyTile')
}

export function buyMovesFrom(moves: readonly Move[], source: BuySource): Move[] {
  return moves.filter(
    (move) => move.kind === 'buyTile' && move.source.tileId === source.tileId,
  )
}

/** 一个 Move 的一句话中文描述，用于确认条与日志。 */
export function describeMove(move: Move): string {
  switch (move.kind) {
    case 'takeTile':
      return `取第 ${depotNumberFromSlot(move.slotId)} 号仓库的板块`
    case 'placeTile':
      return `把仓储第 ${move.storageIndex + 1} 枚板块放到 ${move.to.q},${move.to.r}`
    case 'sellGoods':
      return `卖出 ${move.goods} 号货物`
    case 'takeWorkers':
      return '取 2 个工人'
    case 'buyTile':
      return move.source.kind === 'black' ? '从黑洞买一枚板块' : '从编号仓库买一枚板块'
    case 'workerTakeBuilding':
      return `花 2 个工人取第 ${depotNumberFromSlot(move.slotId)} 号仓库的一枚建筑`
    case 'resolveShipGoodsSpace':
      return `从第 ${move.space} 号货物格取货`
    case 'resolveShipGoodsSecondSpace':
      return `再从第 ${move.space} 号货物格取货`
    case 'resolveWarehouseSellGoods':
      return `仓库效果：卖出 ${move.goods} 号货物`
    case 'resolveTakeTileFromAnyDepot':
      return '从任意仓库取一枚板块'
    case 'resolveCityHallPlace':
      return `市政厅：把仓储第 ${move.storageIndex + 1} 枚放到 ${move.to.q},${move.to.r}`
    case 'endTurn':
      return '结束回合'
  }
}

// ---------------------------------------------------------------------------
// 待处理选择的可点区域
// ---------------------------------------------------------------------------

export interface PendingAffordances {
  /** 船只取货：可选的货物格 */
  readonly spaces: readonly DieValue[]
  /** 仓库效果：可卖的货物颜色 */
  readonly goods: readonly GoodsKind[]
  /** 木工坊 / 教堂 / 市场：可取的仓库格位 */
  readonly slotIds: readonly string[]
  /** 市政厅再放一枚：坐标键 → 可用的仓储下标 */
  readonly placementTargets: ReadonlyMap<string, readonly number[]>
}

export function affordancesForPending(moves: readonly Move[]): PendingAffordances {
  const spaces = new Set<DieValue>()
  const goods = new Set<GoodsKind>()
  const slotIds = new Set<string>()
  const placementTargets = new Map<string, number[]>()

  for (const move of moves) {
    switch (move.kind) {
      case 'resolveShipGoodsSpace':
      case 'resolveShipGoodsSecondSpace':
        spaces.add(move.space)
        break
      case 'resolveWarehouseSellGoods':
        goods.add(move.goods)
        break
      case 'resolveTakeTileFromAnyDepot':
        slotIds.add(move.slotId)
        break
      case 'resolveCityHallPlace': {
        const key = axialKey(move.to)
        const list = placementTargets.get(key) ?? []
        list.push(move.storageIndex)
        placementTargets.set(key, list)
        break
      }
      default:
        break
    }
  }

  return {
    spaces: [...spaces].sort((a, b) => a - b),
    goods: [...goods].sort((a, b) => a - b),
    slotIds: [...slotIds],
    placementTargets,
  }
}
