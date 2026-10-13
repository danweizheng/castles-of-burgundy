import { describe, expect, it } from 'vitest'
import {
  areAdjacent,
  axial,
  axialDistance,
  axialKey,
  connectedComponents,
  neighbors,
  parseAxialKey,
} from '../hex'

describe('六边形几何', () => {
  it('自身距离为 0，相邻距离为 1', () => {
    expect(axialDistance(axial(0, 0), axial(0, 0))).toBe(0)
    expect(axialDistance(axial(2, -3), axial(2, -3))).toBe(0)
    for (const n of neighbors(axial(0, 0))) {
      expect(axialDistance(axial(0, 0), n)).toBe(1)
    }
  })

  it('每个格子恰好有 6 个相邻格，且相邻关系对称', () => {
    const center = axial(3, -2)
    const ns = neighbors(center)
    expect(ns).toHaveLength(6)
    expect(new Set(ns.map(axialKey)).size).toBe(6)
    for (const n of ns) {
      expect(areAdjacent(center, n)).toBe(true)
      expect(neighbors(n).some((m) => axialKey(m) === axialKey(center))).toBe(true)
    }
  })

  it('距离符合六边形度量的已知样例', () => {
    expect(axialDistance(axial(0, 0), axial(2, 0))).toBe(2)
    expect(axialDistance(axial(0, 0), axial(0, 3))).toBe(3)
    expect(axialDistance(axial(0, 0), axial(2, -1))).toBe(2)
    expect(axialDistance(axial(0, 0), axial(3, -2))).toBe(3)
    // 对角方向的"直线"距离为 n
    expect(axialDistance(axial(0, 0), axial(4, -4))).toBe(4)
  })

  it('坐标键可往返转换', () => {
    const a = axial(-3, 5)
    expect(parseAxialKey(axialKey(a))).toEqual(a)
    expect(() => parseAxialKey('1')).toThrow()
    expect(() => parseAxialKey('a,b')).toThrow()
    expect(() => parseAxialKey('1,2,3')).toThrow()
  })
})

describe('连通块划分', () => {
  it('把不相邻的两簇切开', () => {
    // 左簇：一个中心加两个邻居（三个连在一起）
    // 右簇：一个孤立的远格
    const left = [axial(0, 0), axial(1, 0), axial(0, 1)]
    const right = [axial(5, 5)]
    const components = connectedComponents([...left, ...right])

    expect(components).toHaveLength(2)
    expect(components[0]).toHaveLength(3)
    expect(components[1]).toHaveLength(1)
    expect(components[1]?.[0]).toEqual(axial(5, 5))
  })

  it('链式相邻会被合并成一簇（相邻可传递）', () => {
    const chain = [axial(0, 0), axial(1, 0), axial(2, 0), axial(3, 0)]
    expect(connectedComponents(chain)).toHaveLength(1)
  })

  it('斜向相邻不属于同一簇（六边形只有 6 个邻居）', () => {
    // (0,0) 与 (1,-1) 是邻居；(0,0) 与 (1,1) 距离为 2，不是邻居
    expect(connectedComponents([axial(0, 0), axial(1, -1)])).toHaveLength(1)
    expect(connectedComponents([axial(0, 0), axial(1, 1)])).toHaveLength(2)
  })

  it('空输入返回空结果，重复坐标被去重', () => {
    expect(connectedComponents([])).toEqual([])
    const withDupes = connectedComponents([axial(2, 2), axial(2, 2)])
    expect(withDupes).toHaveLength(1)
    expect(withDupes[0]).toHaveLength(1)
  })
})
