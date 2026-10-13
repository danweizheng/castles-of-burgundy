import { describe, expect, it } from 'vitest'
import { phaseCompletionBonus, regionSizeVp, bonusTileVp } from '../../engine/data/scoring'
import { regionsOf } from '../../engine/board'
import type { PlayerId } from '../../engine/types'
import {
  BASE_STATE,
  CONFIG,
  BOARD,
  animalTile,
  castleTile,
  estateOf,
} from '../../engine/__tests__/testUtils'
import { threatsFor, urgentThreats } from '../threats'

const ACTIVE: PlayerId = 'p1'

function animalRegions(): Array<Array<{ q: number; r: number }>> {
  return regionsOf(BOARD)
    .filter((region) => region.color === 'animal')
    .map((region) => region.spaces.map((space) => ({ q: space.q, r: space.r })))
}

describe('威胁分析', () => {
  it('开局没有威胁（什么都还没铺）', () => {
    expect(threatsFor(CONFIG, BASE_STATE, ACTIVE)).toEqual([])
  })

  it('区域还差 1 格时列为紧急威胁，分值 = 大小分 + 阶段奖励', () => {
    // 牧场是 3 格；先放满 2 格
    const region = animalRegions().find((spaces) => spaces.length === 3)!
    const state = estateOf(BASE_STATE, ACTIVE, [
      [spaces0(region), animalTile('a1', 'cow', 3)],
      [spaces1(region), animalTile('a2', 'cow', 3)],
    ])

    const threats = threatsFor(CONFIG, state, ACTIVE)
    const regionThreat = threats.find((threat) => threat.kind === 'region')
    expect(regionThreat).toBeDefined()
    expect(regionThreat!.remaining).toBe(1)
    expect(regionThreat!.value).toBe(regionSizeVp(3) + phaseCompletionBonus(0))
    expect(regionThreat!.label).toContain('3 格')
    expect(urgentThreats(threats)).toContain(regionThreat)
  })

  it('只填了 1/3 的区域不列（"已填一半"才算接近完成）', () => {
    const region = animalRegions().find((spaces) => spaces.length === 3)!
    const state = estateOf(BASE_STATE, ACTIVE, [[spaces0(region), animalTile('a1', 'cow', 3)]])
    const threats = threatsFor(CONFIG, state, ACTIVE).filter((threat) => threat.kind === 'region')
    expect(threats).toEqual([])
  })

  it('2 格区域一格都没放时也不列（否则开局会报出一串毫无意义的威胁）', () => {
    const state = BASE_STATE
    const threats = threatsFor(CONFIG, state, ACTIVE)
    // 开局只有起始城堡；未铺满的 1 格区域与"还差 2 格"的小区域都不该出现
    expect(threats.filter((threat) => threat.remaining === 2)).toEqual([])
  })

  it('某色还差 1–2 格时列为抢奖励板块的威胁，分值为大方块(2 人局 5 分)', () => {
    // 城堡共 4 格，开局已放 1 格（起始城堡）→ 放满 2 格后还剩 1 格
    const castles = BOARD.spaces.filter((space) => space.color === 'castle')
    const extra = castles.find(
      (space) => `${space.q},${space.r}` !== `${BOARD.startingSpace.q},${BOARD.startingSpace.r}`,
    )!
    const state = estateOf(BASE_STATE, ACTIVE, [[{ q: extra.q, r: extra.r }, castleTile('c-extra')]])

    const colorThreat = threatsFor(CONFIG, state, ACTIVE).find((threat) => threat.kind === 'color')
    expect(colorThreat).toBeDefined()
    expect(colorThreat!.remaining).toBe(2)
    expect(colorThreat!.value).toBe(bonusTileVp(2, 'large'))
  })

  it('奖励板块已被领走两枚后，该色不再算威胁', () => {
    const castles = BOARD.spaces.filter((space) => space.color === 'castle')
    const extra = castles.find(
      (space) => `${space.q},${space.r}` !== `${BOARD.startingSpace.q},${BOARD.startingSpace.r}`,
    )!
    const withTile = estateOf(BASE_STATE, ACTIVE, [[{ q: extra.q, r: extra.r }, castleTile('c-extra')]])
    const claimedTwice = {
      ...withTile,
      bonusTilesClaimed: { ...withTile.bonusTilesClaimed, castle: ['large', 'small'] as const },
    }

    expect(
      threatsFor(CONFIG, claimedTwice, ACTIVE).filter((threat) => threat.kind === 'color'),
    ).toEqual([])
  })

  it('玩家自己已领过该色奖励板块时不再算威胁', () => {
    const castles = BOARD.spaces.filter((space) => space.color === 'castle')
    const extra = castles.find(
      (space) => `${space.q},${space.r}` !== `${BOARD.startingSpace.q},${BOARD.startingSpace.r}`,
    )!
    let state = estateOf(BASE_STATE, ACTIVE, [[{ q: extra.q, r: extra.r }, castleTile('c-extra')]])
    state = {
      ...state,
      players: state.players.map((player) =>
        player.id === ACTIVE ? { ...player, bonusTiles: { castle: 'large' } } : player,
      ),
    }
    expect(threatsFor(CONFIG, state, ACTIVE).filter((threat) => threat.kind === 'color')).toEqual([])
  })

  it('排序：先按紧急程度（还差几格），再按分值', () => {
    const region = animalRegions().find((spaces) => spaces.length === 3)!
    const state = estateOf(BASE_STATE, ACTIVE, [
      [spaces0(region), animalTile('a1', 'cow', 3)],
      [spaces1(region), animalTile('a2', 'cow', 3)],
    ])
    const threats = threatsFor(CONFIG, state, ACTIVE)
    for (let i = 1; i < threats.length; i += 1) {
      const previous = threats[i - 1]!
      const current = threats[i]!
      expect(previous.remaining).toBeLessThanOrEqual(current.remaining)
    }
  })

  it('玩家引用不存在的版图时返回空数组（不抛错）', () => {
    const broken = {
      ...BASE_STATE,
      players: BASE_STATE.players.map((player) =>
        player.id === ACTIVE ? { ...player, boardId: '不存在' } : player,
      ),
    }
    expect(threatsFor(CONFIG, broken, ACTIVE)).toEqual([])
  })
})

// 小工具：把区域的前两格拿出来（避免在断言里写 index 访问的断言噪音）
function spaces0(region: Array<{ q: number; r: number }>) {
  return region[0]!
}
function spaces1(region: Array<{ q: number; r: number }>) {
  return region[1]!
}
