import { describe, expect, it } from 'vitest'
import { regionsOf } from '../board'
import { DEFAULT_RULESET } from '../config'
import { axialKey, type Axial } from '../hex'
import {
  applyPhaseEnd,
  awardBonusTile,
  capabilitiesOf,
  completedRegionAt,
  finalScore,
  finalScoreOf,
  fullyCoveredColors,
  scoreAnimalPlacement,
} from '../scoring'
import { createGame } from '../setup'
import { playerById, updatePlayer, type GameState } from '../state'
import type { AnimalKind, AnimalTile, HexTile, PlayerBoardDef, PlayerState, TileColor } from '../types'

const BOARD = DEFAULT_RULESET.playerBoards['1'] as PlayerBoardDef
const BASE = createGame(DEFAULT_RULESET, { seed: 31337 })

function spacesOfColor(color: TileColor): Axial[] {
  return BOARD.spaces.filter((s) => s.color === color).map((s) => ({ q: s.q, r: s.r }))
}

function regionsOfColor(color: TileColor): Axial[][] {
  return regionsOf(BOARD)
    .filter((r) => r.color === color)
    .map((r) => r.spaces.map((s) => ({ q: s.q, r: s.r })))
}

function withTiles(player: PlayerState, entries: ReadonlyArray<readonly [Axial, HexTile]>): PlayerState {
  const estate = { ...player.estate }
  for (const [space, tile] of entries) estate[axialKey(space)] = tile
  return { ...player, estate }
}

function place(state: GameState, playerId: 'p1' | 'p2', entries: ReadonlyArray<readonly [Axial, HexTile]>): GameState {
  return updatePlayer(state, playerId, (player) => withTiles(player, entries))
}

function animalTile(id: string, animal: AnimalKind, animals: 2 | 3 | 4): AnimalTile {
  return { id, color: 'animal', animal, animals }
}

function knowledgeTile(id: number): HexTile {
  return { id: `k-${id}`, color: 'knowledge', knowledge: id }
}

function mineTile(id: string): HexTile {
  return { id, color: 'mine' }
}

function buildingTile(id: string, building: 'watchtower' | 'bank'): HexTile {
  return { id, color: 'building', building }
}

/** 把某个颜色的**全部**空格铺满（用于构造"某色已覆盖"的局面）。 */
function fillColor(player: PlayerState, color: TileColor): PlayerState {
  const entries: Array<readonly [Axial, HexTile]> = spacesOfColor(color).map((space, index) => [
    space,
    { id: `${player.id}-${color}-${index}`, color } as HexTile,
  ])
  return withTiles(player, entries)
}

const CASTLE_REGIONS = regionsOfColor('castle')
const ANIMAL_REGIONS = regionsOfColor('animal')

describe('区域完成计分', () => {
  it('单格城堡区域铺满即完成，得分 = 1 格 + 当前阶段奖励', () => {
    // 找一个"非起始格"的单格城堡区域
    const single = CASTLE_REGIONS.find(
      (region) =>
        region.length === 1 &&
        axialKey(region[0] as Axial) !== axialKey(BOARD.startingSpace),
    )
    expect(single).toBeDefined()
    const space = single![0] as Axial

    const player = withTiles(playerById(BASE, 'p1'), [[space, { id: 'c-x', color: 'castle' }]])

    const atPhaseA = completedRegionAt(player, BOARD, space, 0)
    expect(atPhaseA?.size).toBe(1)
    expect(atPhaseA?.color).toBe('castle')
    expect(atPhaseA?.vp).toBe(1 + 10)

    // 同一个区域在最后一个阶段只值 1 + 2 分（早期完成更值钱）
    const atPhaseE = completedRegionAt(player, BOARD, space, 4)
    expect(atPhaseE?.vp).toBe(1 + 2)
  })

  it('区域没铺满时不算完成', () => {
    const multi = ANIMAL_REGIONS.find((region) => region.length === 3)
    expect(multi).toBeDefined()
    const player = withTiles(playerById(BASE, 'p1'), [
      [multi![0] as Axial, animalTile('a-1', 'cow', 3)],
    ])
    expect(completedRegionAt(player, BOARD, multi![0] as Axial, 0)).toBeUndefined()
  })

  it('铺满整个 3 格牧场时按区域大小计分（3 格 = 6 分）', () => {
    const region = ANIMAL_REGIONS.find((r) => r.length === 3)!
    const spots = region.map((_, i) => region[i] as Axial)
    let player = withTiles(playerById(BASE, 'p1'), [
      [spots[0] as Axial, animalTile('a-1', 'cow', 3)],
      [spots[1] as Axial, animalTile('a-2', 'cow', 3)],
    ])
    expect(completedRegionAt(player, BOARD, spots[1] as Axial, 0)).toBeUndefined()
    player = withTiles(player, [[spots[2] as Axial, animalTile('a-3', 'cow', 3)]])
    expect(completedRegionAt(player, BOARD, spots[2] as Axial, 0)?.vp).toBe(6 + 10)
  })
})

