/**
 * 存档：编解码、校验、以及存储后端。
 *
 * 分工是刻意的：
 * - `encodeSave` / `decodeSave` / `validateState` 是**纯函数**，不碰浏览器 API，因此可以单测。
 *   存档这种"平时不走、出事就丢数据"的路径，必须有测试覆盖。
 * - `createIndexedDbStorage` 只是一层薄适配，把 idb-keyval 包成一个小接口，
 *   方便在测试里换成假的实现。
 *
 * 为什么要做存档：iOS 会清理长期未使用站点的存储，而一局要下 25 轮。
 * 再加上"导出成 JSON 文件"这条路，才算真的丢不了。
 */

import { del, get, set } from 'idb-keyval'
import type { Difficulty } from '../ai/heuristic'
import { rulesetForPlayerCount } from '../engine/config'
import { listLegalMoves } from '../engine/moves'
import type { GameState, RulesetConfig } from '../engine/state'

export const SAVE_KEY = 'cob:save'
/** 存档格式版本。字段结构变化时 +1（与游戏规则版本无关）。 */
export const SAVE_FORMAT = 1

export interface SaveLogEntry {
  readonly id: number
  readonly player: string | undefined
  readonly text: string
}

export interface SaveFile {
  readonly format: number
  readonly rulesetVersion: string
  readonly seed: number
  readonly savedAt: number
  readonly difficulty: Difficulty | 'random'
  readonly state: GameState
  readonly log: readonly SaveLogEntry[]
}

export type DecodeResult =
  | {
      readonly ok: true
      readonly save: SaveFile
      /** 按**存档里的人数**重建的配置：调用方必须用它列合法动作 */
      readonly config: RulesetConfig
    }
  | { readonly ok: false; readonly error: string }

const DIFFICULTIES: ReadonlyArray<Difficulty | 'random'> = ['easy', 'normal', 'hard', 'random']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function buildSaveFile(input: {
  readonly state: GameState
  readonly log: readonly SaveLogEntry[]
  readonly difficulty: Difficulty | 'random'
  readonly now?: number
}): SaveFile {
  return {
    format: SAVE_FORMAT,
    rulesetVersion: input.state.rulesetVersion,
    seed: input.state.seed,
    savedAt: input.now ?? Date.now(),
    difficulty: input.difficulty,
    state: input.state,
    log: input.log.slice(-60), // 只留最近 60 条，存档体积与日志长度无关
  }
}

export function encodeSave(save: SaveFile): string {
  return JSON.stringify(save)
}

/**
 * 校验一份对局状态是否还能跑起来。
 *
 * 最实在的一条检查是"能不能列出一组合法行动" —— 它能一次性抓到
 * 版图数据换了、板块被搬没了、玩家引用了不存在的版图之类的损坏。
 */
export function validateState(config: RulesetConfig, state: GameState): string | undefined {
  if (!Array.isArray(state.players) || state.players.length < 2) return '对局状态里没有玩家'
  if (!Array.isArray(state.turnOrder) || state.turnOrder.length === 0) return '顺位轨是空的'
  if (state.phaseIndex < 0 || state.phaseIndex > 4) return `阶段序号越界：${state.phaseIndex}`
  if (state.roundIndex < 0 || state.roundIndex > 4) return `轮序号越界：${state.roundIndex}`

  for (const player of state.players) {
    const board = config.playerBoards[player.boardId]
    if (board === undefined) return `玩家 ${player.id} 引用了不存在的版图 ${player.boardId}`
  }

  if (state.finished) return undefined

  try {
    const moves = listLegalMoves(config, state)
    if (moves.length === 0) return '这个局面下没有任何合法行动，可能已损坏'
  } catch (error) {
    return `无法列出合法行动：${error instanceof Error ? error.message : String(error)}`
  }

  return undefined
}

