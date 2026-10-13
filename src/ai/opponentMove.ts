/**
 * 对手的一步决策。**把界面里那段逻辑抽出来，是为了让它可测。**
 *
 * 抽出来的理由：这段逻辑原本写在界面组件的 effect 里，于是它"是否依赖局面之外的状态"
 * 没人能验证 —— 事实上它当时确实依赖一个组件内的 ref，
 * 导致撤销之后 AI 会改下另一手、读档之后行为也会变。
 *
 * 现在这个函数是**纯的**：给定 (config, state, difficulty) 必得同一手。
 * 契约由 src/ai/__tests__/opponentMove.test.ts 钉住。
 */

import { listLegalMoves, type Move } from '../engine/moves'
import type { RulesetConfig } from '../engine/state'
import type { GameState } from '../engine/state'
import { decisionRng } from './decisionRng'
import { pickMove, type Difficulty } from './heuristic'
import { pickRandomMove } from './random'

export function opponentMove(
  config: RulesetConfig,
  state: GameState,
  difficulty: Difficulty | 'random',
): Move | undefined {
  const moves = listLegalMoves(config, state)
  if (moves.length === 0) return undefined
  const rng = decisionRng(state)
  if (difficulty === 'random') return pickRandomMove(moves, rng)
  return pickMove(config, state, state.activePlayerId, { difficulty, rng })
}
