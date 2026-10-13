import { describe, expect, it } from 'vitest'
import { listLegalMoves, type Move } from '../../engine/moves'
import type { GameState } from '../../engine/state'
import {
  affordancesForDie,
  affordancesForPending,
  buyMoves,
  buyMovesFrom,
  depotNumberFromSlot,
  endTurnMove,
  placeTileMoves,
  sameDie,
  sellGoodsMove,
  slotIndexFromSlot,
  takeTileMoves,
  takeWorkersMove,
} from '../selection'
import {
  BASE_STATE,
  CONFIG,
  animalTile,
  numberAt,
  patchPlayer,
  setDice,
} from '../../engine/__tests__/testUtils'

const ACTIVE = BASE_STATE.activePlayerId

function movesFor(state: GameState): Move[] {
  return listLegalMoves(CONFIG, state)
}

describe('格位 id 解析', () => {
  it('从格位 id 取出仓库编号与序号', () => {
    expect(depotNumberFromSlot('d3s2')).toBe(3)
    expect(depotNumberFromSlot('d6s4')).toBe(6)
    expect(slotIndexFromSlot('d3s2')).toBe(2)
    expect(slotIndexFromSlot('d6s4')).toBe(4)
  })

  it('非法 id 退化为安全默认值，不抛错（界面不该因为数据脏就白屏）', () => {
    expect(depotNumberFromSlot('garbage')).toBe(1)
    expect(depotNumberFromSlot('d9s1')).toBe(1)
    expect(slotIndexFromSlot('garbage')).toBe(0)
  })
})

describe('骰子等价判断', () => {
  it('同下标相等、不同下标不等、虚拟骰子只与虚拟骰子相等', () => {
    expect(sameDie({ kind: 'die', index: 0 }, { kind: 'die', index: 0 })).toBe(true)
    expect(sameDie({ kind: 'die', index: 0 }, { kind: 'die', index: 1 })).toBe(false)
    expect(sameDie({ kind: 'virtual' }, { kind: 'virtual' })).toBe(true)
    expect(sameDie({ kind: 'virtual' }, { kind: 'die', index: 0 })).toBe(false)
  })
})

