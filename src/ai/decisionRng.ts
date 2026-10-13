/**
 * AI 决策用的随机数：**由局面本身派生**，不另外维护一份随机状态。
 *
 * 为什么这么做（这是一个真实缺陷修掉之后留下的设计）：
 * 早先界面层用 useRef 持有一个随机数发生器，每步决策前推进它。于是：
 *
 * 1. **撤销之后 AI 可能改下另一手。** 撤销只回退 GameState，不回退那个 ref；
 *    等局面再次轮到 AI，它拿着已经推进过的随机数重新决策，
 *    在 normal（有噪声）与 easy（22% 概率随便走）档上会下出不同的棋。
 *    玩家的直觉是"撤销 = 回到刚才那一刻"，AI 的应对却变了，很难解释。
 * 2. **读档之后 AI 行为也会变**，因为那个 ref 不在存档里。
 * 3. 它违反项目自己的架构红线：**所有随机都必须来自 GameState 里的 seed**。
 *    引擎一直遵守，是界面层破的例。
 *
 * 改成从 (state.rng, turnIndex, roundIndex, actionsTakenThisTurn) 派生之后：
 * 同一个局面永远得到同一个种子 → 撤销后 AI 复现同一手、读档后行为一致、
 * 整局可复现；同时不同回合/不同种子仍然得到不同噪声，'easy' 档不会退化成固定套路。
 */

import type { RngState } from '../engine/rng'
import type { GameState } from '../engine/state'

/** 32 位混合函数（wyhash 风格的乘加 + 末轮异或扰动）。 */
export function decisionRng(state: GameState): RngState {
  let hash = state.rng.s | 0
  hash = Math.imul(hash ^ state.turnIndex, 0x9e3779b1)
  hash = Math.imul(hash ^ state.roundIndex, 0x85ebca6b)
  hash = Math.imul(hash ^ state.actionsTakenThisTurn, 0xc2b2ae35)
  hash = Math.imul(hash ^ (state.pending.length + 1), 0x27d4eb2f)
  hash ^= hash >>> 15
  return { s: hash >>> 0 }
}
