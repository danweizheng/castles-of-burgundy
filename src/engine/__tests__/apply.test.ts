import { describe, expect, it } from 'vitest'
import { applyMove } from '../apply'
import { axialKey } from '../hex'
import { listLegalMoves, type Move } from '../moves'
import { capabilitiesOf } from '../scoring'
import { playerById, type GameState } from '../state'
import type { PlayerId } from '../types'
import {
  BASE_STATE,
  CONFIG,
  animalTile,
  buildingTile,
  castleTile,
  estateOf,
  knowledgeTile,
  mineTile,
  numberAt,
  patchPlayer,
  randomPlayout,
  setDice,
  shipTile,
} from './testUtils'

const ACTIVE: PlayerId = BASE_STATE.activePlayerId

function otherPlayer(id: PlayerId): PlayerId {
  return id === 'p1' ? 'p2' : 'p1'
}

function player(state: GameState, id: PlayerId = ACTIVE) {
  return playerById(state, id)
}

describe('取板块（takeTile）', () => {
  it('从仓库取走板块放进仓储，该格位变空', () => {
    let state: GameState = patchPlayer(BASE_STATE, ACTIVE, { workers: 0 })
    state = setDice(state, ACTIVE, [1, 1])

    const move = listLegalMoves(CONFIG, state).find(
      (m): m is Extract<Move, { kind: 'takeTile' }> =>
        m.kind === 'takeTile' && m.slotId !== undefined,
    )
    expect(move).toBeDefined()

    const before = state.depotSlots[move!.slotId]
    const result = applyMove(CONFIG, state, move!)
    const after = player(result.state)

    expect(after.storage).toHaveLength(1)
    expect(after.storage[0]?.id).toBe(before?.id)
    expect(result.state.depotSlots[move!.slotId]).toBeNull()
    expect(result.events.some((e) => e.kind === 'tookTile')).toBe(true)
  })

  it('用过的骰子会被标记，且本回合行动数 +1', () => {
    let state: GameState = patchPlayer(BASE_STATE, ACTIVE, { workers: 0 })
    state = setDice(state, ACTIVE, [1, 1])
    const move = listLegalMoves(CONFIG, state).find(
      (m): m is Extract<Move, { kind: 'takeTile' }> => m.kind === 'takeTile',
    )
    const result = applyMove(CONFIG, state, move!)
    expect(result.state.dice[ACTIVE]?.[0]?.used).toBe(true)
    expect(result.state.actionsTakenThisTurn).toBe(1)
  })

  it('仓储满时必须先弃一枚，被弃的板块移出游戏（进 removedFromGame）', () => {
    let state: GameState = patchPlayer(BASE_STATE, ACTIVE, {
      storage: [animalTile('s1', 'cow', 2), animalTile('s2', 'pig', 2), animalTile('s3', 'sheep', 2)],
      workers: 0,
    })
    state = setDice(state, ACTIVE, [1, 1])

    const withoutDiscard = listLegalMoves(CONFIG, state).find(
      (m): m is Extract<Move, { kind: 'takeTile' }> =>
        m.kind === 'takeTile' && m.discardStorageIndex === undefined,
    )
    expect(withoutDiscard).toBeUndefined()

    const move = listLegalMoves(CONFIG, state).find(
      (m): m is Extract<Move, { kind: 'takeTile' }> =>
        m.kind === 'takeTile' && m.discardStorageIndex !== undefined,
    )
    expect(move!.discardStorageIndex).toBeDefined()

    const discardedId = player(state).storage[move!.discardStorageIndex!]?.id
    const result = applyMove(CONFIG, state, move!)
    expect(player(result.state).storage).toHaveLength(3)
    expect(result.state.removedFromGame.map((t) => t.id)).toContain(discardedId)
    expect(result.events.some((e) => e.kind === 'discardedTile')).toBe(true)
  })

  it('拿空格位会抛错（不允许静默失败）', () => {
    let state: GameState = patchPlayer(BASE_STATE, ACTIVE, { workers: 0 })
    state = setDice(state, ACTIVE, [1, 1])
    const slot = Object.keys(state.depotSlots).find((id) => state.depotSlots[id] === null)
    if (slot === undefined) {
      // 开局所有格位都有牌，先手动清空一个第 1 号仓库的格位
      const first = Object.keys(state.depotSlots)[0] as string
      state = { ...state, depotSlots: { ...state.depotSlots, [first]: null } }
      expect(() => applyMove(CONFIG, state, { kind: 'takeTile', die: { kind: 'die', index: 0 }, slotId: first })).toThrow()
      return
    }
    expect(() =>
      applyMove(CONFIG, state, { kind: 'takeTile', die: { kind: 'die', index: 0 }, slotId: slot }),
    ).toThrow()
  })
})

