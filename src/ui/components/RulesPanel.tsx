import { useState, type ReactNode } from 'react'
import { BUILDINGS } from '../../engine/data/buildings'
import { KNOWLEDGE_TILES } from '../../engine/data/knowledge'
import {
  MAX_REGION_SIZE,
  PHASE_COMPLETION_BONUS,
  bonusTileVp,
  regionSizeVp,
  sellGoodsVpPerTile,
} from '../../engine/data/scoring'
import { PHASE_LETTERS } from '../tiles'

/**
 * 规则速查。
 *
 * 单人玩的时候没人可以问规则，而本作需要频繁查的东西就三样：
 * 计分表、黄板块（知识）释义、米色建筑效果。内容全部来自引擎里的规则数据表，
 * 所以**改了规则数据这里会自动跟着变**，不会出现"面板上写的和引擎跑的不一样"。
 *
 * 文中数值以官方规则书（Special Edition）为准，核实过程见 rules/规则规格.md §14。
 */

type Tab = 'actions' | 'flow' | 'scoring' | 'knowledge' | 'buildings' | 'setup'

const TABS: ReadonlyArray<readonly [Tab, string]> = [
  ['actions', '行动'],
  ['flow', '流程'],
  ['scoring', '计分'],
  ['knowledge', '知识'],
  ['buildings', '建筑'],
  ['setup', '设置'],
]

function Block({ title, children }: { readonly title?: string; readonly children: ReactNode }) {
  return (
    <section className="ruleblock">
      {title === undefined ? null : <h3 className="ruleblock__title">{title}</h3>}
      {children}
    </section>
  )
}

export function Actions() {
  return (
    <>
      <Block title="一个回合">
        <p>恰好 2 个行动，每颗骰子 1 个。组合与顺序任意，同一种行动可以做两次。</p>
        <p className="muted">用过的骰子放到玩家板右上。</p>
      </Block>

      <Block title="工人（不是行动）">
        <p>任意时刻可用：1 个工人把一颗骰子 ±1。</p>
        <p>1 可以变成 6、6 可以变成 1，同样只花 1 个工人。可以付多个工人反复调整同一颗骰子。</p>
        <p className="muted">白骰的结果不能用工人改。</p>
      </Block>

      <Block title="① 从版图取板块">
        <p>掷出的点数决定从第几号仓库取，取一枚放到自己板子右下的「仓储」。</p>
        <p className="warn">永远不要直接放进领地。仓储只有 3 格，满了必须先弃掉一枚（移出本局）。</p>
      </Block>

      <Block title="② 把仓储里的板块放进领地">
        <p>点数决定放哪一格，且必须满足：</p>
        <ul>
          <li>空格的颜色与板块颜色一致</li>
          <li>该格点数等于骰子点数</li>
          <li>与该格相邻的位置至少已有一枚板块</li>
        </ul>
        <p className="muted">放下去的板块不能再移动或拿走。</p>
      </Block>

      <Block title="③ 卖货物">
        <p>点数决定卖哪一色。必须把该色**整叠**卖光。</p>
        <p>收益：固定 1 银币（不管卖几枚）+ 每枚 2 分（2 人局）。</p>
      </Block>

      <Block title="④ 取 2 个工人">
        <p>任意点数都能做，点数本身没有意义。</p>
      </Block>

      <Block title="⑤ 从黑洞买（自由行动，不消耗骰子）">
        <p>每回合限一次，付 2 银币，把买到的板块放进仓储。</p>
        <p>可以在两个骰子行动**之前、之间、之后**任意时点做——所以用完两颗骰子后仍然可以买。</p>
      </Block>
    </>
  )
}

