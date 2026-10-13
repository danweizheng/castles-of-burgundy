import { describe, expect, it } from 'vitest'
import { createRng } from '../rng'
import {
  PLACEHOLDER_BLACK_TILE_INVENTORY,
  PLACEHOLDER_TILE_INVENTORY,
  buildTilePool,
  tileCountsByColor,
  totalTilesOf,
  type TileFaceSpec,
} from '../tiles'
import type { HexTile } from '../types'

/** 把一枚板块还原成"正面签名"，用于比较多重集合。 */
function faceSignature(tile: HexTile): string {
  switch (tile.color) {
    case 'animal':
      return `animal:${tile.animal}:${tile.animals}`
    case 'building':
      return `building:${tile.building}`
    case 'knowledge':
      return `knowledge:${tile.knowledge}`
    default:
      return tile.color
  }
}

function expectedSignatures(faces: readonly TileFaceSpec[]): string[] {
  const result: string[] = []
  for (const face of faces) {
    for (let i = 0; i < face.count; i += 1) {
      result.push(
        faceSignature({
          id: 'x',
          color: face.color,
          animal: face.animal,
          animals: face.animals,
          building: face.building,
          knowledge: face.knowledge,
        } as HexTile),
      )
    }
  }
  return result.sort()
}

describe('板块池：数量与构成', () => {
  it('⚠️ 两张占位库存表之和等于官方组件数 164（拆分值是臆造的，待规则书替换）', () => {
    // 官方组件清单只给出"164 枚六边形板块"这个总数，未给出各色拆分。
    // 官方设置章节还要求"按背面的颜色分堆"，其中黑背面是独立的一堆（供中央黑洞抽取），
    // 所以黑背面板块也在这 164 枚之内 —— 因此断言的是两表之和。
    expect(totalTilesOf(PLACEHOLDER_TILE_INVENTORY)).toBe(136)
    expect(totalTilesOf(PLACEHOLDER_BLACK_TILE_INVENTORY)).toBe(28)
    expect(
      totalTilesOf(PLACEHOLDER_TILE_INVENTORY) + totalTilesOf(PLACEHOLDER_BLACK_TILE_INVENTORY),
    ).toBe(164)
  })

  it('知识板块恰好 26 枚，编号 1–26 各 1 枚', () => {
    const knowledge = PLACEHOLDER_TILE_INVENTORY.filter((f) => f.color === 'knowledge')
    expect(knowledge).toHaveLength(26)
    expect(knowledge.map((f) => f.knowledge).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(
      Array.from({ length: 26 }, (_, i) => i + 1),
    )
    for (const face of knowledge) expect(face.count).toBe(1)
  })

  it('动物板块都指定了种类与只数，且只数在 2–4 之间', () => {
    const animals = PLACEHOLDER_TILE_INVENTORY.filter((f) => f.color === 'animal')
    expect(animals.length).toBeGreaterThan(0)
    for (const face of animals) {
      expect(face.animal).toBeDefined()
      expect([2, 3, 4]).toContain(face.animals)
    }
  })

  it('建筑板块都指定了建筑种类，且覆盖全部 8 种', () => {
    const buildings = PLACEHOLDER_TILE_INVENTORY.filter((f) => f.color === 'building')
    expect(new Set(buildings.map((f) => f.building)).size).toBe(8)
    for (const face of buildings) expect(face.building).toBeDefined()
  })

  it('按颜色统计的合计等于总数', () => {
    const counts = tileCountsByColor(PLACEHOLDER_TILE_INVENTORY)
    const sum = Object.values(counts).reduce((a, b) => a + b, 0)
    expect(sum).toBe(totalTilesOf(PLACEHOLDER_TILE_INVENTORY))
  })
})

describe('板块池：构建与洗牌', () => {
  it('洗好的池长度与正面多重集合都和库存表一致（元素不增不减）', () => {
    const pool = buildTilePool(PLACEHOLDER_TILE_INVENTORY, createRng(20240101))
    expect(pool).toHaveLength(totalTilesOf(PLACEHOLDER_TILE_INVENTORY))
    expect(pool.map(faceSignature).sort()).toEqual(expectedSignatures(PLACEHOLDER_TILE_INVENTORY))
  })

  it('每枚板块的 id 唯一（存档与撤销都靠它定位板块）', () => {
    const pool = buildTilePool(PLACEHOLDER_TILE_INVENTORY, createRng(7))
    const ids = pool.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('同一种子和同一份库存表 → 完全相同的抽取顺序（可复现对局）', () => {
    const a = buildTilePool(PLACEHOLDER_TILE_INVENTORY, createRng(12345))
    const b = buildTilePool(PLACEHOLDER_TILE_INVENTORY, createRng(12345))
    expect(a.map((t) => t.id)).toEqual(b.map((t) => t.id))
  })

  it('不同种子的抽取顺序不同', () => {
    const a = buildTilePool(PLACEHOLDER_TILE_INVENTORY, createRng(1))
    const b = buildTilePool(PLACEHOLDER_TILE_INVENTORY, createRng(2))
    expect(a.map((t) => t.id)).not.toEqual(b.map((t) => t.id))
  })

  it('id 与抽取顺序无关，只由"颜色 + 该色内序号"决定', () => {
    const a = buildTilePool(PLACEHOLDER_TILE_INVENTORY, createRng(1))
    const b = buildTilePool(PLACEHOLDER_TILE_INVENTORY, createRng(2))
    expect([...a.map((t) => t.id)].sort()).toEqual([...b.map((t) => t.id)].sort())
  })

  it('空库存表得到空池', () => {
    expect(buildTilePool([], createRng(1))).toEqual([])
  })

  it('两副牌堆用不同前缀时不会撞 id（有色背面与黑背面是两副独立牌堆）', () => {
    const main = buildTilePool(PLACEHOLDER_TILE_INVENTORY, createRng(1))
    const black = buildTilePool(PLACEHOLDER_BLACK_TILE_INVENTORY, createRng(2), 'black-')
    const ids = [...main.map((t) => t.id), ...black.map((t) => t.id)]
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('若两副牌堆用同一个前缀，id 必然撞车 —— 这就是前缀必须存在的原因', () => {
    // 这条是"特征测试"：它锁住的是"为什么需要前缀"这个原因。
    // 已知两副牌都有 building / animal / knowledge / mine / ship / castle，
    // 且各自的序号都从 1 开始，所以不带前缀时 id 一定会重复。
    const main = buildTilePool(PLACEHOLDER_TILE_INVENTORY, createRng(1))
    const black = buildTilePool(PLACEHOLDER_BLACK_TILE_INVENTORY, createRng(2))
    const ids = [...main.map((t) => t.id), ...black.map((t) => t.id)]
    expect(new Set(ids).size).toBeLessThan(ids.length)
  })
})

describe('板块池：数据校验', () => {
  it('动物板块缺少只数就抛错（而不是造出一个残缺板块）', () => {
    expect(() =>
      buildTilePool([{ color: 'animal', animal: 'cow', count: 1 }], createRng(1)),
    ).toThrow()
  })

  it('建筑板块缺少种类就抛错', () => {
    expect(() => buildTilePool([{ color: 'building', count: 1 }], createRng(1))).toThrow()
  })

  it('知识板块缺少编号就抛错', () => {
    expect(() => buildTilePool([{ color: 'knowledge', count: 1 }], createRng(1))).toThrow()
  })

  it('负数或非整数数量抛错', () => {
    expect(() => buildTilePool([{ color: 'ship', count: -1 }], createRng(1))).toThrow()
    expect(() => buildTilePool([{ color: 'ship', count: 1.5 }], createRng(1))).toThrow()
  })
})
