import { describe, expect, it } from 'vitest'
import { BUILDINGS } from '../../engine/data/buildings'
import { KNOWLEDGE_TILES } from '../../engine/data/knowledge'
import { TILE_COLORS } from '../../engine/types'
import { tileInfo } from '../tileInfo'
import { animalTile, buildingTile, castleTile, knowledgeTile, mineTile, shipTile } from '../../engine/__tests__/testUtils'

describe('板块效果说明', () => {
  it('六种颜色的板块都能给出一句说明（不会出现空说明）', () => {
    const tiles = [
      castleTile('c'),
      mineTile('m'),
      shipTile('s'),
      animalTile('a', 'cow', 3),
      buildingTile('b', 'bank'),
      knowledgeTile('k', 17),
    ]
    expect(new Set(tiles.map((tile) => tile.color)).size).toBe(TILE_COLORS.length)

    for (const tile of tiles) {
      const info = tileInfo(tile)
      expect(info.title.length, `${tile.color} 缺标题`).toBeGreaterThan(0)
      expect(info.text.length, `${tile.color} 缺说明`).toBeGreaterThan(4)
    }
  })

  it('八种建筑各自引用自己的效果文字（不是同一句通用话术）', () => {
    const texts = BUILDINGS.map((building) => tileInfo(buildingTile('b', building.id)))
    for (const [index, building] of BUILDINGS.entries()) {
      const info = texts[index]!
      expect(info.title).toBe(building.name)
      // 文字直接来自引擎数据，面板与这里不可能说法不一致
      expect(info.text).toBe(building.text)
    }
    expect(new Set(texts.map((info) => info.text)).size).toBe(BUILDINGS.length)
  })

  it('26 张知识板块都能给出名字与说明，且都来自引擎数据', () => {
    for (const knowledge of KNOWLEDGE_TILES) {
      const info = tileInfo(knowledgeTile(`k${knowledge.id}`, knowledge.id))
      expect(info.title).toContain(String(knowledge.id))
      expect(info.title).toContain(knowledge.name)
      expect(info.text).toBe(knowledge.text)
    }
  })

  it('动物板块的标题带上只数（决定它值多少分）', () => {
    expect(tileInfo(animalTile('a2', 'cow', 2)).title).toContain('2 只')
    expect(tileInfo(animalTile('a4', 'cow', 4)).title).toContain('4 只')
  })

  it('船与城堡的说明点出它们真正的价值（取货并抢顺位 / 额外行动）', () => {
    expect(tileInfo(shipTile('s')).text).toContain('顺位')
    expect(tileInfo(castleTile('c')).text).toContain('无视点数')
  })
})
