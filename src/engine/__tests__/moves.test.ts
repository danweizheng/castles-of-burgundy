import { describe, expect, it } from 'vitest'
import { activeSlots, activeSlotsFor } from '../gameBoard'
import { axialKey, type Axial } from '../hex'
import { listLegalMoves, pendingLegalMoves, placementProblem, type Move } from '../moves'
import { currentPlayer, playerById, type GameState } from '../state'
import { DIE_VALUES, type DieValue } from '../types'
import {
  BASE_STATE,
  BOARD,
  CONFIG,
  estateOf,
  knowledgeTile,
  numberAt,
  patchPlayer,
  setDice,
  spaceAt,
  buildingTile,
  animalTile,
} from './testUtils'

function kinds(moves: readonly Move[]): string[] {
  return [...new Set(moves.map((m) => m.kind))]
}

function takeTileDepots(moves: readonly Move[]): DieValue[] {
  const depots: DieValue[] = []
  for (const move of moves) {
    if (move.kind !== 'takeTile') continue
    const slot = activeSlots(CONFIG.gameBoard, 2).find((s) => s.id === move.slotId)
    if (slot !== undefined) depots.push(slot.depot)
  }
  return [...new Set(depots)].sort((a, b) => a - b)
}

describe('开局第一手的合法行动', () => {
  const state = BASE_STATE
  const moves = listLegalMoves(CONFIG, state)

  it('有合法行动，且只可能是四种骰子行动', () => {
    expect(moves.length).toBeGreaterThan(0)
    for (const kind of kinds(moves)) {
      expect(['takeTile', 'takeWorkers', 'sellGoods']).toContain(kind)
    }
  })

  it('仓储是空的，所以没有可放的动作；两个骰子都还没用，所以不能结束回合', () => {
    expect(kinds(moves)).not.toContain('placeTile')
    expect(kinds(moves)).not.toContain('endTurn')
  })

  it('起始只有 1 银币，买不起黑洞（官方 2 银币），所以没有购买动作', () => {
    expect(playerById(state, state.activePlayerId).silverlings).toBe(1)
    expect(kinds(moves)).not.toContain('buyTile')
  })

  it('每颗未使用的骰子都能"取 2 个工人"（点数无意义，是保底行动）', () => {
    const takeWorkers = moves.filter((m) => m.kind === 'takeWorkers')
    expect(takeWorkers).toHaveLength(2)
  })

  it('取板块的目标点数必须在骰子可达范围内，且格位上有牌', () => {
    const player = currentPlayer(state)
    const dice = state.dice[player.id] ?? []
    const reachable = new Set<number>()
    for (const die of dice) {
      reachable.add(die.value)
      // 有工人时还能 ±1（这里至少要把自身点数算进去就够做断言）
    }
    for (const move of moves) {
      if (move.kind !== 'takeTile') continue
      const slot = activeSlots(CONFIG.gameBoard, 2).find((s) => s.id === move.slotId)
      expect(slot).toBeDefined()
      expect(state.depotSlots[slot!.id]).not.toBeNull()
      // 要么点数正好等于骰子，要么是靠工人调过去的（工人够）
      expect(reachable.has(slot!.depot) || player.workers > 0).toBe(true)
    }
  })

  it('卖货只能卖手上真有的颜色', () => {
    const player = currentPlayer(state)
    for (const move of moves) {
      if (move.kind !== 'sellGoods') continue
      expect(player.goods[String(move.goods)] ?? 0).toBeGreaterThan(0)
    }
  })
})

describe('点数可达性决定可取哪些仓库', () => {
  it('0 个工人且骰子是 1 时，只能取第 1 号仓库', () => {
    let state: GameState = BASE_STATE
    const active = state.activePlayerId
    state = patchPlayer(state, active, { workers: 0 })
    state = setDice(state, active, [1, 1])

    const moves = listLegalMoves(CONFIG, state)
    expect(takeTileDepots(moves)).toEqual([1])
  })

  it('有 1 个工人时能取到相邻点数（1 也能取 6，因为点数在 1–6 之间环绕）', () => {
    let state: GameState = BASE_STATE
    const active = state.activePlayerId
    state = patchPlayer(state, active, { workers: 1 })
    state = setDice(state, active, [5, 5])

    const depots = takeTileDepots(listLegalMoves(CONFIG, state))
    // 5 可以调成 4 / 6，也可以调成 5
    expect(depots).toEqual([4, 5, 6])
  })

  it('8 号知识板块让 1 个工人可以调 ±2（含 5→1 的环绕）', () => {
    let state: GameState = BASE_STATE
    const active = state.activePlayerId
    // 把 8 号知识板块直接放进领地（能力只看已放置的板块）
    state = estateOf(state, active, [[{ q: -2, r: 0 }, knowledgeTile('k8', 8)]])
    state = patchPlayer(state, active, { workers: 1 })
    state = setDice(state, active, [5, 5])

    const depots = takeTileDepots(listLegalMoves(CONFIG, state))
    // 5 可以调成 3/4/6 以及 7→1
    expect(depots).toEqual([1, 3, 4, 5, 6])
  })
})

