import { describe, expect, it } from 'vitest'
import {
  deriveCapabilities,
  dieOptions,
  knowledgeIdsInEstate,
  wrapDie,
} from '../capabilities'
import type { DieValue, HexTile } from '../types'

describe('能力派生：默认值（没有任何知识板块）', () => {
  const caps = deriveCapabilities([])

  it('规则中没有加成的项都是中性值', () => {
    expect(caps.ignoreBuildingLimitPerCity).toBe(false)
    expect(caps.workerPerMineAtPhaseEnd).toBe(false)
    expect(caps.silverlingsPerSell).toBe(1)
    expect(caps.workersPerSell).toBe(0)
    expect(caps.shipTakesTwoGoodsSpaces).toBe(false)
    expect(caps.takeBuildingWithWorkersCost).toBe(0)
    expect(caps.animalTileBonusVp).toBe(0)
    expect(caps.dieStepsPerWorker).toBe(1)
    expect(caps.freeDieAdjustColors.size).toBe(0)
    expect(caps.freeDieAdjustOnTake).toBe(false)
    expect(caps.silverlingsOnTakeWorkers).toBe(0)
    expect(caps.workersOnTakeWorkers).toBe(2)
    expect(caps.finalVpPerSoldGoodsType).toBe(0)
    expect(caps.finalVpPerBuilding.size).toBe(0)
    expect(caps.finalVpPerAnimalType).toBe(0)
    expect(caps.finalVpPerSoldGoodsTile).toBe(0)
    expect(caps.finalVpPerBonusTile).toBe(0)
  })
})

describe('能力派生：逐张知识板块', () => {
  it('8 号把每个工人的调整幅度从 ±1 变成 ±2', () => {
    expect(deriveCapabilities([8]).dieStepsPerWorker).toBe(2)
  })

  it('9 / 10 / 11 号分别解锁对应颜色的免费 ±1', () => {
    expect([...deriveCapabilities([9]).freeDieAdjustColors]).toEqual(['building'])
    expect([...deriveCapabilities([10]).freeDieAdjustColors].sort()).toEqual(['animal', 'ship'])
    expect([...deriveCapabilities([11]).freeDieAdjustColors].sort()).toEqual([
      'castle',
      'knowledge',
      'mine',
    ])
    expect(deriveCapabilities([9, 10, 11]).freeDieAdjustColors.size).toBe(6)
  })

  it('12 号解锁"取板块"时的免费 ±1', () => {
    expect(deriveCapabilities([12]).freeDieAdjustOnTake).toBe(true)
    expect(deriveCapabilities([11]).freeDieAdjustOnTake).toBe(false)
  })

  it('3 / 4 号改卖货物的收益', () => {
    const caps = deriveCapabilities([3, 4])
    expect(caps.silverlingsPerSell).toBe(2)
    expect(caps.workersPerSell).toBe(1)
  })

  it('13 / 14 号改"取 2 个工人"的收益', () => {
    expect(deriveCapabilities([13]).silverlingsOnTakeWorkers).toBe(1)
    expect(deriveCapabilities([13]).workersOnTakeWorkers).toBe(2)
    expect(deriveCapabilities([14]).workersOnTakeWorkers).toBe(4)
  })

  it('16–23 号各自解锁一种建筑的终局 4 分', () => {
    expect(deriveCapabilities([17]).finalVpPerBuilding.get('watchtower')).toBe(4)
    expect(deriveCapabilities([22]).finalVpPerBuilding.get('bank')).toBe(4)
    expect(deriveCapabilities([17]).finalVpPerBuilding.get('bank')).toBeUndefined()
    expect(deriveCapabilities([16, 17, 18, 19, 20, 21, 22, 23]).finalVpPerBuilding.size).toBe(8)
  })

  it('15 / 24 / 25 / 26 号的终局分值（按 Special Edition 规则书）', () => {
    expect(deriveCapabilities([15]).finalVpPerSoldGoodsType).toBe(2)
    expect(deriveCapabilities([24]).finalVpPerAnimalType).toBe(4)
    expect(deriveCapabilities([25]).finalVpPerSoldGoodsTile).toBe(1)
    expect(deriveCapabilities([26]).finalVpPerBonusTile).toBe(3)
  })

  it('6 号：Special Edition 是"花 2 个工人取一枚建筑"，不是经典版的"从 7 个仓库购买"', () => {
    expect(deriveCapabilities([6]).takeBuildingWithWorkersCost).toBe(2)
    expect(deriveCapabilities([]).takeBuildingWithWorkersCost).toBe(0)
  })

  it('把全部 26 张都放上时不会崩，且各能力都取到上限', () => {
    const all = Array.from({ length: 26 }, (_, i) => i + 1)
    const caps = deriveCapabilities(all)
    expect(caps.dieStepsPerWorker).toBe(2)
    expect(caps.workersOnTakeWorkers).toBe(4)
    expect(caps.freeDieAdjustColors.size).toBe(6)
    expect(caps.finalVpPerBuilding.size).toBe(8)
  })
})

