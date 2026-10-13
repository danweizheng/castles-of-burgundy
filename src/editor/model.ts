/**
 * 版图录入器的模型层（纯函数，可单测）。
 *
 * 为什么需要录入器：引擎里唯一的假数据就是版图。照片交给视觉模型读当然更快，
 * 但读错了很难发现；录入器由你对着实物点，产出的是"你亲眼确认过"的数据，
 * 而且当场就能看到区域划分与校验结果。
 *
 * 一个重要的简化：官方规则把区域定义为**同色相连的连续区域**
 * （"a contiguous area of green hex spaces"、"a contiguous area of beige spaces"），
 * 所以区域 id 可以按"同色连通块"自动派生，不需要手工划边界 ——
 * 手工划反而容易和引擎的连通判定不一致。
 */

import { validatePlayerBoard, type BoardIssue } from '../engine/board'
import { connectedComponents, axialKey } from '../engine/hex'
import { TILE_COLORS, type BoardSpace, type DieValue, type PlayerBoardDef, type TileColor } from '../engine/types'

/** 画布半径。真实版图最多 37 格且形状不规则，用一个半径 4 的六边形（61 格）当画布足够装下。 */
export const EDITOR_RADIUS = 4

export const DEFAULT_COLOR: TileColor = 'building'
export const DEFAULT_NUMBER: DieValue = 1

export interface EditorCell {
  readonly q: number
  readonly r: number
  /** 该格在真实版图上是否存在（不存在的不计入版图） */
  readonly active: boolean
  readonly color: TileColor
  readonly number: DieValue
  /** 是否标记为"推荐的起始城堡格" */
  readonly isStart: boolean
}

/** 半径 4 的六边形画布，61 格，初始全部为"不存在"。 */
export function createCanvas(radius: number = EDITOR_RADIUS): EditorCell[] {
  const cells: EditorCell[] = []
  for (let r = -radius; r <= radius; r += 1) {
    const qMin = Math.max(-radius, -radius - r)
    const qMax = Math.min(radius, radius - r)
    for (let q = qMin; q <= qMax; q += 1) {
      cells.push({ q, r, active: false, color: DEFAULT_COLOR, number: DEFAULT_NUMBER, isStart: false })
    }
  }
  return cells
}

export function cellKey(cell: { q: number; r: number }): string {
  return `${cell.q},${cell.r}`
}

export interface DerivedBoard {
  readonly board?: PlayerBoardDef
  readonly issues: readonly BoardIssue[]
  readonly summary: string
}

/**
 * 把画布整理成一张完整的版图定义，并跑引擎自带的校验器。
 *
 * 校验器是同一份 —— 录入的版图必须能通过引擎校验，否则它"看起来像版图"
 * 但会在对局里出问题（区域不连通、起始城堡格不是深红、区域超过 8 格……）。
 */
export function deriveBoard(
  cells: readonly EditorCell[],
  id: string,
  name: string,
): DerivedBoard {
  const active = cells.filter((cell) => cell.active)

  if (active.length === 0) {
    return { issues: [{ severity: 'error', message: '还没有录入任何格子' }], summary: '空画布' }
  }

  // 区域 = 同色连通块
  const regionIdByKey = new Map<string, string>()
  for (const color of TILE_COLORS) {
    const ofColor = active.filter((cell) => cell.color === color)
    if (ofColor.length === 0) continue
    const components = connectedComponents(ofColor.map((cell) => ({ q: cell.q, r: cell.r })))
    components.forEach((component, index) => {
      const regionId = `${color}-${index + 1}`
      for (const cell of component) regionIdByKey.set(axialKey(cell), regionId)
    })
  }

  const spaces: BoardSpace[] = active.map((cell) => {
    const regionId = regionIdByKey.get(axialKey(cell))
    if (regionId === undefined) throw new Error(`格位 ${cellKey(cell)} 没有派生出区域`)
    return { q: cell.q, r: cell.r, color: cell.color, number: cell.number, regionId }
  })

  const markedStart = active.find((cell) => cell.isStart)
  const firstCastle = active.find((cell) => cell.color === 'castle')
  const startCell = markedStart ?? firstCastle
  // 只取坐标：画布格子对象还带着 active/color/number 等字段，
  // 直接当 startingSpace 会让导出的 JSON 里混进无用字段。
  const startingSpace =
    startCell === undefined ? { q: 0, r: 0 } : { q: startCell.q, r: startCell.r }

  const board: PlayerBoardDef = { id, name, spaces, startingSpace }

  const issues: BoardIssue[] = [...validatePlayerBoard(board)]
  if (markedStart === undefined) {
    issues.push({
      severity: 'warning',
      message: firstCastle === undefined
        ? '没有深红（城堡）格：开局城堡将无处安放'
        : `没有标记"推荐起始格"，暂用第一个深红格 ${cellKey(firstCastle)}`,
    })
  }
  if (active.length > 40) {
    issues.push({ severity: 'warning', message: `格子数 ${active.length} 偏多（真实版图通常 37 格）` })
  }

  return { board, issues, summary: summarize(board) }
}

