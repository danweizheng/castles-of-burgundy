/**
 * Automa 对手：局面评估 + 选招。
 *
 * 设计取舍：**不做 MCTS**。原因是这个游戏的决策点密度不高（每人每局约 50 次），
 * 而状态评估里"离完成区域还差几格""某色快铺满了"这类信息非常强，
 * 一个调好的启发式在同样时间预算下比粗糙的 MCTS 更靠谱，也更容易解释与调参。
 * 所有权重集中在 `DEFAULT_WEIGHTS`，便于用自对弈做参数扫描。
 *
 * 难度分级不靠作弊（不偷看骰子、不改板块顺序），只靠搜索深度与决策噪声：
 * - easy：带较大噪声，会犯错
 * - normal：1 层贪心（对每个合法行动评估其结果的局面）
 * - hard：在本回合第一次行动时做 2 层前瞻（两个行动连起来看）
 */

import { applyMove } from '../engine/apply'
import { boardIndexOf, castleSpacesOf, isAdjacentToAny, regionsOf } from '../engine/board'
import { knowledgeIdsInEstate } from '../engine/capabilities'
import { knowledgeDef } from '../engine/data/knowledge'
import { bonusTileVp, phaseCompletionBonus, regionSizeVp } from '../engine/data/scoring'
import { axialDistance, axialKey, neighbors, type Axial } from '../engine/hex'
import { listLegalMoves, type Move } from '../engine/moves'
import { createRng, nextInt, type RngState } from '../engine/rng'
import { playerById, type GameState, type RulesetConfig } from '../engine/state'
import { TILE_COLORS, type PlayerId, type PlayerState, type TileColor } from '../engine/types'

export type Difficulty = 'easy' | 'normal' | 'hard'

export interface Weights {
  /** 对局中已得分数（含区域完成、动物、瞭望塔、奖励板块） */
  readonly vp: number
  /** 每铺下一格板块的固有价值（"推进"本身就是好事） */
  readonly filledSpace: number
  /** 未完成区域的进度潜力：完成价值 × 进度^1.5，进度越高越诱人 */
  readonly regionPotential: number
  /** 某色快铺满时的额外动机（抢奖励板块） */
  readonly colorPotential: number
  readonly silverling: number
  readonly worker: number
  readonly goodsTile: number
  /** 仓储里"当前放得下去"的板块（放得下去才有价值） */
  readonly storagePlaceable: number
  /** 仓储每多一枚就扣一点（占格子会挡路） */
  readonly storageCrowding: number
  /** 已放置的持续型知识板块 */
  readonly knowledgeContinuous: number
  /** 已放置的终局计分型知识板块 */
  readonly knowledgeFinal: number
  /** 牧场上已有动物的潜力（以后每次同种动物都能重复计分） */
  readonly animalPotential: number
  /**
   * 下一轮先手的价值。
   *
   * 这条是**与版图无关**的原则性价值：先手意味着下一轮先挑重新铺满的仓库
   * （2 人局每阶段 12 个格位）以及本轮那枚货物。早先这里硬编码成 1.5 分，
   * 基本等于忽略 —— 而船只的主要作用之一就是抢顺位；
   * 攻略也明确说 2 人局控制船位很重要。
   */
  readonly turnOrder: number
  /** 对手分数在评估里的负权重（零和倾向，促使 AI 学会卡人） */
  readonly opponentWeight: number
}

/**
 * 资源价值必须**饱和**，否则 AI 会退化成"无限刷取 2 个工人"。
 *
 * 这是实测踩到的坑：工人按每枚固定计分时，"取 2 个工人"成了一个永远有收益的动作，
 * 而早期区域进度被 progress² 折扣得很便宜，于是 AI 整局都在刷工人、一格都不放
 * （自对弈诊断里出现过 p2 放 1 格、攒 101 个工人、0 分）。
 */
const WORKER_VALUE_CAP = 6
const SILVER_VALUE_CAP = 8
const GOODS_VALUE_CAP = 4

export const DEFAULT_WEIGHTS: Weights = {
  vp: 1,
  filledSpace: 1.3,
  regionPotential: 0.9,
  colorPotential: 1.1,
  silverling: 1.2,
  worker: 1.4,
  goodsTile: 0.9,
  storagePlaceable: 2.6,
  storageCrowding: 2.5,
  knowledgeContinuous: 7,
  knowledgeFinal: 2.5,
  animalPotential: 0.22,
  turnOrder: 6,
  opponentWeight: 0.9,
}

/** 单个数字不能超过 8 格（计分表上限）；真实版图数据由校验器保证，这里再兜一层。 */
const MAX_SCORABLE_REGION = 8

