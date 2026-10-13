/**
 * 板块池：把"每种正面的数量"变成一副可抽取的六边形板块。
 *
 * 重要概念：板块**自身没有点数**。同一枚船/矿/城堡在实物上完全相同；
 * 动物/建筑/知识靠正面图案区分，但"能用哪个点数"取决于它被放在哪个编号仓库。
 * 因此这里只描述正面，不描述点数。
 */

import { shuffle, type RngState } from './rng'
import { ANIMAL_KINDS, BUILDING_KINDS } from './types'
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
 * 板块库存 —— 数字来自**官方规则书第 2 页的组件清单**（Special Edition）。
 *
 * 原文：
 *   164 hex tiles:
 *   7x 8 buildings (40 beige, 16 black)
 *   7x 4 livestock (20 green, 8 black)
 *   12 mines       (10 gray, 2 black)
 *   26 ships       (20 blue, 6 black)
 *   26 monasteries (20 yellow, 6 black)
 *   16 castles     (14 burgundy, 2 black)
 * 合计 56+28+12+26+26+16 = 164；其中**黑背面 40 枚**、有色背面 124 枚。
 *
 * 仍然未知的部分（已在 rules/规则规格.md 标注）：
 * - 每种动物 5 枚绿背具体是几只动物（2/3/4）的分布 —— 这里是占位
 * - 26 张知识板块里哪 6 张是黑背面 —— 这里是占位
 */
export const OFFICIAL_TILE_COUNTS = {
  buildings: { colored: 40, black: 16, perType: 7 },
  livestock: { colored: 20, black: 8, perType: 7 },
  mines: { colored: 10, black: 2 },
  ships: { colored: 20, black: 6 },
  monasteries: { colored: 20, black: 6 },
  castles: { colored: 14, black: 2 },
} as const

/** 每种建筑 7 枚：5 枚米色背 + 2 枚黑背。 */
const BUILDING_COLORED_PER_TYPE = 5
const BUILDING_BLACK_PER_TYPE = 2

/**
 * ⚠️ 占位：每种动物的 5 枚绿背板块里，2/3/4 只动物各几枚。
 * 规则书只给了每种动物 7 枚（5 绿 + 2 黑），没给"每枚画几只"的分布。
 */
const ANIMAL_FACE_SPLIT_COLORED: Readonly<Record<string, number>> = { '2': 2, '3': 2, '4': 1 }
/** ⚠️ 占位：每种动物的 2 枚黑背板块里的只数分布。 */
const ANIMAL_FACE_SPLIT_BLACK: Readonly<Record<string, number>> = { '2': 1, '3': 1 }

/** 26 张知识板块里，⚠️ 占位认为这 6 张是黑背面。 */
const BLACK_KNOWLEDGE_IDS: readonly KnowledgeId[] = [1, 6, 8, 11, 17, 24]

function animalFaces(split: Readonly<Record<string, number>>): TileFaceSpec[] {
  const faces: TileFaceSpec[] = []
  for (const animal of ANIMAL_KINDS) {
    for (const [animalsText, count] of Object.entries(split)) {
      if (count <= 0) continue
      faces.push({ color: 'animal', animal, animals: Number(animalsText) as 2 | 3 | 4, count })
    }
  }
  return faces
}

function buildingFaces(perType: number): TileFaceSpec[] {
  return BUILDING_KINDS.map((building) => ({ color: 'building' as const, building, count: perType }))
}

/** 有色背面的板块（124 枚）。 */
export const OFFICIAL_TILE_INVENTORY: readonly TileFaceSpec[] = [
  { color: 'castle', count: OFFICIAL_TILE_COUNTS.castles.colored },
  { color: 'mine', count: OFFICIAL_TILE_COUNTS.mines.colored },
  { color: 'ship', count: OFFICIAL_TILE_COUNTS.ships.colored },
  ...buildingFaces(BUILDING_COLORED_PER_TYPE),
  ...animalFaces(ANIMAL_FACE_SPLIT_COLORED),
  ...Array.from({ length: 26 }, (_, i) => i + 1)
    .filter((id) => !BLACK_KNOWLEDGE_IDS.includes(id))
    .map((id) => ({ color: 'knowledge' as const, knowledge: id, count: 1 })),
]

/** 黑背面的板块（40 枚，供中央黑洞抽取）。 */
export const OFFICIAL_BLACK_TILE_INVENTORY: readonly TileFaceSpec[] = [
  { color: 'castle', count: OFFICIAL_TILE_COUNTS.castles.black },
  { color: 'mine', count: OFFICIAL_TILE_COUNTS.mines.black },
  { color: 'ship', count: OFFICIAL_TILE_COUNTS.ships.black },
  ...buildingFaces(BUILDING_BLACK_PER_TYPE),
  ...animalFaces(ANIMAL_FACE_SPLIT_BLACK),
  ...BLACK_KNOWLEDGE_IDS.map((id) => ({
    color: 'knowledge' as const,
    knowledge: id,
    count: 1,
  })),
]
