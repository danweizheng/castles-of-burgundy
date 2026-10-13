import { describe, expect, it } from 'vitest'
import { boardIndexOf, colorCountsOf, isAdjacentToAny, regionsOf, validatePlayerBoard } from '../board'
import { SYNTHETIC_BOARD, SYNTHETIC_BOARD_EXPECTED } from '../data/boards/synthetic'
import { axial, axialKey } from '../hex'
import type { BoardSpace, PlayerBoardDef } from '../types'

function boardWith(spaces: readonly BoardSpace[]): PlayerBoardDef {
  return { id: 'test', name: '测试版图', spaces, startingSpace: { q: 0, r: 0 } }
}

const CASTLE_START: BoardSpace = { q: 0, r: 0, color: 'castle', number: 6, regionId: 'castle-1' }

describe('合成版图（开发/测试夹具）', () => {
  it('通过自身校验，总格数 37、六色分布与 1 号版图一致', () => {
    const issues = validatePlayerBoard(SYNTHETIC_BOARD, {
      expectedSize: SYNTHETIC_BOARD_EXPECTED.size,
      expectedColorCounts: SYNTHETIC_BOARD_EXPECTED.colorCounts,
    })
    expect(issues).toEqual([])
  })

  it('六色格数统计与预期一致', () => {
    expect(colorCountsOf(SYNTHETIC_BOARD)).toEqual(SYNTHETIC_BOARD_EXPECTED.colorCounts)
  })

  it('区域按同色连通块派生，各色区域格数分布符合预期', () => {
    const sizesByColor: Record<string, number[]> = {}
    for (const region of regionsOf(SYNTHETIC_BOARD)) {
      const list = sizesByColor[region.color] ?? []
      list.push(region.size)
      sizesByColor[region.color] = list
    }
    for (const list of Object.values(sizesByColor)) list.sort((a, b) => a - b)
    expect(sizesByColor).toEqual(SYNTHETIC_BOARD_EXPECTED.regionSizes)
  })

  it('米色分成 4 个城市，大小 5/3/3/1（与官方对 1 号版图的描述吻合）', () => {
    const cities = regionsOf(SYNTHETIC_BOARD)
      .filter((r) => r.color === 'building')
      .map((r) => r.size)
      .sort((a, b) => b - a)
    expect(cities).toEqual([5, 3, 3, 1])
  })

  it('起始城堡格是 castle 色、点数 6，且六个邻居都在版图上', () => {
    const index = boardIndexOf(SYNTHETIC_BOARD)
    const start = index.get(axialKey(SYNTHETIC_BOARD.startingSpace))
    expect(start?.color).toBe('castle')
    expect(start?.number).toBe(6)

    // 中心格在半径 3 的六边形里，六个邻居必然都在
    for (const neighbor of [axial(1, 0), axial(1, -1), axial(0, -1), axial(-1, 0), axial(-1, 1), axial(0, 1)]) {
      expect(index.has(axialKey(neighbor))).toBe(true)
    }
  })

  it('每个格位都能通过坐标索引查到', () => {
    const index = boardIndexOf(SYNTHETIC_BOARD)
    expect(index.size).toBe(SYNTHETIC_BOARD_EXPECTED.size)
    for (const space of SYNTHETIC_BOARD.spaces) {
      expect(index.get(axialKey(space))).toBe(space)
    }
  })

  it('所有区域都不超过计分表上限（8 格）', () => {
    for (const region of regionsOf(SYNTHETIC_BOARD)) {
      expect(region.size).toBeLessThanOrEqual(SYNTHETIC_BOARD_EXPECTED.maxRegionSize)
    }
  })
})

describe('版图校验器能抓出录入错误', () => {
  it('坐标重复', () => {
    const issues = validatePlayerBoard(boardWith([CASTLE_START, { ...CASTLE_START, number: 3 }]))
    expect(issues.some((i) => i.message.includes('坐标重复'))).toBe(true)
  })

  it('区域不连通', () => {
    const issues = validatePlayerBoard(
      boardWith([
        CASTLE_START,
        { q: 5, r: 5, color: 'building', number: 1, regionId: 'split' },
        { q: -5, r: -5, color: 'building', number: 2, regionId: 'split' },
      ]),
    )
    expect(issues.some((i) => i.message.includes('不连通'))).toBe(true)
  })

  it('同一区域内颜色不统一', () => {
    const issues = validatePlayerBoard(
      boardWith([
        CASTLE_START,
        { q: 1, r: 0, color: 'building', number: 1, regionId: 'mixed' },
        { q: 0, r: 1, color: 'animal', number: 2, regionId: 'mixed' },
      ]),
    )
    expect(issues.some((i) => i.message.includes('颜色不统一'))).toBe(true)
  })

  it('区域超过 8 格（计分表放不下）', () => {
    const row: BoardSpace[] = Array.from({ length: 9 }, (_, i) => ({
      q: i + 1,
      r: 0,
      color: 'building',
      number: 1,
      regionId: 'huge',
    }))
    const issues = validatePlayerBoard(boardWith([CASTLE_START, ...row]))
    expect(issues.some((i) => i.message.includes('超过最大'))).toBe(true)
  })

  it('起始城堡格不在版图上', () => {
    const issues = validatePlayerBoard(
      boardWith([{ q: 9, r: 9, color: 'castle', number: 6, regionId: 'castle-1' }]),
    )
    expect(issues.some((i) => i.message.includes('不在版图上'))).toBe(true)
  })

  it('起始城堡格点数不是 6', () => {
    const issues = validatePlayerBoard(
      boardWith([{ q: 0, r: 0, color: 'castle', number: 4, regionId: 'castle-1' }]),
    )
    expect(issues.some((i) => i.message.includes('点数应为 6'))).toBe(true)
  })

  it('起始城堡格颜色不是 castle', () => {
    const issues = validatePlayerBoard(
      boardWith([{ q: 0, r: 0, color: 'building', number: 6, regionId: 'b-1' }]),
    )
    expect(issues.some((i) => i.message.includes('颜色应为 castle'))).toBe(true)
  })

  it('点数超出 1–6', () => {
    const issues = validatePlayerBoard(
      boardWith([CASTLE_START, { q: 1, r: 0, color: 'mine', number: 7 as never, regionId: 'mine-1' }]),
    )
    expect(issues.some((i) => i.message.includes('骰子点数非法'))).toBe(true)
  })

  it('总格数与各色格数不符时按期望值报错', () => {
    const issues = validatePlayerBoard(boardWith([CASTLE_START]), {
      expectedSize: 37,
      expectedColorCounts: { building: 12 },
    })
    expect(issues.some((i) => i.message.includes('总格数应为 37'))).toBe(true)
    expect(issues.some((i) => i.message.includes('building 格数应为 12'))).toBe(true)
  })
})

describe('相邻判定', () => {
  it('只要有一个相邻格已被放置就算相邻', () => {
    const placed = new Set([axialKey(axial(0, 0))])
    expect(isAdjacentToAny(axial(1, 0), placed)).toBe(true)
    expect(isAdjacentToAny(axial(0, 1), placed)).toBe(true)
    expect(isAdjacentToAny(axial(1, 1), placed)).toBe(false) // 距离 2，不是邻居
    expect(isAdjacentToAny(axial(3, 3), placed)).toBe(false)
  })

  it('空领地时任何格都不相邻', () => {
    expect(isAdjacentToAny(axial(0, 0), new Set())).toBe(false)
  })
})
