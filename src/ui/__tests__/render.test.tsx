import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { playerById } from '../../engine/state'
import type { PlayerBoardDef } from '../../engine/types'
import { App } from '../App'
import { DepotPanel } from '../components/DepotPanel'
import { HexBoard } from '../components/HexBoard'
import { PlayerPanel } from '../components/PlayerPanel'
import {
  Buildings,
  Knowledge,
  RulesPanel,
  Scoring,
  Setup,
} from '../components/RulesPanel'
import { SaveMenu } from '../components/SaveMenu'
import { BUILDINGS } from '../../engine/data/buildings'
import { KNOWLEDGE_TILES } from '../../engine/data/knowledge'
import { BASE_STATE, CONFIG } from '../../engine/__tests__/testUtils'

/**
 * 界面渲染冒烟测试。
 *
 * 用 renderToStaticMarkup（服务端渲染）把整棵渲染树跑一遍。它抓不到样式与手感，
 * 但能抓到"某个组件在真实对局状态下会因为 undefined 而崩"这类问题 ——
 * 而这恰好是纯逻辑测试覆盖不到的部分。
 *
 * 注意：SSR 不会执行 useEffect，所以这里的自动对手与定时器都不会触发。
 */

const BOARD = CONFIG.playerBoards['1'] as PlayerBoardDef
const HUMAN_ESTATE = playerById(BASE_STATE, 'p1').estate

function countOccurrences(text: string, needle: string): number {
  return text.split(needle).length - 1
}

describe('HexBoard 渲染', () => {
  const html = renderToStaticMarkup(
    <HexBoard board={BOARD} estate={HUMAN_ESTATE} size={18} />,
  )

  it('每个格位都渲染成一个多边形（合成版图 37 格）', () => {
    expect(countOccurrences(html, '<polygon')).toBe(BOARD.spaces.length)
    expect(BOARD.spaces.length).toBe(37)
  })

  it('空位显示所需点数，已放置的格位显示板块字', () => {
    // 起始城堡已放好，应该出现"城"
    expect(html).toContain('城')
    // 空格上会印点数，比如 6
    expect(html).toContain('>6</text>')
  })

  it('紧凑模式不显示点数（用于对手小版图）', () => {
    const compact = renderToStaticMarkup(<HexBoard board={BOARD} estate={{}} size={8} compact />)
    expect(countOccurrences(compact, '<polygon')).toBe(BOARD.spaces.length)
    expect(compact).not.toContain('>6</text>')
  })

  it('有可点落点时给对应多边形加上目标样式', () => {
    const targets = new Map([['0,0', [0]]])
    const withTargets = renderToStaticMarkup(
      <HexBoard board={BOARD} estate={{}} targets={targets} size={18} onTapSpace={() => {}} />,
    )
    expect(withTargets).toContain('hex--target')
  })
})

describe('DepotPanel 渲染', () => {
  it('6 个编号仓库都渲染出来，货位显示空占位', () => {
    const html = renderToStaticMarkup(
      <DepotPanel
        config={CONFIG}
        state={BASE_STATE}
        highlightedSlotIds={new Set()}
        onTapSlot={() => {}}
      />,
    )
    for (const depot of [1, 2, 3, 4, 5, 6]) {
      expect(html).toContain(`第 ${depot} 号仓库`)
    }
    expect(html).toContain('第 6 号货物格')
  })

  it('被高亮的格位按钮可点（不带 disabled）', () => {
    const slots = Object.keys(BASE_STATE.depotSlots)
    const first = slots[0]
    expect(first).toBeDefined()
    const html = renderToStaticMarkup(
      <DepotPanel
        config={CONFIG}
        state={BASE_STATE}
        highlightedSlotIds={new Set([first!])}
        onTapSlot={() => {}}
      />,
    )
    expect(html).toContain('slot--target')
  })
})

describe('PlayerPanel 渲染', () => {
  it('资源、仓储、货物三行都渲染，且不可点的按钮是 disabled', () => {
    const html = renderToStaticMarkup(<PlayerPanel player={playerById(BASE_STATE, 'p1')} title="你的资源" />)
    expect(html).toContain('你的资源')
    expect(html).toContain('分数')
    expect(html).toContain('银币')
    expect(html).toContain('工人')
    expect(html).toContain('仓储')
    expect(html).toContain('货物')
    // 没有任何可点目标时，仓储都是"空"占位
    expect(html).toContain('tileface--empty')
  })
})

describe('整屏渲染', () => {
  it('完整界面能渲染出 HTML，不抛错', () => {
    const html = renderToStaticMarkup(<App />)
    expect(html).toContain('你的领地')
    expect(html).toContain('阶段')
    expect(html).toContain('白骰')
    expect(html).toContain('点一颗骰子')
    expect(html).toContain('对手')
    // 顶栏按钮
    expect(html).toContain('撤销')
    expect(html).toContain('新局')
    expect(html).toContain('存档')
  })

  it('存档面板能渲染（这是唯一只在真机上才会打开的面板）', () => {
    const html = renderToStaticMarkup(<SaveMenu onClose={() => {}} />)
    expect(html).toContain('导出存档')
    expect(html).toContain('导入存档')
    expect(html).toContain('清除本机存档')
    expect(html).toContain('ios'.replace('ios', 'iOS'))
  })

  it('规则速查：六个分页都在，默认停在「行动」页', () => {
    const html = renderToStaticMarkup(<RulesPanel onClose={() => {}} />)
    for (const label of ['行动', '流程', '计分', '知识', '建筑', '设置']) {
      expect(html, label).toContain(label)
    }
    expect(html).toContain('从版图取板块')
    expect(html).toContain('取 2 个工人')
    expect(html).toContain('规则速查')
  })

  it('规则速查 · 计分页：区域分数表与阶段奖励表都能渲染', () => {
    const html = renderToStaticMarkup(<Scoring />)
    // 5 格区域 = 15 分（这条也正是用来核对计分表的官方锚点）
    expect(html).toContain('>15<')
    expect(html).toContain('>36<')
    // 阶段 A 奖励 10 分
    expect(html).toContain('>10<')
    expect(html).toContain('起始城堡不计分')
    expect(html).toContain('平手判定')
  })

  it('规则速查 · 知识页：26 张知识板块一条不落', () => {
    const html = renderToStaticMarkup(<Knowledge />)
    for (const tile of KNOWLEDGE_TILES) {
      expect(html, `${tile.id} ${tile.name}`).toContain(tile.name)
    }
    // 26 行 + 1 行表头所在的行结构（tbody 里只有数据行，所以正好 26 个 <tr）
    expect((html.match(/<tr/g) ?? []).length).toBe(KNOWLEDGE_TILES.length)
  })

  it('规则速查 · 建筑页：8 种建筑一条不落', () => {
    const html = renderToStaticMarkup(<Buildings />)
    for (const building of BUILDINGS) {
      expect(html, building.name).toContain(building.name)
    }
    expect((html.match(/<tr/g) ?? []).length).toBe(BUILDINGS.length)
  })

  it('规则速查 · 设置页：列出官方组件清单的总数 164', () => {
    const html = renderToStaticMarkup(<Setup />)
    expect(html).toContain('164')
    expect(html).toContain('56')
    expect(html).toContain('28')
  })
})
