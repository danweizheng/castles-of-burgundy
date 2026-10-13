/**
 * 六边形几何：整个引擎的基础，不依赖任何 UI 或 DOM。
 *
 * 使用轴向坐标（axial coordinates, q/r）。注意"尖顶/平顶"朝向只影响渲染，
 * 不影响相邻关系与距离，因此这里只存坐标，朝向由 UI 层决定。
 */

export interface Axial {
  readonly q: number
  readonly r: number
}

/** 六个相邻方向。顺序固定，方便快照测试与可复现回放。 */
export const AXIAL_DIRECTIONS: readonly Axial[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
]

export function axial(q: number, r: number): Axial {
  return { q, r }
}

/** 用作 Map/Set 的键。坐标与字符串一一对应。 */
export function axialKey(a: Axial): string {
  return `${a.q},${a.r}`
}

export function parseAxialKey(key: string): Axial {
  const parts = key.split(',')
  if (parts.length !== 2) throw new Error(`非法的六边形坐标键：${key}`)
  const q = Number(parts[0])
  const r = Number(parts[1])
  if (!Number.isInteger(q) || !Number.isInteger(r)) {
    throw new Error(`非法的六边形坐标键：${key}`)
  }
  return { q, r }
}

export function addAxial(a: Axial, b: Axial): Axial {
  return { q: a.q + b.q, r: a.r + b.r }
}

export function neighbors(a: Axial): Axial[] {
  return AXIAL_DIRECTIONS.map((d) => addAxial(a, d))
}

/** 两个六边形之间的最短步数。 */
export function axialDistance(a: Axial, b: Axial): number {
  const dq = a.q - b.q
  const dr = a.r - b.r
  const ds = -dq - dr
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(ds))
}

export function areAdjacent(a: Axial, b: Axial): boolean {
  return axialDistance(a, b) === 1
}

/**
 * 把一组坐标按六边形相邻关系切成若干连通块。
 *
 * 用途：
 * - 动物计分需要判定"同一牧场"（相邻的浅绿空格构成连通块）
 * - 区域完成判定需要校验板块是否与已有板块相邻可达
 *
 * 连通块内部顺序稳定（按输入顺序做广度优先），使结果可复现、可快照测试。
 */
export function connectedComponents(cells: readonly Axial[]): Axial[][] {
  const remaining = new Set(cells.map(axialKey))
  const components: Axial[][] = []

  for (const start of cells) {
    const startKey = axialKey(start)
    if (!remaining.has(startKey)) continue
    remaining.delete(startKey)

    const component: Axial[] = [start]
    // 用下标推进而不是 shift()，避免 O(n^2) 且避免 undefined 断言
    for (let head = 0; head < component.length; head += 1) {
      const current = component[head]
      if (current === undefined) continue
      for (const n of neighbors(current)) {
        const nk = axialKey(n)
        if (remaining.has(nk)) {
          remaining.delete(nk)
          component.push(n)
        }
      }
    }
    components.push(component)
  }

  return components
}
