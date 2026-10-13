import { describe, expect, it } from 'vitest'
import { applyMove } from '../apply'
import { BUILDING_SCORING_KNOWLEDGE, KNOWLEDGE_TILES } from '../data/knowledge'
import { activeSlots } from '../gameBoard'
import { listLegalMoves, type Move } from '../moves'
import { finalScoreOf } from '../scoring'
import { playerById, type GameState } from '../state'
import type { BuildingKind, DieValue, PlayerId } from '../types'
import {
  BASE_STATE,
  BOARD,
  CONFIG,
  animalTile,
  buildingTile,
  estateOf,
  knowledgeTile,
  numberAt,
  patchPlayer,
  setDice,
} from './testUtils'

/**
 * 知识板块的逐张效果测试。
 *
 * 为什么要单独写：能力派生层（capabilities.ts）本身有测试，但"能力算对了"
 * 和"这个能力真的被用上了"是两件事。最典型的是 9/10/11/12 号那一族 ——
 * 它们给骰子免费 ±1，如果合法行动生成忘了读这个能力，
 * 派生层会全绿而玩家永远用不出这张板块。
 *
 * 所以下面这几条一律用**对比**来断言：
 *   没有这张板块时该行动不合法；放上这张板块后（工人为 0）该行动合法。
 */

const ACTIVE: PlayerId = BASE_STATE.activePlayerId
/** 起始城堡的邻居：(0,-1) 米色、( -1,0) 动物、(1,0) 知识 —— 三格都是 6 点或 2 点，便于构造 ±1。 */
const BEIGE = { q: 0, r: -1 } as const
const ANIMAL = { q: -1, r: 0 } as const
const KNOWLEDGE = { q: 1, r: 0 } as const
/** 放知识板块的地方：不在上面三格，避免占用目标格 */
const KNOWLEDGE_SLOT = { q: -2, r: 0 } as const

const KNOWLEDGE_SPACES = BOARD.spaces.filter((space) => space.color === 'knowledge')
const BUILDING_SPACES = BOARD.spaces.filter((space) => space.color === 'building')

function withKnowledge(state: GameState, id: number): GameState {
  return estateOf(state, ACTIVE, [[KNOWLEDGE_SLOT, knowledgeTile(`k${id}`, id)]])
}

/**
 * 只用**第一颗骰子**能否把这个仓储板块放到目标格。
 *
 * 必须限定骰子序号：早先没限定，而测试里第二颗骰子恰好等于目标格点数，
 * 于是"没有这张知识板块"的负例被第二颗骰子悄悄合法化了，断言因此假失败。
 */
function canPlaceAt(state: GameState, to: { q: number; r: number }): boolean {
  return listLegalMoves(CONFIG, state).some(
    (move) =>
      move.kind === 'placeTile' &&
      move.die.kind === 'die' &&
      move.die.index === 0 &&
      move.storageIndex === 0 &&
      move.to.q === to.q &&
      move.to.r === to.r,
  )
}

function takeableDepots(state: GameState): number[] {
  const depots = new Set<number>()
  for (const move of listLegalMoves(CONFIG, state)) {
    if (move.kind !== 'takeTile') continue
    const slot = activeSlots(CONFIG.gameBoard, 2).find((candidate) => candidate.id === move.slotId)
    if (slot !== undefined) depots.add(slot.depot)
  }
  return [...depots].sort((a, b) => a - b)
}

function withStorageTile(state: GameState, kind: BuildingKind | 'animal' | 'knowledge'): GameState {
  const tile =
    kind === 'animal'
      ? animalTile('t-animal', 'cow', 3)
      : kind === 'knowledge'
        ? knowledgeTile('t-k', 11)
        : buildingTile(`t-${kind}`, kind)
  return patchPlayer(state, ACTIVE, { storage: [tile], workers: 0 })
}