describe('动物即时计分（官方例子逐条复现）', () => {
  it('牧场已有 3 头牛，放入 4 头牛 → 7 分；再放入 4 头牛 → 11 分', () => {
    const region = ANIMAL_REGIONS.find((r) => r.length === 3)!
    const [s0, s1, s2] = region as [Axial, Axial, Axial]

    let player = withTiles(playerById(BASE, 'p1'), [[s0, animalTile('a-1', 'cow', 3)]])
    expect(scoreAnimalPlacement(player, BOARD, s0, animalTile('a-1', 'cow', 3), 0)).toEqual({
      vp: 3,
      scoredTiles: 1,
    })

    player = withTiles(player, [[s1, animalTile('a-2', 'cow', 4)]])
    expect(scoreAnimalPlacement(player, BOARD, s1, animalTile('a-2', 'cow', 4), 0)).toEqual({
      vp: 4 + 3,
      scoredTiles: 2,
    })

    player = withTiles(player, [[s2, animalTile('a-3', 'cow', 4)]])
    expect(scoreAnimalPlacement(player, BOARD, s2, animalTile('a-3', 'cow', 4), 0)).toEqual({
      vp: 4 + 4 + 3,
      scoredTiles: 3,
    })
  })

  it('不同种类的动物在同一牧场互不计分', () => {
    const region = ANIMAL_REGIONS.find((r) => r.length === 3)!
    const [s0, s1] = region as [Axial, Axial]
    let player = withTiles(playerById(BASE, 'p1'), [[s0, animalTile('a-1', 'cow', 4)]])
    player = withTiles(player, [[s1, animalTile('a-2', 'pig', 2)]])
    // 官方例子：2 只猪单独放入 → 3 分（含 7 号板块时为 3 = 2 + 1）
    expect(scoreAnimalPlacement(player, BOARD, s1, animalTile('a-2', 'pig', 2), 0).vp).toBe(2)
    expect(scoreAnimalPlacement(player, BOARD, s1, animalTile('a-2', 'pig', 2), 1).vp).toBe(3)
  })

  it('其他牧场上的同种动物不计分（这是本作最容易实现错的一条）', () => {
    const first = ANIMAL_REGIONS.find((r) => r.length === 3)!
    const second = ANIMAL_REGIONS.filter((r) => r.length === 3)[1]
    expect(second).toBeDefined()
    expect(axialKey(first[0] as Axial)).not.toBe(axialKey(second![0] as Axial))

    // 在第一个牧场放一头 4 只的牛
    let player = withTiles(playerById(BASE, 'p1'), [[first[0] as Axial, animalTile('a-1', 'cow', 4)]])
    // 在**另一个**牧场放入 3 只的牛：不该把上一个牧场的 4 只算进来
    const spot = second![0] as Axial
    player = withTiles(player, [[spot, animalTile('a-2', 'cow', 3)]])
    expect(scoreAnimalPlacement(player, BOARD, spot, animalTile('a-2', 'cow', 3), 0)).toEqual({
      vp: 3,
      scoredTiles: 1,
    })
  })

  it('7 号知识板块：官方例子 —— 牧场已有 4 只羊，放入 3 只羊 → 9 分', () => {
    const region = ANIMAL_REGIONS.find((r) => r.length === 3)!
    const [s0, s1] = region as [Axial, Axial]
    let player = withTiles(playerById(BASE, 'p1'), [[s0, animalTile('a-1', 'sheep', 4)]])
    player = withTiles(player, [[s1, animalTile('a-2', 'sheep', 3)]])
    expect(scoreAnimalPlacement(player, BOARD, s1, animalTile('a-2', 'sheep', 3), 1).vp).toBe(
      (3 + 1) + (4 + 1),
    )
  })
})

