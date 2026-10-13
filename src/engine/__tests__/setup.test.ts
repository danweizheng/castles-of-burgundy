import { describe, expect, it } from 'vitest'
import { activeSlots } from '../gameBoard'
import { DEFAULT_RULESET } from '../config'
import { boardIndexOf } from '../board'
import { axialKey } from '../hex'
import { ROUNDS_PER_PHASE, TOTAL_PHASES } from '../data/scoring'
import {
  GOODS_PER_PLAYER,
  GOODS_PILE_SIZE,
  GOODS_TOTAL,
  STARTING_SILVERLINGS,
  WORKERS_BY_TURN_ORDER,
  advanceTurn,
  countAllTiles,
  createGame,
  setupPhase,
} from '../setup'
import { currentRoundGoods, playerById, type GameState } from '../state'
import {
  OFFICIAL_BLACK_TILE_INVENTORY,
  OFFICIAL_TILE_INVENTORY,
  totalTilesOf,
} from '../tiles'
import type { GoodsKind } from '../types'

const CONFIG = DEFAULT_RULESET
const TOTAL_TILE_COUNT =
  totalTilesOf(OFFICIAL_TILE_INVENTORY) + totalTilesOf(OFFICIAL_BLACK_TILE_INVENTORY)

function sumGoods(goods: Readonly<Record<string, number>>): number {
  return Object.values(goods).reduce((a, b) => a + b, 0)
}

function allTileIds(state: GameState): string[] {
  const ids: string[] = []
  for (const tiles of Object.values(state.supply)) ids.push(...tiles.map((t) => t.id))
  for (const tile of Object.values(state.depotSlots)) if (tile !== null) ids.push(tile.id)
  ids.push(...state.blackDepot.map((t) => t.id))
  ids.push(...state.blackSupply.map((t) => t.id))
  ids.push(...state.removedFromGame.map((t) => t.id))
  for (const player of state.players) {
    ids.push(...Object.values(player.estate).map((t) => t.id))
    ids.push(...player.storage.map((t) => t.id))
  }
  return ids
}

describe('开局设置', () => {
  const state = createGame(CONFIG, { seed: 20240101 })

  it('两位玩家、起始城堡已放在版图的起始格上', () => {
    expect(state.players).toHaveLength(2)
    expect(state.finished).toBe(false)
    expect(state.phaseIndex).toBe(0)
    expect(state.roundIndex).toBe(0)

    for (const player of state.players) {
      const board = CONFIG.playerBoards[player.boardId]
      expect(board).toBeDefined()
      const startKey = axialKey(board!.startingSpace)
      // 开局领地只有起始城堡那一格
      expect(Object.keys(player.estate)).toEqual([startKey])
      const castle = player.estate[startKey]
      expect(castle?.color).toBe('castle')
      // 官方：起始城堡格是深绿中央格，点数为 6
      expect(boardIndexOf(board!).get(startKey)?.number).toBe(6)
    }
  })

  it('起始工人按顺位 1/2 发放（2 人局）', () => {
    const first = playerById(state, state.turnOrder[0]!)
    const second = playerById(state, state.turnOrder[1]!)
    expect(first.workers).toBe(WORKERS_BY_TURN_ORDER[0])
    expect(second.workers).toBe(WORKERS_BY_TURN_ORDER[1])
  })

  it('每人起始 1 银币、0 分、无奖励板块、仓储为空', () => {
    for (const player of state.players) {
      expect(player.silverlings).toBe(STARTING_SILVERLINGS)
      expect(player.vp).toBe(0)
      expect(player.storage).toEqual([])
      expect(player.bonusTiles).toEqual({})
      expect(player.soldGoods).toEqual({})
    }
  })

  it('货物：每人 3 枚，每个阶段一堆 5 枚，共 42 枚中 11 枚本局不用', () => {
    expect(state.phaseGoodsPiles).toHaveLength(TOTAL_PHASES)
    let pileTotal = 0
    for (const pile of state.phaseGoodsPiles) {
      expect(pile).toHaveLength(GOODS_PILE_SIZE)
      pileTotal += pile.length
    }
    expect(pileTotal).toBe(TOTAL_PHASES * GOODS_PILE_SIZE)

    let playerTotal = 0
    for (const player of state.players) {
      expect(sumGoods(player.goods)).toBe(GOODS_PER_PLAYER)
      playerTotal += sumGoods(player.goods)
    }
    // 42 = 25（阶段堆）+ 6（玩家手上）+ 11（本局不用）
    expect(pileTotal + playerTotal + 11).toBe(GOODS_TOTAL)
  })

  it('编号仓库按启用格位的印色铺满，且每格颜色与格位一致', () => {
    const slots = activeSlots(CONFIG.gameBoard, 2)
    // 官方：2 人局启用 12 个格位
    expect(slots).toHaveLength(12)
    expect(Object.keys(state.depotSlots)).toHaveLength(12)

    for (const slot of slots) {
      const tile = state.depotSlots[slot.id]
      expect(tile).toBeDefined()
      expect(tile?.color).toBe(slot.color)
    }
  })

  it('黑洞按人数抽取（2 人局为占位值 2 枚）', () => {
    expect(state.blackDepot).toHaveLength(
      CONFIG.gameBoard.blackDepotDrawByPlayerCount[2],
    )
  })

  it('板块守恒：所有位置的板块加起来等于两张库存表之和，且 id 不重复', () => {
    expect(countAllTiles(state)).toBe(TOTAL_TILE_COUNT)

    const ids = allTileIds(state)
    expect(ids).toHaveLength(TOTAL_TILE_COUNT)
    expect(new Set(ids).size).toBe(TOTAL_TILE_COUNT)
  })

  it('每人掷 2 颗骰子且都还没用', () => {
    for (const player of state.players) {
      const dice = state.dice[player.id]
      expect(dice).toHaveLength(2)
      for (const die of dice!) {
        expect(die.value).toBeGreaterThanOrEqual(1)
        expect(die.value).toBeLessThanOrEqual(6)
        expect(die.used).toBe(false)
      }
    }
  })

  it('白骰把本轮货物放到对应编号的货物格上', () => {
    expect(state.whiteDie).toBeGreaterThanOrEqual(1)
    expect(state.whiteDie).toBeLessThanOrEqual(6)

    const thisRound = currentRoundGoods(state)
    expect(thisRound).toBeDefined()

    const placed: GoodsKind[] = []
    for (const goods of Object.values(state.goodsSpaces)) placed.push(...goods)
    expect(placed).toEqual([thisRound])
    expect(state.goodsSpaces[String(state.whiteDie)]).toEqual([thisRound])
  })

  it('先手就是顺位轨队首，且由他先行动', () => {
    expect(state.turnOrder).toHaveLength(2)
    expect(state.startPlayerId).toBe(state.turnOrder[0])
    expect(state.activePlayerId).toBe(state.startPlayerId)
    expect(state.turnIndex).toBe(0)
  })
})

