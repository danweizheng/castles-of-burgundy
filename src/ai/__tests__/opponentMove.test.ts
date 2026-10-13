import { describe, expect, it } from 'vitest'
import { createGame } from '../../engine/setup'
import { CONFIG } from '../../engine/__tests__/testUtils'
import { decisionRng } from '../decisionRng'
import { opponentMove } from '../opponentMove'

/**
 * 这一组测试钉住一条契约：**对手的决策只取决于局面**。
 *
 * 它对应一个真实缺陷：界面层曾经用一个组件内的 ref 持有随机源，
 * 每次决策前推进一下。后果是撤销之后回退的只有 GameState、不回退那个 ref，
 * 于是 AI 拿着推进过的随机数重新决策，在 normal（有噪声）与 easy（22% 概率随便走）
 * 档上会下出不同的棋 —— 玩家撤销后看到 AI 换了应对，无法解释。
 * 读档之后同样会变，因为那个 ref 不在存档里。
 */

const DIFFICULTIES = ['easy', 'normal', 'hard', 'random'] as const

describe('对手决策只取决于局面', () => {
  for (const difficulty of DIFFICULTIES) {
    it(`${difficulty} 档：同一局面反复求值必得同一手（撤销后 AI 才能复现）`, () => {
      const state = createGame(CONFIG, { seed: 24680 })
      const first = JSON.stringify(opponentMove(CONFIG, state, difficulty))
      expect(first).not.toBe(undefined)

      // 反复调用不得受"上一次调用"影响 —— 这正是不该有外部随机源的判据
      for (let attempt = 0; attempt < 12; attempt += 1) {
        expect(JSON.stringify(opponentMove(CONFIG, state, difficulty)), `第 ${attempt} 次`).toBe(first)
      }
    })
  }

  it('局面不同则可能给出不同决策（否则 AI 会退化成固定套路）', () => {
    // easy 档有 22% 概率随便走，最能体现噪声是否真的在起作用
    const decisions = new Set<string>()
    for (let seed = 1; seed <= 40; seed += 1) {
      const state = createGame(CONFIG, { seed: seed * 97 })
      decisions.add(String(decisionRng(state).s))
    }
    // 40 局应当给出 40 个不同种子
    expect(decisions.size).toBe(40)
  })

  it('决策过程不会改动传入的局面（纯函数，撤销栈才有可能正确）', () => {
    const state = createGame(CONFIG, { seed: 1357 })
    const before = JSON.stringify(state)
    for (const difficulty of DIFFICULTIES) opponentMove(CONFIG, state, difficulty)
    expect(JSON.stringify(state)).toBe(before)
  })
})

describe('局面派生的随机种子', () => {
  it('同一局面得到同一种子，且不受调用顺序影响', () => {
    const state = createGame(CONFIG, { seed: 11 })
    const first = decisionRng(state).s
    decisionRng({ ...state, turnIndex: 999 })
    expect(decisionRng(state).s).toBe(first)
  })

  it('回合数 / 轮次 / 已用行动数 变化时种子跟着变（噪声不会每步都一样）', () => {
    const state = createGame(CONFIG, { seed: 11 })
    const seeds = new Set<number>()
    for (let turn = 0; turn < 50; turn += 1) {
      seeds.add(decisionRng({ ...state, turnIndex: turn }).s)
      // 已用行动数只在 0..2 之间取值，所以它只贡献少数几个新种子
      seeds.add(decisionRng({ ...state, actionsTakenThisTurn: turn % 3 }).s)
    }
    // 50 个回合值 + 3 个行动数取值，去掉重叠后应当有 45 个以上不同种子
    expect(seeds.size).toBeGreaterThan(45)
  })

  it('种子是 32 位无符号整数（可以安全地存进 JSON 存档）', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const value = decisionRng(createGame(CONFIG, { seed: seed * 31 })).s
      expect(Number.isInteger(value)).toBe(true)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(0xffffffff)
    }
  })
})