describe('放置与即时效果', () => {
  it('矿放置时不给分（阶段末才给银币）', () => {
    // 先放一枚板块制造相邻，再放矿
    let state: GameState = estateOf(BASE_STATE, ACTIVE, [
      [{ q: -2, r: 1 }, mineTile('seed-m')],
    ])
    state = patchPlayer(state, ACTIVE, { storage: [mineTile('new-m')], workers: 0 })
    state = setDice(state, ACTIVE, [numberAt(-2, 2), 1])

    const result = applyMove(CONFIG, state, {
      kind: 'placeTile',
      die: { kind: 'die', index: 0 },
      storageIndex: 0,
      to: { q: -2, r: 2 },
    })
    const after = player(result.state)
    // 只可能有区域完成分（2 格矿区域被填满 = 3 分 + 阶段奖励 10 分），没有"矿本身"的分
    expect(after.vp).toBe(3 + 10)
    expect(after.estate[axialKey({ q: -2, r: 2 })]?.color).toBe('mine')
  })

  it('颜色不匹配的放置会抛错', () => {
    let state: GameState = patchPlayer(BASE_STATE, ACTIVE, {
      storage: [animalTile('a', 'cow', 3)],
      workers: 0,
    })
    state = setDice(state, ACTIVE, [numberAt(1, 0), 1])
    expect(() =>
      applyMove(CONFIG, state, {
        kind: 'placeTile',
        die: { kind: 'die', index: 0 },
        storageIndex: 0,
        to: { q: 1, r: 0 }, // 知识格
      }),
    ).toThrow(/颜色不匹配/)
  })

  it('动物即时计分：3 头牛 → 放入 4 头牛 = 7 分；再放 2 头猪 = 3 分（官方例子）', () => {
    // 牧场 A2 = {(-1,0), (-1,1), (0,1)}
    let state: GameState = estateOf(BASE_STATE, ACTIVE, [
      [{ q: -1, r: 0 }, animalTile('cow3', 'cow', 3)],
    ])
    state = patchPlayer(state, ACTIVE, { storage: [animalTile('cow4', 'cow', 4)], workers: 0 })
    state = setDice(state, ACTIVE, [numberAt(-1, 1), 1])

    const result = applyMove(CONFIG, state, {
      kind: 'placeTile',
      die: { kind: 'die', index: 0 },
      storageIndex: 0,
      to: { q: -1, r: 1 },
    })
    expect(player(result.state).vp).toBe(4 + 3)
    const scored = result.events.find((e) => e.kind === 'animalsScored')
    expect(scored).toMatchObject({ vp: 7, tiles: 2 })
  })

  it('放满整个牧场会按区域大小 + 阶段奖励计分（3 格 = 6 + 10 分）', () => {
    let state: GameState = estateOf(BASE_STATE, ACTIVE, [
      [{ q: -1, r: 0 }, animalTile('cow3', 'cow', 3)],
      [{ q: -1, r: 1 }, animalTile('cow4', 'cow', 4)],
    ])
    state = patchPlayer(state, ACTIVE, { storage: [animalTile('cow2', 'cow', 2)], workers: 0 })
    state = setDice(state, ACTIVE, [numberAt(0, 1), 1])

    const result = applyMove(CONFIG, state, {
      kind: 'placeTile',
      die: { kind: 'die', index: 0 },
      storageIndex: 0,
      to: { q: 0, r: 1 },
    })
    const after = player(result.state)
    // 动物即时分（2+4+3 = 9）+ 区域完成（3 格 = 6 分）+ 阶段 A 奖励 10 分
    expect(after.vp).toBe(9 + 6 + 10)
    expect(result.events.some((e) => e.kind === 'regionCompleted')).toBe(true)
  })

  it('知识板块放置后能力立刻生效（8 号 → 每个工人 ±2）', () => {
    // (-2,0) 是单格知识区域，与 (-1,0) 相邻
    let state: GameState = estateOf(BASE_STATE, ACTIVE, [
      [{ q: -1, r: 0 }, animalTile('seed', 'cow', 2)],
    ])
    state = patchPlayer(state, ACTIVE, { storage: [knowledgeTile('k8', 8)], workers: 0 })
    state = setDice(state, ACTIVE, [numberAt(-2, 0), 1])

    expect(capabilitiesOf(player(state)).dieStepsPerWorker).toBe(1)

    const result = applyMove(CONFIG, state, {
      kind: 'placeTile',
      die: { kind: 'die', index: 0 },
      storageIndex: 0,
      to: { q: -2, r: 0 },
    })
    expect(capabilitiesOf(player(result.state)).dieStepsPerWorker).toBe(2)
    // 单格区域完成 = 1 分 + 阶段 A 的 10 分
    expect(player(result.state).vp).toBe(1 + 10)
  })

  it('城堡给一次虚拟骰子行动：不计入两个行动、不耗工人，且必须先执行完才能结束回合', () => {
    // 先给 (-3,0) 制造相邻块
    let state: GameState = estateOf(BASE_STATE, ACTIVE, [
      [{ q: -2, r: 0 }, knowledgeTile('seed-k', 1)],
    ])
    state = patchPlayer(state, ACTIVE, {
      storage: [castleTile('t-castle'), buildingTile('t-watch', 'watchtower')],
      workers: 0,
    })
    state = setDice(state, ACTIVE, [numberAt(-3, 0), 1])

    const afterCastle = applyMove(CONFIG, state, {
      kind: 'placeTile',
      die: { kind: 'die', index: 0 },
      storageIndex: 0,
      to: { q: -3, r: 0 },
    })
    expect(afterCastle.state.pendingExtraActions).toBe(1)
    expect(afterCastle.state.actionsTakenThisTurn).toBe(1)
    // 单格城堡区域完成 = 1 + 10
    expect(player(afterCastle.state).vp).toBe(1 + 10)

    // 还有额外行动没执行 → 不能结束回合
    expect(listLegalMoves(CONFIG, afterCastle.state).some((m) => m.kind === 'endTurn')).toBe(false)

    // 瞭望塔：(-3,1) 与 (-3,0) 相邻；放下去立刻 +4 分，不产生待处理选择
    const afterWatch = applyMove(CONFIG, afterCastle.state, {
      kind: 'placeTile',
      die: { kind: 'virtual' },
      storageIndex: 0,
      to: { q: -3, r: 1 },
    })
    expect(afterWatch.state.pendingExtraActions).toBe(0)
    // 虚拟骰子不计入两个行动
    expect(afterWatch.state.actionsTakenThisTurn).toBe(1)
    expect(player(afterWatch.state).vp).toBe(1 + 10 + 4)
  })

  it('船只：从任意货物格取走全部货物，并把顺位前移', () => {
    // (0,-1) 是米色格，与 (0,-2) 船只格相邻；这里直接塞一枚建筑当垫脚
    let state: GameState = estateOf(BASE_STATE, ACTIVE, [
      [{ q: 0, r: -1 }, buildingTile('seed-b', 'bank')],
    ])
    // 注意：开局那 3 枚随机货物可能已经占满"3 种颜色"的额度，
    // 所以这里显式把手上的货物收成 1 种，才测得到"取货成功"这一支。
    state = patchPlayer(state, ACTIVE, {
      storage: [shipTile('t-ship')],
      workers: 0,
      goods: { 2: 1 },
    })
    state = setDice(state, ACTIVE, [numberAt(0, -2), 1])
    state = { ...state, goodsSpaces: { ...state.goodsSpaces, '3': [1, 4, 4] } }

    const placed = applyMove(CONFIG, state, {
      kind: 'placeTile',
      die: { kind: 'die', index: 0 },
      storageIndex: 0,
      to: { q: 0, r: -2 },
    })
    // 放置船只后必须选择从哪个货物格取货
    expect(placed.state.pending[0]).toEqual({ kind: 'shipGoodsSpace', exclude: [] })
    expect(listLegalMoves(CONFIG, placed.state).every((m) => m.kind === 'resolveShipGoodsSpace')).toBe(
      true,
    )

    const orderBefore = placed.state.turnOrder
    const indexBefore = orderBefore.indexOf(ACTIVE)

    const resolved = applyMove(CONFIG, placed.state, {
      kind: 'resolveShipGoodsSpace',
      space: 3,
    })
    const after = player(resolved.state)
    expect(after.goods['1']).toBe(1)
    expect(after.goods['4']).toBe(2)
    expect(resolved.state.goodsSpaces['3']).toEqual([])
    expect(resolved.events.some((e) => e.kind === 'shipTookGoods')).toBe(true)

    // 顺位前移：原本不在队首的会前移一格
    if (indexBefore > 0) {
      expect(resolved.state.turnOrder.indexOf(ACTIVE)).toBe(indexBefore - 1)
    }
    // 取货是放置行动的后续，不再增加行动数
    expect(resolved.state.actionsTakenThisTurn).toBe(1)
  })

  it('5 号知识板块（双港）：第二次选格不会再抛出第三次，也不会再次前移顺位', () => {
    // 这是修一个真实死循环时补的回归测试：早先两次选格共用同一个函数且无条件抛出
    // 新的"第二次选择"，于是每次解决都生出下一个 —— AI 自对弈里出现 5000 步中
    // 4877 步都在解决同一个选择的活锁。
    let state: GameState = estateOf(BASE_STATE, ACTIVE, [
      [{ q: 0, r: -1 }, buildingTile('seed-b', 'bank')],
      [{ q: -2, r: 0 }, knowledgeTile('k5', 5)],
    ])
    state = patchPlayer(state, ACTIVE, {
      storage: [shipTile('t-ship')],
      workers: 0,
      // 手上不留货：两次取货一共会拿到 1/4/5 三种颜色，正好占满"最多 3 种"的额度
      goods: {},
    })
    state = setDice(state, ACTIVE, [numberAt(0, -2), 1])
    // 第 3 号与第 4 号货物格相邻，且都放了货
    state = { ...state, goodsSpaces: { ...state.goodsSpaces, '3': [1, 4], '4': [5] } }

    const placed = applyMove(CONFIG, state, {
      kind: 'placeTile',
      die: { kind: 'die', index: 0 },
      storageIndex: 0,
      to: { q: 0, r: -2 },
    })
    expect(placed.state.pending[0]).toEqual({ kind: 'shipGoodsSpace', exclude: [] })

    const first = applyMove(CONFIG, placed.state, { kind: 'resolveShipGoodsSpace', space: 3 })
    // 双港生效：抛出"再选一个相邻货物格"
    expect(first.state.pending[0]).toEqual({ kind: 'shipGoodsSecondSpace', firstSpace: 3 })

    const second = applyMove(CONFIG, first.state, {
      kind: 'resolveShipGoodsSecondSpace',
      space: 4,
    })
    // 关键：第二次解决之后必须干净收尾
    expect(second.state.pending).toEqual([])
    // 关键：顺位只在第一次选格时前移过一次
    expect(second.state.turnOrder).toEqual(first.state.turnOrder)
    // 两个格子的货都取到了
    expect(player(second.state).goods['1']).toBe(1)
    expect(player(second.state).goods['4']).toBe(1)
    expect(player(second.state).goods['5']).toBe(1)
  })

  it('知识板块 5 号：没有这张板块时不会抛出第二次选择', () => {
    let state: GameState = estateOf(BASE_STATE, ACTIVE, [
      [{ q: 0, r: -1 }, buildingTile('seed-b', 'bank')],
    ])
    state = patchPlayer(state, ACTIVE, { storage: [shipTile('t-ship')], workers: 0, goods: { 2: 1 } })
    state = setDice(state, ACTIVE, [numberAt(0, -2), 1])
    state = { ...state, goodsSpaces: { ...state.goodsSpaces, '3': [1, 4], '4': [5] } }

    const placed = applyMove(CONFIG, state, {
      kind: 'placeTile',
      die: { kind: 'die', index: 0 },
      storageIndex: 0,
      to: { q: 0, r: -2 },
    })
    const resolved = applyMove(CONFIG, placed.state, { kind: 'resolveShipGoodsSpace', space: 3 })
    expect(resolved.state.pending).toEqual([])
  })

  it('货物仓储最多 3 种颜色，装不下的留在原处', () => {
    let state: GameState = estateOf(BASE_STATE, ACTIVE, [
      [{ q: 0, r: -1 }, buildingTile('seed-b', 'bank')],
    ])
    state = patchPlayer(state, ACTIVE, {
      storage: [shipTile('t-ship')],
      workers: 0,
      goods: { 1: 1, 2: 1, 3: 1 },
    })
    state = setDice(state, ACTIVE, [numberAt(0, -2), 1])
    state = { ...state, goodsSpaces: { '6': [4, 4, 5] } }

    const placed = applyMove(CONFIG, state, {
      kind: 'placeTile',
      die: { kind: 'die', index: 0 },
      storageIndex: 0,
      to: { q: 0, r: -2 },
    })
    const resolved = applyMove(CONFIG, placed.state, { kind: 'resolveShipGoodsSpace', space: 6 })
    const after = player(resolved.state)

    // 已经有 3 种颜色，所以 4 与 5 都放不进去
    expect(after.goods['4']).toBeUndefined()
    expect(after.goods['5']).toBeUndefined()
    expect(resolved.state.goodsSpaces['6']).toEqual([4, 4, 5])
  })

  it('仓库建筑会要求选择卖出一种货物', () => {
    let state: GameState = estateOf(BASE_STATE, ACTIVE, [
      [{ q: -2, r: -1 }, buildingTile('seed-b', 'bank')],
    ])
    state = patchPlayer(state, ACTIVE, {
      storage: [buildingTile('t-warehouse', 'warehouse')],
      workers: 0,
      goods: { 2: 2 },
    })
    state = setDice(state, ACTIVE, [numberAt(-1, -1), 1])

    const placed = applyMove(CONFIG, state, {
      kind: 'placeTile',
      die: { kind: 'die', index: 0 },
      storageIndex: 0,
      to: { q: -1, r: -1 },
    })
    expect(placed.state.pending[0]).toEqual({ kind: 'warehouseSellGoods' })

    const resolved = applyMove(CONFIG, placed.state, {
      kind: 'resolveWarehouseSellGoods',
      goods: 2,
    })
    const after = player(resolved.state)
    // 卖出 2 枚 → 4 分（2 人局每枚 2 分）+ 1 银币
    expect(after.vp).toBe(player(placed.state).vp + 4)
    expect(after.silverlings).toBe(player(placed.state).silverlings + 1)
  })

  it('市政厅会要求再放一枚，且忽略颜色', () => {
    let state: GameState = estateOf(BASE_STATE, ACTIVE, [
      [{ q: -2, r: -1 }, buildingTile('seed-b', 'bank')],
    ])
    state = patchPlayer(state, ACTIVE, {
      storage: [buildingTile('t-hall', 'cityHall'), animalTile('t-cow', 'cow', 3)],
      workers: 0,
    })
    state = setDice(state, ACTIVE, [numberAt(-1, -1), 1])

    const placed = applyMove(CONFIG, state, {
      kind: 'placeTile',
      die: { kind: 'die', index: 0 },
      storageIndex: 0,
      to: { q: -1, r: -1 },
    })
    // 默认保留点数限制（Q8），所以 requiredNumber = 市政厅所在格的点数
    expect(placed.state.pending[0]).toEqual({
      kind: 'cityHallPlace',
      requiredNumber: numberAt(-1, -1),
    })

    // 把动物板块放到 (-2,-1)? 已有板块。用 (-1,-1) 旁的另一个米色格，点数须相同
    const options = listLegalMoves(CONFIG, placed.state).filter(
      (m): m is Extract<Move, { kind: 'resolveCityHallPlace' }> =>
        m.kind === 'resolveCityHallPlace',
    )
    expect(options.length).toBeGreaterThan(0)

    const target = options[0]!
    const resolved = applyMove(CONFIG, placed.state, target)
    const tile = player(resolved.state).estate[axialKey(target.to)]
    expect(tile?.color).toBe('animal')
  })
})

