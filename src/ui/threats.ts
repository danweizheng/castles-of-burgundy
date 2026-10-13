/**
 * 威胁分析：某个玩家离"完成一个区域 / 铺满一个颜色"还差几格。
 *
 * 为什么值得单独做：本作 2 人局的核心是卡位，而卡位的前提是**看得见对手快到什么程度**。
 * 手机上对手的领地只有一块缩略图，光看颜色块根本判断不出来。
 *
 * 这里只做"数格子 + 查表算分"，是纯函数，因此可以单测；
 * 界面只负责把它渲染成一句话。
 */

import { regionsOf } from '../engine/board'
import { bonusTileVp, phaseCompletionBonus, regionSizeVp } from '../engine/data/scoring'
import { axialKey } from '../engine/hex'
import { playerById, type GameState, type RulesetConfig } from '../engine/state'
import { TILE_COLORS, type PlayerId } from '../engine/types'
import { TILE_COLOR_LABEL } from './tiles'

export interface Threat {
  readonly kind: 'region' | 'color'
  /** 中文描述，界面直接用 */
  readonly label: string
  /** 还差几格 */
  readonly remaining: number
  /** 完成能拿多少分（颜色按当前还能领到的大/小奖励板块计） */
  readonly value: number
}

/** 只报"还差 1–2 格"的威胁：差 3 格以上还谈不上紧急，全列出来只会变成噪音。 */
const URGENT_REMAINING = 2

/**
 * 还要求"至少填了一半"。
 *
 * 这条不是凑出来的：只按"还差 ≤2 格"筛的话，开局那一刻版图上所有 1–2 格的小区域
 * 都会满足条件（一格都没放，"还差 2 格"），于是一开局就报出一串毫无意义的威胁。
 * 加上"已填一半"之后，"快完成"才真的是快完成。
 */
function isCloseToComplete(size: number, filled: number): boolean {
  const remaining = size - filled
  return remaining >= 1 && remaining <= URGENT_REMAINING && filled * 2 >= size
}

export function threatsFor(
  config: RulesetConfig,
  state: GameState,
  playerId: PlayerId,
): Threat[] {
  const player = playerById(state, playerId)
  const board = config.playerBoards[player.boardId]
  if (board === undefined) return []

  const threats: Threat[] = []

  // 区域：快完成了
  for (const region of regionsOf(board)) {
    if (region.size === 0) continue
    if (region.size > 8) continue // 计分表放不下，属于异常数据

    let filled = 0
    for (const space of region.spaces) {
      if (player.estate[axialKey(space)] !== undefined) filled += 1
    }
    if (!isCloseToComplete(region.size, filled)) continue

    threats.push({
      kind: 'region',
      label: `${region.size} 格${TILE_COLOR_LABEL[region.color]}区域`,
      remaining: region.size - filled,
      value: regionSizeVp(region.size) + phaseCompletionBonus(state.phaseIndex),
    })
  }

  // 颜色：全部空格快铺满（对应奖励板块）。已经领不到奖励板块的颜色不再算威胁。
  const claimed = state.bonusTilesClaimed
  for (const color of TILE_COLORS) {
    const spaces = board.spaces.filter((space) => space.color === color)
    if (spaces.length === 0) continue

    const alreadyClaimed = claimed[color] ?? []
    // 两枚奖励板块都被领走、或该玩家自己已经领过这一色，就不再是"抢奖励"的威胁
    if (alreadyClaimed.length >= 2 || player.bonusTiles[color] !== undefined) continue

    const filled = spaces.filter((space) => player.estate[axialKey(space)] !== undefined).length
    if (!isCloseToComplete(spaces.length, filled)) continue

    threats.push({
      kind: 'color',
      label: `${TILE_COLOR_LABEL[color]}色全部铺满`,
      remaining: spaces.length - filled,
      value: bonusTileVp(state.playerCount, alreadyClaimed.length === 0 ? 'large' : 'small'),
    })
  }

  // 越紧急、越值钱的排前面
  return threats.sort((a, b) => a.remaining - b.remaining || b.value - a.value)
}

/** 只差 1 格的威胁（界面用它决定要不要亮警示色）。 */
export function urgentThreats(threats: readonly Threat[]): Threat[] {
  return threats.filter((threat) => threat.remaining === 1)
}
