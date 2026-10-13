import { useEffect, useMemo, useRef, useState } from 'react'
import { pickMove, suggestMove, type Difficulty } from '../../ai/heuristic'
import { pickRandomMove } from '../../ai/random'
import { axialKey } from '../../engine/hex'
import { listLegalMoves, type DieRef, type Move } from '../../engine/moves'
import { createRng, nextInt } from '../../engine/rng'
import { finalScore } from '../../engine/scoring'
import { playerById, type GameState, type PendingChoice } from '../../engine/state'
import type { BoardSpace, DieValue, GoodsKind } from '../../engine/types'
import { useGameStore } from '../../store/gameStore'
import { ChooserSheet, type ChooserOption } from '../components/ChooserSheet'
import { DepotPanel } from '../components/DepotPanel'
import { HexBoard } from '../components/HexBoard'
import { LogPanel } from '../components/LogPanel'
import { PlayerPanel } from '../components/PlayerPanel'
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

  const [selectedDie, setSelectedDie] = useState<DieRef | null>(null)
  const [chooser, setChooser] = useState<{ title: string; options: ChooserOption[] } | null>(null)
  const [showLog, setShowLog] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  /** 对手决策用的随机源；每次决策前推进一下，避免相同局面永远得到同一套噪声 */
  const opponentRng = useRef(createRng(Math.floor(Math.random() * 1_000_000_000)))

  const human = playerById(state, HUMAN)
  const opponent = state.players.find((player) => player.id !== HUMAN) ?? human
  const board = config.playerBoards[human.boardId]
  const opponentBoard = config.playerBoards[opponent.boardId]

  const pending: PendingChoice | undefined = state.pending[0]
  const isHumanTurn = state.activePlayerId === HUMAN && !state.finished

  // 每次状态变化都清空选择与弹层：一步走完，界面回到"等下一次点选"的干净状态
  useEffect(() => {
    setSelectedDie(null)
    setChooser(null)
    setHint(null)
  }, [state])

  // Automa 对手行动
  useEffect(() => {
    if (!autoOpponent || state.finished) return
    if (state.activePlayerId === HUMAN) return
    const timer = window.setTimeout(
      () => {
        const moves = listLegalMoves(config, state)
        if (moves.length === 0) return
        const rng = opponentRng.current
        nextInt(rng, 1_000_000)
        const move =
          difficulty === 'random'
            ? pickRandomMove(moves)
            : pickMove(config, state, state.activePlayerId, { difficulty, rng })
        if (move !== undefined) play(move)
      },
      difficulty === 'hard' ? 420 : 300,
    )
    return () => window.clearTimeout(timer)
  }, [state, autoOpponent, config, play, difficulty])

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

  const dieAffordances: DieAffordances | null = useMemo(
    () => (selectedDie === null ? null : affordancesForDie(moves, selectedDie)),
    [moves, selectedDie],
  )
  const pendingAffordances: PendingAffordances | null = useMemo(
    () => (pending === undefined ? null : affordancesForPending(moves)),
    [moves, pending],
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

      <section className="opponent">
        <div className="opponent__head">
          <span>对手</span>
          <span className="muted">
            {opponent.vp} 分 · {opponent.silverlings} 银币 · {opponent.workers} 工人 · 仓储{' '}
            {opponent.storage.length}/3
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
                      key={`die-${die.index}`}
                      type="button"
                      className={
                        selectedDie !== null && sameDie(selectedDie, die) ? 'die die--selected' : 'die'
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
          <span className="muted">种子 {state.seed}</span>
        </div>
      </footer>

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