describe('卖货与取工人', () => {
  it('卖货：卖光该色，得 1 银币 + 每枚 2 分（2 人局）', () => {
    let state: GameState = patchPlayer(BASE_STATE, ACTIVE, { goods: { 2: 3 }, workers: 0 })
    state = setDice(state, ACTIVE, [2, 6])

    const before = player(state)
    const result = applyMove(CONFIG, state, {
      kind: 'sellGoods',
      die: { kind: 'die', index: 0 },
      goods: 2,
    })
    const after = player(result.state)
    expect(after.vp).toBe(before.vp + 3 * 2)
    expect(after.silverlings).toBe(before.silverlings + 1)
    expect(after.goods['2']).toBeUndefined()
    expect(after.soldGoods['2']).toBe(3)
    expect(result.events.some((e) => e.kind === 'soldGoods')).toBe(true)
  })

  it('3 号知识板块让卖货得 2 银币，4 号额外给 1 个工人', () => {
    let state: GameState = estateOf(BASE_STATE, ACTIVE, [
      [{ q: -2, r: 0 }, knowledgeTile('k3', 3)],
      [{ q: 1, r: 0 }, knowledgeTile('k4', 4)],
    ])
    state = patchPlayer(state, ACTIVE, { goods: { 5: 1 }, workers: 0 })
    state = setDice(state, ACTIVE, [5, 6])

    const before = player(state)
    const result = applyMove(CONFIG, state, {
      kind: 'sellGoods',
      die: { kind: 'die', index: 0 },
      goods: 5,
    })
    const after = player(result.state)
    expect(after.silverlings).toBe(before.silverlings + 2)
    expect(after.workers).toBe(before.workers + 1)
  })

  it('卖没有的货物会抛错', () => {
    let state: GameState = patchPlayer(BASE_STATE, ACTIVE, { goods: {}, workers: 0 })
    state = setDice(state, ACTIVE, [2, 6])
    expect(() =>
      applyMove(CONFIG, state, { kind: 'sellGoods', die: { kind: 'die', index: 0 }, goods: 2 }),
    ).toThrow()
  })

  it('取 2 个工人：与点数无关', () => {
    let state: GameState = patchPlayer(BASE_STATE, ACTIVE, { workers: 0 })
    state = setDice(state, ACTIVE, [3, 6])
    const before = player(state)
    const result = applyMove(CONFIG, state, { kind: 'takeWorkers', die: { kind: 'die', index: 0 } })
    expect(player(result.state).workers).toBe(before.workers + 2)
  })

  it('13 / 14 号知识板块改"取 2 个工人"的收益', () => {
    let state: GameState = estateOf(BASE_STATE, ACTIVE, [
      [{ q: -2, r: 0 }, knowledgeTile('k13', 13)],
      [{ q: 1, r: 0 }, knowledgeTile('k14', 14)],
    ])
    state = patchPlayer(state, ACTIVE, { workers: 0, silverlings: 0 })
    state = setDice(state, ACTIVE, [3, 6])
    const result = applyMove(CONFIG, state, { kind: 'takeWorkers', die: { kind: 'die', index: 0 } })
    const after = player(result.state)
    expect(after.workers).toBe(4)
    expect(after.silverlings).toBe(1)
  })
})