describe('9 / 10 / 11 号：放置对应颜色的板块时骰子可以免费 ±1', () => {
  it('9 号（建筑）：没有它就放不下去，有了它（0 工人）就能放下', () => {
    // (0,-1) 是 6 点；把骰子设成 1，只能靠免费 -1 变成 6（1-1 环绕到 6）
    const die = 1 as DieValue
    const without = setDice(withStorageTile(BASE_STATE, 'bank'), ACTIVE, [die, die])
    expect(canPlaceAt(without, BEIGE)).toBe(false)

    const with9 = setDice(withStorageTile(withKnowledge(BASE_STATE, 9), 'bank'), ACTIVE, [die, die])
    expect(canPlaceAt(with9, BEIGE)).toBe(true)

    // 真的执行下去，且一个工人都没花
    const move = listLegalMoves(CONFIG, with9).find(
      (candidate): candidate is Extract<Move, { kind: 'placeTile' }> =>
        candidate.kind === 'placeTile' && candidate.to.q === BEIGE.q && candidate.to.r === BEIGE.r,
    )
    expect(move).toBeDefined()
    const result = applyMove(CONFIG, with9, move!)
    expect(playerById(result.state, ACTIVE).workers).toBe(0)
  })

  it('10 号（船 / 动物）：动物板块能靠免费 ±1 放下', () => {
    const die = 1 as DieValue
    const without = setDice(withStorageTile(BASE_STATE, 'animal'), ACTIVE, [die, die])
    expect(canPlaceAt(without, ANIMAL)).toBe(false)

    const with10 = setDice(withStorageTile(withKnowledge(BASE_STATE, 10), 'animal'), ACTIVE, [die, die])
    expect(canPlaceAt(with10, ANIMAL)).toBe(true)
  })

  it('11 号（城堡 / 矿 / 知识）：知识板块能靠免费 ±1 放下', () => {
    const target = numberAt(KNOWLEDGE.q, KNOWLEDGE.r)
    const die = (((numberAt(KNOWLEDGE.q, KNOWLEDGE.r) - 1 - 1 + 6) % 6) + 1) as DieValue
    // 目标点数与骰子点数必须正好相差 1，否则这条测试就失去意义
    expect(Math.abs(target - die) === 1 || Math.abs(target - die) === 5).toBe(true)

    const without = setDice(withStorageTile(BASE_STATE, 'knowledge'), ACTIVE, [die, die])
    expect(canPlaceAt(without, KNOWLEDGE)).toBe(false)

    const with11 = setDice(withStorageTile(withKnowledge(BASE_STATE, 11), 'knowledge'), ACTIVE, [die, die])
    expect(canPlaceAt(with11, KNOWLEDGE)).toBe(true)
  })

  it('9 号不会顺带让动物板块也能免费调整（颜色是分开管的）', () => {
    const die = 1 as DieValue
    const with9 = setDice(withStorageTile(withKnowledge(BASE_STATE, 9), 'animal'), ACTIVE, [die, die])
    expect(canPlaceAt(with9, ANIMAL)).toBe(false)
  })
})

describe('12 号：从版图取板块时骰子可以免费 ±1', () => {
  it('没有它就是只能取骰子点数那一个仓库；有了它（0 工人）能取相邻点数', () => {
    const die = 1 as DieValue
    const without = setDice(patchPlayer(BASE_STATE, ACTIVE, { workers: 0 }), ACTIVE, [die, die])
    expect(takeableDepots(without)).toEqual([1])

    const with12 = setDice(
      patchPlayer(withKnowledge(BASE_STATE, 12), ACTIVE, { workers: 0 }),
      ACTIVE,
      [die, die],
    )
    // 1±1 → 2 与 6（环绕）
    expect(takeableDepots(with12)).toEqual([1, 2, 6])
  })

  it('12 号只影响"取板块"，不影响放置时的点数', () => {
    const die = 1 as DieValue
    const state = setDice(withStorageTile(withKnowledge(BASE_STATE, 12), 'bank'), ACTIVE, [die, die])
    expect(canPlaceAt(state, BEIGE)).toBe(false)
  })
})