describe('奖励板块争夺', () => {
  it('全部城堡铺满时该色被"覆盖"，才可领奖励板块', () => {
    const castles = spacesOfColor('castle')
    expect(castles).toHaveLength(4)

    // 开局只放了起始城堡（1/4），不算覆盖
    expect(fullyCoveredColors(playerById(BASE, 'p1'), BOARD)).not.toContain('castle')

    const player = fillColor(playerById(BASE, 'p1'), 'castle')
    expect(fullyCoveredColors(player, BOARD)).toContain('castle')
  })

  it('没铺满时 awardBonusTile 拒绝发出奖励板块', () => {
    expect(awardBonusTile(DEFAULT_RULESET, BASE, playerById(BASE, 'p1'), 'castle')).toBeUndefined()
  })

  it('第一个拿到大方块（2 人局 5 分），第二个拿小方块（2 分），之后没有', () => {
    let state: GameState = BASE
    state = updatePlayer(state, 'p1', (player) => fillColor(player, 'castle'))
    state = updatePlayer(state, 'p2', (player) => fillColor(player, 'castle'))

    const first = awardBonusTile(DEFAULT_RULESET, state, playerById(state, 'p1'), 'castle')
    expect(first?.size).toBe('large')
    expect(first?.vp).toBe(5)
    state = first!.state
    expect(playerById(state, 'p1').bonusTiles['castle']).toBe('large')
    expect(playerById(state, 'p1').vp).toBe(5)

    const second = awardBonusTile(DEFAULT_RULESET, state, playerById(state, 'p2'), 'castle')
    expect(second?.size).toBe('small')
    expect(second?.vp).toBe(2)
    state = second!.state
    expect(playerById(state, 'p2').bonusTiles['castle']).toBe('small')

    // 大小两块都被领走后再没有
    expect(awardBonusTile(DEFAULT_RULESET, state, playerById(state, 'p1'), 'castle')).toBeUndefined()

    // 同一位玩家不会重复领同一色：p1 换一个尚未被领走的颜色
    const shipFilled = updatePlayer(state, 'p1', (player) => fillColor(player, 'ship'))
    const again = awardBonusTile(DEFAULT_RULESET, shipFilled, playerById(shipFilled, 'p1'), 'ship')
    expect(again?.size).toBe('large')
    expect(
      awardBonusTile(DEFAULT_RULESET, again!.state, playerById(again!.state, 'p1'), 'ship'),
    ).toBeUndefined()
  })
})

describe('阶段末收益', () => {
  it('每座矿给 1 银币', () => {
    const mines = spacesOfColor('mine')
    const state = place(BASE, 'p1', [
      [mines[0] as Axial, mineTile('m-1')],
      [mines[1] as Axial, mineTile('m-2')],
    ])
    const before = playerById(state, 'p1').silverlings
    const after = applyPhaseEnd(state, DEFAULT_RULESET)
    expect(playerById(after, 'p1').silverlings).toBe(before + 2)
    // 对手没有矿，不增加
    expect(playerById(after, 'p2').silverlings).toBe(playerById(state, 'p2').silverlings)
  })

  it('2 号知识板块：每座矿额外给 1 个工人', () => {
    const mines = spacesOfColor('mine')
    const knowledge = spacesOfColor('knowledge')
    const state = place(BASE, 'p1', [
      [mines[0] as Axial, mineTile('m-1')],
      [knowledge[0] as Axial, knowledgeTile(2)],
    ])
    const before = playerById(state, 'p1')
    const after = playerById(applyPhaseEnd(state, DEFAULT_RULESET), 'p1')
    expect(after.silverlings).toBe(before.silverlings + 1)
    expect(after.workers).toBe(before.workers + 1)
  })

  it('没有矿时阶段末不产生任何变化', () => {
    const after = applyPhaseEnd(BASE, DEFAULT_RULESET)
    expect(after.players).toEqual(BASE.players)
  })
})

