/**
 * 开发与测试用的**合成版图**（⚠️ 不是真实版图）。
 *
 * 为什么需要它：真实版图数据要靠人工从实物录入（见 rules/规则规格.md 第 12 节），
 * 那段工作和我写引擎是两条并行线。为了不互相阻塞，这里按**真实版图的统计特征**
 * 造一张同构版图：37 格、六色分布与 1 号版图一致、4 个米色城市（5/3/3/1 格，
 * 与官方对 1 号版图的描述完全一致）、多个同色区域以便测试"区域分别计分"。
 *
 * 真实数据录入完成后，只需把 setActivePlayerBoards 的数据换掉，引擎逻辑一行都不用改。
 */

import { axialKey, connectedComponents } from '../../hex'
import { MAX_REGION_SIZE } from '../scoring'
import type { BoardSpace, DieValue, PlayerBoardDef, TileColor } from '../../types'

const COLOR_BY_LETTER: Readonly<Record<string, TileColor>> = {
  C: 'castle',
  S: 'ship',
  A: 'animal',
  M: 'mine',
  B: 'building',
  K: 'knowledge',
}

/**
 * 半径 3 的六边形（37 格）。行号 r = -3..3，`qStart` 是该行最左格的 q，
 * 字符串从左到右逐格给出颜色字母。
 *
 * 六边形半径 3 的行长度序列为 4/5/6/7/6/5/4，合计 37。
 * 六色分布：castle 4 / ship 6 / animal 6 / mine 3 / building 12 / knowledge 6。
 */
const MAP: ReadonlyArray<{ readonly r: number; readonly qStart: number; readonly cells: string }> = [
  { r: -3, qStart: 0, cells: 'SACS' },
  { r: -2, qStart: -1, cells: 'SSAAS' },
  { r: -1, qStart: -2, cells: 'BBBBBS' },
  { r: 0, qStart: -3, cells: 'CKACKKB' },
  { r: 1, qStart: -3, cells: 'BMAAMK' },
  { r: 2, qStart: -3, cells: 'BMBBB' },
  { r: 3, qStart: -3, cells: 'BCKK' },
]

/** 起始城堡所在格（中心，点数 6）。 */
const STARTING_SPACE = { q: 0, r: 0 } as const

interface DraftCell {
  readonly q: number
  readonly r: number
  readonly color: TileColor
}

function draftCells(): DraftCell[] {
  const cells: DraftCell[] = []
  for (const row of MAP) {
    for (let i = 0; i < row.cells.length; i += 1) {
      const letter = row.cells[i]
      if (letter === undefined) throw new Error('合成版图数据越界')
      const color = COLOR_BY_LETTER[letter]
      if (color === undefined) throw new Error(`合成版图出现未知颜色字母：${letter}`)
      cells.push({ q: row.qStart + i, r: row.r, color })
    }
  }
  return cells
}

/**
 * 按"同色相邻连通块"派生 regionId。
 * 顺序是稳定的：以逐行扫描的先后为准，所以派生结果可复现、可快照测试。
 */
function assignRegionIds(cells: readonly DraftCell[]): Map<string, string> {
  const regionIdByKey = new Map<string, string>()

  for (const color of ['castle', 'ship', 'animal', 'mine', 'building', 'knowledge'] as const) {
    const ofColor = cells.filter((c) => c.color === color)
    const components = connectedComponents(ofColor.map((c) => ({ q: c.q, r: c.r })))
    components.forEach((component, index) => {
      const regionId = `${color}-${index + 1}`
      for (const cell of component) regionIdByKey.set(axialKey(cell), regionId)
    })
  }

  return regionIdByKey
}

function buildBoard(): PlayerBoardDef {
  const cells = draftCells()
  const regionIdByKey = assignRegionIds(cells)
  const startKey = axialKey(STARTING_SPACE)

  const spaces: BoardSpace[] = cells.map((cell, index) => {
    const key = axialKey(cell)
    const regionId = regionIdByKey.get(key)
    if (regionId === undefined) throw new Error(`格位 ${key} 没有派生出区域`)

    // 点数按稳定顺序循环 1–6；起始城堡格强制为 6（规则要求）
    const number = (key === startKey ? 6 : ((index % 6) + 1)) as DieValue

    return { q: cell.q, r: cell.r, color: cell.color, number, regionId }
  })

  return {
    id: 'synthetic',
    name: '合成测试版图（非真实数据）',
    spaces,
    startingSpace: STARTING_SPACE,
  }
}

export const SYNTHETIC_BOARD: PlayerBoardDef = buildBoard()

/** 供测试断言的预期形状。 */
export const SYNTHETIC_BOARD_EXPECTED = {
  size: 37,
  maxRegionSize: MAX_REGION_SIZE,
  colorCounts: {
    castle: 4,
    ship: 6,
    animal: 6,
    mine: 3,
    building: 12,
    knowledge: 6,
  },
  /** 每种颜色的区域格数列表（已排序），用来锁住区域派生结果 */
  regionSizes: {
    castle: [1, 1, 1, 1],
    ship: [3, 3],
    animal: [3, 3],
    mine: [1, 2],
    building: [1, 3, 3, 5],
    knowledge: [1, 2, 3],
  },
} as const