function completionValue(size: number, phaseIndex: number): number {
  if (size < 1 || size > MAX_SCORABLE_REGION) return 0
  return regionSizeVp(size) + phaseCompletionBonus(phaseIndex)
}

/** 领地当前"还能够到"的颜色（有空格且与已有板块相邻）。 */
function placeableColors(config: RulesetConfig, player: PlayerState): Set<TileColor> {
  const board = config.playerBoards[player.boardId]
  if (board === undefined) return new Set()
  const placedKeys = new Set(Object.keys(player.estate))
  const colors = new Set<TileColor>()
  for (const space of board.spaces) {
    if (player.estate[axialKey(space)] !== undefined) continue
    const here = { q: space.q, r: space.r }
    if (isAdjacentToAny(here, placedKeys)) colors.add(space.color)
  }
  return colors
}

/** 一名玩家的静态价值（不含对手）。 */
export function scorePlayer(
  config: RulesetConfig,
  state: GameState,
  player: PlayerState,
  weights: Weights,
): number {
  const board = config.playerBoards[player.boardId]
  if (board === undefined) return 0

  let total = player.vp * weights.vp

  // 区域进度潜力 + 每铺一格的固有价值
  let filledSpaces = 0
  for (const region of regionsOf(board)) {
    const size = region.size
    if (size === 0) continue
    let filled = 0
    for (const space of region.spaces) {
      if (player.estate[axialKey(space)] !== undefined) filled += 1
    }
    filledSpaces += filled
    if (filled >= size) continue // 已完成，分数已经算进 vp
    const progress = filled / size
    total +=
      completionValue(size, state.phaseIndex) *
      Math.pow(progress, 1.5) *
      weights.regionPotential
  }
  total += filledSpaces * weights.filledSpace

  // 抢奖励板块：某色只剩一两格时明显加分
  const bonusTop = bonusTileVp(state.playerCount, 'large')
  for (const color of TILE_COLORS) {
    let totalSpaces = 0
    let filled = 0
    for (const space of board.spaces) {
      if (space.color !== color) continue
      totalSpaces += 1
      if (player.estate[axialKey(space)] !== undefined) filled += 1
    }
    if (totalSpaces === 0) continue
    const remaining = totalSpaces - filled
    if (remaining === 0 || remaining > 2) continue
    total += bonusTop * (1 - remaining / totalSpaces) * weights.colorPotential
  }

  // 牧场潜力：同种动物以后每次放入都会重复计分
  for (const region of regionsOf(board)) {
    if (region.color !== 'animal') continue
    const byKind = new Map<string, number>()
    for (const space of region.spaces) {
      const tile = player.estate[axialKey(space)]
      if (tile === undefined || tile.color !== 'animal') continue
      byKind.set(tile.animal, (byKind.get(tile.animal) ?? 0) + tile.animals)
    }
    let sum = 0
    for (const animals of byKind.values()) sum += animals
    total += sum * weights.animalPotential
  }

  // 资源（价值饱和，见 WORKER_VALUE_CAP 的说明）
  total += Math.min(player.silverlings, SILVER_VALUE_CAP) * weights.silverling
  total += Math.min(player.workers, WORKER_VALUE_CAP) * weights.worker
  for (const count of Object.values(player.goods)) {
    total += Math.min(count, GOODS_VALUE_CAP) * weights.goodsTile
  }

  // 仓储：放得下去才值钱
  const placeable = placeableColors(config, player)
  for (const tile of player.storage) {
    if (placeable.has(tile.color)) total += weights.storagePlaceable
    total -= weights.storageCrowding
  }

  // 已放置的知识板块
  for (const id of knowledgeIdsInEstate(player.estate)) {
    total +=
      knowledgeDef(id).kind === 'finalScoring'
        ? weights.knowledgeFinal
        : weights.knowledgeContinuous
  }

  return total
}

/** 从某位玩家视角评估整个局面（已扣除对手的加权价值）。 */
export function evaluate(
  config: RulesetConfig,
  state: GameState,
  playerId: PlayerId,
  weights: Weights = DEFAULT_WEIGHTS,
): number {
  const me = playerById(state, playerId)
  const opponent = state.players.find((player) => player.id !== playerId)

  let total = scorePlayer(config, state, me, weights)
  if (opponent !== undefined) {
    total -= scorePlayer(config, state, opponent, weights) * weights.opponentWeight
  }

  // 顺位越靠前，下一轮越早挑重新铺满的仓库，按名次给分
  const order = state.turnOrder.indexOf(playerId)
  if (order >= 0) {
    total += (state.playerCount - 1 - order) * weights.turnOrder
  }

  return total
}

// ---------------------------------------------------------------------------
// 整回合搜索（"完整对手"的核心）
// ---------------------------------------------------------------------------

