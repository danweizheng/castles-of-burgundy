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
 *
 * id 由"前缀 + 颜色 + 该颜色内序号"组成，与抽取顺序无关，因此可复现、可快照测试。
 * **前缀是必需的**：有色背面与黑背面是两副独立的牌堆，如果都用默认前缀，
 * 两副牌里都会出现 `building-001`、`knowledge-001`，id 撞车会让仓储与领地的引用错位。
 */
export function buildTilePool(
  faces: readonly TileFaceSpec[],
  rng: RngState,
  idPrefix = '',
): HexTile[] {
  const tiles: HexTile[] = []
  const counters = new Map<TileColor, number>()

  for (const face of faces) {
    if (!Number.isInteger(face.count) || face.count < 0) {
      throw new Error(`板块数量必须是非负整数（${face.color} 收到 ${face.count}）`)
    }
    for (let i = 0; i < face.count; i += 1) {
      const next = (counters.get(face.color) ?? 0) + 1
      counters.set(face.color, next)
      const id = `${idPrefix}${face.color}-${String(next).padStart(3, '0')}`
      tiles.push(makeTile(face, id))
    }
  }

  return shuffle(rng, tiles)
}

/**
 * ⚠️ 占位库存表（**必须**用规则书组件清单替换，见 rules/规则规格.md 第 12 节第 3 项）。
 *
 * 已知的事实与未知的部分：
 * - 官方组件清单给出"164 枚六边形板块"，但**未给出**各色拆分；
 * - 官方设置章节说要把六边形板块"按背面的颜色分堆"，其中**黑背面是独立的一堆**
 *   （供中央黑洞抽取），所以黑背面板块属于这 164 枚之内；
 * - 因此本文件给出两张表，**两者之和**应当等于 164：
 *     `PLACEHOLDER_TILE_INVENTORY`（有色背面）140 枚 + `PLACEHOLDER_BLACK_TILE_INVENTORY` 24 枚
 * - 唯一有依据的明细是 knowledge 的 26（"26 different yellow tiles"）。
 *
 * 除此之外的每一个数字都是臆造的。替换方式：只改这两个常量；测试里有一条
 * "两表之和须为 164"的断言，改错会立刻失败。
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

/** 动物正面的生成（占位数量见上表）。 */
function placeholderAnimalFaces(): TileFaceSpec[] {
  return Object.entries(PLACEHOLDER_ANIMAL_TILE_COUNTS).map(([key, count]) => {
    const [animal, animals] = key.split('-')
    return {
      color: 'animal' as const,
      animal: animal as AnimalKind,
      animals: Number(animals) as 2 | 3 | 4,
      count,
    }
  })
}

/** 有色背面的板块（占位）。合计 136。 */
export const PLACEHOLDER_TILE_INVENTORY: readonly TileFaceSpec[] = [
  { color: 'castle', count: 12 },
  { color: 'mine', count: 12 },
  { color: 'ship', count: 12 },
  { color: 'building', building: 'warehouse', count: 5 },
  { color: 'building', building: 'carpenter', count: 5 },
  { color: 'building', building: 'church', count: 5 },
  { color: 'building', building: 'market', count: 5 },
  { color: 'building', building: 'boardingHouse', count: 6 },
  { color: 'building', building: 'bank', count: 6 },
  { color: 'building', building: 'cityHall', count: 5 },
  { color: 'building', building: 'watchtower', count: 5 },
  ...placeholderAnimalFaces(),
  ...Array.from({ length: 26 }, (_, i) => ({
    color: 'knowledge' as const,
    knowledge: i + 1,
    count: 1,
  })),
]

/**
 * 黑背面的板块（占位，供中央黑洞抽取）。合计 28。
 *
 * 官方把黑背面单独成堆，但没有给出它的构成。这里假设它是各色混合。
 */
export const PLACEHOLDER_BLACK_TILE_INVENTORY: readonly TileFaceSpec[] = [
  { color: 'building', building: 'warehouse', count: 1 },
  { color: 'building', building: 'carpenter', count: 1 },
  { color: 'building', building: 'church', count: 1 },
  { color: 'building', building: 'market', count: 1 },
  { color: 'building', building: 'boardingHouse', count: 1 },
  { color: 'building', building: 'bank', count: 1 },
  { color: 'building', building: 'cityHall', count: 1 },
  { color: 'building', building: 'watchtower', count: 1 },
  { color: 'animal', animal: 'chicken', animals: 2, count: 1 },
  { color: 'animal', animal: 'chicken', animals: 3, count: 1 },
  { color: 'animal', animal: 'sheep', animals: 2, count: 1 },
  { color: 'animal', animal: 'sheep', animals: 3, count: 1 },
  { color: 'animal', animal: 'pig', animals: 2, count: 1 },
  { color: 'animal', animal: 'pig', animals: 3, count: 1 },
  { color: 'animal', animal: 'cow', animals: 2, count: 1 },
  { color: 'animal', animal: 'cow', animals: 3, count: 1 },
  { color: 'mine', count: 3 },
  { color: 'ship', count: 3 },
  { color: 'castle', count: 2 },
  { color: 'knowledge', knowledge: 8, count: 1 },
  { color: 'knowledge', knowledge: 11, count: 1 },
  { color: 'knowledge', knowledge: 17, count: 1 },
  { color: 'knowledge', knowledge: 24, count: 1 },
]
