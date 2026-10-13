import { describe, expect, it } from 'vitest'
import { createRng } from '../rng'
import {
  OFFICIAL_BLACK_TILE_INVENTORY,
  OFFICIAL_TILE_INVENTORY,
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
  it('库存与官方规则书第 2 页的组件清单一致：124 有色背面 + 40 黑背面 = 164', () => {
    expect(totalTilesOf(OFFICIAL_TILE_INVENTORY)).toBe(124)
    expect(totalTilesOf(OFFICIAL_BLACK_TILE_INVENTORY)).toBe(40)
    expect(totalTilesOf(OFFICIAL_TILE_INVENTORY) + totalTilesOf(OFFICIAL_BLACK_TILE_INVENTORY)).toBe(
      164,
    )
  })

  it('各色数量与官方清单逐项一致（7x8 建筑 / 7x4 动物 / 12 矿 / 26 船 / 26 知识 / 16 城堡）', () => {
    const colored = tileCountsByColor(OFFICIAL_TILE_INVENTORY)
    const black = tileCountsByColor(OFFICIAL_BLACK_TILE_INVENTORY)

    expect(colored.building).toBe(40)
    expect(black.building).toBe(16)
    expect(colored.animal).toBe(20)
    expect(black.animal).toBe(8)
    expect(colored.mine).toBe(10)
    expect(black.mine).toBe(2)
    expect(colored.ship).toBe(20)
    expect(black.ship).toBe(6)
    expect(colored.knowledge).toBe(20)
    expect(black.knowledge).toBe(6)
    expect(colored.castle).toBe(14)
    expect(black.castle).toBe(2)

    expect((colored.building ?? 0) + (black.building ?? 0)).toBe(56)
    expect((colored.animal ?? 0) + (black.animal ?? 0)).toBe(28)
    expect((colored.mine ?? 0) + (black.mine ?? 0)).toBe(12)
    expect((colored.ship ?? 0) + (black.ship ?? 0)).toBe(26)
    expect((colored.knowledge ?? 0) + (black.knowledge ?? 0)).toBe(26)
    expect((colored.castle ?? 0) + (black.castle ?? 0)).toBe(16)
  })

  it('每种建筑恰好 7 枚（5 米色背 + 2 黑背）', () => {
    const countOf = (faces: readonly TileFaceSpec[], building: string): number =>
      faces
        .filter((f) => f.building === building)
        .reduce((sum, f) => sum + f.count, 0)

    for (const building of [
      'warehouse',
      'carpenter',
      'church',
      'market',
      'boardingHouse',
      'bank',
      'cityHall',
      'watchtower',
    ]) {
      expect(countOf(OFFICIAL_TILE_INVENTORY, building), building).toBe(5)
      expect(countOf(OFFICIAL_BLACK_TILE_INVENTORY, building), building).toBe(2)
    }
  })

  it('每种动物恰好 7 枚（5 绿背 + 2 黑背）', () => {
    const countOf = (faces: readonly TileFaceSpec[], animal: string): number =>
      faces.filter((f) => f.animal === animal).reduce((sum, f) => sum + f.count, 0)

    for (const animal of ['chicken', 'sheep', 'pig', 'cow']) {
      expect(countOf(OFFICIAL_TILE_INVENTORY, animal), animal).toBe(5)
      expect(countOf(OFFICIAL_BLACK_TILE_INVENTORY, animal), animal).toBe(2)
    }
  })

  it('知识板块共 26 种、各 1 枚，分成 20 枚黄背 + 6 枚黑背', () => {
    const colored = OFFICIAL_TILE_INVENTORY.filter((f) => f.color === 'knowledge')
    const black = OFFICIAL_BLACK_TILE_INVENTORY.filter((f) => f.color === 'knowledge')
    expect(colored).toHaveLength(20)
    expect(black).toHaveLength(6)

    const allIds = [...colored, ...black]
      .map((f) => f.knowledge)
      .sort((a, b) => (a ?? 0) - (b ?? 0))
    expect(allIds).toEqual(Array.from({ length: 26 }, (_, i) => i + 1))
    for (const face of [...colored, ...black]) expect(face.count).toBe(1)

    // 两堆之间不能重复同一张知识板块
    const coloredIds = new Set(colored.map((f) => f.knowledge))
    for (const face of black) expect(coloredIds.has(face.knowledge)).toBe(false)
  })

  it('动物板块都指定了种类与只数，且只数在 2–4 之间', () => {
    const animals = OFFICIAL_TILE_INVENTORY.filter((f) => f.color === 'animal')
    expect(animals.length).toBeGreaterThan(0)
    for (const face of animals) {
      expect(face.animal).toBeDefined()
      expect([2, 3, 4]).toContain(face.animals)
    }
  })

  it('建筑板块都指定了建筑种类，且覆盖全部 8 种', () => {
    const buildings = OFFICIAL_TILE_INVENTORY.filter((f) => f.color === 'building')
    expect(new Set(buildings.map((f) => f.building)).size).toBe(8)
    for (const face of buildings) expect(face.building).toBeDefined()
  })

  it('按颜色统计的合计等于总数', () => {
    const counts = tileCountsByColor(OFFICIAL_TILE_INVENTORY)
    const sum = Object.values(counts).reduce((a, b) => a + b, 0)
    expect(sum).toBe(totalTilesOf(OFFICIAL_TILE_INVENTORY))
  })
})