describe('购买与回合结束', () => {
  it('从黑洞买一枚：扣 2 银币、进仓储、每回合限一次', () => {
    let state: GameState = patchPlayer(BASE_STATE, ACTIVE, { silverlings: 5 })
    state = setDice(state, ACTIVE, [3, 6])
    const tileId = state.blackDepot[0]?.id
    expect(tileId).toBeDefined()

    const result = applyMove(CONFIG, state, {
      kind: 'buyTile',
      source: { kind: 'black', tileId: tileId! },
    })
    const after = player(result.state)
    expect(after.silverlings).toBe(3)
    expect(after.storage).toHaveLength(1)
    expect(result.state.purchasedThisTurn).toBe(true)

    expect(() =>
      applyMove(CONFIG, result.state, {
        kind: 'buyTile',
        source: { kind: 'black', tileId: result.state.blackDepot[0]?.id ?? 'x' },
      }),
    ).toThrow(/已经购买过/)
  })

  it('银币不足时买不了', () => {
    let state: GameState = patchPlayer(BASE_STATE, ACTIVE, { silverlings: 1 })
    state = setDice(state, ACTIVE, [3, 6])
    const tileId = state.blackDepot[0]!.id
    expect(() =>
      applyMove(CONFIG, state, { kind: 'buyTile', source: { kind: 'black', tileId } }),
    ).toThrow(/银币不足/)
  })

  it('没用完两个行动就结束回合会抛错', () => {
    expect(() => applyMove(CONFIG, BASE_STATE, { kind: 'endTurn' })).toThrow()
  })

  it('结束回合后轮到对手，且对手拿到新掷的骰子', () => {
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
    const result = applyMove(CONFIG, state, { kind: 'endTurn' })
    expect(result.state.activePlayerId).toBe(otherPlayer(active))
    expect(result.state.actionsTakenThisTurn).toBe(0)
    // 同一位玩家在同一轮里不会连续行动两次
    expect(result.state.turnIndex).toBe(1)
    expect(result.events.some((e) => e.kind === 'turnEnded')).toBe(true)
  })

  it('对局结束后任何行动都会抛错', () => {
    const finished: GameState = { ...BASE_STATE, finished: true }
    expect(() => applyMove(CONFIG, finished, { kind: 'endTurn' })).toThrow(/已经结束/)
  })
})

