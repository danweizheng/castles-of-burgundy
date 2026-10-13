import { describe, expect, it } from 'vitest'
import { axialKey } from '../../engine/hex'
import type { DieValue, TileColor } from '../../engine/types'
import {
  DEFAULT_COLOR,
  DEFAULT_NUMBER,
  boardToJson,
  cellKey,
  cellsFromJson,
  createCanvas,
  deriveBoard,
  summarize,
  type EditorCell,
} from '../model'

function canvasWith(
  entries: ReadonlyArray<readonly [number, number, TileColor, DieValue?]>,
  start?: readonly [number, number],
): EditorCell[] {
  const canvas = createCanvas()
  return canvas.map((cell) => {
    const hit = entries.find(([q, r]) => q === cell.q && r === cell.r)
    if (hit === undefined) return cell
    return {
      ...cell,
      active: true,
      color: hit[2],
      number: hit[3] ?? DEFAULT_NUMBER,
      isStart: start !== undefined && start[0] === cell.q && start[1] === cell.r,
    }
  })
}

describe('录入画布', () => {
  it('半径 4 的六边形画布是 61 格，初始全部为"不存在"', () => {
    const canvas = createCanvas()
    expect(canvas).toHaveLength(61)
    expect(canvas.every((cell) => !cell.active)).toBe(true)
    expect(new Set(canvas.map((cell) => cellKey(cell))).size).toBe(61)
  })

  it('空画布给出可读的错误，而不是崩掉', () => {
    const result = deriveBoard(createCanvas(), '1', '测试')
    expect(result.board).toBeUndefined()
    expect(result.issues[0]?.message).toContain('还没有录入任何格子')
  })
})

describe('区域按同色连通块派生', () => {
  it('两块不相连的同色区域会各自成区（这正是官方对"区域"的定义）', () => {
    // 两个分离的米色小块：{0,0} 与 {3,0}，还有 {3,1} 与 {3,0} 相连
    const cells = canvasWith([
      [0, 0, 'building'],
      [3, 0, 'building'],
      [3, 1, 'building'],
      [0, 1, 'building'],
      [1, 0, 'castle', 6],
    ])
    const result = deriveBoard(cells, '1', '测试')
    expect(result.board).toBeDefined()
    const regions = new Set(result.board!.spaces.map((space) => space.regionId))
    // {(0,0),(0,1)} 一块；{(3,0),(3,1)} 一块
    expect(regions.size).toBe(3) // 两块米色 + 一块城堡
  })

  it('相邻的同色格子会并成同一区域', () => {
    const cells = canvasWith([
      [0, 0, 'animal'],
      [0, 1, 'animal'],
      [1, 0, 'castle', 6],
    ])
    const result = deriveBoard(cells, '1', '测试')
    const animalRegions = new Set(
      result.board!.spaces.filter((s) => s.color === 'animal').map((s) => s.regionId),
    )
    expect(animalRegions.size).toBe(1)
  })
})

describe('起始城堡格', () => {
  it('优先用被标记的那一格', () => {
    const cells = canvasWith(
      [
        [0, 0, 'castle', 6],
        [2, 0, 'castle', 3],
      ],
      [2, 0],
    )
    const result = deriveBoard(cells, '1', '测试')
    expect(result.board!.startingSpace).toEqual({ q: 2, r: 0 })
    expect(result.issues.some((issue) => issue.message.includes('没有标记'))).toBe(false)
  })

  it('没标记时退回第一个深红格，并给出提示', () => {
    const cells = canvasWith(
      [
        [0, 0, 'building'],
        [2, 0, 'castle', 3],
      ],
      undefined,
    )
    const result = deriveBoard(cells, '1', '测试')
    expect(result.board!.startingSpace).toEqual({ q: 2, r: 0 })
    expect(result.issues.some((issue) => issue.message.includes('没有标记'))).toBe(true)
  })

  it('把非深红格标成起始格时，引擎校验器会报错（录入器复用同一份校验）', () => {
    const cells = canvasWith([[0, 0, 'building']], [0, 0])
    const result = deriveBoard(cells, '1', '测试')
    expect(result.issues.some((issue) => issue.message.includes('颜色应为 castle'))).toBe(true)
  })

  it('完全没有深红格时提示开局城堡无处安放', () => {
    const cells = canvasWith([[0, 0, 'building']])
    const result = deriveBoard(cells, '1', '测试')
    expect(result.issues.some((issue) => issue.message.includes('无处安放'))).toBe(true)
  })
})