interface BeamNode {
  readonly state: GameState
  /** 根节点的行动：搜索结束后要返回的就是它 */
  readonly firstMove: Move
  readonly score: number
}

/**
 * 对一个**完整回合**做束搜索。
 *
 * 为什么可以这么做：一回合的两颗骰子在回合开始时就已经掷出、双方都看得见，
 * 所以"这一回合该怎么打"是一个信息完备的搜索问题 —— 不需要对骰子求期望，
 * 只要把两个行动（以及连锁出来的额外行动与待处理选择）连起来看。
 *
 * 早先的做法是"走一步看一步"的贪心，它有个典型的短视：
 * 用骰子 A 取板块、用骰子 B 把它放下，这两步单独看都不如"取工人"划算，
 * 连起来看才是最优。束搜索正好修掉这一点。
 *
 * 分层保留（而不是全局排序）是刻意的：一个"只用了一颗骰子"的中间状态
 * 和一个"回合已结束"的终局状态不可比 —— 前者还有行动没花。
 * 所以中间状态只在自己的层内竞争，最后优先与"回合已结束"的叶子比较。
 */
function beamSearchTurn(
  config: RulesetConfig,
  state: GameState,
  playerId: PlayerId,
  beamWidth: number,
  maxEvaluations: number,
): { move: Move; score: number; evaluations: number } | undefined {
  const rootMoves = listLegalMoves(config, state)
  if (rootMoves.length === 0) return undefined
  if (rootMoves.length === 1) {
    const only = rootMoves[0]!
    const after = applyMove(config, state, only).state
    return { move: only, score: evaluate(config, after, playerId), evaluations: 1 }
  }

  const isTurnOver = (node: BeamNode): boolean =>
    node.state.finished || node.state.activePlayerId !== playerId

  let evaluations = 0
  let level: BeamNode[] = []
  for (const move of rootMoves) {
    if (evaluations >= maxEvaluations) break
    const after = applyMove(config, state, move).state
    evaluations += 1
    level.push({ state: after, firstMove: move, score: evaluate(config, after, playerId) })
  }
  level = topNodes(level, beamWidth)

  const completed: BeamNode[] = []
  // 一个回合最多：2 个骰子行动 + 城堡额外行动 + 若干连锁的待处理选择 + 结束回合
  const MAX_DEPTH = 7

  for (let depth = 1; depth < MAX_DEPTH && level.length > 0; depth += 1) {
    const next: BeamNode[] = []
    for (const node of level) {
      for (const move of listLegalMoves(config, node.state)) {
        if (evaluations >= maxEvaluations) break
        const after = applyMove(config, node.state, move).state
        evaluations += 1
        next.push({
          state: after,
          firstMove: node.firstMove,
          score: evaluate(config, after, playerId),
        })
      }
      if (evaluations >= maxEvaluations) break
    }

    completed.push(...next.filter(isTurnOver))
    level = topNodes(next.filter((node) => !isTurnOver(node)), beamWidth)
    if (evaluations >= maxEvaluations) break
  }

  // 优先只与"回合真的结束了"的局面比较；一个都没有才退回中间状态
  const pool = completed.length > 0 ? completed : level
  let best: BeamNode | undefined
  for (const node of pool) {
    if (best === undefined || node.score > best.score) best = node
  }
  return best === undefined
    ? undefined
    : { move: best.firstMove, score: best.score, evaluations }
}

function topNodes(nodes: readonly BeamNode[], width: number): BeamNode[] {
  if (nodes.length <= width) return [...nodes]
  return [...nodes].sort((a, b) => b.score - a.score).slice(0, width)
}

// ---------------------------------------------------------------------------
// 选招
// ---------------------------------------------------------------------------

export interface PickMoveOptions {
  readonly difficulty: Difficulty
  readonly rng: RngState
  /** 前瞻的评估次数上限，防止在 Web Worker 外把主线程卡死 */
  readonly maxEvaluations?: number
}

const NOISE: Readonly<Record<Difficulty, number>> = {
  easy: 22,
  normal: 0.5,
  hard: 0,
}

const RANDOM_PICK_CHANCE: Readonly<Record<Difficulty, number>> = {
  easy: 0.22,
  normal: 0,
  hard: 0,
}

/**
 * 困难档的束宽与评估预算。
 *
 * 实测（整回合搜索）：束宽 8 / 预算 2500 时单次搜索约 20ms，
 * 而界面给困难档的思考延迟是 420ms —— 富余很多，所以开到更大。
 * 调这两个数只需要跑 src/ai 的测试看"耗时"与"难度分层"两行输出。
 */
