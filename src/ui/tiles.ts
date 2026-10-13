/**
 * 界面符号表。
 *
 * 不用原版美术素材，改用「颜色 + 单字 + 数字」三重编码：
 * 颜色区分大类，单字区分具体种类，数字显示点数/数量/知识编号。
 * 这样在手机上不用放大也能认出来，而且完全矢量、体积为零。
 */

import type { AnimalKind, BuildingKind, GoodsKind, HexTile, TileColor } from '../engine/types'

/** 六种板块颜色的 CSS 配色（沿用官方配色语义：深绿/浅绿/米色/灰/蓝/黄）。 */
export const TILE_COLOR_CSS: Readonly<Record<TileColor, string>> = {
  castle: '#3f6b46',
  animal: '#79ab5f',
  building: '#c39a63',
  mine: '#8b8f96',
  ship: '#5486b5',
  knowledge: '#d0b23f',
}

export const TILE_COLOR_DARK: Readonly<Record<TileColor, string>> = {
  castle: '#24402a',
  animal: '#435f34',
  building: '#6f5738',
  mine: '#4d5054',
  ship: '#2f4d68',
  knowledge: '#77661f',
}

export const TILE_COLOR_LABEL: Readonly<Record<TileColor, string>> = {
  castle: '城堡',
  animal: '动物',
  building: '建筑',
  mine: '矿',
  ship: '船',
  knowledge: '知识',
}

const ANIMAL_GLYPH: Readonly<Record<AnimalKind, string>> = {
  chicken: '鸡',
  sheep: '羊',
  pig: '猪',
  cow: '牛',
}

const BUILDING_GLYPH: Readonly<Record<BuildingKind, string>> = {
  warehouse: '仓',
  carpenter: '木',
  church: '教',
  market: '市',
  boardingHouse: '客',
  bank: '银',
  cityHall: '厅',
  watchtower: '塔',
}

/** 货物没有名字，只有 6 种颜色，用色块 + 编号表示。 */
export const GOODS_CSS: Readonly<Record<string, string>> = {
  1: '#c0562f',
  2: '#8a4f9c',
  3: '#2f7f8a',
  4: '#b8446a',
  5: '#7a7a2f',
  6: '#9c6b2f',
}

export interface TileGlyph {
  /** 主字 */
  readonly text: string
  /** 右下角小字（动物只数 / 知识编号） */
  readonly sub?: string
  readonly color: string
  readonly label: string
}

export function tileGlyph(tile: HexTile): TileGlyph {
  const color = TILE_COLOR_CSS[tile.color]
  switch (tile.color) {
    case 'castle':
      return { text: '城', color, label: '城堡' }
    case 'mine':
      return { text: '矿', color, label: '矿' }
    case 'ship':
      return { text: '船', color, label: '船' }
    case 'animal':
      return {
        text: ANIMAL_GLYPH[tile.animal],
        sub: String(tile.animals),
        color,
        label: `动物（${tile.animals} 只）`,
      }
    case 'building':
      return { text: BUILDING_GLYPH[tile.building], color, label: '建筑' }
    case 'knowledge':
      return { text: '知', sub: String(tile.knowledge), color, label: `知识 ${tile.knowledge} 号` }
  }
}

export function goodsCss(kind: GoodsKind): string {
  return GOODS_CSS[String(kind)] ?? '#888'
}

/** 中文数字，用于"第 N 阶段 / 第 N 轮"。 */
export const PHASE_LETTERS = ['A', 'B', 'C', 'D', 'E'] as const

export function playerLabel(id: string): string {
  return id === 'p1' ? '你' : id === 'p2' ? '对手' : id
}