describe('从领地取出已放置的知识板块编号', () => {
  it('只看知识板块，忽略其他颜色', () => {
    const estate: Record<string, HexTile> = {
      '0,0': { id: 'castle-001', color: 'castle' },
      '1,0': { id: 'knowledge-001', color: 'knowledge', knowledge: 8 },
      '0,1': { id: 'knowledge-002', color: 'knowledge', knowledge: 11 },
      '1,1': { id: 'mine-001', color: 'mine' },
    }
    expect(knowledgeIdsInEstate(estate).sort((a, b) => a - b)).toEqual([8, 11])
  })

  it('空领地返回空数组', () => {
    expect(knowledgeIdsInEstate({})).toEqual([])
  })
})

describe('骰子点数的环绕', () => {
  it('1 往下走是 6，6 往上走是 1', () => {
    expect(wrapDie(0)).toBe(6)
    expect(wrapDie(7)).toBe(1)
    expect(wrapDie(-1)).toBe(5)
    expect(wrapDie(8)).toBe(2)
  })

  it('1–6 原样返回', () => {
    for (const v of [1, 2, 3, 4, 5, 6]) expect(wrapDie(v)).toBe(v)
  })
})

describe('dieOptions：一颗骰子能变成什么', () => {
  it('没有工人也没有免费调整时，只能是自己', () => {
    expect(dieOptions({ die: 3, workers: 0, freeAdjust: false, stepsPerWorker: 1 })).toEqual([
      { value: 3, workersSpent: 0 },
    ])
  })

  it('免费调整不需要工人，且覆盖 ±1', () => {
    expect(dieOptions({ die: 3, workers: 0, freeAdjust: true, stepsPerWorker: 1 })).toEqual([
      { value: 2, workersSpent: 0 },
      { value: 3, workersSpent: 0 },
      { value: 4, workersSpent: 0 },
    ])
  })

  it('1 个工人在 1–6 之间环绕（1 可以变成 6）', () => {
    const options = dieOptions({ die: 1, workers: 1, freeAdjust: false, stepsPerWorker: 1 })
    expect(options).toEqual([
      { value: 1, workersSpent: 0 },
      { value: 2, workersSpent: 1 },
      { value: 6, workersSpent: 1 },
    ])
  })

  it('6 往上走会绕回 1', () => {
    const values = dieOptions({ die: 6, workers: 1, freeAdjust: false, stepsPerWorker: 1 }).map(
      (o) => o.value,
    )
    expect(values.sort((a, b) => a - b)).toEqual([1, 5, 6])
  })

  it('8 号知识板块下 1 个工人可达 ±2（1 能变成 3 和 5）', () => {
    const options = dieOptions({ die: 1, workers: 1, freeAdjust: false, stepsPerWorker: 2 })
    expect(options.map((o) => o.value).sort((a, b) => a - b)).toEqual([1, 2, 3, 5, 6])
    for (const option of options) expect(option.workersSpent).toBeLessThanOrEqual(1)
  })

  it('免费调整与工人调整可以叠加', () => {
    const options = dieOptions({ die: 4, workers: 1, freeAdjust: true, stepsPerWorker: 1 })
    // 免费 ±1 落点 3/4/5；再各用 1 个工人可到 2/6/... 合起来覆盖 2..6 全部
    expect(options.map((o) => o.value).sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6])
    // 4 本身不需要工人；相邻的 3/5 靠免费调整也不需要工人
    expect(options.find((o) => o.value === 4)?.workersSpent).toBe(0)
    expect(options.find((o) => o.value === 3)?.workersSpent).toBe(0)
    expect(options.find((o) => o.value === 5)?.workersSpent).toBe(0)
    expect(options.find((o) => o.value === 2)?.workersSpent).toBe(1)
  })

  it('同一目标点数取工人消耗最小的方案', () => {
    // 从 1 出发，只用 1 个工人就能到 2；不该出现"花 2 个工人"的重复项
    const options = dieOptions({ die: 1, workers: 3, freeAdjust: false, stepsPerWorker: 1 })
    const values = options.map((o) => o.value)
    expect(new Set(values).size).toBe(values.length)
    expect(options.find((o) => o.value === 2)?.workersSpent).toBe(1)
    expect(options.find((o) => o.value === 3)?.workersSpent).toBe(2)
  })

  it('工人够多时可以到达任意点数', () => {
    const values = dieOptions({
      die: 1,
      workers: 6,
      freeAdjust: false,
      stepsPerWorker: 1,
    }).map((o) => o.value as DieValue)
    expect([...values].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('结果按点数升序排列（便于 UI 与快照测试）', () => {
    const options = dieOptions({ die: 5, workers: 2, freeAdjust: true, stepsPerWorker: 1 })
    const values = options.map((o) => o.value)
    expect(values).toEqual([...values].sort((a, b) => a - b))
  })

  it('拒绝非法的工人数与调整幅度', () => {
    expect(() => dieOptions({ die: 1, workers: -1, freeAdjust: false, stepsPerWorker: 1 })).toThrow()
    expect(() => dieOptions({ die: 1, workers: 0.5, freeAdjust: false, stepsPerWorker: 1 })).toThrow()
    expect(() => dieOptions({ die: 1, workers: 1, freeAdjust: false, stepsPerWorker: 0 })).toThrow()
  })
})
