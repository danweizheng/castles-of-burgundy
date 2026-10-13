import { describe, expect, it } from 'vitest'
import { applyMove } from '../apply'
import { activeSlots } from '../gameBoard'
import { listLegalMoves } from '../moves'
import { createRng, nextInt } from '../rng'
import { bonusTileVp, sellGoodsVpPerTile, workersToVp } from '../data/scoring'
import { createGame } from '../setup'
import type { GameState } from '../state'
import type { PlayerId } from '../types'
import { CONFIG } from './testUtils'

/**
 * 3 / 4 人局。
 *
 * 起因：`createGame` 里曾写着 `playerCount === 2 ? ['p1','p2'] : ['p1','p2','p3','p4']` ——
 * **3 人局会创建 4 个玩家**。而 3/4 人局此前**一条测试都没有**，所以没人发现。
 * 引擎其余部分（按人数启用仓库格位、黑洞抽取数、卖货分值、奖励板块分值）
 * 其实早就按人数建模了，只是从没被跑过。
 *
 * 这组测试的逻辑：先钉住"能正确开局"，再用**整局随机对局**去撞
 * "代码里暗含 2 人假设"的地方 —— 那是单点断言很难发现的。
 */

const COUNTS = [2, 3, 4] as const

function configFor(playerCount: 2 | 3 | 4) {
  return { ...CONFIG, playerCount }
}

function playToEnd(playerCount: 2 | 3 | 4, seed: number, maxSteps = 8000): GameState {
  const config = configFor(playerCount)
  const rng = createRng(seed)
  let state = createGame(config, { seed })
  let steps = 0
  while (!state.finished && steps < maxSteps) {
    const moves = listLegalMoves(config, state)
    if (moves.length === 0) break
    state = applyMove(config, state, moves[nextInt(rng, moves.length)]!).state
    steps += 1
  }
  return state
}

describe('按人数正确开局', () => {
  for (const playerCount of COUNTS) {
    it(`${playerCount} 人局：玩家数量与编号正确`, () => {
      const state = createGame(configFor(playerCount), { seed: 4242 })
      expect(state.playerCount).toBe(playerCount)
      expect(state.players).toHaveLength(playerCount)

      const expected: PlayerId[] = ['p1', 'p2', 'p3', 'p4'].slice(0, playerCount) as PlayerId[]
      expect([...state.players.map((player) => player.id)].sort()).toEqual([...expected].sort())
      // 顺位轨必须覆盖所有玩家且不重不漏
      expect([...state.turnOrder].sort()).toEqual([...expected].sort())
    })

    it(`${playerCount} 人局：起始工人数按顺位递增（1/2/3/4）`, () => {
      const state = createGame(configFor(playerCount), { seed: 99 })
      const byOrder = state.turnOrder.map(
        (id) => state.players.find((player) => player.id === id)!.workers,
      )
      expect(byOrder).toEqual([1, 2, 3, 4].slice(0, playerCount))
    })

    it(`${playerCount} 人局：启用的仓库格位数符合官方（12 / 18 / 24）`, () => {
      const state = createGame(configFor(playerCount), { seed: 7 })
      const slots = activeSlots(configFor(playerCount).gameBoard, playerCount)
      expect(slots).toHaveLength(6 * playerCount)
      expect(Object.keys(state.depotSlots)).toHaveLength(6 * playerCount)
      // 每个玩家的货物流量一致（每人 3 枚）
      for (const player of state.players) {
        const total = Object.values(player.goods).reduce((sum, count) => sum + count, 0)
        expect(total, `${player.id} 的起始货物数`).toBe(3)
      }
    })
  }
})

describe('按人数变化的分值（官方规则书）', () => {
  it('卖货每枚 2/3/4 分（规则书：+2/3/4 VP per tile (2/3/4 players)）', () => {
    expect(sellGoodsVpPerTile(2)).toBe(2)
    expect(sellGoodsVpPerTile(3)).toBe(3)
    expect(sellGoodsVpPerTile(4)).toBe(4)
  })

  it('奖励板块大块 5/6/7、小块 2/3/4（规则书：顶层那张印着 "5/6/7"）', () => {
    expect(bonusTileVp(2, 'large')).toBe(5)
    expect(bonusTileVp(3, 'large')).toBe(6)
    expect(bonusTileVp(4, 'large')).toBe(7)
    for (const count of COUNTS) expect(bonusTileVp(count, 'small')).toBe(count)
  })

  it('工人折算与人数无关（每 2 个工人 1 分）', () => {
    expect(workersToVp(0)).toBe(0)
    expect(workersToVp(3)).toBe(1)
    expect(workersToVp(4)).toBe(2)
  })

  it('非法人数会被明确拒绝，而不是默默按 2 人算', () => {
    expect(() => sellGoodsVpPerTile(5)).toThrow(/2\/3\/4/)
    expect(() => bonusTileVp(1, 'large')).toThrow(/2\/3\/4/)
  })
})

describe('整局随机对局（最能撞出"代码里暗含 2 人假设"的地方）', () => {
  for (const playerCount of COUNTS) {
    it(`${playerCount} 人局能完整打完，且终局分数合理`, () => {
      // 多个种子：随机走法容易撞到冷门分支
      for (const seed of [11, 22, 33]) {
        const state = playToEnd(playerCount, seed * playerCount)
        expect(state.finished, `${playerCount} 人局（种子 ${seed}）没打完`).toBe(true)
        for (const player of state.players) {
          expect(player.vp, `${player.id} 分数异常`).toBeGreaterThanOrEqual(0)
        }
        // 5 阶段 × 5 轮，轮次计数不因人数而变
        expect(state.phaseIndex).toBe(4)
      }
    }, 120_000)
  }

  it('人数越多、局面越不同（说明人数真的参与了初始化，而不是被忽略）', () => {
    const two = createGame(configFor(2), { seed: 555 })
    const three = createGame(configFor(3), { seed: 555 })
    const four = createGame(configFor(4), { seed: 555 })
    expect(JSON.stringify(two)).not.toBe(JSON.stringify(three))
    expect(JSON.stringify(three)).not.toBe(JSON.stringify(four))
  })
})
