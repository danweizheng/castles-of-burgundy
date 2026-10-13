/**
 * 默认规则集：把版图与板块库存组装成一个可用的配置。
 *
 * ⚠️ 当前全部是**占位数据**：玩家版图用合成版图顶替 1 号版图，中央版图的仓库色位是造出来的，
 * 板块数量拆分也是臆造的。等实物数据录入后，只需要替换这个文件里的三处引用，
 * 引擎逻辑一行都不用改。
 */

import { SYNTHETIC_BOARD } from './data/boards/synthetic'
import { createPlaceholderGameBoard } from './gameBoard'
import { RULESET_VERSION, type RulesetConfig } from './state'
import { PLACEHOLDER_BLACK_TILE_INVENTORY, PLACEHOLDER_TILE_INVENTORY } from './tiles'
import type { PlayerBoardDef } from './types'

export function createDefaultRuleset(): RulesetConfig {
  const playerBoards: Record<string, PlayerBoardDef> = {
    // 真实版图数据做好后，这里应登记 No.1–No.9；当前 '1' 由合成版图顶替
    '1': SYNTHETIC_BOARD,
  }

  return {
    version: RULESET_VERSION,
    playerCount: 2,
    playerBoards,
    gameBoard: createPlaceholderGameBoard(),
    tileInventory: PLACEHOLDER_TILE_INVENTORY,
    blackTileInventory: PLACEHOLDER_BLACK_TILE_INVENTORY,
  }
}

export const DEFAULT_RULESET: RulesetConfig = createDefaultRuleset()