export function Flow() {
  return (
    <>
      <Block title="整体结构">
        <p>5 个阶段（A–E）× 每阶段 5 轮 = 25 轮。</p>
        <p>每人每轮 1 个回合、每回合 2 个行动 → 一局共 50 个骰子行动。</p>
      </Block>

      <Block title="每轮开始">
        <ol>
          <li>所有人同时掷 2 颗骰子；先手额外掷白骰。</li>
          <li>
            先手从本轮货物堆取最上面一枚，放到**白骰点数对应的仓库**的货物格上。
            <span className="muted">（白骰到此用完，不能当作行动，也不能用工人调。）</span>
          </li>
          <li>然后先手行动，接着按顺位轨依次（从右到左，同一格从上到下）。</li>
        </ol>
      </Block>

      <Block title="顺位">
        <p>顺位轨队首（最右且最上）是下一轮的先手，并拿到白骰。</p>
        <p>放船会让你的棋子向右移一格；若该格已有人，就叠在上面。</p>
      </Block>

      <Block title="阶段开始">
        <ol>
          <li>把棋盘上剩余的六边形板块收回盒中（<span className="warn">移出本局</span>，不是放回供应堆）。第一阶段的这一步跳过。</li>
          <li>按每个仓库格位的**印刷颜色**，从供应堆重新铺满 6 个编号仓库。</li>
          <li>重新铺黑洞（黑背面的板块）。</li>
          <li>取当前阶段的 5 枚货物，正面放到阶段格下方。</li>
        </ol>
        <p className="muted">货物留在原处，不清空。</p>
      </Block>

      <Block title="阶段结束">
        <p>每座矿给你 1 银币。部分知识板块也在此结算。</p>
      </Block>
    </>
  )
}

