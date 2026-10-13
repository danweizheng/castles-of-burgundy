/**
 * 版图模型：索引、区域派生、校验。
 *
 * 为什么要有校验器：9 张领地版图（以及中央版图）的数据要靠人工从实物录入，
 * 而"某个区域其实不连通""某格数字抄错""总格数不对"这类错误在引擎里极难定位。
 * 把校验前置，录入错误会在数据加载时就报出来。
 */

import { axialKey, connectedComponents, neighbors, type Axial } from './hex'
import { MAX_REGION_SIZE } from './data/scoring'
import type { BoardSpace, PlayerBoardDef, RegionInfo, TileColor } from './types'
import { TILE_COLORS } from './types'

export interface BoardIssue {
  readonly severity: 'error' | 'warning'
  readonly message: string
}

export interface PlayerBoardValidationOptions {
  /** 期望的总格数（可选）。 */
  readonly expectedSize?: number
  /** 期望的各色格数（可选）。 */
  readonly expectedColorCounts?: Readonly<Partial<Record<TileColor, number>>>
}

/** 坐标键 → 格位。 */
export function boardIndexOf(board: PlayerBoardDef): Map<string, BoardSpace> {
  const index = new Map<string, BoardSpace>()
  for (const space of board.spaces) {
    index.set(axialKey(space), space)
  }
  return index
}

/** 按 regionId 汇总，得到每个区域的颜色、格数、坐标列表。顺序稳定。 */
export function regionsOf(board: PlayerBoardDef): RegionInfo[] {
  const grouped = new Map<string, { color: TileColor; spaces: Axial[] }>()
  for (const space of board.spaces) {
    const existing = grouped.get(space.regionId)
    if (existing === undefined) {
      grouped.set(space.regionId, { color: space.color, spaces: [{ q: space.q, r: space.r }] })
    } else {
      existing.spaces.push({ q: space.q, r: space.r })
    }
  }

  const regions: RegionInfo[] = []
  for (const [regionId, group] of grouped) {
    regions.push({
      regionId,
      color: group.color,
      spaces: group.spaces,
      size: group.spaces.length,
    })
  }
  return regions
}

/** 各色格数统计。 */
export function colorCountsOf(board: PlayerBoardDef): Record<TileColor, number> {
  const counts = Object.fromEntries(TILE_COLORS.map((c) => [c, 0])) as Record<TileColor, number>
  for (const space of board.spaces) {
    counts[space.color] += 1
  }
  return counts
}

/**
 * 校验一张玩家版图的数据是否自洽。
 * 返回的 issues 为空数组表示通过。
 */
export function validatePlayerBoard(
  board: PlayerBoardDef,
  options: PlayerBoardValidationOptions = {},
): BoardIssue[] {
  const issues: BoardIssue[] = []

  // 1. 坐标不得重复
  const seen = new Set<string>()
  for (const space of board.spaces) {
    const key = axialKey(space)
    if (seen.has(key)) issues.push({ severity: 'error', message: `坐标重复：${key}` })
    seen.add(key)
  }

  // 2. 点数必须是 1–6 的整数
  for (const space of board.spaces) {
    if (!Number.isInteger(space.number) || space.number < 1 || space.number > 6) {
      issues.push({
        severity: 'error',
        message: `格位 ${axialKey(space)} 的骰子点数非法：${String(space.number)}`,
      })
    }
  }

  // 3. 起始城堡格
  const startKey = axialKey(board.startingSpace)
  const startSpace = board.spaces.find((s) => axialKey(s) === startKey)
  if (startSpace === undefined) {
    issues.push({ severity: 'error', message: `起始城堡格 ${startKey} 不在版图上` })
  } else {
    if (startSpace.color !== 'castle') {
      issues.push({
        severity: 'error',
        message: `起始城堡格 ${startKey} 颜色应为 castle，实际为 ${startSpace.color}`,
      })
    }
    if (startSpace.number !== 6) {
      issues.push({
        severity: 'error',
        message: `起始城堡格 ${startKey} 的点数应为 6，实际为 ${String(startSpace.number)}`,
      })
    }
  }

  // 4. 每个区域：同色、连通、不超过最大格数
  const regions = regionsOf(board)
  const spaceByKey = boardIndexOf(board)
  for (const region of regions) {
    const colors = new Set(
      region.spaces.map((a) => spaceByKey.get(axialKey(a))?.color).filter((c) => c !== undefined),
    )
    if (colors.size > 1) {
      issues.push({
        severity: 'error',
        message: `区域 ${region.regionId} 颜色不统一：${[...colors].join(' / ')}`,
      })
    }

    const components = connectedComponents(region.spaces)
    if (components.length > 1) {
      const sizes = components.map((c) => c.length).sort((a, b) => b - a)
      issues.push({
        severity: 'error',
        message: `区域 ${region.regionId} 不连通，被分成了 ${components.length} 块（格数 ${sizes.join(' / ')}）`,
      })
    }

    if (region.size > MAX_REGION_SIZE) {
      issues.push({
        severity: 'error',
        message: `区域 ${region.regionId} 有 ${region.size} 格，超过最大 ${MAX_REGION_SIZE} 格（计分表放不下）`,
      })
    }
  }

  // 5. 可选：总格数与各色格数
  if (options.expectedSize !== undefined && board.spaces.length !== options.expectedSize) {
    issues.push({
      severity: 'error',
      message: `总格数应为 ${options.expectedSize}，实际 ${board.spaces.length}`,
    })
  }
  if (options.expectedColorCounts !== undefined) {
    const actual = colorCountsOf(board)
    for (const color of TILE_COLORS) {
      const expected = options.expectedColorCounts[color]
      if (expected !== undefined && actual[color] !== expected) {
        issues.push({
          severity: 'error',
          message: `${color} 格数应为 ${expected}，实际 ${actual[color]}`,
        })
      }
    }
  }

  return issues
}

/** 坐标的六个邻居里，是否至少有一个在 placedKeys 中。 */
export function isAdjacentToAny(space: Axial, placedKeys: ReadonlySet<string>): boolean {
  return neighbors(space).some((n) => placedKeys.has(axialKey(n)))
}

/**
 * 版图上所有深红（城堡）格。
 *
 * 官方规则：开局城堡放在玩家**选定**的深红格上，不是固定中央格。
 * 原文："Take 1 castle and place it face-up on the chosen burgundy space on your duchy board"；
 * 只有"第一次玩"才推荐放中央 6 号格。
 */
export function castleSpacesOf(board: PlayerBoardDef): Axial[] {
  return board.spaces
    .filter((space) => space.color === 'castle')
    .map((space) => ({ q: space.q, r: space.r }))
}

export function isCastleSpace(board: PlayerBoardDef, space: Axial): boolean {
  const target = boardIndexOf(board).get(axialKey(space))
  return target?.color === 'castle'
}
