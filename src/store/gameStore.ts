/**
 * 对局状态容器。
 *
 * 用 zustand 而不是 React state，理由只有一个：**撤销**。
 * GameState 是纯数据且很小（几十 KB），所以撤销直接存整份快照栈，简单可靠，
 * 不需要写逆操作。快照里同时记住当时的日志长度，撤销时日志一起回退。
 */

import { create } from 'zustand'
import type { Difficulty } from '../ai/heuristic'
import { applyMove } from '../engine/apply'
import { DEFAULT_RULESET } from '../engine/config'
import { listLegalMoves, type Move } from '../engine/moves'
import { createGame } from '../engine/setup'
import type { GameState, RulesetConfig } from '../engine/state'
import type { PlayerId } from '../engine/types'
import { uiEventText } from '../ui/eventText'

export interface LogEntry {
  readonly id: number
  readonly player: PlayerId | undefined
  readonly text: string
}

interface Snapshot {
  readonly state: GameState
  readonly logLength: number
}

interface GameStore {
  readonly config: RulesetConfig
  readonly humanPlayerId: PlayerId
  readonly seed: number
  readonly state: GameState
  readonly past: readonly Snapshot[]
  readonly log: readonly LogEntry[]
  readonly moves: readonly Move[]
  /** 临时占位对手的开关（Automa 做好后可以去掉，或改成难度选择） */
  readonly autoOpponent: boolean
  /**
   * 对手强度。'random' 是早期那个纯随机占位对手，保留下来当"最弱的一档"。
   */
  readonly difficulty: Difficulty | 'random'
  newGame: (seed?: number) => void
  play: (move: Move) => void
  undo: () => void
  toggleAutoOpponent: () => void
  setDifficulty: (difficulty: Difficulty | 'random') => void
}

let entryId = 0

function nextEntry(player: PlayerId | undefined, text: string): LogEntry {
  entryId += 1
  return { id: entryId, player, text }
}

function freshSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000)
}

function newGameLog(seed: number): LogEntry[] {
  return [nextEntry(undefined, `新对局开始（种子 ${seed}）`)]
}

export const useGameStore = create<GameStore>()((set, get) => {
  const seed = freshSeed()
  const state = createGame(DEFAULT_RULESET, { seed })

  return {
    config: DEFAULT_RULESET,
    humanPlayerId: 'p1',
    seed,
    state,
    past: [],
    log: newGameLog(seed),
    moves: listLegalMoves(DEFAULT_RULESET, state),
    autoOpponent: true,
    difficulty: 'normal',
    setDifficulty: (difficulty) => set({ difficulty }),

    newGame: (requestedSeed) => {
      const nextSeed = requestedSeed ?? freshSeed()
      const fresh = createGame(DEFAULT_RULESET, { seed: nextSeed })
      set({
        seed: nextSeed,
        state: fresh,
        past: [],
        log: newGameLog(nextSeed),
        moves: listLegalMoves(DEFAULT_RULESET, fresh),
      })
    },

    play: (move) => {
      const current = get()
      const result = applyMove(current.config, current.state, move)
      const entries = result.events.map((event) => {
        const { player, text } = uiEventText(event)
        return nextEntry(player, text)
      })
      set({
        state: result.state,
        past: [...current.past, { state: current.state, logLength: current.log.length }],
        log: [...current.log, ...entries].slice(-150),
        moves: listLegalMoves(current.config, result.state),
      })
    },

    undo: () => {
      const current = get()
      const previous = current.past[current.past.length - 1]
      if (previous === undefined) return
      set({
        state: previous.state,
        past: current.past.slice(0, -1),
        log: current.log.slice(0, previous.logLength),
        moves: listLegalMoves(current.config, previous.state),
      })
    },

    toggleAutoOpponent: () => set({ autoOpponent: !get().autoOpponent }),
  }
})
