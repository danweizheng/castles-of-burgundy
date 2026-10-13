import { useEffect, useMemo, useState } from 'react'
import { opponentMove } from '../../ai/opponentMove'
import { suggestMove, type Difficulty } from '../../ai/heuristic'
import { castleSpacesOf } from '../../engine/board'
import { axialKey } from '../../engine/hex'
import { type DieRef, type Move } from '../../engine/moves'
import { finalScore } from '../../engine/scoring'
import { playerById, type GameState, type PendingChoice } from '../../engine/state'
import type { BoardSpace, DieValue, GoodsKind } from '../../engine/types'
import { useGameStore } from '../../store/gameStore'
import { ChooserSheet, type ChooserOption } from '../components/ChooserSheet'
import { DepotPanel } from '../components/DepotPanel'
import { HexBoard } from '../components/HexBoard'
import { LogPanel } from '../components/LogPanel'
import { OpponentSheet } from '../components/OpponentSheet'
import { PlayerPanel } from '../components/PlayerPanel'
import { RulesPanel } from '../components/RulesPanel'
import { SaveMenu } from '../components/SaveMenu'
import {
  affordancesForDie,
  affordancesForPending,
  describeMove,
  sameDie,
  takeTileMoves,
  type DieAffordances,
  type PendingAffordances,
} from '../selection'
import { PHASE_LETTERS, playerLabel, tileGlyph } from '../tiles'
import { tileInfo } from '../tileInfo'
import { threatsFor } from '../threats'
import { offlineLabel, useOfflineState } from '../useOfflineReady'

const HUMAN = 'p1' as const
const PHASE_COUNT = 5
const ROUND_COUNT = 5

function pendingBanner(pending: PendingChoice): string {
  switch (pending.kind) {
    case 'shipGoodsSpace':
      return '船只效果：选择从哪个货物格取走全部货物（与骰子点数无关）'
    case 'shipGoodsSecondSpace':
      return '双港（5 号知识板块）：再选一个相邻的货物格'
    case 'warehouseSellGoods':
      return '仓库效果：选择要卖出的一种货物（不需骰子）'
    case 'takeTileFromAnyDepot':
      return '建筑效果：从点亮的仓库格位取一枚板块'
    case 'cityHallPlace':
      return '市政厅：在点亮的格子里再放一枚板块（可忽略颜色）'
  }
}

function moveLabel(move: Move, state: GameState): string {
  const active = playerById(state, state.activePlayerId)
  switch (move.kind) {
    case 'placeTile': {
      const tile = active.storage[move.storageIndex]
      const glyph = tile === undefined ? undefined : tileGlyph(tile)
      return `放仓储第 ${move.storageIndex + 1} 枚${glyph === undefined ? '' : `（${glyph.label}）`}`
    }
    case 'takeTile': {
      if (move.discardStorageIndex === undefined) return '取这枚板块'
      const tile = active.storage[move.discardStorageIndex]
      const glyph = tile === undefined ? undefined : tileGlyph(tile)
      return `弃掉仓储第 ${move.discardStorageIndex + 1} 枚${glyph === undefined ? '' : `（${glyph.label}）`}`
    }
    case 'buyTile':
      return move.source.kind === 'black' ? '从中央黑洞购买（2 银币）' : '从编号仓库购买（2 银币）'
    default:
      return describeMove(move)
  }
}

