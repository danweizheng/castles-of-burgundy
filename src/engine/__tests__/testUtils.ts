/**
 * 测试工具。放在 __tests__ 下但文件名不是 *.test.ts，所以不会被当成测试文件收集。
 */

import { expect } from 'vitest'
import { applyMove } from '../apply'
import { boardIndexOf } from '../board'
import { DEFAULT_RULESET } from '../config'
import { GOODS_STORAGE_TYPES, STORAGE_CAPACITY } from '../data/scoring'
import { axialKey, type Axial } from '../hex'
import { distinctGoodsKinds, listLegalMoves } from '../moves'
import { createRng, nextInt } from '../rng'
import { countAllTiles, createGame } from '../setup'
import { playerById, updatePlayer, type GameState } from '../state'
import { PLACEHOLDER_BLACK_TILE_INVENTORY, PLACEHOLDER_TILE_INVENTORY, totalTilesOf } from '../tiles'
import type {
  AnimalKind,
  BoardSpace,
  BuildingKind,
  DieValue,
  HexTile,
  PlayerBoardDef,
  PlayerId,
  PlayerState,
} from '../types'

export const CONFIG = DEFAULT_RULESET
export const BOARD = CONFIG.playerBoards['1'] as PlayerBoardDef
export const BOARD_SIZE = BOARD.spaces.length
export const TOTAL_TILE_COUNT =
  totalTilesOf(PLACEHOLDER_TILE_INVENTORY) + totalTilesOf(PLACEHOLDER_BLACK_TILE_INVENTORY)

/** 固定种子的开局状态。所有测试都从它派生，保证可复现。 */
export const BASE_STATE: GameState = createGame(CONFIG, { seed: 31337 })

export function spaceAt(q: number, r: number): BoardSpace {
  const space = boardIndexOf(BOARD).get(axialKey({ q, r }))
  if (space === undefined) throw new Error(`合成版图上没有 ${q},${r}`)
  return space
}

export function numberAt(q: number, r: number): DieValue {
  return spaceAt(q, r).number
}

export function patchPlayer(state: GameState, id: PlayerId, patch: Partial<PlayerState>): GameState {
  return updatePlayer(state, id, (player) => ({ ...player, ...patch }))
}

export function patchBoth(
  state: GameState,
  patch: Partial<PlayerState> | ((player: PlayerState) => Partial<PlayerState>),
): GameState {
  return {
    ...state,
    players: state.players.map((player) => ({
      ...player,
      ...(typeof patch === 'function' ? patch(player) : patch),
    })),
  }
}

export function setDice(
  state: GameState,
  id: PlayerId,
  values: readonly [DieValue, DieValue],
): GameState {
  return {
    ...state,
    dice: {
      ...state.dice,
      [id]: values.map((value) => ({ value, used: false })),
    },
  }
}

/** 把板块直接塞进领地（跳过放置合法性检查，用于构造测试局面）。 */
export function withEstate(
  player: PlayerState,
  entries: ReadonlyArray<readonly [Axial, HexTile]>,
): PlayerState {
  const estate = { ...player.estate }
  for (const [space, tile] of entries) estate[axialKey(space)] = tile
  return { ...player, estate }
}

export function estateOf(
  state: GameState,
  id: PlayerId,
  entries: ReadonlyArray<readonly [Axial, HexTile]>,
): GameState {
  return updatePlayer(state, id, (player) => withEstate(player, entries))
}

export function castleTile(id: string): HexTile {
  return { id, color: 'castle' }
}
export function mineTile(id: string): HexTile {
  return { id, color: 'mine' }
}
export function shipTile(id: string): HexTile {
  return { id, color: 'ship' }
}
export function animalTile(id: string, animal: AnimalKind, animals: 2 | 3 | 4): HexTile {
  return { id, color: 'animal', animal, animals }
}
export function buildingTile(id: string, building: BuildingKind): HexTile {
  return { id, color: 'building', building }
}
export function knowledgeTile(id: string, knowledge: number): HexTile {
  return { id, color: 'knowledge', knowledge }
}

/** 每一步都要成立的不变量。任何一条被破坏都说明规则实现出了错。 */
export function assertInvariants(state: GameState, label: string): void {
  expect(countAllTiles(state), `${label}：板块总数`).toBe(TOTAL_TILE_COUNT)

  for (const player of state.players) {
    expect(player.storage.length, `${label}：${player.id} 仓储格数`).toBeLessThanOrEqual(
      STORAGE_CAPACITY,
    )
    expect(
      distinctGoodsKinds(player),
      `${label}：${player.id} 货物颜色种类`,
    ).toBeLessThanOrEqual(GOODS_STORAGE_TYPES)
    expect(player.silverlings, `${label}：${player.id} 银币`).toBeGreaterThanOrEqual(0)
    expect(player.workers, `${label}：${player.id} 工人`).toBeGreaterThanOrEqual(0)
    expect(player.vp, `${label}：${player.id} 分数`).toBeGreaterThanOrEqual(0)
    expect(
      Object.keys(player.estate).length,
      `${label}：${player.id} 领地格数`,
    ).toBeLessThanOrEqual(BOARD_SIZE)

    for (const [key, count] of Object.entries(player.goods)) {
      expect(count, `${label}：货物 ${key} 数量`).toBeGreaterThanOrEqual(0)
    }
  }

  expect(state.phaseIndex, `${label}：阶段序号`).toBeGreaterThanOrEqual(0)
  expect(state.phaseIndex, `${label}：阶段序号`).toBeLessThan(5)
  expect(state.roundIndex, `${label}：轮序号`).toBeLessThan(5)
  expect(playerById(state, state.activePlayerId), `${label}：当前玩家存在`).toBeDefined()
}

/** 所有板块 id 全局唯一。 */
export function assertUniqueTileIds(state: GameState, label: string): void {
  const ids: string[] = []
  for (const tiles of Object.values(state.supply)) ids.push(...tiles.map((t) => t.id))
  for (const tile of Object.values(state.depotSlots)) if (tile !== null) ids.push(tile.id)
  ids.push(...state.blackDepot.map((t) => t.id))
  ids.push(...state.blackSupply.map((t) => t.id))
  ids.push(...state.removedFromGame.map((t) => t.id))
  for (const player of state.players) {
    ids.push(...Object.values(player.estate).map((t) => t.id))
    ids.push(...player.storage.map((t) => t.id))
  }
  expect(new Set(ids).size, `${label}：板块 id 唯一`).toBe(ids.length)
}

export interface PlayoutResult {
  readonly state: GameState
  readonly steps: number
}

/** 用随机合法行动把一局打完。返回终局状态与步数。 */
export function randomPlayout(seed: number, maxSteps = 4000): PlayoutResult {
  const chooser = createRng(seed)
  let state = createGame(CONFIG, { seed })
  let steps = 0

  while (!state.finished && steps < maxSteps) {
    const moves = listLegalMoves(CONFIG, state)
    expect(moves.length, `第 ${steps} 步没有任何合法行动（不该发生）`).toBeGreaterThan(0)
    const index = nextInt(chooser, moves.length)
    const move = moves[index]
    if (move === undefined) throw new Error('随机选动作越界')

    state = applyMove(CONFIG, state, move).state
    steps += 1

    if (steps % 37 === 0) assertInvariants(state, `随机对局第 ${steps} 步`)
  }

  assertInvariants(state, '随机对局终局')
  assertUniqueTileIds(state, '随机对局终局')
  return { state, steps }
}
