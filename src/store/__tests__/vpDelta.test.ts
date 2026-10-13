import { describe, expect, it } from 'vitest'
import type { PlayerId, PlayerState } from '../../engine/types'
import { BASE_STATE } from '../../engine/__tests__/testUtils'
import { vpDeltas } from '../vpDelta'

function players(vp1: number, vp2: number): PlayerState[] {
  const p1 = { ...BASE_STATE.players[0]!, id: 'p1' as PlayerId, vp: vp1 }
  const p2 = { ...BASE_STATE.players[1]!, id: 'p2' as PlayerId, vp: vp2 }
  return [p1, p2]
}

describe('得分增量（飘字用）', () => {
  it('算出每位玩家这一手的加分', () => {
    expect(vpDeltas(players(10, 5), players(17, 5))).toEqual({ p1: 7 })
    expect(vpDeltas(players(10, 5), players(10, 12))).toEqual({ p2: 7 })
    expect(vpDeltas(players(0, 0), players(3, 4))).toEqual({ p1: 3, p2: 4 })
  })

  it('没有加分时返回空对象（界面因此不会飘出 +0）', () => {
    expect(vpDeltas(players(10, 10), players(10, 10))).toEqual({})
  })

  it('分数下降不产生飘字（本作没有扣分，出现即说明状态被改坏了）', () => {
    expect(vpDeltas(players(10, 10), players(4, 10))).toEqual({})
  })

  it('忽略 before 里没有的玩家（例如人数变化）', () => {
    const extra: PlayerState = { ...BASE_STATE.players[0]!, id: 'p3' as PlayerId, vp: 9 }
    expect(vpDeltas(players(0, 0), [...players(1, 1), extra])).toEqual({ p1: 1, p2: 1 })
  })
})