describe('放置合法性', () => {
  it('必须与已有板块相邻', () => {
    // 起始城堡在 (0,0)。(1,-3) 也是动物格，颜色与点数都能对上，但离起始城堡很远
    const state = patchPlayer(BASE_STATE, BASE_STATE.activePlayerId, {
      storage: [animalTile('a', 'cow', 3)],
    })
    const far = { q: 1, r: -3 }
    const problem = placementProblem(CONFIG, state, currentPlayer(state), {
      storageIndex: 0,
      to: far,
      ignoreColor: false,
      requiredNumber: numberAt(far.q, far.r),
    })
    expect(problem).toContain('相邻')
  })

  it('颜色必须匹配', () => {
    const state = patchPlayer(BASE_STATE, BASE_STATE.activePlayerId, {
      storage: [animalTile('a', 'cow', 3)],
    })
    // (1,0) 是知识格（黄色），不能放动物
    const target = { q: 1, r: 0 }
    const problem = placementProblem(CONFIG, state, currentPlayer(state), {
      storageIndex: 0,
      to: target,
      ignoreColor: false,
      requiredNumber: numberAt(1, 0),
    })
    expect(problem).toContain('颜色不匹配')
  })

  it('点数必须匹配', () => {
    const state = patchPlayer(BASE_STATE, BASE_STATE.activePlayerId, {
      storage: [animalTile('a', 'cow', 3)],
    })
    const target = { q: -1, r: 0 } // 动物格，与起始城堡相邻
    const actual = numberAt(target.q, target.r)
    const wrong = (actual === 1 ? 2 : 1) as DieValue
    const problem = placementProblem(CONFIG, state, currentPlayer(state), {
      storageIndex: 0,
      to: target,
      ignoreColor: false,
      requiredNumber: wrong,
    })
    expect(problem).toContain('点数不匹配')
  })

  it('目标格已经有板块时被拒绝', () => {
    const state = patchPlayer(BASE_STATE, BASE_STATE.activePlayerId, {
      storage: [animalTile('a', 'cow', 3)],
    })
    const start = BOARD.startingSpace
    const problem = placementProblem(CONFIG, state, currentPlayer(state), {
      storageIndex: 0,
      to: { q: start.q, r: start.r },
      ignoreColor: true,
      requiredNumber: null,
    })
    expect(problem).toContain('已经有板块')
  })

  it('同一个城市里不能有两座同种建筑（1 号知识板块可以解除）', () => {
    // 米色 5 格城市：r=-1 上 q=-2..2
    const seedAt = { q: -2, r: -1 }
    const target = { q: -1, r: -1 }

    let state: GameState = estateOf(BASE_STATE, BASE_STATE.activePlayerId, [
      [seedAt, buildingTile('seed-w', 'warehouse')],
    ])
    state = patchPlayer(state, BASE_STATE.activePlayerId, {
      storage: [buildingTile('new-w', 'warehouse')],
    })

    const blocked = placementProblem(CONFIG, state, currentPlayer(state), {
      storageIndex: 0,
      to: target,
      ignoreColor: false,
      requiredNumber: numberAt(target.q, target.r),
    })
    expect(blocked).toContain('同一个城市')

    // 放上 1 号知识板块后解除限制
    const relieved = estateOf(state, BASE_STATE.activePlayerId, [
      [{ q: -2, r: 0 }, knowledgeTile('k1', 1)],
    ])
    const allowed = placementProblem(CONFIG, relieved, currentPlayer(relieved), {
      storageIndex: 0,
      to: target,
      ignoreColor: false,
      requiredNumber: numberAt(target.q, target.r),
    })
    expect(allowed).toBeUndefined()
  })

  it('同一个城市里的**不同**建筑种类是允许的', () => {
    let state: GameState = estateOf(BASE_STATE, BASE_STATE.activePlayerId, [
      [{ q: -2, r: -1 }, buildingTile('seed-w', 'warehouse')],
    ])
    state = patchPlayer(state, BASE_STATE.activePlayerId, {
      storage: [buildingTile('new-b', 'bank')],
    })
    const target = { q: -1, r: -1 }
    const problem = placementProblem(CONFIG, state, currentPlayer(state), {
      storageIndex: 0,
      to: target,
      ignoreColor: false,
      requiredNumber: numberAt(target.q, target.r),
    })
    expect(problem).toBeUndefined()
  })
})