export function Scoring() {
  const rows = Array.from({ length: MAX_REGION_SIZE }, (_, index) => index + 1)
  return (
    <>
      <Block title="区域完成（立即结算）">
        <p>某一色的连通区域被完全铺满时，立刻得两种分：</p>
        <table className="rulestable">
          <thead>
            <tr>
              <th>区域格数</th>
              {rows.map((size) => (
                <th key={size}>{size}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>大小分</th>
              {rows.map((size) => (
                <td key={size}>{regionSizeVp(size)}</td>
              ))}
            </tr>
          </tbody>
        </table>
        <p>再加上「当前阶段奖励」——与区域大小无关：</p>
        <table className="rulestable">
          <thead>
            <tr>
              <th>阶段</th>
              {PHASE_LETTERS.map((letter) => (
                <th key={letter}>{letter}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>奖励分</th>
              {PHASE_COMPLETION_BONUS.map((bonus, index) => (
                <td key={index}>{bonus}</td>
              ))}
            </tr>
          </tbody>
        </table>
        <p className="warn">起始城堡不计分，哪怕它占的是一个 1 格区域。</p>
        <p className="muted">所以同一个区域越早完成越值钱。</p>
      </Block>

      <Block title="动物（放置时立即得分）">
        <p>得分 = 新板块上画的动物数 + **同一牧场**里**同种**动物已有板块上的动物数。</p>
        <p>牧场 = 相邻浅绿空格构成的连通区域。同种动物不必与新板块相邻，但必须在同一牧场。</p>
        <p className="muted">例：牧场里已有 3 头牛，放入 4 头牛 → 4 + 3 = 7 分；再放一枚 4 头牛 → 4 + 4 + 3 = 11 分。</p>
      </Block>

      <Block title="矿 / 建筑 / 船 / 城堡">
        <ul>
          <li><b>矿</b>：放置时无效果；每阶段结束每座给 1 银币。</li>
          <li><b>建筑</b>：放置时立即获得一次该建筑的效果。同一「城镇」里每种建筑只能有一座。</li>
          <li><b>船</b>：从**任意**一个仓库取走全部货物（与骰子点数无关），然后顺位前移一格。</li>
          <li><b>城堡</b>：立刻多一次「任选点数」的行动。</li>
        </ul>
      </Block>

      <Block title="奖励板块（抢首杀）">
        <p>第一个把自己领地内**某一色全部空格**铺满的人，拿该色大方块；第二个拿小方块。</p>
        <p>
          大方块：{bonusTileVp(2, 'large')} 分（2 人局）／小方块：{bonusTileVp(2, 'small')} 分。
        </p>
        <p className="muted">第三种及以后没有。</p>
      </Block>

      <Block title="终局结算">
        <ul>
          <li>每枚未卖出的货物：1 分</li>
          <li>每枚剩余银币：1 分</li>
          <li>每 2 个工人：1 分（向下取整）</li>
          <li>带终局计分的知识板块（见「知识」页）</li>
        </ul>
        <p className="warn">仓储区里剩下的板块不计分。</p>
      </Block>

      <Block title="平手判定">
        <p>① 领地上空格少者胜 → ② 再平手，顺位轨上更靠后者胜。</p>
      </Block>
    </>
  )
}

export function Knowledge() {
  return (
    <>
      <Block>
        <p className="muted">
          共 26 张，各 1 枚（其中 6 张是黑背面，只出现在黑洞里）。板块右下角的小数字就是编号。
        </p>
      </Block>
      <table className="rulestable rulestable--list">
        <tbody>
          {KNOWLEDGE_TILES.map((tile) => (
            <tr key={tile.id}>
              <th>{tile.id}</th>
              <td>
                <b>{tile.name}</b>
                <br />
                <span className="muted">{tile.text}</span>
                <br />
                <span className="tag">
                  {tile.kind === 'continuous' ? '持续' : tile.kind === 'phaseEnd' ? '阶段末' : '终局计分'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

export function Buildings() {
  const sellPerTile = sellGoodsVpPerTile(2)
  return (
    <>
      <Block>
        <p className="muted">
          放置建筑时**立即免费**获得一次效果（不需要骰子）。同一个「城镇」里每种建筑只能有一座。
          效果用不上时（例如仓库里已无对应颜色板块），建筑仍可放置，只是效果作废。
        </p>
      </Block>
      <table className="rulestable rulestable--list">
        <tbody>
          {BUILDINGS.map((building) => (
            <tr key={building.id}>
              <th>{building.name}</th>
              <td>{building.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Block title="卖货收益（2 人局）">
        <p>固定 1 银币 + 每枚 {sellPerTile} 分。</p>
      </Block>
    </>
  )
}

export function Setup() {
  return (
    <>
      <Block title="每人起始">
        <ul>
          <li>1 银币</li>
          <li>1 座城堡，放在你**选定**的深红格上（第一次玩推荐中央 6 号格）</li>
          <li>3 枚随机货物</li>
          <li>按顺位发工人：第 1 位 1 个、第 2 位 2 个、第 3 位 3 个、第 4 位 4 个</li>
        </ul>
      </Block>

      <Block title="公共准备">
        <ul>
          <li>42 枚货物洗混，分 5 堆各 5 枚放到 A–E 阶段格；剩下 17 枚留用</li>
          <li>12 枚奖励板块（6 色各大小 1 枚，大方块上印 5/6/7）</li>
          <li>24 枚银币、26 枚工人（两者都视为不限量）</li>
        </ul>
      </Block>

      <Block title="板块总数 164">
        <table className="rulestable rulestable--list">
          <tbody>
            <tr>
              <th>建筑</th>
              <td>56（米色背 40 + 黑背 16）</td>
            </tr>
            <tr>
              <th>动物</th>
              <td>28（绿背 20 + 黑背 8）</td>
            </tr>
            <tr>
              <th>矿</th>
              <td>12（灰背 10 + 黑背 2）</td>
            </tr>
            <tr>
              <th>船</th>
              <td>26（蓝背 20 + 黑背 6）</td>
            </tr>
            <tr>
              <th>知识</th>
              <td>26（黄背 20 + 黑背 6）</td>
            </tr>
            <tr>
              <th>城堡</th>
              <td>16（深红背 14 + 黑背 2）</td>
            </tr>
          </tbody>
        </table>
      </Block>

      <Block title="存储上限">
        <ul>
          <li>板块仓储：3 格</li>
          <li>货物仓储：最多 3 种不同颜色，同色叠放</li>
        </ul>
      </Block>
    </>
  )
}

export interface RulesPanelProps {
  readonly onClose: () => void
}

export function RulesPanel({ onClose }: RulesPanelProps) {
  const [tab, setTab] = useState<Tab>('actions')

  return (
    <div className="sheet" role="dialog" aria-modal="true">
      <div className="sheet__panel">
        <h2 className="sheet__title">规则速查</h2>

        <div className="tabs">
          {TABS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={tab === value ? 'tab tab--active' : 'tab'}
              onClick={() => setTab(value)}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'actions' ? <Actions /> : null}
        {tab === 'flow' ? <Flow /> : null}
        {tab === 'scoring' ? <Scoring /> : null}
        {tab === 'knowledge' ? <Knowledge /> : null}
        {tab === 'buildings' ? <Buildings /> : null}
        {tab === 'setup' ? <Setup /> : null}

        <p className="muted">数值以官方规则书（Special Edition）为准。</p>

        <button type="button" className="btn btn--ghost btn--block" onClick={onClose}>
          关闭
        </button>
      </div>
    </div>
  )
}
