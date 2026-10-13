/**
 * 八种建筑的效果描述。
 *
 * 这里只声明"效果是什么"（机器可读的 tag + 参数），具体怎么改状态由 effects 层实现。
 * 这样做的原因：建筑效果是即时触发的一次性效果，但触发时机很多（放置时、市政厅连锁时），
 * 声明与执行分离能让效果系统只写一遍。
 */

import type { BuildingKind, TileColor } from '../types'

export type BuildingEffect =
  /** 仓库：立即（不消耗骰子）卖出一种自选货物，规则同"卖货物"行动。 */
  | { readonly kind: 'sellGoods' }
  /** 木工坊：从任意编号仓库（非黑洞）取 1 枚米色建筑板块放入仓储。 */
  | { readonly kind: 'takeTileFromAnyDepot'; readonly colors: readonly TileColor[] }
  /** 客栈：取 4 个工人。 */
  | { readonly kind: 'gainWorkers'; readonly amount: number }
  /** 银行：取 2 银币。 */
  | { readonly kind: 'gainSilverlings'; readonly amount: number }
  /** 市政厅：从仓储再放 1 枚板块进领地，不受颜色限制（含其全部效果）。 */
  | { readonly kind: 'placeExtraTileIgnoringColor' }
  /** 瞭望塔：立即前进 4 分。 */
  | { readonly kind: 'gainVp'; readonly amount: number }

export interface BuildingDef {
  readonly id: BuildingKind
  readonly name: string
  readonly englishName: string
  readonly effect: BuildingEffect
  /** 规则书上的效果原文要点，用于 UI 悬浮说明与自查。 */
  readonly text: string
}

export const BUILDINGS: readonly BuildingDef[] = [
  {
    id: 'warehouse',
    name: '仓库',
    englishName: 'Warehouse',
    effect: { kind: 'sellGoods' },
    text: '立即（不需骰子）卖出一种自选货物，效果同"卖货物"行动。',
  },
  {
    id: 'carpenter',
    name: '木工坊',
    englishName: "Carpenter's Workshop",
    effect: { kind: 'takeTileFromAnyDepot', colors: ['building'] },
    text: '从任意编号仓库（非黑洞）取 1 枚米色建筑板块，放入仓储空位。',
  },
  {
    id: 'church',
    name: '教堂',
    englishName: 'Church',
    effect: { kind: 'takeTileFromAnyDepot', colors: ['mine', 'knowledge', 'castle'] },
    text: '从任意编号仓库（非黑洞）取 1 枚矿 / 知识 / 城堡板块，放入仓储空位。',
  },
  {
    id: 'market',
    name: '市场',
    englishName: 'Market',
    effect: { kind: 'takeTileFromAnyDepot', colors: ['ship', 'animal'] },
    text: '从任意编号仓库（非黑洞）取 1 枚船 / 动物板块，放入仓储空位。',
  },
  {
    id: 'boardingHouse',
    name: '客栈',
    englishName: 'Boarding House',
    effect: { kind: 'gainWorkers', amount: 4 },
    text: '立即取 4 个工人。',
  },
  {
    id: 'bank',
    name: '银行',
    englishName: 'Bank',
    effect: { kind: 'gainSilverlings', amount: 2 },
    text: '立即取 2 银币。',
  },
  {
    id: 'cityHall',
    name: '市政厅',
    englishName: 'City Hall',
    effect: { kind: 'placeExtraTileIgnoringColor' },
    text: '从仓储再放 1 枚板块进领地，不受颜色限制（含其全部效果）。',
  },
  {
    id: 'watchtower',
    name: '瞭望塔',
    englishName: 'Watchtower',
    effect: { kind: 'gainVp', amount: 4 },
    text: '立即前进 4 分。',
  },
]

const BUILDING_BY_ID = new Map<BuildingKind, BuildingDef>(BUILDINGS.map((b) => [b.id, b]))

export function buildingDef(id: BuildingKind): BuildingDef {
  const def = BUILDING_BY_ID.get(id)
  if (def === undefined) throw new Error(`未知建筑：${id}`)
  return def
}