describe('回合结束是显式动作', () => {
  it('还没用完两个骰子时不能结束回合', () => {
    expect(kinds(listLegalMoves(CONFIG, BASE_STATE))).not.toContain('endTurn')
  })

  it('用完两个骰子之后才能结束回合', () => {
    let state: GameState = BASE_STATE
    const active = state.activePlayerId
    state = {
      ...state,
      actionsTakenThisTurn: 2,
      dice: {
        ...state.dice,
        [active]: (state.dice[active] ?? []).map((die) => ({ ...die, used: true })),
      },
    }
    expect(kinds(listLegalMoves(CONFIG, state))).toContain('endTurn')
  })

  it('还有城堡额外行动时不能结束回合', () => {
    let state: GameState = BASE_STATE
    const active = state.activePlayerId
    state = {
      ...state,
      actionsTakenThisTurn: 2,
      pendingExtraActions: 1,
      dice: {
        ...state.dice,
        [active]: (state.dice[active] ?? []).map((die) => ({ ...die, used: true })),
      },
    }
    const moves = listLegalMoves(CONFIG, state)
    expect(kinds(moves)).not.toContain('endTurn')
    // 只剩虚拟骰子可用
    for (const move of moves) {
      if ('die' in move) expect(move.die.kind).toBe('virtual')
    }
  })

  it('仓储满时必须带一个弃牌选择，否则不能取板块', () => {
    let state: GameState = BASE_STATE
    const active = state.activePlayerId
    state = patchPlayer(state, active, {
      storage: [animalTile('s1', 'cow', 2), animalTile('s2', 'pig', 2), animalTile('s3', 'sheep', 2)],
      workers: 3,
    })
    state = setDice(state, active, [1, 1])

    const takeTiles = listLegalMoves(CONFIG, state).filter((m) => m.kind === 'takeTile')
    expect(takeTiles.length).toBeGreaterThan(0)
    for (const move of takeTiles) {
      if (move.kind !== 'takeTile') continue
      expect(move.discardStorageIndex).toBeDefined()
      expect(move.discardStorageIndex).toBeLessThan(3)
    }
  })
})

describe('购买（自由行动）', () => {
  it('有 2 银币且本回合没买过时才能买', () => {
    let state: GameState = BASE_STATE
    const active = state.activePlayerId
    state = patchPlayer(state, active, { silverlings: 2 })
    expect(kinds(listLegalMoves(CONFIG, state))).toContain('buyTile')

    const bought = { ...state, purchasedThisTurn: true }
    expect(kinds(listLegalMoves(CONFIG, bought))).not.toContain('buyTile')
  })

  it('没有 6 号知识板块时，只能从黑洞买', () => {
    let state: GameState = BASE_STATE
    const active = state.activePlayerId
    state = patchPlayer(state, active, { silverlings: 2 })
    for (const move of listLegalMoves(CONFIG, state)) {
      if (move.kind !== 'buyTile') continue
      expect(move.source.kind).toBe('black')
    }
  })

  it('6 号知识板块（Special Edition）：每回合限一次，花 2 个工人从任意编号仓库取一枚米色建筑', () => {
    let state: GameState = BASE_STATE
    const active = state.activePlayerId
    state = estateOf(state, active, [[{ q: -2, r: 0 }, knowledgeTile('k6', 6)]])
    state = patchPlayer(state, active, { workers: 3 })
    state = setDice(state, active, [1, 1])

    const takes = listLegalMoves(CONFIG, state).filter((m) => m.kind === 'workerTakeBuilding')
    expect(takes.length).toBeGreaterThan(0)
    for (const move of takes) {
      if (move.kind !== 'workerTakeBuilding') continue
      const slot = activeSlots(CONFIG.gameBoard, 2).find((s) => s.id === move.slotId)
      // 只能取米色建筑格位
      expect(slot?.color).toBe('building')
    }

    // 工人不足 2 枚时没有这个行动
    const poor = patchPlayer(state, active, { workers: 1 })
    expect(listLegalMoves(CONFIG, poor).some((m) => m.kind === 'workerTakeBuilding')).toBe(false)

    // 没有这张板块时也没有这个行动
    const without = patchPlayer(BASE_STATE, active, { workers: 3 })
    expect(listLegalMoves(CONFIG, without).some((m) => m.kind === 'workerTakeBuilding')).toBe(false)
  })
})

