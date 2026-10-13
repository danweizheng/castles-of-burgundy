/**
 * 结算：区域完成、动物计分、奖励板块争夺、阶段末收益、终局计分。
 *
 * 与 `data/scoring.ts` 的分工：那边只放**数值表**（区域大小→分数、阶段奖励、
 * 按人数的分值与兑换率），这边放**算法**（谁完成了什么、得多少分）。
 * 这样待确认的数值（Q1/Q2）永远只需要改数据文件。
 */

import { boardIndexOf, regionsOf } from './board'
import { deriveCapabilities, knowledgeIdsInEstate, type Capabilities } from './capabilities'
import { bonusTileVp, regionCompletionVp, sellGoodsVpPerTile, workersToVp } from './data/scoring'
import { axialKey, type Axial } from './hex'
import type { GameState, RulesetConfig } from './state'
import { playerById } from './state'
import type {
  AnimalTile,
  BonusTileSize,
  BuildingKind,
  HexTile,
  PlayerBoardDef,
  PlayerId,
  PlayerState,
  TileColor,
} from './types'
import { TILE_COLORS } from './types'

/** 从领地派生该玩家的能力（已放置的知识板块才生效）。 */
export function capabilitiesOf(player: PlayerState): Capabilities {
  return deriveCapabilities(knowledgeIdsInEstate(player.estate))
}

export function tileAt(player: PlayerState, space: Axial): HexTile | undefined {
  return player.estate[axialKey(space)]
}

export function regionIdAt(board: PlayerBoardDef, space: Axial): string | undefined {
  return boardIndexOf(board).get(axialKey(space))?.regionId
}

export function regionSpaces(board: PlayerBoardDef, regionId: string): readonly Axial[] {
  return regionsOf(board).find((r) => r.regionId === regionId)?.spaces ?? []
}

/** 领地上是否已经把某个区域的每一格都铺满。 */
export function isRegionComplete(player: PlayerState, spaces: readonly Axial[]): boolean {
  return spaces.every((space) => player.estate[axialKey(space)] !== undefined)
}

export interface RegionCompletion {
  readonly regionId: string
  readonly color: TileColor
  readonly size: number
  readonly vp: number
}

/**
 * 刚放下的板块是否让所在区域完成了；完成则返回该区域的得分。
 *
 * 官方：区域完成得两种分 —— 按区域大小（1–8 格 → 1–36 分）**加上**
 * 当前阶段的额外分（A–E = 10/8/6/4/2，与区域大小无关）。
 */
export function completedRegionAt(
  player: PlayerState,
  board: PlayerBoardDef,
  space: Axial,
  phaseIndex: number,
): RegionCompletion | undefined {
  const regionId = regionIdAt(board, space)
  if (regionId === undefined) return undefined
  const spaces = regionSpaces(board, regionId)
  if (!isRegionComplete(player, spaces)) return undefined
  return {
    regionId,
    color: regionsOf(board).find((r) => r.regionId === regionId)?.color ?? 'building',
    size: spaces.length,
    vp: regionCompletionVp(spaces.length, phaseIndex),
  }
}

export interface AnimalScoring {
  readonly vp: number
  /** 参与计分的板块数（含刚放下的那枚），7 号知识板块按这个数加分 */
  readonly scoredTiles: number
}

/**
 * 动物（浅绿）即时计分。
 *
 * 官方规则与例子：
 * - 得分 = 新板块上的动物数 + **同一牧场**中**同种动物**已有板块上的动物数
 * - 牧场 = 相邻浅绿空格构成的连通区域；同种动物*不必*与新板块相邻，但必须在同一牧场
 * - 其他牧场上的同种动物不计分
 * - 例：牧场已有 3 头牛，放入 4 头牛 → 4 + 3 = 7 分；再放入另一枚 4 头牛 → 4 + 4 + 3 = 11 分
 * - 7 号知识板块：每枚**计分的动物板块**额外 +1 分
 *   例：牧场已有 4 只羊，放入 3 只羊 → (3+1) + (4+1) = 9 分
 *
 * 调用约定：**必须在新板块已放入 estate 之后调用**。
 */
export function scoreAnimalPlacement(
  player: PlayerState,
  board: PlayerBoardDef,
  placedSpace: Axial,
  placedTile: AnimalTile,
  animalTileBonusVp: number,
): AnimalScoring {
  const regionId = regionIdAt(board, placedSpace)
  if (regionId === undefined) return { vp: 0, scoredTiles: 0 }

  let animals = 0
  let scoredTiles = 0
  for (const space of regionSpaces(board, regionId)) {
    const tile = player.estate[axialKey(space)]
    if (tile === undefined || tile.color !== 'animal') continue
    if (tile.animal !== placedTile.animal) continue
    animals += tile.animals
    scoredTiles += 1
  }

  return { vp: animals + animalTileBonusVp * scoredTiles, scoredTiles }
}

