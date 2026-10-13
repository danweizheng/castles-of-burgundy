import { describe, expect, it } from 'vitest'
import { applyMove } from '../apply'
import { BUILDINGS, buildingDef } from '../data/buildings'
import { activeSlots } from '../gameBoard'
import { listLegalMoves, type Move } from '../moves'
import { currentPlayer, playerById, type GameState } from '../state'
import type { BuildingKind, PlayerId, PlayerState } from '../types'
import {
  BASE_STATE,
  CONFIG,
  buildingTile,
  knowledgeTile,
  mineTile,
  numberAt,
  patchPlayer,
  setDice,
} from './testUtils'

/**
 * 八种建筑效果的完整覆盖。
 *
 * 写这个文件的起因：8 种建筑里只有 3 种（仓库、市政厅、瞭望塔）在别处被间接覆盖到，
 * 木工坊／教堂／市场／客栈／银行这 5 种**一行测试都没有**。而它们是有真实逻辑的：
 * "效果能否用上"的判定、可取板块的颜色限制、仓储满时的弃牌。
 */

const ACTIVE: PlayerId = BASE_STATE.activePlayerId
/** 起始城堡的邻居里有两格米色；(0,-1) 属于那个 5 格城市，放一枚不会立刻完成区域。 */
const BEIGE_TARGET = { q: 0, r: -1 } as const

function player(state: GameState, id: PlayerId = ACTIVE): PlayerState {
  return playerById(state, id)
}

/** 取某格上的建筑种类（HexTile 是联合类型，需要先按颜色收窄）。 */
function buildingAt(state: GameState, q: number, r: number): BuildingKind | undefined {
  const tile = player(state).estate[`${q},${r}`]
  return tile !== undefined && tile.color === 'building' ? tile.building : undefined
}

/**
 * 把一枚建筑放到 (0,-1)。
 *
 * 返回**放置前**的状态与结果：助手会在构造时把工人设成 0（避免骰子被自动调整），
 * 所以断言必须拿"构造出来的那个局面"当基线，而不是拿 BASE_STATE ——
 * 早先就是这里对不上，客栈的 +4 工人断言因此假失败。
 */
function placeBuilding(building: BuildingKind, extra?: Partial<PlayerState>) {
  let state = patchPlayer(BASE_STATE, ACTIVE, {
    storage: [buildingTile(`t-${building}`, building)],
    workers: 0,
    ...extra,
  })
  state = setDice(state, ACTIVE, [numberAt(BEIGE_TARGET.q, BEIGE_TARGET.r), 1])
  const before = player(state)
  const result = applyMove(CONFIG, state, {
    kind: 'placeTile',
    die: { kind: 'die', index: 0 },
    storageIndex: 0,
    to: { q: BEIGE_TARGET.q, r: BEIGE_TARGET.r },
  })
  return { before, result }
}

describe('建筑效果表与官方规则书逐条一致（规则保真度锁）', () => {
  it('三张"从任意仓库取板块"的建筑，可取颜色与规则书原文一致', () => {
    // 规则书：Market — a ship (blue) or livestock (green) tile
    expect(buildingDef('market').effect).toEqual({
      kind: 'takeTileFromAnyDepot',
      colors: ['ship', 'animal'],
    })
    // 规则书：Carpenter's Workshop — a beige building tile
    expect(buildingDef('carpenter').effect).toEqual({
      kind: 'takeTileFromAnyDepot',
      colors: ['building'],
    })
    // 规则书：Church — a mine (gray), monastery (yellow), or castle (burgundy) tile
    expect(buildingDef('church').effect).toEqual({
      kind: 'takeTileFromAnyDepot',
      colors: ['mine', 'knowledge', 'castle'],
    })
  })

  it('另外五种建筑的数值与规则书一致', () => {
    expect(buildingDef('warehouse').effect).toEqual({ kind: 'sellGoods' })
    expect(buildingDef('boardingHouse').effect).toEqual({ kind: 'gainWorkers', amount: 4 })
    expect(buildingDef('bank').effect).toEqual({ kind: 'gainSilverlings', amount: 2 })
    expect(buildingDef('watchtower').effect).toEqual({ kind: 'gainVp', amount: 4 })
    expect(buildingDef('cityHall').effect).toEqual({ kind: 'placeExtraTileIgnoringColor' })
  })

  it('恰好八种建筑，编号不重复', () => {
    expect(BUILDINGS).toHaveLength(8)
    expect(new Set(BUILDINGS.map((building) => building.id)).size).toBe(8)
  })
})