describe('板块池：构建与洗牌', () => {
  it('洗好的池长度与正面多重集合都和库存表一致（元素不增不减）', () => {
    const pool = buildTilePool(OFFICIAL_TILE_INVENTORY, createRng(20240101))
    expect(pool).toHaveLength(totalTilesOf(OFFICIAL_TILE_INVENTORY))
    expect(pool.map(faceSignature).sort()).toEqual(expectedSignatures(OFFICIAL_TILE_INVENTORY))
  })

  it('每枚板块的 id 唯一（存档与撤销都靠它定位板块）', () => {
    const pool = buildTilePool(OFFICIAL_TILE_INVENTORY, createRng(7))
    const ids = pool.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('同一种子和同一份库存表 → 完全相同的抽取顺序（可复现对局）', () => {
    const a = buildTilePool(OFFICIAL_TILE_INVENTORY, createRng(12345))
    const b = buildTilePool(OFFICIAL_TILE_INVENTORY, createRng(12345))
    expect(a.map((t) => t.id)).toEqual(b.map((t) => t.id))
  })

  it('不同种子的抽取顺序不同', () => {
    const a = buildTilePool(OFFICIAL_TILE_INVENTORY, createRng(1))
    const b = buildTilePool(OFFICIAL_TILE_INVENTORY, createRng(2))
    expect(a.map((t) => t.id)).not.toEqual(b.map((t) => t.id))
  })

  it('id 与抽取顺序无关，只由"颜色 + 该色内序号"决定', () => {
    const a = buildTilePool(OFFICIAL_TILE_INVENTORY, createRng(1))
    const b = buildTilePool(OFFICIAL_TILE_INVENTORY, createRng(2))
    expect([...a.map((t) => t.id)].sort()).toEqual([...b.map((t) => t.id)].sort())
  })

  it('空库存表得到空池', () => {
    expect(buildTilePool([], createRng(1))).toEqual([])
  })

  it('两副牌堆用不同前缀时不会撞 id（有色背面与黑背面是两副独立牌堆）', () => {
    const main = buildTilePool(OFFICIAL_TILE_INVENTORY, createRng(1))
    const black = buildTilePool(OFFICIAL_BLACK_TILE_INVENTORY, createRng(2), 'black-')
    const ids = [...main.map((t) => t.id), ...black.map((t) => t.id)]
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('若两副牌堆用同一个前缀，id 必然撞车 —— 这就是前缀必须存在的原因', () => {
    // 这条是"特征测试"：它锁住的是"为什么需要前缀"这个原因。
    // 已知两副牌都有 building / animal / knowledge / mine / ship / castle，
    // 且各自的序号都从 1 开始，所以不带前缀时 id 一定会重复。
    const main = buildTilePool(OFFICIAL_TILE_INVENTORY, createRng(1))
    const black = buildTilePool(OFFICIAL_BLACK_TILE_INVENTORY, createRng(2))
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
