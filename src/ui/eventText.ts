/**
 * 事件 → 界面文案。
 *
 * `describeEvent` 的输出带玩家 id 前缀（便于调试与日志），界面需要一个单独的
 * 「玩家标签 + 正文」结构，所以这里做一层薄适配，而不是复制一份 switch
 * —— 复制会漂移。
 */

import { describeEvent, type GameEvent } from '../engine/events'
import type { PlayerId } from '../engine/types'

const PLAYER_PREFIX = /^p[1-4]\s+/

/** 事件归属的玩家（无归属的事件返回 undefined）。 */
export function eventPlayer(event: GameEvent): PlayerId | undefined {
  switch (event.kind) {
    case 'rolledDice':
    case 'dieAdjusted':
    case 'tookTile':
    case 'discardedTile':
    case 'placedTile':
    case 'regionCompleted':
    case 'animalsScored':
    case 'bonusTileClaimed':
    case 'soldGoods':
    case 'tookWorkers':
    case 'boughtTile':
    case 'shipTookGoods':
    case 'turnOrderAdvanced':
    case 'buildingEffect':
    case 'castleExtraAction':
    case 'turnEnded':
      return event.player
    default:
      return undefined
  }
}

export interface UiEventText {
  readonly player: PlayerId | undefined
  readonly text: string
}

export function uiEventText(event: GameEvent): UiEventText {
  return {
    player: eventPlayer(event),
    text: describeEvent(event).replace(PLAYER_PREFIX, ''),
  }
}