export function GameScreen() {
  const config = useGameStore((store) => store.config)
  const state = useGameStore((store) => store.state)
  const moves = useGameStore((store) => store.moves)
  const log = useGameStore((store) => store.log)
  const past = useGameStore((store) => store.past)
  const autoOpponent = useGameStore((store) => store.autoOpponent)
  const difficulty = useGameStore((store) => store.difficulty)
  const setDifficulty = useGameStore((store) => store.setDifficulty)
  const play = useGameStore((store) => store.play)
  const undo = useGameStore((store) => store.undo)
  const newGame = useGameStore((store) => store.newGame)
  const toggleAutoOpponent = useGameStore((store) => store.toggleAutoOpponent)
  const hydrate = useGameStore((store) => store.hydrate)
  const hydrated = useGameStore((store) => store.hydrated)
  const saveError = useGameStore((store) => store.saveError)
  const needsSetup = useGameStore((store) => store.needsSetup)
  const chooseStartingCastle = useGameStore((store) => store.chooseStartingCastle)
  const lastVp = useGameStore((store) => store.lastVp)

  const [selectedDie, setSelectedDie] = useState<DieRef | null>(null)
  const [chooser, setChooser] = useState<{ title: string; options: ChooserOption[] } | null>(null)
  const [showLog, setShowLog] = useState(false)
  const [showSave, setShowSave] = useState(false)
  const [showRules, setShowRules] = useState(false)
  const [showOpponent, setShowOpponent] = useState(false)
  const offlineState = useOfflineState()
  const [hint, setHint] = useState<string | null>(null)
  // 启动时尝试恢复上一局
  useEffect(() => {
    void hydrate()
  }, [hydrate])

  const human = playerById(state, HUMAN)
  const opponent = state.players.find((player) => player.id !== HUMAN) ?? human
  const board = config.playerBoards[human.boardId]
  const opponentBoard = config.playerBoards[opponent.boardId]

  const pending: PendingChoice | undefined = state.pending[0]
  const isHumanTurn = state.activePlayerId === HUMAN && !state.finished

  /**
   * 只在"日志长度仍然对得上"时才显示飘字。
   * 撤销、新局、导入存档都会改变日志长度，于是过期的飘字自动被抑制，
   * 不需要在 store 的每个 set() 里手工清空。
   */
  const floats = lastVp !== null && lastVp.logLength === log.length ? lastVp.deltas : {}

  /** 对手快到什么程度：只用于顶部的警示徽标，详细清单在放大视图里 */
  const opponentThreats = useMemo(
    () => threatsFor(config, state, opponent.id),
    [config, state, opponent.id],
  )

  // 每次状态变化都清空选择与弹层：一步走完，界面回到"等下一次点选"的干净状态
  useEffect(() => {
    setSelectedDie(null)
    setChooser(null)
    setHint(null)
  }, [state])

  // Automa 对手行动（选出生点阶段不能开跑，否则会抢在玩家之前行动）
  useEffect(() => {
    if (!autoOpponent || state.finished || needsSetup) return
    if (state.activePlayerId === HUMAN) return
    const timer = window.setTimeout(
      () => {
        const move = opponentMove(config, state, difficulty)
        if (move !== undefined) play(move)
      },
      difficulty === 'hard' ? 420 : 300,
    )
    return () => window.clearTimeout(timer)
  }, [state, autoOpponent, config, play, difficulty, needsSetup])

  /** 选出生点时，把版图上所有深红格点亮 */
  const castleTargets = useMemo<ReadonlyMap<string, readonly number[]> | undefined>(() => {
    if (!needsSetup || board === undefined) return undefined
    const targets = new Map<string, readonly number[]>()
    for (const space of castleSpacesOf(board)) targets.set(axialKey(space), [])
    return targets
  }, [needsSetup, board])

  const availableDice = useMemo<DieRef[]>(() => {
    if (!isHumanTurn || pending !== undefined) return []
    const result: DieRef[] = []
    if (state.actionsTakenThisTurn < 2) {
      ;(state.dice[HUMAN] ?? []).forEach((die, index) => {
        if (die.used) return
        if (index === 0 || index === 1) result.push({ kind: 'die', index })
      })
    }
    if (state.pendingExtraActions > 0) result.push({ kind: 'virtual' })
    return result
  }, [state, isHumanTurn, pending])

  /**
   * 可点区域一律只在**轮到人类**时派生。
   *
   * 为什么必须加 isHumanTurn：`moves` 是**当前行动方**的合法动作，轮到对手时它就是对手的动作。
   * 而清空 selectedDie 的 effect 在绘制**之后**才跑，所以存在一个"新状态已渲染、
   * 选中状态还没清"的窗口 —— 那个窗口里 affordancesForDie 会拿对手的动作点亮格子，
   * 点下去就是替对手走棋（这类动作在 store 的合法动作表里，守卫也拦不住）。
   * 闸门做在派生处，界面就结构上不可能越权。
   */
  const dieAffordances: DieAffordances | null = useMemo(
    () => (!isHumanTurn || selectedDie === null ? null : affordancesForDie(moves, selectedDie)),
    [moves, selectedDie, isHumanTurn],
  )
  const pendingAffordances: PendingAffordances | null = useMemo(
    () => (!isHumanTurn || pending === undefined ? null : affordancesForPending(moves)),
    [moves, pending, isHumanTurn],
  )

  const placementTargets: ReadonlyMap<string, readonly number[]> | undefined =
    pending !== undefined
      ? pending.kind === 'cityHallPlace'
        ? pendingAffordances?.placementTargets
        : undefined
      : dieAffordances?.placementTargets

  const highlightedSlotIds = useMemo<ReadonlySet<string>>(() => {
    if (pending !== undefined) return new Set(pendingAffordances?.slotIds ?? [])
    return dieAffordances?.depotSlotIds ?? new Set<string>()
  }, [pending, pendingAffordances, dieAffordances])

  const highlightedGoodsSpaces = useMemo<ReadonlySet<DieValue> | undefined>(() => {
    if (pending?.kind === 'shipGoodsSpace' || pending?.kind === 'shipGoodsSecondSpace') {
      return new Set(pendingAffordances?.spaces ?? [])
    }
    return undefined
  }, [pending, pendingAffordances])

  const goodsTargets = useMemo<ReadonlySet<GoodsKind>>(() => {
    if (pending?.kind === 'warehouseSellGoods') return new Set(pendingAffordances?.goods ?? [])
    return dieAffordances?.sellGoods ?? new Set<GoodsKind>()
  }, [pending, pendingAffordances, dieAffordances])

  const takeWorkersMove = selectedDie === null
    ? undefined
    : moves.find((move) => move.kind === 'takeWorkers' && sameDie(move.die, selectedDie))
  const endTurn = moves.find((move) => move.kind === 'endTurn')
  const buyMoves = moves.filter((move) => move.kind === 'buyTile')

  function applySingle(candidates: readonly Move[], title: string): void {
    if (candidates.length === 0) return
    const only = candidates[0]
    if (candidates.length === 1 && only !== undefined) {
      play(only)
      setSelectedDie(null)
      return
    }
    setChooser({
      title,
      options: candidates.map((move) => ({ label: moveLabel(move, state), move })),
    })
  }

  function onTapSpace(space: BoardSpace): void {
    const key = axialKey(space)
    if (pending !== undefined) {
      if (pending.kind !== 'cityHallPlace') return
      applySingle(
        moves.filter((move) => move.kind === 'resolveCityHallPlace' && axialKey(move.to) === key),
        '选择要放下的板块',
      )
      return
    }
    if (selectedDie === null) return
    applySingle(
      moves.filter(
        (move) => move.kind === 'placeTile' && sameDie(move.die, selectedDie) && axialKey(move.to) === key,
      ),
      '同一个格子可以放多枚，选一枚',
    )
  }

  function onTapSlot(slotId: string): void {
    if (pending !== undefined) {
      if (pending.kind !== 'takeTileFromAnyDepot') return
      applySingle(
        moves.filter((move) => move.kind === 'resolveTakeTileFromAnyDepot' && move.slotId === slotId),
        '仓储已满，选择要弃掉的板块',
      )
      return
    }
    if (selectedDie === null) return
    applySingle(takeTileMoves(moves, selectedDie, slotId), '仓储已满，选择要弃掉的板块')
  }

  function onTapGoodsSpace(space: DieValue): void {
    applySingle(
      moves.filter(
        (move) =>
          (move.kind === 'resolveShipGoodsSpace' || move.kind === 'resolveShipGoodsSecondSpace') &&
          move.space === space,
      ),
      '选择货物格',
    )
  }

  function onTapGoods(kind: GoodsKind): void {
    if (pending !== undefined) {
      applySingle(
        moves.filter((move) => move.kind === 'resolveWarehouseSellGoods' && move.goods === kind),
        '选择要卖出的货物',
      )
      return
    }
    if (selectedDie === null) return
    applySingle(
      moves.filter(
        (move) => move.kind === 'sellGoods' && sameDie(move.die, selectedDie) && move.goods === kind,
      ),
      '卖出这种货物',
    )
  }

  const result = state.finished ? finalScore(config, state) : null
  const turnsTaken = state.phaseIndex * ROUND_COUNT + state.roundIndex

  return (
    <div className="screen">
      <header className="topbar">
        <div className="topbar__info">
          <span className="badge badge--phase">阶段 {PHASE_LETTERS[state.phaseIndex] ?? '?'}</span>
          <span className="badge">第 {state.roundIndex + 1}/{ROUND_COUNT} 轮</span>
          <span className="badge">白骰 {state.whiteDie}</span>
          <span className="badge badge--dim">已推进 {turnsTaken}/{PHASE_COUNT * ROUND_COUNT}</span>
        </div>
        <div className="topbar__actions">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={!isHumanTurn || pending !== undefined}
            onClick={() => {
              const suggestion = suggestMove(config, state, HUMAN)
              setHint(
                suggestion === undefined
                  ? '当前没有可选行动'
                  : `推荐：${moveLabel(suggestion.move, state)}`,
              )
            }}
          >
            提示
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowLog((v) => !v)}>
            {showLog ? '收起日志' : '日志'}
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowRules(true)}>
            规则
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowSave(true)}>
            存档
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={undo}
            disabled={past.length === 0}
          >
            撤销
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => newGame()}>
            新局
          </button>
        </div>
      </header>

      {!hydrated ? <p className="muted">正在检查本机存档…</p> : null}
      {saveError === null || showSave ? null : <p className="banner banner--warn">{saveError}</p>}

      <section className="opponent">
        <div className="opponent__head">
          <span>对手</span>
          <span className="opponent__actions">
            <span className="muted">
              {opponent.vp} 分 · {opponent.silverlings} 银币 · {opponent.workers} 工人 · 仓储{' '}
              {opponent.storage.length}/3
              {floats[opponent.id] === undefined ? null : (
                <span key={`float-opp-${log.length}`} className="scorefloat">
                  +{floats[opponent.id]}
                </span>
              )}
            </span>
            {opponentThreats.filter((threat) => threat.remaining === 1).length === 0 ? null : (
              <span className="badge badge--warn">
                {opponentThreats.filter((threat) => threat.remaining === 1).length} 处只差 1 格
              </span>
            )}
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setShowOpponent(true)}
            >
              查看
            </button>
          </span>
        </div>
        {opponentBoard === undefined ? null : (
          <HexBoard board={opponentBoard} estate={opponent.estate} size={8} compact />
        )}
      </section>

      {showLog ? <LogPanel entries={log} humanPlayerId={HUMAN} /> : null}

      <section className="mine">
        <div className="mine__head">
          <span>你的领地</span>
          <span className="muted">
            已放 {Object.keys(human.estate).length}/{board?.spaces.length ?? 0} 格
            {floats[HUMAN] === undefined ? null : (
              <span key={`float-me-${log.length}`} className="scorefloat">
                +{floats[HUMAN]}
              </span>
            )}
          </span>
        </div>
        {board === undefined ? null : (
          <HexBoard
            board={board}
            estate={human.estate}
            targets={placementTargets}
            onTapSpace={onTapSpace}
            size={18}
          />
        )}
      </section>

      <section className="middle">
        {pending === undefined ? null : <p className="banner banner--pending">{pendingBanner(pending)}</p>}
        <DepotPanel
          config={config}
          state={state}
          highlightedSlotIds={highlightedSlotIds}
          onTapSlot={onTapSlot}
          highlightedGoodsSpaces={highlightedGoodsSpaces}
          onTapGoodsSpace={onTapGoodsSpace}
        />
      </section>

      <PlayerPanel
        player={human}
        title="你的资源"
        goodsTargets={goodsTargets}
        onTapGoods={onTapGoods}
      />

      <div className="actionbar">
        {pending === undefined ? (
          <>
            {hint === null ? null : <p className="banner banner--hint">{hint}</p>}
            <div className="dice">
              {availableDice.length === 0 ? (
                <span className="muted">
                  {state.finished ? '对局结束' : isHumanTurn ? '本回合行动已用完' : '对手行动中…'}
                </span>
              ) : (
                availableDice.map((die) =>
                  die.kind === 'virtual' ? (
                    <button
                      key="virtual"
                      type="button"
                      className={
                        selectedDie?.kind === 'virtual' ? 'die die--virtual die--selected' : 'die die--virtual'
                      }
                      onClick={() => setSelectedDie(selectedDie?.kind === 'virtual' ? null : die)}
                    >
                      城堡
                    </button>
                  ) : (
                    <button
                      // 按"阶段-轮"做 key：每轮重掷时元素重新挂载，于是掷骰动画会播一次；
                      // 同一轮内用掉一颗骰子不会重播（因为那时 actionsTakenThisTurn 已经不是 0）
                      key={`die-${state.phaseIndex}-${state.roundIndex}-${die.index}`}
                      type="button"
                      className={
                        (selectedDie !== null && sameDie(selectedDie, die) ? 'die die--selected' : 'die') +
                        (state.actionsTakenThisTurn === 0 ? ' die--roll' : '')
                      }
                      onClick={() => setSelectedDie(selectedDie !== null && sameDie(selectedDie, die) ? null : die)}
                    >
                      {state.dice[HUMAN]?.[die.index]?.value ?? '?'}
                    </button>
                  ),
                )
              )}
            </div>

            <p className="hint">
              {selectedDie === null
                ? '点一颗骰子，界面会点亮所有可以操作的地方'
                : '点亮的仓库格位 / 货物 / 领地格子都可以点'}
            </p>

            {/* 选中骰子后就要决定"放哪一枚"，这时把仓储每枚的效果摆出来。
                触摸屏上 title 属性不显示，不写出来玩家只能看到一个「木」字。 */}
            {selectedDie === null || human.storage.length === 0 ? null : (
              <ul className="storageinfo">
                {human.storage.map((tile, index) => {
                  const info = tileInfo(tile)
                  return (
                    <li key={tile.id} className="storageinfo__item">
                      <b>
                        {index + 1}. {info.title}
                      </b>
                      <span> — {info.text}</span>
                    </li>
                  )
                })}
              </ul>
            )}

            <div className="actionbar__buttons">
              {takeWorkersMove === undefined ? null : (
                <button type="button" className="btn" onClick={() => play(takeWorkersMove)}>
                  取 2 个工人
                </button>
              )}
              {buyMoves.length === 0 ? null : (
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    applySingle(
                      buyMoves,
                      '选择购买来源',
                    )
                  }
                >
                  买一枚（2 银币）
                </button>
              )}
              {endTurn === undefined ? null : (
                <button type="button" className="btn btn--primary" onClick={() => play(endTurn)}>
                  结束回合
                </button>
              )}
            </div>
          </>
        ) : (
          <p className="hint">请先解决上面的选择</p>
        )}
      </div>

      <footer className="footer">
        <div className="footer__row">
          {(
            [
              ['easy', '轻松'],
              ['normal', '普通'],
              ['hard', '困难'],
              ['random', '随机'],
            ] as ReadonlyArray<readonly [Difficulty | 'random', string]>
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={difficulty === value ? 'btn btn--sm btn--primary' : 'btn btn--sm'}
              onClick={() => setDifficulty(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="footer__row">
          <button type="button" className="btn btn--ghost btn--sm" onClick={toggleAutoOpponent}>
            对手：{autoOpponent ? '自动' : '暂停'}
          </button>
          <span className={offlineState === 'ready' ? 'offline offline--ready' : 'offline'}>
            {offlineLabel(offlineState)}
          </span>
          <span className="muted">种子 {state.seed}</span>
        </div>
      </footer>

      {needsSetup ? (
        <div className="sheet" role="dialog" aria-modal="true">
          <div className="sheet__panel">
            <h2 className="sheet__title">选择出生点</h2>
            <p className="muted">
              官方规则：起始城堡放在你选定的深红格上。点亮的就是可选格；第一次玩推荐中央的 6 号格。
            </p>
            {board === undefined ? null : (
              <HexBoard
                board={board}
                estate={human.estate}
                targets={castleTargets}
                onTapSpace={(space) => chooseStartingCastle({ q: space.q, r: space.r })}
                size={16}
              />
            )}
            <button
              type="button"
              className="btn btn--primary btn--block"
              onClick={() => {
                if (board !== undefined) chooseStartingCastle(board.startingSpace)
              }}
            >
              用推荐的中央格
            </button>
          </div>
        </div>
      ) : null}

      {showOpponent ? (
        <OpponentSheet
          config={config}
          state={state}
          opponentId={opponent.id}
          onClose={() => setShowOpponent(false)}
        />
      ) : null}

      {showRules ? <RulesPanel onClose={() => setShowRules(false)} /> : null}

      {showSave ? <SaveMenu onClose={() => setShowSave(false)} /> : null}

      {chooser === null ? null : (
        <ChooserSheet
          title={chooser.title}
          options={chooser.options}
          onPick={(move) => {
            play(move)
            setChooser(null)
            setSelectedDie(null)
          }}
          onCancel={() => setChooser(null)}
        />
      )}

      {result === null ? null : (
        <div className="sheet" role="dialog" aria-modal="true">
          <div className="sheet__panel">
            <h2 className="sheet__title">
              {result.winnerId === HUMAN ? '你赢了' : `${playerLabel(result.winnerId)}赢了`}
            </h2>
            {result.scores.map((score) => (
              <div key={score.playerId} className="scorecard">
                <div className="scorecard__head">
                  <b>{playerLabel(score.playerId)}</b>
                  <span>{score.totalVp} 分</span>
                </div>
                <ul className="scorecard__list">
                  <li>对局中得分 {score.inGameVp}</li>
                  <li>未卖货物 {score.unsoldGoodsVp}</li>
                  <li>剩余银币 {score.silverlingsVp}</li>
                  <li>工人折算 {score.workersVp}</li>
                  <li>知识板块 {score.knowledgeVp}</li>
                  <li>领地空格 {score.emptySpaces}</li>
                </ul>
                {score.knowledgeDetail.length === 0 ? null : (
                  <ul className="scorecard__list scorecard__list--dim">
                    {score.knowledgeDetail.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
            <p className="muted">{result.tiebreakNote}</p>
            <button type="button" className="btn btn--primary btn--block" onClick={() => newGame()}>
              再来一局
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
