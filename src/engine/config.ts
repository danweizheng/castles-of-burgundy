/**
 * 默认规则集：把版图与板块库存组装成一个可用的配置。
 *
 * 数据来源：
 * - 板块库存：**官方规则书第 2 页的组件清单**（已确定，见 tiles.ts）
 * - 玩家版图 / 中央版图：**仍是占位数据**，等实物照片（棋盘上印的颜色与数字无法从规则书文本得到）
 *
 * 替换占位数据时只需要改这个文件里的两处引用，引擎逻辑一行都不用改。
 */

import { SYNTHETIC_BOARD } from './data/boards/synthetic'
import { createPlaceholderGameBoard } from './gameBoard'
import { RULESET_VERSION, type RulesetConfig } from './state'
import { OFFICIAL_BLACK_TILE_INVENTORY, OFFICIAL_TILE_INVENTORY } from './tiles'
import type { PlayerBoardDef } from './types'

export function createDefaultRuleset(): RulesetConfig {
  const playerBoards: Record<string, PlayerBoardDef> = {
    // 真实版图数据做好后，这里应登记 No.1–No.10（Special Edition 是 #1-10）；当前 '1' 由合成版图顶替
    '1': SYNTHETIC_BOARD,
  }

  return {
    version: RULESET_VERSION,
    playerCount: 2,
    playerBoards,
    gameBoard: createPlaceholderGameBoard(),
    tileInventory: OFFICIAL_TILE_INVENTORY,
    blackTileInventory: OFFICIAL_BLACK_TILE_INVENTORY,
  }
}

export const DEFAULT_RULESET: RulesetConfig = createDefaultRuleset()

/**
 * 同一套数据、换一个玩家人数。
 *
 * 人数会影响不少东西：玩家数量、启用的仓库格位数（12/18/24）、起始工人数、
 * 卖货每枚分值（2/3/4）、奖励板块分值（大块 5/6/7）。
 * **存档恢复时必须用存档里的人数重建配置**，否则 3/4 人局的存档会被 2 人局配置校验 ——
 * 合法动作与格位数全对不上，会得到"存档损坏"这种误导性的结论。
 */
export function rulesetForPlayerCount(playerCount: 2 | 3 | 4): RulesetConfig {
  return { ...DEFAULT_RULESET, playerCount }
}