describe('概括文本', () => {
  it('包含格子数、各色格数与米色城市大小', () => {
    const cells = canvasWith([
      [0, 0, 'building'],
      [0, 1, 'building'],
      [1, 0, 'building'],
      [3, 0, 'building'],
      [0, 2, 'castle', 6],
    ])
    const board = deriveBoard(cells, '1', '测试').board!
    const text = summarize(board)
    expect(text).toContain('共 5 格')
    expect(text).toContain('building 4')
    expect(text).toContain('castle 1')
    // 一个 3 格城市 + 一个 1 格城市
    expect(text).toContain('3/1')
  })
})

describe('导出与导入', () => {
  it('导出后能原样读回', () => {
    const cells = canvasWith(
      [
        [0, 0, 'castle', 6],
        [0, 1, 'animal', 3],
        [1, 1, 'animal', 4],
      ],
      [0, 0],
    )
    const board = deriveBoard(cells, '1', '测试版图').board!
    const restored = cellsFromJson(createCanvas(), boardToJson(board))
    expect(restored.error).toBeUndefined()

    const again = deriveBoard(restored.cells!, '1', '测试版图').board!
    expect(again.spaces.length).toBe(board.spaces.length)
    expect(again.startingSpace).toEqual(board.startingSpace)
    // 区域的连通结构也要一致
    const signature = (b: typeof board): string =>
      b.spaces
        .map((space) => `${space.q},${space.r}:${space.color}:${space.number}:${space.regionId}`)
        .sort()
        .join('|')
    expect(signature(again)).toBe(signature(board))
  })

  it('画布之外的新格子会被自动补进画布', () => {
    const board = {
      id: 'x',
      name: 'x',
      spaces: [{ q: -5, r: 0, color: 'building' as TileColor, number: 2 as DieValue, regionId: 'building-1' }],
      startingSpace: { q: -5, r: 0 },
    }
    const restored = cellsFromJson(createCanvas(), JSON.stringify(board))
    expect(restored.error).toBeUndefined()
    expect(restored.cells!.some((cell) => cell.q === -5 && cell.active)).toBe(true)
  })

  it('上一次录入残留的格子会被清掉（不会和新导入的混在一起）', () => {
    const stale = canvasWith([[0, 0, 'animal']])
    const board = {
      id: 'x',
      name: 'x',
      spaces: [{ q: 4, r: 0, color: 'castle' as TileColor, number: 6 as DieValue, regionId: 'castle-1' }],
      startingSpace: { q: 4, r: 0 },
    }
    const restored = cellsFromJson(stale, JSON.stringify(board))
    expect(restored.cells!.filter((cell) => cell.active).map(cellKey)).toEqual(['4,0'])
  })

  it('坏输入给出可读错误', () => {
    expect(cellsFromJson(createCanvas(), '{不是 json').error).toContain('不是合法 JSON')
    expect(cellsFromJson(createCanvas(), '[]').error).toContain('顶层不是对象')
    expect(cellsFromJson(createCanvas(), '{}').error).toContain('缺少 spaces')
  })

  it('默认颜色与默认点数有明确取值（避免出现 undefined 的格子）', () => {
    expect(DEFAULT_COLOR).toBe('building')
    expect(DEFAULT_NUMBER).toBe(1)
    expect(axialKey({ q: 0, r: 0 })).toBe('0,0')
  })
})