/** 一句话概括：格子数、各色格数、区域格数分布、城市大小分布。 */
export function summarize(board: PlayerBoardDef): string {
  const byColor = new Map<TileColor, number>()
  for (const space of board.spaces) {
    byColor.set(space.color, (byColor.get(space.color) ?? 0) + 1)
  }

  const regionSizes = new Map<string, number>()
  for (const space of board.spaces) {
    regionSizes.set(space.regionId, (regionSizes.get(space.regionId) ?? 0) + 1)
  }

  const buildingSizes = [...regionSizes.entries()]
    .filter(([regionId]) => regionId.startsWith('building-'))
    .map(([, size]) => size)
    .sort((a, b) => b - a)

  const colorText = TILE_COLORS.filter((color) => (byColor.get(color) ?? 0) > 0)
    .map((color) => `${color} ${byColor.get(color)}`)
    .join('、')

  const regionText = [...regionSizes.values()].sort((a, b) => b - a).join('/')
  const cityText = buildingSizes.length === 0 ? '无' : buildingSizes.join('/')

  return `共 ${board.spaces.length} 格；${colorText}；区域格数 ${regionText}；米色城市 ${buildingSizes.length} 个（${cityText}）`
}

// ---------------------------------------------------------------------------
// 导入 / 导出
// ---------------------------------------------------------------------------

export function boardToJson(board: PlayerBoardDef): string {
  return JSON.stringify(board, null, 2)
}

/** 把导出的 JSON 读回画布。版图里出现画布之外的坐标时会自动补格。 */
export function cellsFromJson(cells: readonly EditorCell[], text: string): {
  readonly cells?: EditorCell[]
  readonly error?: string
} {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return { error: `不是合法 JSON：${error instanceof Error ? error.message : ''}` }
  }

  // 数组在 JS 里 typeof 也是 'object'，所以必须单独挡掉，否则错误信息会含混
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { error: 'JSON 顶层不是对象' }
  }
  const candidate = parsed as Partial<PlayerBoardDef>
  if (!Array.isArray(candidate.spaces)) return { error: '缺少 spaces 数组' }

  const byKey = new Map<string, EditorCell>()
  for (const cell of cells) byKey.set(cellKey(cell), cell)

  const startKey = candidate.startingSpace === undefined ? '' : axialKey(candidate.startingSpace)

  for (const raw of candidate.spaces as BoardSpace[]) {
    if (typeof raw?.q !== 'number' || typeof raw?.r !== 'number') {
      return { error: 'spaces 里有缺少 q/r 的条目' }
    }
    const key = `${raw.q},${raw.r}`
    byKey.set(key, {
      q: raw.q,
      r: raw.r,
      active: true,
      color: raw.color,
      number: raw.number,
      isStart: key === startKey,
    })
  }

  // 画布里已有但版图里没有的格 → 标记为不存在（避免残留上一次录入的内容）
  for (const [key, cell] of byKey) {
    if (cell.active && !(candidate.spaces as BoardSpace[]).some((s) => `${s.q},${s.r}` === key)) {
      byKey.set(key, { ...cell, active: false, isStart: false })
    }
  }

  return { cells: [...byKey.values()] }
}