describe('从合法行动推导可点区域', () => {
  it('仓库格位高亮集合 = 该骰子能取到的格位', () => {
    let state: GameState = patchPlayer(BASE_STATE, ACTIVE, { workers: 0 })
    state = setDice(state, ACTIVE, [1, 1])
    const moves = movesFor(state)

    const affordances = affordancesForDie(moves, { kind: 'die', index: 0 })
    expect(affordances.depotSlotIds.size).toBeGreaterThan(0)

    // 高亮的每一个格位都必须真的对应一个合法 takeTile
    for (const slotId of affordances.depotSlotIds) {
      expect(takeTileMoves(moves, { kind: 'die', index: 0 }, slotId).length).toBeGreaterThan(0)
      expect(depotNumberFromSlot(slotId)).toBe(1)
    }
  })

  it('没有可用行动时返回空的 affordances（界面因此不会点亮任何东西）', () => {
    let state: GameState = patchPlayer(BASE_STATE, ACTIVE, { goods: {}, workers: 0, storage: [] })
    // 把两个骰子都标记为已用，于是这颗"骰子"什么都做不了
    state = {
      ...state,
      dice: { ...state.dice, [ACTIVE]: [{ value: 1, used: true }, { value: 1, used: true }] },
    }
    const affordances = affordancesForDie(movesFor(state), { kind: 'die', index: 0 })
    expect(affordances.depotSlotIds.size).toBe(0)
    expect(affordances.sellGoods.size).toBe(0)
    expect(affordances.placementTargets.size).toBe(0)
    expect(affordances.canTakeWorkers).toBe(false)
  })

  it('放置落点：每个落点都记录可用的仓储下标', () => {
    let state: GameState = patchPlayer(BASE_STATE, ACTIVE, {
      storage: [animalTile('a1', 'cow', 3), animalTile('a2', 'pig', 2)],
      workers: 0,
    })
    state = setDice(state, ACTIVE, [numberAt(-1, 0), 1])
    const moves = movesFor(state)
    const affordances = affordancesForDie(moves, { kind: 'die', index: 0 })

    const target = { q: -1, r: 0 }
    const indexes = affordances.placementTargets.get(`${target.q},${target.r}`)
    expect(indexes).toBeDefined()
    // 两枚动物板块都能放进同一个动物格
    expect([...indexes!].sort()).toEqual([0, 1])
    expect(placeTileMoves(moves, target).length).toBe(2)
    expect(placeTileMoves(moves, target, 0).length).toBe(1)
  })

  it('卖货高亮只包含真有货的颜色，且能找到对应的 Move', () => {
    let state: GameState = patchPlayer(BASE_STATE, ACTIVE, { goods: { 3: 2 }, workers: 0 })
    state = setDice(state, ACTIVE, [3, 6])
    const moves = movesFor(state)
    const affordances = affordancesForDie(moves, { kind: 'die', index: 0 })

    expect([...affordances.sellGoods]).toEqual([3])
    expect(sellGoodsMove(moves, { kind: 'die', index: 0 }, 3)).toBeDefined()
    expect(sellGoodsMove(moves, { kind: 'die', index: 0 }, 1)).toBeUndefined()
  })

  it('取工人永远可用，并能在两颗骰子上分别找到 Move', () => {
    const moves = movesFor(BASE_STATE)
    expect(takeWorkersMove(moves, { kind: 'die', index: 0 })).toBeDefined()
    expect(takeWorkersMove(moves, { kind: 'die', index: 1 })).toBeDefined()
    expect(takeWorkersMove(moves, { kind: 'virtual' })).toBeUndefined()
  })

  it('结束回合在还没用完两个行动时找不到 Move', () => {
    expect(endTurnMove(movesFor(BASE_STATE))).toBeUndefined()
  })

  it('购买来源可以按来源精确匹配 Move', () => {
    let state: GameState = patchPlayer(BASE_STATE, ACTIVE, { silverlings: 5 })
    state = setDice(state, ACTIVE, [3, 6])
    const moves = movesFor(state)
    const all = buyMoves(moves)
    expect(all.length).toBeGreaterThan(0)

    const black = all.find((move) => move.kind === 'buyTile' && move.source.kind === 'black')
    expect(black).toBeDefined()
    if (black === undefined || black.kind !== 'buyTile' || black.source.kind !== 'black') return

    const matched = buyMovesFrom(moves, { kind: 'black', tileId: black.source.tileId })
    expect(matched.length).toBeGreaterThan(0)
    expect(matched.every((move) => move.kind === 'buyTile')).toBe(true)
  })
})

describe('待处理选择的可点区域', () => {
  it('船只取货：6 个货物格都可选', () => {
    const moves: Move[] = [1, 2, 3, 4, 5, 6].map((space) => ({
      kind: 'resolveShipGoodsSpace',
      space: space as 1 | 2 | 3 | 4 | 5 | 6,
    }))
    expect(affordancesForPending(moves).spaces).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('仓库效果：只列出真有货的颜色', () => {
    const moves: Move[] = [
      { kind: 'resolveWarehouseSellGoods', goods: 4 },
      { kind: 'resolveWarehouseSellGoods', goods: 1 },
    ]
    expect(affordancesForPending(moves).goods).toEqual([1, 4])
  })

  it('市政厅：落点带上可用的仓储下标', () => {
    const moves: Move[] = [
      { kind: 'resolveCityHallPlace', storageIndex: 0, to: { q: 1, r: 0 } },
      { kind: 'resolveCityHallPlace', storageIndex: 2, to: { q: 1, r: 0 } },
      { kind: 'resolveCityHallPlace', storageIndex: 1, to: { q: 0, r: 1 } },
    ]
    const affordances = affordancesForPending(moves)
    expect([...(affordances.placementTargets.get('1,0') ?? [])].sort()).toEqual([0, 2])
    expect([...(affordances.placementTargets.get('0,1') ?? [])]).toEqual([1])
  })

  it('无关动作不会污染结果', () => {
    const moves: Move[] = [{ kind: 'endTurn' }]
    const affordances = affordancesForPending(moves)
    expect(affordances.spaces).toEqual([])
    expect(affordances.goods).toEqual([])
    expect(affordances.slotIds).toEqual([])
    expect(affordances.placementTargets.size).toBe(0)
  })
})
