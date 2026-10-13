/**
 * 对局状态容器。
 *
 * 用 zustand 而不是 React state，理由只有一个：**撤销**。
 * GameState 是纯数据且很小（几十 KB），所以撤销直接存整份快照栈，简单可靠，
 * 不需要写逆操作。快照里同时记住当时的日志长度，撤销时日志一起回退。
 *
 * 另外这里负责**自动存档**：每次状态变化后延迟写入 IndexedDB。
 * iOS 会清理长期未使用站点的存储，所以除了自动存档，界面还提供导出/导入 JSON。
 */

import { create } from 'zustand'
import { pickStartingCastle, type Difficulty } from '../ai/heuristic'
import { applyMove } from '../engine/apply'
import { DEFAULT_RULESET } from '../engine/config'
import type { Axial } from '../engine/hex'
import { listLegalMoves, type Move } from '../engine/moves'
import { createGame } from '../engine/setup'
import type { GameState, RulesetConfig } from '../engine/state'
import type { PlayerId } from '../engine/types'
import { uiEventText } from '../ui/eventText'
import {
  buildSaveFile,
  createIndexedDbStorage,
  createMemoryStorage,
  decodeSaveText,
  encodeSave,
  loadSave,
  writeSave,
  type SaveStorage,
} from './persistence'

export interface LogEntry {
  readonly id: number
  readonly player: string | undefined
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
  /** 临时占位对手的开关 */
  readonly autoOpponent: boolean
  /** 对手强度。'random' 是最弱的一档（纯随机）。 */
  readonly difficulty: Difficulty | 'random'
  /** 是否已经尝试过恢复存档（避免首屏闪一下空对局） */
  readonly hydrated: boolean
  readonly lastSavedAt: number | null
  readonly saveError: string | null
  /** 新开一局后、玩家还没选出生点之前为 true */
  readonly needsSetup: boolean

  newGame: (seed?: number) => void
  play: (move: Move) => void
  undo: () => void
  toggleAutoOpponent: () => void
  setDifficulty: (difficulty: Difficulty | 'random') => void
  /** 官方规则：起始城堡放在玩家**选定**的深红格上（不是固定中央格） */
  chooseStartingCastle: (space: Axial) => void
  hydrate: () => Promise<void>
  exportSaveText: () => string
  importSaveText: (text: string) => { readonly ok: boolean; readonly error?: string }
  clearSave: () => Promise<void>
}

/** 浏览器外（例如测试）没有 IndexedDB，退回内存实现，避免整块功能崩掉。 */
function selectStorage(): SaveStorage {
  if (typeof indexedDB === 'undefined') return createMemoryStorage()
  return createIndexedDbStorage()
}

const storage = selectStorage()
const SAVE_DEBOUNCE_MS = 400

export const useGameStore = create<GameStore>()((set, get) => {
  let saveTimer: ReturnType<typeof setTimeout> | undefined

  /** 延迟写入，避免连点几下就把 IndexedDB 写爆。 */
  function scheduleSave(): void {
    if (saveTimer !== undefined) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = undefined
      const store = get()
      const save = buildSaveFile({
        state: store.state,
        log: store.log,
        difficulty: store.difficulty,
      })
      void writeSave(storage, save)
        .then(() => set({ lastSavedAt: save.savedAt, saveError: null }))
        .catch((error: unknown) => set({ saveError: `自动存档失败：${String(error)}` }))
    }, SAVE_DEBOUNCE_MS)
  }

  let entryId = 0
  function nextEntry(player: string | undefined, text: string): LogEntry {
    entryId += 1
    return { id: entryId, player, text }
  }

  function freshSeed(): number {
    return Math.floor(Math.random() * 1_000_000_000)
  }

  function newGameLog(seed: number): LogEntry[] {
    return [nextEntry(undefined, `新对局开始（种子 ${seed}）`)]
  }

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
    hydrated: false,
    lastSavedAt: null,
    saveError: null,
    needsSetup: true,

    setDifficulty: (difficulty) => {
      set({ difficulty })
      scheduleSave()
    },

    /**
     * 选定出生点后重开一局：**沿用同一颗种子**，只改起始城堡格，
     * 所以仓库、货物、掷骰结果都不变，玩家看到的只是城堡换了位置。
     * 对手的出生点由 AI 自己选（官方规则允许任选深红格）。
     */
    chooseStartingCastle: (space) => {
      const current = get()
      const humanId = current.humanPlayerId
      const opponent = current.state.players.find((player) => player.id !== humanId)

      const startingSpaces: Partial<Record<PlayerId, Axial>> = { [humanId]: space }
      if (opponent !== undefined) {
        startingSpaces[opponent.id] = pickStartingCastle(current.config, opponent)
      }

      const fresh = createGame(current.config, { seed: current.seed, startingSpaces })
      set({
        state: fresh,
        past: [],
        log: newGameLog(current.seed),
        moves: listLegalMoves(current.config, fresh),
        needsSetup: false,
        saveError: null,
      })
      scheduleSave()
    },

    newGame: (requestedSeed) => {
      const nextSeed = requestedSeed ?? freshSeed()
      const fresh = createGame(DEFAULT_RULESET, { seed: nextSeed })
      set({
        seed: nextSeed,
        state: fresh,
        past: [],
        log: newGameLog(nextSeed),
        moves: listLegalMoves(DEFAULT_RULESET, fresh),
        saveError: null,
        needsSetup: true,
      })
      scheduleSave()
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
      scheduleSave()
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
      scheduleSave()
    },

    toggleAutoOpponent: () => set({ autoOpponent: !get().autoOpponent }),

    hydrate: async () => {
      if (get().hydrated) return
      const outcome = await loadSave(DEFAULT_RULESET, storage)

      if (outcome.found && outcome.result !== undefined && !outcome.result.ok) {
        // 存档坏了不能直接崩：保留一份新对局，并把原因显示出来
        set({ hydrated: true, saveError: `存档无法恢复：${outcome.result.error}` })
        return
      }

      if (outcome.found && outcome.result !== undefined && outcome.result.ok) {
        const save = outcome.result.save
        set({
          seed: save.seed,
          state: save.state,
          past: [],
          log: save.log.map((entry) => ({ ...entry })),
          moves: listLegalMoves(DEFAULT_RULESET, save.state),
          difficulty: save.difficulty,
          needsSetup: false,
          hydrated: true,
          lastSavedAt: save.savedAt,
          saveError: null,
        })
        return
      }

      set({ hydrated: true })
    },

    exportSaveText: () => {
      const current = get()
      return encodeSave(
        buildSaveFile({ state: current.state, log: current.log, difficulty: current.difficulty }),
      )
    },

    importSaveText: (text) => {
      const decoded = decodeSaveText(DEFAULT_RULESET, text)
      if (!decoded.ok) return { ok: false, error: decoded.error }

      const save = decoded.save
      set({
        seed: save.seed,
        state: save.state,
        past: [],
        log: save.log.map((entry) => ({ ...entry })),
        moves: listLegalMoves(DEFAULT_RULESET, save.state),
        difficulty: save.difficulty,
        needsSetup: false,
        lastSavedAt: save.savedAt,
        saveError: null,
      })
      scheduleSave()
      return { ok: true }
    },

    clearSave: async () => {
      try {
        await storage.clear()
      } catch (error) {
        set({ saveError: `清除存档失败：${String(error)}` })
        return
      }
      set({ lastSavedAt: null, saveError: null })
    },
  }
})