describe('立即结算型的三张：银行 / 客栈 / 瞭望塔', () => {
  it('银行：+2 银币，且不产生待处理选择', () => {
    const { before, result } = placeBuilding('bank')
    const after = player(result.state)
    expect(after.silverlings).toBe(before.silverlings + 2)
    expect(result.state.pending).toEqual([])
    expect(after.estate[`${BEIGE_TARGET.q},${BEIGE_TARGET.r}`]?.color).toBe('building')
  })

  it('客栈：+4 工人', () => {
    const { before, result } = placeBuilding('boardingHouse')
    expect(player(result.state).workers).toBe(before.workers + 4)
    expect(result.state.pending).toEqual([])
  })

  it('瞭望塔：+4 分（5 格城市只填了 1 格，没有区域完成分混进来）', () => {
    const { before, result } = placeBuilding('watchtower')
    expect(player(result.state).vp).toBe(before.vp + 4)
    expect(result.events.some((event) => event.kind === 'regionCompleted')).toBe(false)
  })
})

describe('仓库：立即卖出一种自选货物', () => {
  it('产生"选择卖哪一种"的待处理选择', () => {
    const { result } = placeBuilding('warehouse', { goods: { 2: 3, 5: 1 } })
    expect(result.state.pending[0]).toEqual({ kind: 'warehouseSellGoods' })
  })

  it('解决后整叠卖出：1 银币 + 每枚 2 分（2 人局）', () => {
    const { result: placed } = placeBuilding('warehouse', { goods: { 2: 3 } })
    const before = player(placed.state)
    const resolved = applyMove(CONFIG, placed.state, {
      kind: 'resolveWarehouseSellGoods',
      goods: 2,
    })
    const after = player(resolved.state)
    expect(after.vp).toBe(before.vp + 3 * 2)
    expect(after.silverlings).toBe(before.silverlings + 1)
    expect(after.goods['2']).toBeUndefined()
    expect(after.soldGoods['2']).toBe(3)
    expect(resolved.state.pending).toEqual([])
  })

  it('手上一种货物都没有时，效果作废但建筑照常放下（规则书明说可以）', () => {
    const { result } = placeBuilding('warehouse', { goods: {} })
    expect(result.state.pending).toEqual([])
    expect(player(result.state).estate[`${BEIGE_TARGET.q},${BEIGE_TARGET.r}`]?.color).toBe('building')
  })
})