/** 领地上哪些颜色的空格已经全部铺满（用于争抢奖励板块）。 */
export function fullyCoveredColors(player: PlayerState, board: PlayerBoardDef): TileColor[] {
  const remaining = {} as Record<TileColor, number>
  for (const color of TILE_COLORS) remaining[color] = 0
  for (const space of board.spaces) remaining[space.color] += 1
  for (const space of board.spaces) {
    if (player.estate[axialKey(space)] !== undefined) remaining[space.color] -= 1
  }
  return TILE_COLORS.filter((color) => remaining[color] === 0)
}

export interface BonusTileAward {
  readonly state: GameState
  readonly player: PlayerState
  readonly color: TileColor
  readonly size: BonusTileSize
  readonly vp: number
}

/**
 * 抢奖励板块：第一个把某色全部空格铺满的玩家拿大方块，第二个拿小方块，之后没有。
 * 官方：大方块 2/3/4 人局 = 5/6/7 分；小方块 = 2/3/4 分。
 *
 * 这里会**自己复核该颜色是否真的已全部铺满** —— 宁可让调用方拿到 undefined，
 * 也不要在某次结算顺序写错时凭空发出一个奖励板块。
 */
export function awardBonusTile(
  config: RulesetConfig,
  state: GameState,
  player: PlayerState,
  color: TileColor,
): BonusTileAward | undefined {
  const board = config.playerBoards[player.boardId]
  if (board === undefined) throw new Error(`找不到玩家版图 ${player.boardId}`)
  if (!fullyCoveredColors(player, board).includes(color)) return undefined

  const claimed = state.bonusTilesClaimed[color] ?? []
  if (claimed.length >= 2) return undefined
  if (player.bonusTiles[color] !== undefined) return undefined

  const size: BonusTileSize = claimed.length === 0 ? 'large' : 'small'
  const vp = bonusTileVp(state.playerCount, size)

  const updatedPlayer: PlayerState = {
    ...player,
    vp: player.vp + vp,
    bonusTiles: { ...player.bonusTiles, [color]: size },
  }

  return {
    state: {
      ...state,
      players: state.players.map((p) => (p.id === player.id ? updatedPlayer : p)),
      bonusTilesClaimed: { ...state.bonusTilesClaimed, [color]: [...claimed, size] },
    },
    player: updatedPlayer,
    color,
    size,
    vp,
  }
}

/**
 * 阶段末收益（官方：每阶段结束后执行）。
 *
 * - 每座矿得 1 银币
 * - 2 号知识板块：除银币外，每座矿再额外得 1 工人
 *
 * 注意：区域完成的分是在放置时即时结算的，不在阶段末；阶段末只有矿与阶段触发型板块。
 */
export function applyPhaseEnd(state: GameState, _config: RulesetConfig): GameState {
  const players = state.players.map((player) => {
    let mines = 0
    for (const tile of Object.values(player.estate)) {
      if (tile.color === 'mine') mines += 1
    }
    if (mines === 0) return player

    const caps = capabilitiesOf(player)
    return {
      ...player,
      silverlings: player.silverlings + mines,
      workers: player.workers + (caps.workerPerMineAtPhaseEnd ? mines : 0),
    }
  })

  return { ...state, players }
}

export interface PlayerFinalScore {
  readonly playerId: PlayerId
  readonly inGameVp: number
  readonly unsoldGoodsVp: number
  readonly silverlingsVp: number
  readonly workersVp: number
  readonly knowledgeVp: number
  readonly knowledgeDetail: readonly string[]
  readonly totalVp: number
  /** 领地上还剩多少空格（平手判定第一顺位：越少越好） */
  readonly emptySpaces: number
}

export interface FinalScoreResult {
  readonly scores: readonly PlayerFinalScore[]
  readonly winnerId: PlayerId
  readonly tiebreakNote: string
}

function countBuildings(player: PlayerState): Map<BuildingKind, number> {
  const counts = new Map<BuildingKind, number>()
  for (const tile of Object.values(player.estate)) {
    if (tile.color !== 'building') continue
    counts.set(tile.building, (counts.get(tile.building) ?? 0) + 1)
  }
  return counts
}

function countAnimalKinds(player: PlayerState): number {
  const kinds = new Set<string>()
  for (const tile of Object.values(player.estate)) {
    if (tile.color === 'animal') kinds.add(tile.animal)
  }
  return kinds.size
}

function sumGoods(goods: Readonly<Record<string, number>>): number {
  let total = 0
  for (const count of Object.values(goods)) total += count
  return total
}

