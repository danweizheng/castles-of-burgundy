/**
 * 中央版图模型。
 *
 * 🔴 关键事实（本轮从官方规则确认）：仓库格位是**印了颜色**的。
 * 原文："place them, face-up, onto the **matching-coloured** six-sided spaces in the six numbered depots"。
 * 也就是说"点数 N 上能抽到什么颜色"由中央版图决定，不是随机的。
 * 佐证：3 人局的例外说明专门指出"第 6 号仓库那个深绿（城堡）格位"。
 *
 * 格位标记的含义：`playerCount` 是**启用该格位所需的最少人数**。
 * - 2 人局启用标记 2 的格位 = 12 个（官方：「only those spaces marked with 2s (12 spaces)」）
 * - 3 人局启用标记 2 与 3 的格位 = 18 个
 * - 4 人局启用全部 = 24 个
 */

import { DIE_VALUES, type DieValue, type HexTile, type TileColor } from './types'

export interface DepotSlotDef {
  /** 稳定 id，用于在 GameState 里按位置存取板块（如 'd3s2'）。 */
  readonly id: string
  readonly depot: DieValue
  readonly color: TileColor
  /** 启用该格位所需的最少人数。 */
  readonly playerCount: 2 | 3 | 4
}

export interface GameBoardDef {
  readonly id: string
  readonly name: string
  readonly depotSlots: readonly DepotSlotDef[]
  /**
   * 黑洞开局抽几枚（按人数）。官方原文只说"draw 2 to 8 tiles, depending on player number"，
   * 未给出精确对应。⚠️ 2 人局取 2 是占位值（Q3）。
   */
  readonly blackDepotDrawByPlayerCount: Readonly<Record<2 | 3 | 4, number>>
}

export interface GameBoardIssue {
  readonly severity: 'error' | 'warning'
  readonly message: string
}

/** 某个点数在给定人数下启用的格位。 */
export function activeSlotsFor(
  board: GameBoardDef,
  depot: DieValue,
  playerCount: 2 | 3 | 4,
): DepotSlotDef[] {
  return board.depotSlots.filter((slot) => slot.depot === depot && slot.playerCount <= playerCount)
}

/** 给定人数下所有启用的格位。 */
export function activeSlots(board: GameBoardDef, playerCount: 2 | 3 | 4): DepotSlotDef[] {
  return board.depotSlots.filter((slot) => slot.playerCount <= playerCount)
}

/** 某个点数在给定人数下会出现哪些颜色（AI 判断"这个点数能拿什么"要用）。 */
export function colorsAvailableAt(
  board: GameBoardDef,
  depot: DieValue,
  playerCount: 2 | 3 | 4,
): TileColor[] {
  return [...new Set(activeSlotsFor(board, depot, playerCount).map((slot) => slot.color))]
}

export function validateGameBoard(
  board: GameBoardDef,
  playerCount: 2 | 3 | 4 = 2,
): GameBoardIssue[] {
  const issues: GameBoardIssue[] = []

  const ids = new Set<string>()
  for (const slot of board.depotSlots) {
    if (ids.has(slot.id)) issues.push({ severity: 'error', message: `仓库格位 id 重复：${slot.id}` })
    ids.add(slot.id)
  }

  // 官方给出的启用格位数：2 人 12 / 3 人 18 / 4 人 24
  for (const [count, expected] of [
    [2, 12],
    [3, 18],
    [4, 24],
  ] as const) {
    const actual = activeSlots(board, count).length
    if (actual !== expected) {
      issues.push({
        severity: 'error',
        message: `${count} 人局启用的仓库格位应为 ${expected} 个，实际 ${actual} 个`,
      })
    }
  }

  for (const depot of DIE_VALUES) {
    if (activeSlotsFor(board, depot, playerCount).length === 0) {
      issues.push({
        severity: 'error',
        message: `第 ${depot} 号仓库在 ${playerCount} 人局没有任何可用格位`,
      })
    }
  }

  return issues
}

/** 按人数过滤后，把仓库格位初始化成"全空"。 */
export function emptyDepotSlots(
  board: GameBoardDef,
  playerCount: 2 | 3 | 4,
): Record<string, HexTile | null> {
  const slots: Record<string, HexTile | null> = {}
  for (const slot of activeSlots(board, playerCount)) slots[slot.id] = null
  return slots
}

/**
 * ⚠️ **占位中央版图** —— 仓库色位布局必须用实物数据替换（rules/规则规格.md 第 12 节第 2 项）。
 *
 * 这里生成的布局满足官方的"格位数"约束（12 / 18 / 24），颜色按确定性轮转填充，
 * 且第 6 号仓库的第一个格位天然落在深绿（城堡）上 —— 与官方对 3 人局的例外说明相合。
 * 颜色本身是臆造的，只影响 AI 判断质量，不影响流程跑通。
 */
export function createPlaceholderGameBoard(): GameBoardDef {
  const palette: readonly TileColor[] = ['building', 'animal', 'mine', 'ship', 'knowledge', 'castle']
  const markerByIndex: readonly (2 | 3 | 4)[] = [2, 2, 3, 4]

  const depotSlots: DepotSlotDef[] = []
  for (const depot of DIE_VALUES) {
    for (let i = 0; i < markerByIndex.length; i += 1) {
      const color = palette[(depot - 1 + i) % palette.length]
      const playerCount = markerByIndex[i]
      if (color === undefined || playerCount === undefined) {
        throw new Error(`占位中央版图生成越界：depot=${depot} i=${i}`)
      }
      depotSlots.push({ id: `d${depot}s${i + 1}`, depot, color, playerCount })
    }
  }

  return {
    id: 'placeholder-central',
    name: '占位中央版图（色位非真实数据）',
    depotSlots,
    blackDepotDrawByPlayerCount: { 2: 2, 3: 4, 4: 8 },
  }
}