describe('待处理选择的解法', () => {
  it('船只的货物格选择：6 个货物格都可选（空的也能选，否则全空时会卡死）', () => {
    const state: GameState = { ...BASE_STATE, pending: [{ kind: 'shipGoodsSpace', exclude: [] }] }
    const moves = pendingLegalMoves(CONFIG, state, currentPlayer(state), {
      kind: 'shipGoodsSpace',
      exclude: [],
    })
    expect(moves).toHaveLength(6)
    expect(moves.map((m) => (m.kind === 'resolveShipGoodsSpace' ? m.space : 0))).toEqual([
      1, 2, 3, 4, 5, 6,
    ])
  })

  it('5 号知识板块的第二格只能是第一格的相邻格', () => {
    const state: GameState = {
      ...BASE_STATE,
      pending: [{ kind: 'shipGoodsSecondSpace', firstSpace: 3 }],
    }
    const moves = pendingLegalMoves(CONFIG, state, currentPlayer(state), {
      kind: 'shipGoodsSecondSpace',
      firstSpace: 3,
    })
    expect(moves.map((m) => (m.kind === 'resolveShipGoodsSecondSpace' ? m.space : 0))).toEqual([
      2, 4,
    ])
  })

  it('仓库效果只提供手上真有的货物颜色', () => {
    let state: GameState = BASE_STATE
    const active = state.activePlayerId
    state = patchPlayer(state, active, { goods: { 2: 3 } })
    const moves = pendingLegalMoves(CONFIG, { ...state, pending: [{ kind: 'warehouseSellGoods' }] }, currentPlayer(state), {
      kind: 'warehouseSellGoods',
    })
    expect(moves.map((m) => (m.kind === 'resolveWarehouseSellGoods' ? m.goods : 0))).toEqual([2])
  })

  it('市政厅的额外放置：忽略颜色，但仍受点数与相邻限制', () => {
    let state: GameState = estateOf(BASE_STATE, BASE_STATE.activePlayerId, [
      [{ q: -2, r: -1 }, buildingTile('seed-w', 'warehouse')],
    ])
    state = patchPlayer(state, BASE_STATE.activePlayerId, {
      // 一枚动物板块，正常放不到米色城市里；市政厅允许忽略颜色
      storage: [animalTile('a', 'cow', 3)],
    })
    const target = { q: -1, r: -1 }
    const pending = { kind: 'cityHallPlace' as const, requiredNumber: numberAt(target.q, target.r) }

    const moves = pendingLegalMoves(CONFIG, state, currentPlayer(state), pending)
    const spots = moves
      .filter((m) => m.kind === 'resolveCityHallPlace')
      .map((m) => (m.kind === 'resolveCityHallPlace' ? axialKey(m.to) : ''))
    expect(spots).toContain(axialKey(target))
    // 颜色被忽略：这枚动物板块确实出现在可选列表里
    expect(moves.length).toBeGreaterThan(0)
  })

  it('市政厅若保留点数限制，点数不符的格子不在解里', () => {
    let state: GameState = estateOf(BASE_STATE, BASE_STATE.activePlayerId, [
      [{ q: -2, r: -1 }, buildingTile('seed-w', 'warehouse')],
    ])
    state = patchPlayer(state, BASE_STATE.activePlayerId, {
      storage: [animalTile('a', 'cow', 3)],
    })
    const target = { q: -1, r: -1 }
    const wrongNumber = (numberAt(target.q, target.r) === 1 ? 2 : 1) as DieValue
    const moves = pendingLegalMoves(CONFIG, state, currentPlayer(state), {
      kind: 'cityHallPlace',
      requiredNumber: wrongNumber,
    })
    const spots = moves
      .filter((m) => m.kind === 'resolveCityHallPlace')
      .map((m) => (m.kind === 'resolveCityHallPlace' ? axialKey(m.to) : ''))
    expect(spots).not.toContain(axialKey(target))
  })
})

describe('仓库格位与合成版图的一致性', () => {
  it('2 人局启用 12 个格位，每个编号仓库都有牌可抽', () => {
    expect(activeSlots(CONFIG.gameBoard, 2)).toHaveLength(12)
    for (const depot of DIE_VALUES) {
      expect(activeSlotsFor(CONFIG.gameBoard, depot, 2).length).toBeGreaterThan(0)
    }
  })

  it('合成版图上起始城堡的六个邻居都在版图内（第一手必须放得下去）', () => {
    for (const to of [
      { q: 1, r: 0 },
      { q: 1, r: -1 },
      { q: 0, r: -1 },
      { q: -1, r: 0 },
      { q: -1, r: 1 },
      { q: 0, r: 1 },
    ] as Axial[]) {
      expect(() => spaceAt(to.q, to.r)).not.toThrow()
    }
  })
})