const HARD_BEAM_WIDTH = 16
const HARD_EVALUATION_BUDGET = 9000

function cloneRng(rng: RngState): RngState {
  return { s: rng.s }
}

/**
 * 选一个行动。返回 undefined 表示当前没有合法行动（正常对局不会发生）。
 *
 * 难度分级：
 * - easy：贪心 + 较大噪声，有一定概率随便走
 * - normal：一层贪心（对每个合法行动评估其结果）
 * - hard：**回合开始时**对整个回合做束搜索；回合中途（例如正在解决待处理选择）
 *   退回一层贪心，避免每一步都做一次重搜索
 *
 * 这里**只**通过公开接口（listLegalMoves / applyMove / 公开状态）访问游戏，
 * 因此结构上不可能作弊；也方便把对手换成人类玩家做自对弈测试。
 */
export function pickMove(
  config: RulesetConfig,
  state: GameState,
  playerId: PlayerId,
  options: PickMoveOptions,
): Move | undefined {
  const moves = listLegalMoves(config, state)
  if (moves.length === 0) return undefined
  if (moves.length === 1) return moves[0]

  const rng = cloneRng(options.rng)

  // 只有"结束回合"之外别无选择时才不必评估（上面已经处理 moves.length === 1）

  // hard：回合开始时做整回合束搜索
  const atTurnStart =
    state.pending.length === 0 && state.actionsTakenThisTurn === 0 && state.pendingExtraActions === 0
  if (options.difficulty === 'hard' && atTurnStart) {
    const result = beamSearchTurn(
      config,
      state,
      playerId,
      HARD_BEAM_WIDTH,
      options.maxEvaluations ?? HARD_EVALUATION_BUDGET,
    )
    if (result !== undefined) return result.move
  }

  // easy 难度：有一定概率随便走一步
  if (nextInt(rng, 1000) / 1000 < RANDOM_PICK_CHANCE[options.difficulty]) {
    return moves[nextInt(rng, moves.length)]
  }

  const noise = NOISE[options.difficulty]
  let best: Move | undefined
  let bestScore = Number.NEGATIVE_INFINITY

  for (const move of moves) {
    const after = applyMove(config, state, move).state
    let score = evaluate(config, after, playerId)
    if (noise > 0) {
      score += ((nextInt(rng, 2001) - 1000) / 1000) * noise
    }
    if (score > bestScore) {
      bestScore = score
      best = move
    }
  }

  return best ?? moves[0]
}

/** 便捷：给界面"提示"功能用——返回推荐行动及其评估分。 */
export function suggestMove(
  config: RulesetConfig,
  state: GameState,
  playerId: PlayerId,
): { readonly move: Move; readonly score: number } | undefined {
  const move = pickMove(config, state, playerId, {
    difficulty: 'normal',
    rng: createRng(1),
  })
  if (move === undefined) return undefined
  const after = applyMove(config, state, move).state
  return { move, score: evaluate(config, after, playerId) }
}

// ---------------------------------------------------------------------------
// 开局城堡选点
// ---------------------------------------------------------------------------

/**
 * 选开局城堡所在的深红格。
 *
 * 官方规则允许任选深红格（只有"第一次玩"才推荐中央 6 号格），所以 AI 也该自己选。
 * 这里用一个很便宜的结构性指标，避免为了开局一行就套整局评估：
 * - **相邻空格数**：能往几个方向铺开
 * - **相邻空格的颜色种类**：开局最缺的是"能立刻放下的板块"，颜色越杂越灵活
 * - 平手时偏好版图推荐的中央格
 */
export function pickStartingCastle(config: RulesetConfig, player: PlayerState): Axial {
  const board = config.playerBoards[player.boardId]
  if (board === undefined) return { q: 0, r: 0 }

  const candidates = castleSpacesOf(board)
  if (candidates.length === 0) return board.startingSpace

  const index = boardIndexOf(board)
  const recommended = axialKey(board.startingSpace)
  let best = candidates[0] ?? board.startingSpace
  let bestScore = Number.NEGATIVE_INFINITY

  for (const candidate of candidates) {
    let empty = 0
    const colors = new Set<TileColor>()
    for (const neighbor of neighbors(candidate)) {
      const space = index.get(axialKey(neighbor))
      if (space === undefined) continue
      empty += 1
      colors.add(space.color)
    }
    // 离推荐格越近越稳（权重刻意很小，只用作平手偏好）
    const centrality = -axialDistance(candidate, board.startingSpace) * 0.01
    const score =
      empty + colors.size * 0.4 + centrality + (axialKey(candidate) === recommended ? 0.001 : 0)

    if (score > bestScore) {
      bestScore = score
      best = candidate
    }
  }

  return best
}
