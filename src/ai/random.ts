/**
 * 最弱的一档对手：从合法行动里随机挑一个。
 *
 * 注意它**必须接收 rng**，不能用 Math.random()。
 * 早先这里用的是 Math.random()，于是"随机"档成了唯一不遵守
 * 「所有随机都来自 GameState 的 seed」这条红线的对手 ——
 * 后果与界面层那个外部随机源一样：撤销之后 AI 会改下另一手、读档之后行为也会变。
 */

import { nextInt, type RngState } from '../engine/rng'
import type { Move } from '../engine/moves'

export function pickRandomMove(moves: readonly Move[], rng: RngState): Move | undefined {
  if (moves.length === 0) return undefined
  // 克隆一份再用：不改动调用方传进来的随机状态，让"这是纯函数"一眼可辨
  const local: RngState = { s: rng.s }
  return moves[nextInt(local, moves.length)]
}