/** 一名玩家的终局加分（不含对局中已得的 vp）。 */
export function finalScoreOf(config: RulesetConfig, player: PlayerState): PlayerFinalScore {
  const caps = capabilitiesOf(player)
  const board = config.playerBoards[player.boardId]
  if (board === undefined) throw new Error(`找不到玩家版图 ${player.boardId}`)

  const unsoldGoodsVp = sumGoods(player.goods)
  const silverlingsVp = player.silverlings
  const workersVp = workersToVp(player.workers)

  const detail: string[] = []
  let knowledgeVp = 0

  if (caps.finalVpPerSoldGoodsType > 0) {
    const kinds = Object.entries(player.soldGoods).filter(([, count]) => count > 0).length
    const vp = kinds * caps.finalVpPerSoldGoodsType
    if (vp > 0) detail.push(`已卖出的货物类型 ${kinds} × ${caps.finalVpPerSoldGoodsType} = ${vp}`)
    knowledgeVp += vp
  }

  if (caps.finalVpPerBuilding.size > 0) {
    const counts = countBuildings(player)
    for (const [building, vpPer] of caps.finalVpPerBuilding) {
      const count = counts.get(building) ?? 0
      if (count === 0) continue
      const vp = count * vpPer
      detail.push(`${building} ${count} 座 × ${vpPer} = ${vp}`)
      knowledgeVp += vp
    }
  }

  if (caps.finalVpPerAnimalType > 0) {
    const kinds = countAnimalKinds(player)
    const vp = kinds * caps.finalVpPerAnimalType
    if (vp > 0) detail.push(`动物类型 ${kinds} × ${caps.finalVpPerAnimalType} = ${vp}`)
    knowledgeVp += vp
  }

  if (caps.finalVpPerSoldGoodsTile > 0) {
    const tiles = sumGoods(player.soldGoods)
    const vp = tiles * caps.finalVpPerSoldGoodsTile
    if (vp > 0) detail.push(`已卖出货物 ${tiles} 枚 × ${caps.finalVpPerSoldGoodsTile} = ${vp}`)
    knowledgeVp += vp
  }

  if (caps.finalVpPerBonusTile > 0) {
    const bonus = Object.keys(player.bonusTiles).length
    const vp = bonus * caps.finalVpPerBonusTile
    if (vp > 0) detail.push(`奖励板块 ${bonus} 枚 × ${caps.finalVpPerBonusTile} = ${vp}`)
    knowledgeVp += vp
  }

  const emptySpaces = board.spaces.length - Object.keys(player.estate).length
  const totalVp = player.vp + unsoldGoodsVp + silverlingsVp + workersVp + knowledgeVp

  return {
    playerId: player.id,
    inGameVp: player.vp,
    unsoldGoodsVp,
    silverlingsVp,
    workersVp,
    knowledgeVp,
    knowledgeDetail: detail,
    totalVp,
    emptySpaces,
  }
}

/**
 * 终局计分与胜负判定。
 *
 * 计分项（官方）：每枚未卖出货物 1 分、每枚剩余银币 1 分、每 2 个工人 1 分、
 * 带终局计分的知识板块；**仓储区里剩余的六边形板块不计分**。
 *
 * 平手判定：① 领地上空格最少者胜 → ② 顺位较后者胜。
 */
export function finalScore(config: RulesetConfig, state: GameState): FinalScoreResult {
  const scores = state.players.map((player) => finalScoreOf(config, player))

  const ranked = [...scores].sort((a, b) => {
    if (b.totalVp !== a.totalVp) return b.totalVp - a.totalVp
    if (a.emptySpaces !== b.emptySpaces) return a.emptySpaces - b.emptySpaces
    const aOrder = state.turnOrder.indexOf(a.playerId)
    const bOrder = state.turnOrder.indexOf(b.playerId)
    return bOrder - aOrder
  })

  const winner = ranked[0]
  if (winner === undefined) throw new Error('没有可比分的玩家')
  const runnerUp = ranked[1]

  let tiebreakNote = '按总分'
  if (runnerUp !== undefined && runnerUp.totalVp === winner.totalVp) {
    tiebreakNote =
      runnerUp.emptySpaces === winner.emptySpaces
        ? '总分与空格数都相同，按顺位较后者胜'
        : '总分相同，按领地上空格较少者胜'
  }

  return { scores, winnerId: winner.playerId, tiebreakNote }
}

/** 卖货的可变部分：每枚货物得分（供 effects 层调用）。 */
export function sellGoodsVp(state: GameState, tiles: number): number {
  return tiles * sellGoodsVpPerTile(state.playerCount)
}

/** 便捷：取某玩家当前能力。 */
export function capabilitiesOfPlayer(state: GameState, id: PlayerId): Capabilities {
  return capabilitiesOf(playerById(state, id))
}
