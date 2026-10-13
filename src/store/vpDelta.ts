/**
 * 得分飘字的增量来源。
 *
 * 为什么不从事件里解析分数：事件只覆盖了一部分加分途径
 * （瞭望塔的 +4 不是一个带 vp 的事件），从事件里凑一定会漏。
 * 直接比较"这一手前后每位玩家的分数"则天然覆盖全部途径，且不可能算错。
 */

import type { PlayerId, PlayerState } from '../engine/types'

export type VpDeltas = Partial<Record<PlayerId, number>>

export function vpDeltas(before: readonly PlayerState[], after: readonly PlayerState[]): VpDeltas {
  const previous = new Map<PlayerId, number>()
  for (const player of before) previous.set(player.id, player.vp)

  const deltas: VpDeltas = {}
  for (const player of after) {
    const previousVp = previous.get(player.id)
    // before 里没有这位玩家就无从计算增量。当成 0 分算的话会飘出一个虚假的"总分"，
    // 所以这里选择跳过，而不是硬凑一个数字。
    if (previousVp === undefined) continue

    const delta = player.vp - previousVp
    // 只飘正分：扣分在本作里不存在，负值出现即说明状态被改坏了，不该画出来
    if (delta > 0) deltas[player.id] = delta
  }
  return deltas
}
