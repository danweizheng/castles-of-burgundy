import { describe, expect, it } from 'vitest'
import { applyMove } from '../apply'
import { listLegalMoves } from '../moves'
import { createRng, nextInt } from '../rng'
import { createGame } from '../setup'
import type { GameState } from '../state'
import { CONFIG } from './testUtils'

/**
 * 架构根基的机械化验证：**纯函数、可复现、互不干扰**。
 *
 * 整个项目有三条红线，其中两条从来没有被机器化验证过：
 *
 * 1. **`applyMove` 绝不修改传入的 state。**
 *    撤销（快照栈）、AI 推演（克隆同一局面试各种走法）、存档全靠这条。
 *    一旦某个分支顺手改了一下输入，撤销会**静默地**坏掉 ——
 *    快照里存的其实是"后来被改过的"状态，而没有任何测试会变红。
 *    下面用"对所有合法动作逐个试、每试一次都比对原局面的指纹"来兜住它。
 *
 * 2. **同一 seed + 同一串动作 ⇒ 同一结果，且两局互不干扰。**
 *    这条同时兜住"引擎里偷偷用了 Math.random()"与"存在跨局共享的可变状态"
 *    两类问题。后者尤其阴险：单局测试全绿，只有同时开两局才会露出来。
 *    （第 24 轮修掉的"AI 随机源放在 GameState 之外"就是这一类。）
 */

function playToEnd(seed: number, useRandomMoves: boolean, maxSteps = 4000): GameState {
  const rng = createRng(seed ^ 0x5f3759df)
  let state = createGame(CONFIG, { seed })
  let steps = 0
  while (!state.finished && steps < maxSteps) {
    const moves = listLegalMoves(CONFIG, state)
    if (moves.length === 0) break
    const move = useRandomMoves ? moves[nextInt(rng, moves.length)]! : moves[0]!
    state = applyMove(CONFIG, state, move).state
    steps += 1
  }
  return state
}

/** 对局的可比较指纹："谁赢、各得多少分、走了多少步"之外，还要看局面本身。 */
function fingerprint(state: GameState): string {
  return JSON.stringify(state)
}

describe('applyMove 的纯函数性（撤销与 AI 推演的地基）', () => {
  it('对所有合法动作逐个试，原局面一个字段都不许变', () => {
    for (const seed of [3, 42, 777]) {
      let state = createGame(CONFIG, { seed })
      for (let step = 0; step < 15; step += 1) {
        const moves = listLegalMoves(CONFIG, state)
        if (moves.length === 0) break

        const before = fingerprint(state)
        for (const move of moves) {
          // 返回值故意不接：这一条只关心"有没有副作用"
          applyMove(CONFIG, state, move)
          expect(
            fingerprint(state),
            `种子 ${seed} 第 ${step} 步执行 ${move.kind} 之后，传入的局面被改动了`,
          ).toBe(before)
        }

        state = applyMove(CONFIG, state, moves[0]!).state
      }
    }
  })

  it('同一局面的两份克隆：各自走棋互不影响', () => {
    const state = createGame(CONFIG, { seed: 20250101 })
    const moves = listLegalMoves(CONFIG, state)
    expect(moves.length, '开局应当有多个合法动作').toBeGreaterThan(1)

    const left = JSON.parse(fingerprint(state)) as GameState
    const right = JSON.parse(fingerprint(state)) as GameState
    const rightBefore = fingerprint(right)

    applyMove(CONFIG, left, moves[0]!)
    // 左边走了一步，右边必须原封不动
    expect(fingerprint(right)).toBe(rightBefore)

    const leftBefore = fingerprint(left)
    applyMove(CONFIG, right, moves[1]!)
    // 反过来同样成立
    expect(fingerprint(left)).toBe(leftBefore)
  })
})

describe('可复现性与互不干扰', () => {
  it('同一 seed + 同一串动作 ⇒ 完全相同的终局', () => {
    for (const useRandom of [false, true]) {
      const first = playToEnd(1234, useRandom)
      const second = playToEnd(1234, useRandom)
      expect(first.finished).toBe(true)
      expect(fingerprint(second)).toBe(fingerprint(first))
    }
  })

  it('不同 seed ⇒ 不同的局面（否则说明种子其实没起作用）', () => {
    const a = playToEnd(1, true)
    const b = playToEnd(2, true)
    expect(fingerprint(a)).not.toBe(fingerprint(b))
  })

  it('两局交错推进，结果与各自单独推进完全一致（没有跨局共享状态）', () => {
    const seedA = 8888
    const seedB = 9999

    // 单独推进
    const soloA = playToEnd(seedA, true)
    const soloB = playToEnd(seedB, true)

    // 交错推进：每一轮各推进一步
    const rngA = createRng(seedA ^ 0x5f3759df)
    const rngB = createRng(seedB ^ 0x5f3759df)
    let stateA = createGame(CONFIG, { seed: seedA })
    let stateB = createGame(CONFIG, { seed: seedB })
    for (let step = 0; step < 4000; step += 1) {
      if (!stateA.finished) {
        const moves = listLegalMoves(CONFIG, stateA)
        if (moves.length > 0) {
          stateA = applyMove(CONFIG, stateA, moves[nextInt(rngA, moves.length)]!).state
        }
      }
      if (!stateB.finished) {
        const moves = listLegalMoves(CONFIG, stateB)
        if (moves.length > 0) {
          stateB = applyMove(CONFIG, stateB, moves[nextInt(rngB, moves.length)]!).state
        }
      }
      if (stateA.finished && stateB.finished) break
    }

    expect(fingerprint(stateA)).toBe(fingerprint(soloA))
    expect(fingerprint(stateB)).toBe(fingerprint(soloB))
  })

  it('局面能被 JSON 往返（存档格式的前提）', () => {
    const state = playToEnd(31337, false, 120)
    const roundTripped = JSON.parse(JSON.stringify(state)) as GameState
    expect(fingerprint(roundTripped)).toBe(fingerprint(state))
    // 往返之后仍然能继续走棋，说明没有丢掉函数之外的东西
    const moves = listLegalMoves(CONFIG, roundTripped)
    expect(moves.length).toBeGreaterThan(0)
    expect(() => applyMove(CONFIG, roundTripped, moves[0]!)).not.toThrow()
  })
})