describe('终局计分', () => {
  it('未卖货物 1 分/枚、银币 1 分/枚、每 2 个工人 1 分', () => {
    const state = updatePlayer(BASE, 'p1', (player) => ({
      ...player,
      goods: { 1: 2, 3: 1 },
      silverlings: 4,
      workers: 5,
    }))
    const score = finalScoreOf(DEFAULT_RULESET, playerById(state, 'p1'))
    expect(score.unsoldGoodsVp).toBe(3)
    expect(score.silverlingsVp).toBe(4)
    expect(score.workersVp).toBe(2)
    expect(score.knowledgeVp).toBe(0)
    expect(score.totalVp).toBe(9)
  })

  it('终局计分型知识板块：15 / 24 / 25 / 26 / 16–23 号', () => {
    const knowledge = spacesOfColor('knowledge')
    const buildings = spacesOfColor('building')
    const animals = spacesOfColor('animal')

    const state = updatePlayer(BASE, 'p1', (player) => {
      const withKnowledge = withTiles(player, [
        [knowledge[0] as Axial, knowledgeTile(15)],
        [knowledge[1] as Axial, knowledgeTile(17)], // 17 = 瞭望塔专精
        [knowledge[2] as Axial, knowledgeTile(24)],
        [knowledge[3] as Axial, knowledgeTile(25)],
        [knowledge[4] as Axial, knowledgeTile(26)],
        [buildings[0] as Axial, buildingTile('b-1', 'watchtower')],
        [buildings[1] as Axial, buildingTile('b-2', 'watchtower')],
        [animals[0] as Axial, animalTile('a-1', 'cow', 3)],
        [animals[1] as Axial, animalTile('a-2', 'pig', 2)],
      ])
      return { ...withKnowledge, soldGoods: { 1: 3, 4: 1 }, bonusTiles: { castle: 'large' } }
    })

    const score = finalScoreOf(DEFAULT_RULESET, playerById(state, 'p1'))
    // 15 号：2 种已卖出的货物类型 × 3 = 6
    // 24 号：2 种动物类型 × 4 = 8
    // 25 号：4 枚已卖出货物 × 1 = 4
    // 26 号：1 枚奖励板块 × 2 = 2
    // 17 号：2 座瞭望塔 × 4 = 8
    expect(score.knowledgeVp).toBe(6 + 8 + 4 + 2 + 8)
    expect(score.knowledgeDetail.length).toBeGreaterThanOrEqual(5)
  })

  it('空格数 = 版图总格数 − 已放置板块数（平手判定要用）', () => {
    const score = finalScoreOf(DEFAULT_RULESET, playerById(BASE, 'p1'))
    expect(score.emptySpaces).toBe(BOARD.spaces.length - 1)
  })

  it('总分更高者获胜，并给出平手判定说明', () => {
    const state = updatePlayer(BASE, 'p1', (player) => ({ ...player, vp: 100 }))
    const result = finalScore(DEFAULT_RULESET, state)
    expect(result.winnerId).toBe('p1')
    expect(result.tiebreakNote).toBe('按总分')
  })

  it('总分相同时，领地上空格较少者胜', () => {
    // 必须挑一个"非起始格"的城堡格，否则这一格本来就有起始城堡，等于没多放
    const extra = CASTLE_REGIONS.flat().find(
      (space) => axialKey(space) !== axialKey(BOARD.startingSpace),
    )
    expect(extra).toBeDefined()

    let state: GameState = updatePlayer(BASE, 'p2', (player) =>
      withTiles(player, [[extra as Axial, { id: 'c-p2', color: 'castle' }]]),
    )
    // 双方除 vp 与领地以外的终局加分项全部清零，只留下平手判定可比
    const level = (vp: number) => (player: PlayerState): PlayerState => ({
      ...player,
      vp,
      goods: {},
      soldGoods: {},
      bonusTiles: {},
      silverlings: 0,
      workers: 0,
    })
    state = updatePlayer(state, 'p1', level(10))
    state = updatePlayer(state, 'p2', level(10))

    const result = finalScore(DEFAULT_RULESET, state)
    // p2 多放一块 → 空格更少 → 总分相同则 p2 胜
    expect(result.winnerId).toBe('p2')
    expect(result.tiebreakNote).toContain('空格')
  })

  it('能力派生只看已放置的知识板块（在手上的不算）', () => {
    expect(capabilitiesOf(playerById(BASE, 'p1')).dieStepsPerWorker).toBe(1)
    const state = place(BASE, 'p1', [
      [spacesOfColor('knowledge')[0] as Axial, knowledgeTile(8)],
    ])
    expect(capabilitiesOf(playerById(state, 'p1')).dieStepsPerWorker).toBe(2)
  })
})