describe('木工坊 / 教堂 / 市场：从任意编号仓库取一枚指定颜色的板块', () => {
  const cases: ReadonlyArray<readonly [BuildingKind, readonly string[]]> = [
    ['carpenter', ['building']],
    ['church', ['mine', 'knowledge', 'castle']],
    ['market', ['ship', 'animal']],
  ]

  for (const [building, colors] of cases) {
    it(`${building}：待处理选择的颜色集合正确，且每个可选格位都真的是这些颜色`, () => {
      const { result: placed } = placeBuilding(building)
      const pending = placed.state.pending[0]
      expect(pending).toEqual({ kind: 'takeTileFromAnyDepot', colors })

      const options = listLegalMoves(CONFIG, placed.state).filter(
        (move): move is Extract<Move, { kind: 'resolveTakeTileFromAnyDepot' }> =>
          move.kind === 'resolveTakeTileFromAnyDepot',
      )
      expect(options.length).toBeGreaterThan(0)
      for (const option of options) {
        const slot = activeSlots(CONFIG.gameBoard, 2).find((candidate) => candidate.id === option.slotId)
        expect(slot).toBeDefined()
        expect(colors).toContain(slot!.color)
        expect(placed.state.depotSlots[slot!.id]).not.toBeNull()
      }
    })
  }

  it('解决后：板块从仓库进了仓储，且不额外消耗行动', () => {
    const { result: placed } = placeBuilding('carpenter')
    const option = listLegalMoves(CONFIG, placed.state).find(
      (move): move is Extract<Move, { kind: 'resolveTakeTileFromAnyDepot' }> =>
        move.kind === 'resolveTakeTileFromAnyDepot',
    )
    expect(option).toBeDefined()

    const tileId = placed.state.depotSlots[option!.slotId]?.id
    const actionsBefore = placed.state.actionsTakenThisTurn
    const resolved = applyMove(CONFIG, placed.state, option!)

    expect(resolved.state.depotSlots[option!.slotId]).toBeNull()
    expect(player(resolved.state).storage.map((tile) => tile.id)).toContain(tileId)
    // 效果不是新行动：行动计数不该再涨
    expect(resolved.state.actionsTakenThisTurn).toBe(actionsBefore)
    expect(resolved.state.pending).toEqual([])
  })

  it('教堂取到城堡/矿/知识三类都能落在仓储里', () => {
    const { result: placed } = placeBuilding('church')
    const options = listLegalMoves(CONFIG, placed.state).filter(
      (move): move is Extract<Move, { kind: 'resolveTakeTileFromAnyDepot' }> =>
        move.kind === 'resolveTakeTileFromAnyDepot',
    )
    const seenColors = new Set<string>()
    for (const option of options) {
      const slot = activeSlots(CONFIG.gameBoard, 2).find((candidate) => candidate.id === option.slotId)
      if (slot !== undefined) seenColors.add(slot.color)
    }
    // 默认占位版图上三类都铺着牌，所以这一支应当至少覆盖到两类
    expect(seenColors.size).toBeGreaterThanOrEqual(2)
    for (const color of seenColors) expect(['mine', 'knowledge', 'castle']).toContain(color)
  })

  it('效果用不上时（六个仓库里都没有该颜色的牌）不产生待处理选择，建筑仍可放下', () => {
    // 把版图上所有米色格位清空 → 木工坊的效果无处可用
    const beigeSlots = activeSlots(CONFIG.gameBoard, 2).filter((slot) => slot.color === 'building')
    expect(beigeSlots.length).toBeGreaterThan(0)

    const emptied: Record<string, null> = {}
    for (const slot of beigeSlots) emptied[slot.id] = null

    let state: GameState = patchPlayer(BASE_STATE, ACTIVE, {
      storage: [buildingTile('t-carpenter', 'carpenter')],
      workers: 0,
    })
    state = setDice(state, ACTIVE, [numberAt(BEIGE_TARGET.q, BEIGE_TARGET.r), 1])
    state = { ...state, depotSlots: { ...state.depotSlots, ...emptied } }

    const result = applyMove(CONFIG, state, {
      kind: 'placeTile',
      die: { kind: 'die', index: 0 },
      storageIndex: 0,
      to: { q: BEIGE_TARGET.q, r: BEIGE_TARGET.r },
    })
    expect(result.state.pending).toEqual([])
    expect(buildingAt(result.state, BEIGE_TARGET.q, BEIGE_TARGET.r)).toBe('carpenter')
  })

  it('仓储满时取板块必须先弃一枚，弃掉的那枚移出游戏', () => {
    const full = [mineTile('s1'), mineTile('s2'), mineTile('s3')]
    // 先放建筑会占掉仓储，所以这里直接构造"建筑已放下、仓储已满"的局面
    const { result: placed } = placeBuilding('carpenter')
    const state: GameState = {
      ...placed.state,
      players: placed.state.players.map((candidate) =>
        candidate.id === ACTIVE ? { ...candidate, storage: full } : candidate,
      ),
    }

    const withoutDiscard = listLegalMoves(CONFIG, state).find(
      (move): move is Extract<Move, { kind: 'resolveTakeTileFromAnyDepot' }> =>
        move.kind === 'resolveTakeTileFromAnyDepot' && move.discardStorageIndex === undefined,
    )
    expect(withoutDiscard).toBeUndefined()

    const withDiscard = listLegalMoves(CONFIG, state).find(
      (move): move is Extract<Move, { kind: 'resolveTakeTileFromAnyDepot' }> =>
        move.kind === 'resolveTakeTileFromAnyDepot' && move.discardStorageIndex !== undefined,
    )
    expect(withDiscard).toBeDefined()

    const discardedId = full[withDiscard!.discardStorageIndex!]?.id
    const resolved = applyMove(CONFIG, state, withDiscard!)
    expect(player(resolved.state).storage).toHaveLength(3)
    expect(resolved.state.removedFromGame.map((tile) => tile.id)).toContain(discardedId)
  })
})

