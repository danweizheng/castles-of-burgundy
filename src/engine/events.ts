/**
 * 对局事件。
 *
 * `applyMove` 返回新状态 + 一组事件。UI 只渲染事件、不自己推算规则，
 * 中文播报与动画都由事件驱动（见 README 第三条架构红线）。
 */

import type { Axial } from './hex'
import type { BonusTileSize, BuildingKind, DieValue, GoodsKind, PlayerId, TileColor } from './types'

export type GameEvent =
  | { readonly kind: 'rolledDice'; readonly player: PlayerId; readonly values: readonly DieValue[] }
  /**
   * 骰子被工人调整过（含知识板块给的免费 ±1）。
   * `workersSpent` 为 0 但仍带 `freeAdjust` 时，说明是免费调整。
   */
  | {
      readonly kind: 'dieAdjusted'
      readonly player: PlayerId
      readonly from: DieValue
      readonly to: DieValue
      readonly workersSpent: number
    }
  | { readonly kind: 'tookTile'; readonly player: PlayerId; readonly tileId: string; readonly color: TileColor }
  | { readonly kind: 'discardedTile'; readonly player: PlayerId; readonly tileId: string; readonly color: TileColor }
  | {
      readonly kind: 'placedTile'
      readonly player: PlayerId
      readonly tileId: string
      readonly color: TileColor
      readonly to: Axial
      readonly building?: BuildingKind
      readonly knowledge?: number
      readonly animals?: number
    }
  | {
      readonly kind: 'regionCompleted'
      readonly player: PlayerId
      readonly regionId: string
      readonly size: number
      readonly vp: number
    }
  | { readonly kind: 'animalsScored'; readonly player: PlayerId; readonly vp: number; readonly tiles: number }
  | {
      readonly kind: 'bonusTileClaimed'
      readonly player: PlayerId
      readonly color: TileColor
      readonly size: BonusTileSize
      readonly vp: number
    }
  | {
      readonly kind: 'soldGoods'
      readonly player: PlayerId
      readonly goods: GoodsKind
      readonly tiles: number
      readonly vp: number
      readonly silverlings: number
      readonly workers: number
    }
  | {
      readonly kind: 'tookWorkers'
      readonly player: PlayerId
      readonly workers: number
      readonly silverlings: number
    }
  | { readonly kind: 'boughtTile'; readonly player: PlayerId; readonly tileId: string; readonly color: TileColor }
  | {
      readonly kind: 'shipTookGoods'
      readonly player: PlayerId
      readonly space: DieValue
      readonly taken: readonly GoodsKind[]
      readonly left: readonly GoodsKind[]
    }
  | { readonly kind: 'turnOrderAdvanced'; readonly player: PlayerId; readonly isStartPlayer: boolean }
  | { readonly kind: 'buildingEffect'; readonly player: PlayerId; readonly building: BuildingKind }
  | { readonly kind: 'castleExtraAction'; readonly player: PlayerId }
  | { readonly kind: 'phaseEnded'; readonly phase: number; readonly silverlings: readonly number[] }
  | { readonly kind: 'turnEnded'; readonly player: PlayerId }
  | { readonly kind: 'roundStarted'; readonly phase: number; readonly round: number; readonly whiteDie: DieValue }
  | { readonly kind: 'phaseStarted'; readonly phase: number }
  | { readonly kind: 'gameFinished' }

export function describeEvent(event: GameEvent): string {
  switch (event.kind) {
    case 'rolledDice':
      return `${event.player} 掷出 ${event.values.join(' / ')}`
    case 'dieAdjusted':
      return `${event.player} 把骰子 ${event.from} 调成 ${event.to}（花 ${event.workersSpent} 个工人，免费调整 ${event.workersSpent === 0 ? '是' : '否'}）`
    case 'tookTile':
      return `${event.player} 取走一枚${event.color}板块`
    case 'discardedTile':
      return `${event.player} 丢弃一枚${event.color}板块（移出游戏）`
    case 'placedTile':
      return `${event.player} 放置一枚${event.color}板块到 ${event.to.q},${event.to.r}`
    case 'regionCompleted':
      return `${event.player} 铺满区域 ${event.regionId}（${event.size} 格）得 ${event.vp} 分`
    case 'animalsScored':
      return `${event.player} 动物计分 ${event.vp} 分（${event.tiles} 枚板块）`
    case 'bonusTileClaimed':
      return `${event.player} 拿到${event.color}${event.size === 'large' ? '大' : '小'}奖励板块，得 ${event.vp} 分`
    case 'soldGoods':
      return `${event.player} 卖出 ${event.tiles} 枚货物得 ${event.vp} 分与 ${event.silverlings} 银币`
    case 'tookWorkers':
      return `${event.player} 取 ${event.workers} 个工人`
    case 'boughtTile':
      return `${event.player} 从黑洞买下一枚${event.color}板块`
    case 'shipTookGoods':
      return `${event.player} 从第 ${event.space} 号货物格取走 ${event.taken.length} 枚货物`
    case 'turnOrderAdvanced':
      return `${event.player} 顺位前移${event.isStartPlayer ? '，成为下一轮先手' : ''}`
    case 'buildingEffect':
      return `${event.player} 触发建筑效果：${event.building}`
    case 'castleExtraAction':
      return `${event.player} 获得一次城堡额外行动`
    case 'phaseEnded':
      return `第 ${event.phase} 阶段结束`
    case 'turnEnded':
      return `${event.player} 回合结束`
    case 'roundStarted':
      return `第 ${event.phase} 阶段第 ${event.round} 轮开始（白骰 ${event.whiteDie}）`
    case 'phaseStarted':
      return `第 ${event.phase} 阶段开始`
    case 'gameFinished':
      return '对局结束'
  }
}
