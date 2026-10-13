/**
 * "这枚板块放下后会怎样"。
 *
 * 起因：仓储里的板块在手机上只有一个 title 属性，而 **title 在触摸屏上不显示**。
 * 玩家看到一个「木」字，无从知道它会做什么 —— 而"放下后会发生什么"恰恰是决定
 * 该放哪一枚、放到哪里的关键信息。
 *
 * 文字全部取自引擎数据（BUILDINGS / KNOWLEDGE_TILES 的 text 字段），
 * 不在这里另写一份，避免面板、悬浮提示、引擎三处说法不一致。
 */

import { BUILDINGS } from '../engine/data/buildings'
import { KNOWLEDGE_TILES } from '../engine/data/knowledge'
import type { HexTile } from '../engine/types'

export interface TileInfo {
  /** 短标题，例如「银行」「知识板块 17 号 · 瞭望塔」 */
  readonly title: string
  /** 放下后会发生什么 */
  readonly text: string
}

export function tileInfo(tile: HexTile): TileInfo {
  switch (tile.color) {
    case 'building': {
      const def = BUILDINGS.find((building) => building.id === tile.building)
      return {
        title: def?.name ?? '建筑',
        text: def?.text ?? '放下后触发它的效果。',
      }
    }

    case 'knowledge': {
      const def = KNOWLEDGE_TILES.find((knowledge) => knowledge.id === tile.knowledge)
      return {
        title: def === undefined ? `知识板块 ${tile.knowledge} 号` : `知识板块 ${tile.knowledge} 号 · ${def.name}`,
        text: def?.text ?? '放下后从这一刻起整局生效。',
      }
    }

    case 'castle':
      return {
        title: '城堡',
        text: '放下后立即再用一颗骰子做 1 个行动，无视点数。',
      }

    case 'mine':
      return {
        title: '矿',
        text: '每个阶段结束时，每座矿给你 1 银币。',
      }

    case 'ship':
      return {
        title: '船',
        text: '从任意一个货物格取走全部货物，并把你的顺位标记前移一位。',
      }

    case 'animal':
      return {
        title: `动物 · ${tile.animals} 只`,
        text: '按牧场上同种动物的累计只数计分；放进已有同种动物的牧场会额外得分。',
      }
  }
}
