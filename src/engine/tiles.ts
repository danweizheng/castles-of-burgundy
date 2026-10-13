/**
 * 板块池：把"每种正面的数量"变成一副可抽取的六边形板块。
 *
 * 重要概念：板块**自身没有点数**。同一枚船/矿/城堡在实物上完全相同；
 * 动物/建筑/知识靠正面图案区分，但"能用哪个点数"取决于它被放在哪个编号仓库。
 * 因此这里只描述正面，不描述点数。
 */

import { shuffle, type RngState } from './rng'
import type { AnimalKind, BuildingKind, HexTile, KnowledgeId, TileColor } from './types'

/** 一种板块正面及其数量。 */
export interface TileFaceSpec {
  readonly color: TileColor
  readonly animal?: AnimalKind
  readonly animals?: 2 | 3 | 4
  readonly building?: BuildingKind
  readonly knowledge?: KnowledgeId
  readonly count: number
}

function makeTile(face: TileFaceSpec, id: string): HexTile {
  switch (face.color) {
    case 'castle':
    case 'mine':
    case 'ship':
      return { id, color: face.color }
    case 'animal':
      if (face.animal === undefined || face.animals === undefined) {
        throw new Error(`动物板块必须指定 animal 与 animals（id=${id}）`)
      }
      return { id, color: 'animal', animal: face.animal, animals: face.animals }
    case 'building':
      if (face.building === undefined) {
        throw new Error(`建筑板块必须指定 building（id=${id}）`)
      }
      return { id, color: 'building', building: face.building }
    case 'knowledge':
      if (face.knowledge === undefined) {
        throw new Error(`知识板块必须指定 knowledge 编号（id=${id}）`)
      }
      return { id, color: 'knowledge', knowledge: face.knowledge }
  }
}

/** 板块总数。 */
export function totalTilesOf(faces: readonly TileFaceSpec[]): number {
  return faces.reduce((sum, face) => sum + face.count, 0)
}

/** 按颜色统计板块数。 */
export function tileCountsByColor(faces: readonly TileFaceSpec[]): Partial<Record<TileColor, number>> {
  const counts: Partial<Record<TileColor, number>> = {}
  for (const face of faces) {
    counts[face.color] = (counts[face.color] ?? 0) + face.count
  }
  return counts
}

/**
 * 构建并洗好一副板块池。
 * id 由"颜色 + 该颜色内的序号"组成，与抽取顺序无关，因此可复现、可快照测试。
 */
export function buildTilePool(faces: readonly TileFaceSpec[], rng: RngState): HexTile[] {
  const tiles: HexTile[] = []
  const counters = new Map<TileColor, number>()

  for (const face of faces) {
    if (!Number.isInteger(face.count) || face.count < 0) {
      throw new Error(`板块数量必须是非负整数（${face.color} 收到 ${face.count}）`)
    }
    for (let i = 0; i < face.count; i += 1) {
      const next = (counters.get(face.color) ?? 0) + 1
      counters.set(face.color, next)
      const id = `${face.color}-${String(next).padStart(3, '0')}`
      tiles.push(makeTile(face, id))
    }
  }

  return shuffle(rng, tiles)
}

/**
 * ⚠️ 占位库存表 —— **必须用规则书组件清单替换**（rules/规则规格.md 第 12 节第 2 项）。
 *
 * 说明：官方组件清单给出的总数是 164 枚六边形板块，但**未给出**各色数量分布。
 * 这里给出的拆分是为了让引擎能跑起来，属于臆造值：
 *   castle 12 + mine 12 + ship 12 + animal 32 + building 70 + knowledge 26 = 164
 * 其中 knowledge 的 26 是唯一有依据的部分（"26 different yellow tiles"）。
 *
 * 替换方式：只改这个常量。测试里有一条"总数须为 164"的断言，改错会立刻报出来。
 */
export const PLACEHOLDER_ANIMAL_TILE_COUNTS: Readonly<Record<string, number>> = {
  'chicken-2': 3,
  'chicken-3': 3,
  'chicken-4': 2,
  'sheep-2': 3,
  'sheep-3': 3,
  'sheep-4': 2,
  'pig-2': 3,
  'pig-3': 2,
  'pig-4': 2,
  'cow-2': 3,
  'cow-3': 3,
  'cow-4': 3,
}

export const PLACEHOLDER_TILE_INVENTORY: readonly TileFaceSpec[] = [
  { color: 'castle', count: 12 },
  { color: 'mine', count: 12 },
  { color: 'ship', count: 12 },
  { color: 'building', building: 'warehouse', count: 9 },
  { color: 'building', building: 'carpenter', count: 9 },
  { color: 'building', building: 'church', count: 9 },
  { color: 'building', building: 'market', count: 9 },
  { color: 'building', building: 'boardingHouse', count: 9 },
  { color: 'building', building: 'bank', count: 9 },
  { color: 'building', building: 'cityHall', count: 8 },
  { color: 'building', building: 'watchtower', count: 8 },
  ...(Object.entries(PLACEHOLDER_ANIMAL_TILE_COUNTS).map(([key, count]) => {
    const [animal, animals] = key.split('-')
    return {
      color: 'animal' as const,
      animal: animal as AnimalKind,
      animals: Number(animals) as 2 | 3 | 4,
      count,
    }
  })),
  ...Array.from({ length: 26 }, (_, i) => ({
    color: 'knowledge' as const,
    knowledge: i + 1,
    count: 1,
  })),
]