describe('可复现性（存档、回放、AI 克隆的前提）', () => {
  it('同一颗种子产生完全相同的对局状态', () => {
    const a = createGame(CONFIG, { seed: 777 })
    const b = createGame(CONFIG, { seed: 777 })
    expect(JSON.stringify(b)).toBe(JSON.stringify(a))
  })

  it('不同种子产生不同状态', () => {
    const a = createGame(CONFIG, { seed: 1 })
    const b = createGame(CONFIG, { seed: 2 })
    expect(JSON.stringify(b)).not.toBe(JSON.stringify(a))
  })

  it('状态是纯数据：JSON 往返后完全一致（GameState 必须可序列化）', () => {
    const state = createGame(CONFIG, { seed: 4242 })
    const roundTripped = JSON.parse(JSON.stringify(state)) as GameState
    expect(roundTripped).toEqual(state)
  })
})

describe('阶段推进与回合推进', () => {
  it('两位玩家各行动一次 = 一轮；两位玩家各 25 轮后游戏结束', () => {
    let state = createGame(CONFIG, { seed: 99 })
    let turns = 0
    while (!state.finished && turns < 500) {
      state = advanceTurn(state, CONFIG)
      turns += 1
    }
    expect(state.finished).toBe(true)
    // 5 阶段 × 5 轮 × 2 人 = 50 个回合
    expect(turns).toBe(TOTAL_PHASES * ROUNDS_PER_PHASE * 2)
    expect(state.phaseIndex).toBe(TOTAL_PHASES - 1)
    expect(state.roundIndex).toBe(ROUNDS_PER_PHASE - 1)
  })

  it('每轮结束会重新掷骰并重新铺货物格', () => {
    let state = createGame(CONFIG, { seed: 123 })
    state = advanceTurn(state, CONFIG)
    // 第一位玩家结束后，仍是同一轮，轮次不变
    expect(state.roundIndex).toBe(0)
    expect(state.activePlayerId).toBe(state.turnOrder[1])

    state = advanceTurn(state, CONFIG)
    // 两位都行动过 → 进入下一轮
    expect(state.roundIndex).toBe(1)
    expect(state.activePlayerId).toBe(state.turnOrder[0])

    const placed: GoodsKind[] = []
    for (const goods of Object.values(state.goodsSpaces)) placed.push(...goods)
    expect(placed).toHaveLength(2)
  })

  it('阶段切换时重新铺满仓库，且每次都保持板块守恒与颜色匹配', () => {
    let state = createGame(CONFIG, { seed: 55 })
    for (let i = 0; i < 10; i += 1) state = advanceTurn(state, CONFIG)
    // 10 个回合 = 5 轮 = 一整个阶段，此时已进入第 2 阶段
    expect(state.phaseIndex).toBe(1)
    expect(state.roundIndex).toBe(0)

    for (const slot of activeSlots(CONFIG.gameBoard, 2)) {
      expect(state.depotSlots[slot.id]?.color).toBe(slot.color)
    }
    expect(countAllTiles(state)).toBe(TOTAL_TILE_COUNT)
  })

  it('setupPhase 是幂等的：连做两次不会凭空多出板块', () => {
    const state = createGame(CONFIG, { seed: 8 })
    const once = setupPhase(state, CONFIG)
    const twice = setupPhase(once, CONFIG)
    expect(countAllTiles(once)).toBe(TOTAL_TILE_COUNT)
    expect(countAllTiles(twice)).toBe(TOTAL_TILE_COUNT)
    // 收回的板块重新入堆，所以两次之后仓库仍然铺满且颜色匹配
    for (const slot of activeSlots(CONFIG.gameBoard, 2)) {
      expect(twice.depotSlots[slot.id]?.color).toBe(slot.color)
    }
  })
})