export function decodeSave(config: RulesetConfig, raw: unknown): DecodeResult {
  if (!isRecord(raw)) return { ok: false, error: '存档不是一个对象' }
  if (raw.format !== SAVE_FORMAT) {
    return { ok: false, error: `存档格式版本不匹配（存档 ${String(raw.format)}，当前 ${SAVE_FORMAT}）` }
  }
  if (typeof raw.rulesetVersion !== 'string' || raw.rulesetVersion !== config.version) {
    return {
      ok: false,
      error: `规则集版本不匹配（存档 ${String(raw.rulesetVersion)}，当前 ${config.version}）——版图或库存数据变了，旧存档无法安全恢复`,
    }
  }
  if (!isRecord(raw.state)) return { ok: false, error: '存档里没有对局状态' }

  const state = raw.state as unknown as GameState

  /**
   * 按**存档里的人数**重建配置再校验。
   *
   * 否则会出现这种情况：3 人局的存档被拿去和 2 人局配置对照，
   * 仓库格位数（18 vs 12）与合法动作全对不上，于是报"存档损坏" —— 结论是误导性的。
   */
  const resolved = rulesetForPlayerCount(state.playerCount)
  const problem = validateState(resolved, state)
  if (problem !== undefined) return { ok: false, error: problem }

  const difficulty = DIFFICULTIES.includes(raw.difficulty as Difficulty | 'random')
    ? (raw.difficulty as Difficulty | 'random')
    : 'normal'

  const log: SaveLogEntry[] = Array.isArray(raw.log)
    ? (raw.log as unknown[]).filter(isRecord).map((entry) => ({
        id: typeof entry.id === 'number' ? entry.id : 0,
        player: typeof entry.player === 'string' ? entry.player : undefined,
        text: typeof entry.text === 'string' ? entry.text : '',
      }))
    : []

  return {
    ok: true,
    // 把按存档人数重建的配置一并返回：调用方必须用它来列合法动作，否则会算错
    config: resolved,
    save: {
      format: SAVE_FORMAT,
      rulesetVersion: raw.rulesetVersion,
      seed: typeof raw.seed === 'number' ? raw.seed : state.seed,
      savedAt: typeof raw.savedAt === 'number' ? raw.savedAt : 0,
      difficulty,
      state,
      log,
    },
  }
}

export function decodeSaveText(config: RulesetConfig, text: string): DecodeResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return { ok: false, error: `不是合法的 JSON：${error instanceof Error ? error.message : ''}` }
  }
  return decodeSave(config, parsed)
}

// ---------------------------------------------------------------------------
// 存储后端
// ---------------------------------------------------------------------------

export interface SaveStorage {
  read(): Promise<unknown>
  write(value: unknown): Promise<void>
  clear(): Promise<void>
}

/** 线上用的实现：IndexedDB。 */
export function createIndexedDbStorage(key: string = SAVE_KEY): SaveStorage {
  return {
    read: () => get(key),
    write: (value) => set(key, value),
    clear: () => del(key),
  }
}

/** 内存实现，测试与"浏览器不支持 IndexedDB"时使用。 */
export function createMemoryStorage(initial?: unknown): SaveStorage & { peek(): unknown } {
  let value: unknown = initial
  return {
    read: async () => value,
    write: async (next) => {
      value = next
    },
    clear: async () => {
      value = undefined
    },
    peek: () => value,
  }
}

export interface LoadOutcome {
  readonly found: boolean
  readonly result?: DecodeResult
}

export async function loadSave(config: RulesetConfig, storage: SaveStorage): Promise<LoadOutcome> {
  let raw: unknown
  try {
    raw = await storage.read()
  } catch (error) {
    return { found: false, result: { ok: false, error: `读取存档失败：${String(error)}` } }
  }
  if (raw === undefined || raw === null) return { found: false }
  return { found: true, result: decodeSave(config, raw) }
}

export async function writeSave(storage: SaveStorage, save: SaveFile): Promise<void> {
  await storage.write(JSON.parse(encodeSave(save)) as unknown)
}

/** 存档的一句话描述，用于界面提示。 */
export function describeSave(save: SaveFile): string {
  const when = save.savedAt > 0 ? new Date(save.savedAt).toLocaleString() : '未知时间'
  const phase = 'ABCDE'[save.state.phaseIndex] ?? '?'
  const status = save.state.finished ? '已结束' : `第 ${phase} 阶段 第 ${save.state.roundIndex + 1} 轮`
  return `${when} · ${status} · 种子 ${save.seed}`
}
