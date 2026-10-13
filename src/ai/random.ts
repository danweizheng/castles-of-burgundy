/**
 * 临时占位对手：从合法行动里随机挑一个。
 *
 * 它存在的唯一目的，是让界面现在就能完整走完一局，用来验证流程与交互。
 * 下一阶段的 Automa 拟人对手会替换掉它 —— 接口完全一样：
 * 「给定合法行动列表，返回一个行动」。所以替换时 UI 一行都不用改。
 */

import type { Move } from '../engine/moves'

export function pickRandomMove(moves: readonly Move[]): Move | undefined {
  if (moves.length === 0) return undefined
  const index = Math.floor(Math.random() * moves.length)
  return moves[index]
}