describe('6 号：每回合限一次，花 2 个工人从任意编号仓库取一枚米色建筑', () => {
  const beigeSlotId = (): string => {
    const slot = activeSlots(CONFIG.gameBoard, 2).find(
      (candidate) => candidate.color === 'building' && BASE_STATE.depotSlots[candidate.id] != null,
    )
    expect(slot).toBeDefined()
    return slot!.id
  }

  it('2 个工人才够，1 个工人时这个行动不出现', () => {
    const rich = patchPlayer(withKnowledge(BASE_STATE, 6), ACTIVE, { workers: 2 })
    expect(listLegalMoves(CONFIG, rich).some((move) => move.kind === 'workerTakeBuilding')).toBe(true)

    const poor = patchPlayer(withKnowledge(BASE_STATE, 6), ACTIVE, { workers: 1 })
    expect(listLegalMoves(CONFIG, poor).some((move) => move.kind === 'workerTakeBuilding')).toBe(false)
  })

  it('执行后：扣 2 个工人、板块进仓储、本回合不能再做第二次', () => {
    const slotId = beigeSlotId()
    const state = patchPlayer(withKnowledge(BASE_STATE, 6), ACTIVE, { workers: 5, storage: [] })
    const tileId = state.depotSlots[slotId]?.id

    const result = applyMove(CONFIG, state, { kind: 'workerTakeBuilding', slotId })
    const after = playerById(result.state, ACTIVE)
    expect(after.workers).toBe(3)
    expect(after.storage.map((tile) => tile.id)).toContain(tileId)
    expect(result.state.depotSlots[slotId]).toBeNull()
    expect(result.state.usedWorkerTakeThisTurn).toBe(true)

    // 每回合限一次
    const secondSlot = activeSlots(CONFIG.gameBoard, 2).find(
      (candidate) => candidate.color === 'building' && result.state.depotSlots[candidate.id] != null,
    )
    expect(() =>
      applyMove(CONFIG, result.state, { kind: 'workerTakeBuilding', slotId: secondSlot!.id }),
    ).toThrow(/每回合只能用一次/)
    expect(
      listLegalMoves(CONFIG, result.state).some((move) => move.kind === 'workerTakeBuilding'),
    ).toBe(false)
  })

  it('取下个回合会重置（回合推进后又能用了）', () => {
    const slotId = beigeSlotId()
    let state = patchPlayer(withKnowledge(BASE_STATE, 6), ACTIVE, { workers: 5, storage: [] })
    state = applyMove(CONFIG, state, { kind: 'workerTakeBuilding', slotId }).state
    // 直接模拟"轮到下一位玩家再轮回来"：清掉标志位等价于新回合
    const nextTurn: GameState = { ...state, usedWorkerTakeThisTurn: false }
    expect(listLegalMoves(CONFIG, nextTurn).some((move) => move.kind === 'workerTakeBuilding')).toBe(
      true,
    )
  })

  it('永远只能取米色建筑，取不到别的颜色', () => {
    const state = patchPlayer(withKnowledge(BASE_STATE, 6), ACTIVE, { workers: 5, storage: [] })
    for (const move of listLegalMoves(CONFIG, state)) {
      if (move.kind !== 'workerTakeBuilding') continue
      const slot = activeSlots(CONFIG.gameBoard, 2).find((candidate) => candidate.id === move.slotId)
      expect(slot?.color).toBe('building')
    }
  })
})

describe('16–23 号：终局每座对应建筑 4 分', () => {
  const entries = Object.entries(BUILDING_SCORING_KNOWLEDGE)

  it('一共八张，覆盖八种建筑', () => {
    expect(entries).toHaveLength(8)
    expect(new Set(entries.map(([, building]) => building)).size).toBe(8)
  })

  for (const [idText, building] of entries) {
    it(`${idText} 号：领地里有 2 座 ${building} 时终局得 8 分`, () => {
      const knowledgeSpace = KNOWLEDGE_SPACES[0]!
      const first = BUILDING_SPACES[0]!
      const second = BUILDING_SPACES[1]!

      const state = estateOf(BASE_STATE, ACTIVE, [
        [{ q: knowledgeSpace.q, r: knowledgeSpace.r }, knowledgeTile(`k${idText}`, Number(idText))],
        [{ q: first.q, r: first.r }, buildingTile('b1', building as BuildingKind)],
        [{ q: second.q, r: second.r }, buildingTile('b2', building as BuildingKind)],
      ])

      const score = finalScoreOf(CONFIG, playerById(state, ACTIVE))
      expect(score.knowledgeVp).toBe(8)
    })
  }

  it('领地里有别的建筑时不加分（只算对应那一种）', () => {
    const knowledgeSpace = KNOWLEDGE_SPACES[0]!
    const buildingSpace = BUILDING_SPACES[0]!
    // 17 号只认瞭望塔，这里放的却是银行
    const state = estateOf(BASE_STATE, ACTIVE, [
      [{ q: knowledgeSpace.q, r: knowledgeSpace.r }, knowledgeTile('k17', 17)],
      [{ q: buildingSpace.q, r: buildingSpace.r }, buildingTile('b1', 'bank')],
    ])
    const score = finalScoreOf(CONFIG, playerById(state, ACTIVE))
    expect(score.knowledgeVp).toBe(0)
  })

  it('没有这张板块时，同样的建筑布局得不分', () => {
    const buildingSpace = BUILDING_SPACES[0]!
    const state = estateOf(BASE_STATE, ACTIVE, [
      [{ q: buildingSpace.q, r: buildingSpace.r }, buildingTile('b1', 'watchtower')],
    ])
    const score = finalScoreOf(CONFIG, playerById(state, ACTIVE))
    expect(score.knowledgeVp).toBe(0)
  })
})

describe('26 张知识板块的效果表完整性', () => {
  it('每张都有中文名与效果说明（面板与悬浮提示都靠它）', () => {
    for (const tile of KNOWLEDGE_TILES) {
      expect(tile.name.length, `${tile.id} 号缺名字`).toBeGreaterThan(0)
      expect(tile.text.length, `${tile.id} 号缺说明`).toBeGreaterThan(4)
    }
  })

  it('编号是 1–26 且不重复', () => {
    const ids = KNOWLEDGE_TILES.map((tile) => tile.id).sort((a, b) => a - b)
    expect(ids).toEqual(Array.from({ length: 26 }, (_, index) => index + 1))
  })
})
