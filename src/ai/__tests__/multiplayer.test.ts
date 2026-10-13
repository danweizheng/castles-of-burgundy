import { describe, expect, it } from 'vitest'
import { applyMove } from '../../engine/apply'
import { listLegalMoves } from '../../engine/moves'
import { createGame } from '../../engine/setup'
import { evaluate, pickMove } from '../heuristic'
import { decisionRng } from '../decisionRng'
import { pickRandomMove } from '../random'
import { CONFIG } from '../../engine/__tests__/testUtils'
import type { GameState } from '../../engine/state'

/**
 * 3 / 4 人局里的 AI。
 *
 * 起因：`evaluate` 里写着 `players.find(p => p.id !== playerId)` —— **只取第一位对手**。
 * 项目长期只支持 2 人局，所以那一行看不出问题；一旦 3/4 人局可玩，
 * 它就变成真缺陷：AI 对另外两位对手的进度完全无感，也就不会去卡他们。
 *
 * 改成取"最强的对手"：输给任何一位都算输，该盯的是领跑者。
 * **2 人局行为是否逐位不变**没有写成断言 —— 那需要把整条公式抄一遍（会随实现漂移）；
 * 改用 git 暂存做 A/B 对比确认：hard vs normal 12 胜 0 负、159.8 : 96.8，
 * normal vs 随机 20 胜 0 负、105.8 : 25.2，改动前后完全一致。
 */

const THREE = { ...CONFIG, playerCount: 3 as const }
const FOUR = { ...CONFIG, playerCount: 4 as const }

/** 把某位玩家的分数抬高，用来观察评估是否"看得见他"。 */
function boost(state: GameState, playerId: string, amount = 90): GameState {
  return {
    ...state,
    players: state.players.map((player) =>
      player.id === playerId ? { ...player, vp: player.vp + amount } : player,
    ),
  }
}

describe('多人局里的局面评估', () => {
  it('3 人局要看得见所有对手：只把"第二位对手"做强，评估必须跟着下降', () => {
    const state = createGame(THREE, { seed: 1010 })
    const others = state.players.filter((player) => player.id !== 'p1')
    // 关键：挑**不是第一位**的那位对手 —— 旧代码只看 others[0]，对它完全无感
    const ignored = others[1]
    expect(ignored, '3 人局应当有两位对手').toBeDefined()
    expect(others[0]!.id).not.toBe(ignored!.id)

    const before = evaluate(THREE, state, 'p1')
    expect(evaluate(THREE, boost(state, ignored!.id), 'p1')).toBeLessThan(before)
  })

  it('4 人局里任意一位对手变强，评估都会下降（不再只看第一位）', () => {
    const state = createGame(FOUR, { seed: 2020 })
    const before = evaluate(FOUR, state, 'p1')
    const others = state.players.filter((player) => player.id !== 'p1')
    expect(others).toHaveLength(3)

    for (const other of others) {
      expect(
        evaluate(FOUR, boost(state, other.id), 'p1'),
        `${other.id} 变强后评估没有下降 —— 说明它被忽略了`,
      ).toBeLessThan(before)
    }
  })

  it('2 人局里唯一对手变强，评估同样下降（这条改动没有砸掉原有行为）', () => {
    const two = { ...CONFIG, playerCount: 2 as const }
    const state = createGame(two, { seed: 777 })
    const before = evaluate(two, state, 'p1')
    const other = state.players.find((player) => player.id !== 'p1')!
    expect(evaluate(two, boost(state, other.id), 'p1')).toBeLessThan(before)
  })

  it('自己的分数变高时评估上升（对手项没有把符号弄反）', () => {
    const state = createGame(THREE, { seed: 313 })
    const before = evaluate(THREE, state, 'p1')
    expect(evaluate(THREE, boost(state, 'p1'), 'p1')).toBeGreaterThan(before)
  })
})

describe('多人局里的 AI 强度（自对弈冒烟）', () => {
  it('3 人局：贪心档对两位随机对手仍然明显更强', () => {
    const config = THREE
    let better = 0
    const rounds = 4

    for (let i = 0; i < rounds; i += 1) {
      const seed = 500 + i * 37
      let state = createGame(config, { seed })
      let steps = 0
      while (!state.finished && steps < 8000) {
        const moves = listLegalMoves(config, state)
        if (moves.length === 0) break
        const active = state.activePlayerId
        // p1 用贪心档，其余两位随机走
        const move =
          active === 'p1'
            ? pickMove(config, state, active, { difficulty: 'normal', rng: decisionRng(state) })
            : pickRandomMove(moves, decisionRng(state))
        if (move === undefined) break
        state = applyMove(config, state, move).state
        steps += 1
      }

      expect(state.finished, `第 ${i} 局（种子 ${seed}）没打完`).toBe(true)
      const mine = state.players.find((player) => player.id === 'p1')!.vp
      const best = Math.max(
        ...state.players.filter((player) => player.id !== 'p1').map((player) => player.vp),
      )
      if (mine > best) better += 1
    }

    // 随机对手很弱，正常应当全胜；留一局容错（不同种子的骰运差异）
    expect(better, `3 人局只赢了 ${better}/${rounds} 局`).toBeGreaterThanOrEqual(3)
  }, 180_000)
})
