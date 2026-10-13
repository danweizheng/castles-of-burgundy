import { describe, expect, it } from 'vitest'
import {
  ACTIONS_PER_TURN,
  GOODS_STORAGE_TYPES,
  MAX_REGION_SIZE,
  PHASE_COMPLETION_BONUS,
  REGION_SIZE_VP,
  ROUNDS_PER_PHASE,
  SELL_GOODS_SILVERLINGS,
  STORAGE_CAPACITY,
  TOTAL_PHASES,
  bonusTileVp,
  phaseCompletionBonus,
  regionCompletionVp,
  regionSizeVp,
  sellGoodsVpPerTile,
  workersToVp,
} from '../data/scoring'

describe('区域大小 → 基础分（⚠️ Q1，按三角数实现）', () => {
  it('是三角数 n(n+1)/2，正好覆盖 1–36', () => {
    for (let size = 1; size <= MAX_REGION_SIZE; size += 1) {
      expect(REGION_SIZE_VP[size]).toBe((size * (size + 1)) / 2)
    }
    expect(REGION_SIZE_VP[1]).toBe(1)
    expect(REGION_SIZE_VP[MAX_REGION_SIZE]).toBe(36)
  })

  it('大小超出 1–8 时抛错，而不是静默给 0 分', () => {
    expect(() => regionSizeVp(0)).toThrow()
    expect(() => regionSizeVp(9)).toThrow()
    expect(() => regionSizeVp(2.5)).toThrow()
  })

  it('1 格和 8 格取到两端值', () => {
    expect(regionSizeVp(1)).toBe(1)
    expect(regionSizeVp(8)).toBe(36)
  })
})

describe('阶段奖励分（⚠️ Q2，按等差 10/8/6/4/2 实现）', () => {
  it('五个阶段依次是 10 / 8 / 6 / 4 / 2', () => {
    expect([...PHASE_COMPLETION_BONUS]).toEqual([10, 8, 6, 4, 2])
    expect(phaseCompletionBonus(0)).toBe(10)
    expect(phaseCompletionBonus(4)).toBe(2)
  })

  it('阶段序号越界时抛错', () => {
    expect(() => phaseCompletionBonus(-1)).toThrow()
    expect(() => phaseCompletionBonus(5)).toThrow()
  })

  it('区域完成合计 = 大小分 + 阶段奖励分（官方：与区域大小无关的阶段加分）', () => {
    expect(regionCompletionVp(1, 0)).toBe(1 + 10)
    expect(regionCompletionVp(4, 2)).toBe(10 + 6)
    expect(regionCompletionVp(8, 4)).toBe(36 + 2)
  })

  it('同一个区域越早完成越值钱', () => {
    for (let size = 1; size <= MAX_REGION_SIZE; size += 1) {
      for (let phase = 1; phase < TOTAL_PHASES; phase += 1) {
        expect(regionCompletionVp(size, phase - 1)).toBeGreaterThan(
          regionCompletionVp(size, phase),
        )
      }
    }
  })
})

describe('卖货物', () => {
  it('每枚货物的分数 = 人数（2/3/4 人局分别是 2/3/4 分）', () => {
    expect(sellGoodsVpPerTile(2)).toBe(2)
    expect(sellGoodsVpPerTile(3)).toBe(3)
    expect(sellGoodsVpPerTile(4)).toBe(4)
  })

  it('不支持的入数抛错（本作只做 2 人局，但数值表要完整）', () => {
    expect(() => sellGoodsVpPerTile(1)).toThrow()
    expect(() => sellGoodsVpPerTile(5)).toThrow()
  })

  it('无论卖几枚都只固定得 1 银币（3 号知识板块会改成 2）', () => {
    expect(SELL_GOODS_SILVERLINGS).toBe(1)
  })
})

describe('奖励板块（抢首杀）', () => {
  it('大方块：2/3/4 人局 = 5/6/7 分', () => {
    expect(bonusTileVp(2, 'large')).toBe(5)
    expect(bonusTileVp(3, 'large')).toBe(6)
    expect(bonusTileVp(4, 'large')).toBe(7)
  })

  it('小方块：2/3/4 人局 = 2/3/4 分', () => {
    expect(bonusTileVp(2, 'small')).toBe(2)
    expect(bonusTileVp(3, 'small')).toBe(3)
    expect(bonusTileVp(4, 'small')).toBe(4)
  })

  it('大方块永远比小方块多 3 分', () => {
    for (const count of [2, 3, 4]) {
      expect(bonusTileVp(count, 'large') - bonusTileVp(count, 'small')).toBe(3)
    }
  })
})

describe('终局：工人兑换', () => {
  it('每 2 个工人 1 分，向下取整', () => {
    expect(workersToVp(0)).toBe(0)
    expect(workersToVp(1)).toBe(0)
    expect(workersToVp(2)).toBe(1)
    expect(workersToVp(3)).toBe(1)
    expect(workersToVp(7)).toBe(3)
  })

  it('负数抛错', () => {
    expect(() => workersToVp(-1)).toThrow()
  })
})

describe('结构常量与官方规则一致', () => {
  it('5 阶段 × 5 轮、每回合 2 个行动（每行动一颗骰子）', () => {
    expect(TOTAL_PHASES).toBe(5)
    expect(ROUNDS_PER_PHASE).toBe(5)
    expect(ACTIONS_PER_TURN).toBe(2)
    // 每人每局行动数 = 5 × 5 × 2 = 50
    expect(TOTAL_PHASES * ROUNDS_PER_PHASE * ACTIONS_PER_TURN).toBe(50)
  })

  it('板块仓储 3 格、货物仓储最多 3 种颜色', () => {
    expect(STORAGE_CAPACITY).toBe(3)
    expect(GOODS_STORAGE_TYPES).toBe(3)
  })
})