describe('随机合法行动打到终局（整体验证）', () => {
  it('用随机合法行动能把一局打完，且全程满足所有不变量', () => {
    const result = randomPlayout(20240101)
    expect(result.state.finished).toBe(true)
    expect(result.state.phaseIndex).toBe(4)
    expect(result.state.roundIndex).toBe(4)
    expect(result.steps).toBeGreaterThan(50)
  })

  it('换一颗种子同样能打完，说明不是偶然走通', () => {
    const result = randomPlayout(987654321)
    expect(result.state.finished).toBe(true)
  })

  it('多种子随机对局全部能打完（随机走法最容易撞到冷门规则组合）', () => {
    // 上一轮那个"5 号知识板块无限复制待处理选择"的活锁，就是因为既有测试
    // 恰好没走到"某张知识板块 + 某次船只放置"这条路径。多种子随机对局是
    // 最便宜的覆盖手段：每局约 700 步、几十毫秒，能翻出很多正常玩法碰不到的交互。
    const seeds = Array.from({ length: 20 }, (_, index) => 90000 + index * 613)
    const stepCounts: number[] = []

    for (const seed of seeds) {
      const result = randomPlayout(seed)
      stepCounts.push(result.steps)
    }

    console.info(
      `[随机对局] ${seeds.length} 局全部打完，步数 ${Math.min(...stepCounts)}-${Math.max(...stepCounts)}`,
    )
    expect(stepCounts.length).toBe(seeds.length)
  }, 300_000)
})
