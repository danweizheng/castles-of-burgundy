import { Fragment, useMemo } from 'react'
import { axial, connectedComponents } from '../engine/hex'
import { createRng, rollDie } from '../engine/rng'

/** 固定种子，用于向用户演示"同一种子必然复现同一局"这一架构约束。 */
const DEMO_SEED = 20240101

interface SelfCheck {
  readonly rolls: readonly number[]
  readonly deterministic: boolean
  readonly clusterSizes: readonly number[]
}

function runSelfCheck(): SelfCheck {
  // 同一颗种子跑两遍，结果必须完全一致——这是存档、撤销、AI 克隆的前提
  const rollsA = Array.from({ length: 5 }, () => rollDie(createRng(DEMO_SEED)))
  const rollsB = Array.from({ length: 5 }, () => rollDie(createRng(DEMO_SEED)))

  // 五个格子里有两个不相邻的簇：(0,0)/(1,0)/(0,1) 连在一起，(4,4)/(5,4) 连在一起
  const cluster = [axial(0, 0), axial(1, 0), axial(0, 1), axial(4, 4), axial(5, 4)]
  const clusterSizes = connectedComponents(cluster)
    .map((c) => c.length)
    .sort((a, b) => b - a)

  return {
    rolls: rollsA,
    deterministic: rollsA.join(',') === rollsB.join(','),
    clusterSizes,
  }
}

const CONFIRMED_DECISIONS: ReadonlyArray<readonly [string, string]> = [
  ['目标平台', 'iPhone Safari（添加到主屏幕后以独立应用方式运行）'],
  ['规则范围', '基础版 2 人局；更多对手与扩展列为远期里程碑'],
  ['单人模式', 'Automa 拟人对手（占真领地、真骰子、真板块）'],
  ['界面', '中文，自绘 SVG 极简符号'],
]

const ARCHITECTURE_RULES: readonly string[] = [
  'src/engine 不认识 React，不碰 DOM，不读 Date.now()；随机全部来自显式传入的种子。',
  'GameState 必须 100% JSON 可序列化：撤销 = 快照栈，存档 = JSON.stringify，AI 克隆 = structuredClone。',
  'applyMove(state, action) 返回 { state, events }，UI 只渲染 events，不自己推算规则。',
]

export function App() {
  const check = useMemo(runSelfCheck, [])

  return (
    <div className="app">
      <header className="hero">
        <div className="hero__crest" aria-hidden="true">
          ♜
        </div>
        <div>
          <h1 className="hero__title">勃艮第城堡</h1>
          <p className="hero__subtitle">单人版 · 阶段 0 工程骨架</p>
        </div>
      </header>

      <section className="card">
        <h2 className="card__title">引擎自检</h2>
        <dl className="kv">
          <dt>种子 {DEMO_SEED} 掷出的 5 颗骰子</dt>
          <dd className="mono">{check.rolls.join(' · ')}</dd>
          <dt>同种子重跑结果一致</dt>
          <dd className={check.deterministic ? 'ok' : 'bad'}>
            {check.deterministic ? '通过（可复现）' : '失败（存在非确定性随机）'}
          </dd>
          <dt>连通块划分（期望 3 / 2）</dt>
          <dd className="mono">{check.clusterSizes.join(' / ')}</dd>
        </dl>
      </section>

      <section className="card">
        <h2 className="card__title">已确认的产品决策</h2>
        <dl className="kv">
          {CONFIRMED_DECISIONS.map(([label, value]) => (
            <Fragment key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </Fragment>
          ))}
        </dl>
      </section>

      <section className="card">
        <h2 className="card__title">架构红线</h2>
        <ol className="rules">
          {ARCHITECTURE_RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ol>
      </section>

      <section className="card card--muted">
        <h2 className="card__title">当前状态</h2>
        <p className="note">
          这是工程骨架，还没有对局界面。规则规格正在
          <span className="mono"> rules/规则规格.md </span>
          逐条复核，确认后才开始写引擎核心，避免在错误规则上返工。
        </p>
      </section>
    </div>
  )
}
