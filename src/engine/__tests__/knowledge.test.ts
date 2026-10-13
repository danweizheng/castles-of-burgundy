import { describe, expect, it } from 'vitest'
import {
  ALL_KNOWLEDGE_IDS,
  BUILDING_SCORING_KNOWLEDGE,
  BUILDING_SCORING_KNOWLEDGE_IDS,
  FREE_DIE_ADJUST_KNOWLEDGE,
  KNOWLEDGE_TILES,
  K,
  SCORING_KNOWLEDGE_BY_BUILDING,
  knowledgeDef,
} from '../data/knowledge'
import { BUILDING_KINDS } from '../types'

describe('知识板块表（官方共 26 张）', () => {
  it('恰好 26 张，编号 1–26 无重复无缺号', () => {
    expect(KNOWLEDGE_TILES).toHaveLength(26)
    const ids = KNOWLEDGE_TILES.map((k) => k.id).sort((a, b) => a - b)
    expect(ids).toEqual(Array.from({ length: 26 }, (_, i) => i + 1))
    expect(new Set(ids).size).toBe(26)
    expect(ALL_KNOWLEDGE_IDS).toHaveLength(26)
  })

  it('每张都有中文名与效果说明', () => {
    for (const tile of KNOWLEDGE_TILES) {
      expect(tile.name.length).toBeGreaterThan(0)
      expect(tile.text.length).toBeGreaterThan(4)
    }
  })

  it('生效方式分布：13 张持续型 / 1 张阶段结算 / 12 张终局计分型', () => {
    const byKind = { continuous: 0, phaseEnd: 0, finalScoring: 0 }
    for (const tile of KNOWLEDGE_TILES) byKind[tile.kind] += 1
    expect(byKind).toEqual({ continuous: 13, phaseEnd: 1, finalScoring: 12 })
  })

  it('唯一一张阶段结算型是 2 号（矿工）', () => {
    const phaseEnd = KNOWLEDGE_TILES.filter((k) => k.kind === 'phaseEnd')
    expect(phaseEnd.map((k) => k.id)).toEqual([K.workerPerMineAtPhaseEnd])
  })

  it('查询接口：认识的编号返回定义，不认识的抛错', () => {
    expect(knowledgeDef(K.dieAdjustTwoPerWorker).name).toBe('巧匠')
    expect(() => knowledgeDef(99)).toThrow()
  })
})

describe('16–23 号与八种建筑的对应', () => {
  it('编号恰好是 16–23 且覆盖全部 8 种建筑', () => {
    expect(BUILDING_SCORING_KNOWLEDGE_IDS).toEqual([16, 17, 18, 19, 20, 21, 22, 23])
    const buildings = Object.values(BUILDING_SCORING_KNOWLEDGE)
    expect(buildings).toHaveLength(8)
    expect([...buildings].sort()).toEqual([...BUILDING_KINDS].sort())
  })

  it('两个锚点与官方例子一致：17 = 瞭望塔、22 = 银行', () => {
    // 官方原文："Benno has yellow tiles 17 (watchtowers) and 22 (banks)"
    expect(BUILDING_SCORING_KNOWLEDGE[17]).toBe('watchtower')
    expect(BUILDING_SCORING_KNOWLEDGE[22]).toBe('bank')
  })

  it('正向表与反向表完全一致（防止两处漂移）', () => {
    for (const [idText, building] of Object.entries(BUILDING_SCORING_KNOWLEDGE)) {
      expect(SCORING_KNOWLEDGE_BY_BUILDING[building]).toBe(Number(idText))
    }
    expect(Object.keys(SCORING_KNOWLEDGE_BY_BUILDING)).toHaveLength(8)
  })
})

describe('9 / 10 / 11 号：免费骰子调整的颜色映射', () => {
  it('六种板块颜色都有对应条目', () => {
    expect(Object.keys(FREE_DIE_ADJUST_KNOWLEDGE).sort()).toEqual([
      'animal',
      'building',
      'castle',
      'knowledge',
      'mine',
      'ship',
    ])
  })

  it('9 号管建筑、10 号管船与动物、11 号管城堡/矿/知识', () => {
    expect(FREE_DIE_ADJUST_KNOWLEDGE.building).toBe(K.freeAdjustBuildings)
    expect(FREE_DIE_ADJUST_KNOWLEDGE.ship).toBe(K.freeAdjustShipsAndAnimals)
    expect(FREE_DIE_ADJUST_KNOWLEDGE.animal).toBe(K.freeAdjustShipsAndAnimals)
    expect(FREE_DIE_ADJUST_KNOWLEDGE.castle).toBe(K.freeAdjustCastlesMinesKnowledge)
    expect(FREE_DIE_ADJUST_KNOWLEDGE.mine).toBe(K.freeAdjustCastlesMinesKnowledge)
    expect(FREE_DIE_ADJUST_KNOWLEDGE.knowledge).toBe(K.freeAdjustCastlesMinesKnowledge)
  })
})

describe('编号常量表', () => {
  it('每个编号都是 1–26 且彼此不同', () => {
    const values = Object.values(K).sort((a, b) => a - b)
    expect(new Set(values).size).toBe(values.length)
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(1)
      expect(value).toBeLessThanOrEqual(26)
    }
  })
})