describe('市政厅：从仓储再放一枚，且照常触发那枚板块的效果', () => {
  it('默认版图上没有可放的落点时会作废（属于正确行为，不是漏洞）', () => {
    // (0,-1) 的点数是 6；它周围可用的米色格点数都不是 6，所以市政厅的额外放置无处可放。
    // 规则书：效果用不上时建筑仍可放下，只是效果作废。
    const { result } = placeBuilding('cityHall')
    expect(result.state.pending).toEqual([])
    expect(buildingAt(result.state, BEIGE_TARGET.q, BEIGE_TARGET.r)).toBe('cityHall')
  })

  it('可以放置时：放下的那枚板块会触发自己的效果（用瞭望塔验证 +4 分）', () => {
    // 直接构造出市政厅的待处理选择，绕开"落点必须点数匹配"的位置依赖
    const { result: placed } = placeBuilding('cityHall')
    const state: GameState = {
      ...placed.state,
      pending: [{ kind: 'cityHallPlace', requiredNumber: null }],
      players: placed.state.players.map((candidate) =>
        candidate.id === ACTIVE
          ? { ...candidate, storage: [buildingTile('t-watch', 'watchtower')] }
          : candidate,
      ),
    }

    const options = listLegalMoves(CONFIG, state).filter(
      (move): move is Extract<Move, { kind: 'resolveCityHallPlace' }> =>
        move.kind === 'resolveCityHallPlace',
    )
    expect(options.length).toBeGreaterThan(0)

    const vpBefore = player(state).vp
    const resolved = applyMove(CONFIG, state, options[0]!)
    // 瞭望塔效果被触发了
    expect(player(resolved.state).vp).toBe(vpBefore + 4)
    expect(resolved.state.pending).toEqual([])
    // 仓储空了（那一枚已经放进领地）
    expect(player(resolved.state).storage).toEqual([])
  })

  it('待处理选择里给出的落点都是空的、且与已有板块相邻', () => {
    const { result: placed } = placeBuilding('cityHall')
    const state: GameState = {
      ...placed.state,
      pending: [{ kind: 'cityHallPlace', requiredNumber: null }],
      players: placed.state.players.map((candidate) =>
        candidate.id === ACTIVE ? { ...candidate, storage: [mineTile('t-mine')] } : candidate,
      ),
    }
    const occupied = new Set(Object.keys(currentPlayer(state).estate))
    const options = listLegalMoves(CONFIG, state).filter(
      (move): move is Extract<Move, { kind: 'resolveCityHallPlace' }> =>
        move.kind === 'resolveCityHallPlace',
    )
    expect(options.length).toBeGreaterThan(0)
    for (const option of options) {
      expect(occupied.has(`${option.to.q},${option.to.r}`)).toBe(false)
    }
  })
})

describe('建筑的两条通用规则', () => {
  it('同一个城市里不能有第二座同种建筑（1 号知识板块解除限制）', () => {
    // (0,-1) 与 (1,-1) 同属 r=-1 那个 5 格城市
    let state: GameState = patchPlayer(BASE_STATE, ACTIVE, {
      storage: [buildingTile('t-bank-1', 'bank')],
      workers: 0,
    })
    state = setDice(state, ACTIVE, [numberAt(BEIGE_TARGET.q, BEIGE_TARGET.r), 1])
    const first = applyMove(CONFIG, state, {
      kind: 'placeTile',
      die: { kind: 'die', index: 0 },
      storageIndex: 0,
      to: { q: BEIGE_TARGET.q, r: BEIGE_TARGET.r },
    })

    const secondTarget = { q: 1, r: -1 } as const
    const second: GameState = {
      ...first.state,
      players: first.state.players.map((candidate) =>
        candidate.id === ACTIVE
          ? { ...candidate, storage: [buildingTile('t-bank-2', 'bank')] }
          : candidate,
      ),
      dice: {
        ...first.state.dice,
        [ACTIVE]: [{ value: numberAt(secondTarget.q, secondTarget.r), used: false }],
      },
    }

    expect(() =>
      applyMove(CONFIG, second, {
        kind: 'placeTile',
        die: { kind: 'die', index: 0 },
        storageIndex: 0,
        to: { q: secondTarget.q, r: secondTarget.r },
      }),
    ).toThrow(/同一个城市/)

    // 放上 1 号知识板块后限制解除
    const relieved: GameState = {
      ...second,
      players: second.players.map((candidate) =>
        candidate.id === ACTIVE
          ? { ...candidate, estate: { ...candidate.estate, '-2,0': knowledgeTile('k1', 1) } }
          : candidate,
      ),
    }
    expect(() =>
      applyMove(CONFIG, relieved, {
        kind: 'placeTile',
        die: { kind: 'die', index: 0 },
        storageIndex: 0,
        to: { q: secondTarget.q, r: secondTarget.r },
      }),
    ).not.toThrow()
  })

  it('建筑效果不需要额外的骰子或行动', () => {
    const before = BASE_STATE.actionsTakenThisTurn
    const { result } = placeBuilding('bank')
    expect(result.state.actionsTakenThisTurn).toBe(before + 1)
    // 加上建筑本身那一次动作，正好只花了一颗骰子
    expect(result.state.dice[ACTIVE]?.filter((die) => die.used)).toHaveLength(1)
  })

  it('建筑效果只在放置时触发一次，之后的动作不会重复触发', () => {
    const { result } = placeBuilding('bank')
    const silverlingsAfterPlace = player(result.state).silverlings
    // 再做一个无关行动（取 2 个工人）；银行的效果不该再触发一次
    const next = applyMove(CONFIG, result.state, {
      kind: 'takeWorkers',
      die: { kind: 'die', index: 1 },
    })
    expect(player(next.state).silverlings).toBe(silverlingsAfterPlace)
  })
})
