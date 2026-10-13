/**
 * 执行行动：applyMove(config, state, move) → { state, events }。
 *
 * 约定：
 * - 纯函数。绝不修改传入的 state（撤销靠快照栈，改旧状态会立刻毁掉撤销）。
 * - 前置条件不满足时 **抛错**，而不是静默忽略。这样 AI 或 UI 传错动作会被立刻发现，
 *   而不是让对局悄悄进入一个不合法的状态。
 * - 事件列表交给 UI 渲染中文播报与动画（UI 不自己推算规则）。
 */

import { boardIndexOf } from './board'
import { dieOptions } from './capabilities'
import { buildingDef } from './data/buildings'
import {
  ACTIONS_PER_TURN,
  CITY_HALL_IGNORES_NUMBER,
  GOODS_STORAGE_TYPES,
  STORAGE_CAPACITY,
  sellGoodsVpPerTile,
} from './data/scoring'
import type { GameEvent } from './events'
import { activeSlots } from './gameBoard'
import { axialKey, type Axial } from './hex'
import {
  canResolvePending,
  goodsSpaceNeighbours,
  placementProblem,
  type DieRef,
  type Move,
} from './moves'
import { awardBonusTile, capabilitiesOf, completedRegionAt, scoreAnimalPlacement } from './scoring'
import { advanceTurn } from './setup'
import {
  currentPending,
  currentPlayer,
  playerById,
  withPlayer,
  type GameState,
  type PendingChoice,
  type RulesetConfig,
} from './state'
import type {
  BuildingTile,
  DieValue,
  GoodsKind,
  HexTile,
  PlayerId,
  PlayerState,
} from './types'

export interface ApplyResult {
  readonly state: GameState
  readonly events: readonly GameEvent[]
}

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

function setGoodsCount(
  goods: Readonly<Record<string, number>>,
  kind: GoodsKind,
  count: number,
): Record<string, number> {
  const next: Record<string, number> = { ...goods }
  if (count <= 0) delete next[String(kind)]
  else next[String(kind)] = count
  return next
}

function addGoods(
  goods: Readonly<Record<string, number>>,
  kind: GoodsKind,
  delta: number,
): Record<string, number> {
  return setGoodsCount(goods, kind, (goods[String(kind)] ?? 0) + delta)
}

/**
 * 支付骰子：算出最少要花几个工人、把骰子标记为已用、推进本回合的行动计数。
 *
 * 城堡的虚拟骰子（`kind: 'virtual'`）不占真骰子、不花工人，也不计入两个行动，
 * 只消耗一次"额外行动"额度。
 */
function spendDie(
  state: GameState,
  die: DieRef,
  requirement: { readonly value: DieValue | null; readonly freeAdjust: boolean },
): { state: GameState; events: GameEvent[] } {
  const player = currentPlayer(state)

  if (die.kind === 'virtual') {
    if (state.pendingExtraActions <= 0) throw new Error('没有可用的城堡额外行动')
    return { state: { ...state, pendingExtraActions: state.pendingExtraActions - 1 }, events: [] }
  }

  const dieState = state.dice[player.id]?.[die.index]
  if (dieState === undefined) throw new Error(`骰子下标 ${die.index} 不存在`)
  if (dieState.used) throw new Error('这颗骰子已经用过了')

  const caps = capabilitiesOf(player)
  let workersSpent = 0
  let usedValue = dieState.value

  if (requirement.value !== null) {
    const option = dieOptions({
      die: dieState.value,
      workers: player.workers,
      freeAdjust: requirement.freeAdjust,
      stepsPerWorker: caps.dieStepsPerWorker,
    }).find((candidate) => candidate.value === requirement.value)
    if (option === undefined) {
      throw new Error(`点数无法从 ${dieState.value} 调整到 ${requirement.value}`)
    }
    workersSpent = option.workersSpent
    usedValue = option.value
  }

  const events: GameEvent[] = []
  if (usedValue !== dieState.value || workersSpent > 0) {
    events.push({
      kind: 'dieAdjusted',
      player: player.id,
      from: dieState.value,
      to: usedValue,
      workersSpent,
    })
  }

  return {
    state: {
      ...state,
      dice: {
        ...state.dice,
        [player.id]: (state.dice[player.id] ?? []).map((d, index) =>
          index === die.index ? { ...d, used: true } : d,
        ),
      },
      actionsTakenThisTurn: state.actionsTakenThisTurn + 1,
      players: state.players.map((p) =>
        p.id === player.id ? { ...p, workers: p.workers - workersSpent } : p,
      ),
    },
    events,
  }
}

/**
 * 把一枚板块放进仓储。
 *
 * 官方：仓储已满时**必须先弃掉一枚**（移出游戏），再放入新板块。
 * 弃掉的板块进 `removedFromGame`，这样"板块守恒"仍然可以被精确断言。
 */
function putTileIntoStorage(
  state: GameState,
  tile: HexTile,
  discardStorageIndex: number | undefined,
): { state: GameState; events: GameEvent[] } {
  const player = currentPlayer(state)
  const events: GameEvent[] = []
  let storage = [...player.storage]
  let removed = state.removedFromGame

  if (storage.length >= STORAGE_CAPACITY) {
    if (discardStorageIndex === undefined) throw new Error('仓储已满，必须先弃掉一枚板块')
    const discarded = storage[discardStorageIndex]
    if (discarded === undefined) throw new Error(`要弃掉的仓储下标越界：${discardStorageIndex}`)
    storage = storage.filter((_, index) => index !== discardStorageIndex)
    removed = [...removed, discarded]
    events.push({
      kind: 'discardedTile',
      player: player.id,
      tileId: discarded.id,
      color: discarded.color,
    })
  }

  storage.push(tile)
  return {
    state: withPlayer({ ...state, removedFromGame: removed }, { ...player, storage }),
    events,
  }
}

/** 卖货的共同实现（骰子行动与"仓库"建筑效果都走这里）。 */
function sellGoodsInternal(
  state: GameState,
  playerId: PlayerId,
  goods: GoodsKind,
  count: number,
  events: GameEvent[],
): ApplyResult {
  const player = playerById(state, playerId)
  const caps = capabilitiesOf(player)
  const vp = count * sellGoodsVpPerTile(state.playerCount)
  const silverlings = caps.silverlingsPerSell
  const workers = caps.workersPerSell

  const next: PlayerState = {
    ...player,
    vp: player.vp + vp,
    silverlings: player.silverlings + silverlings,
    workers: player.workers + workers,
    goods: setGoodsCount(player.goods, goods, 0),
    soldGoods: addGoods(player.soldGoods, goods, count),
  }

  return {
    state: withPlayer(state, next),
    events: [...events, { kind: 'soldGoods', player: playerId, goods, tiles: count, vp, silverlings, workers }],
  }
}

// ---------------------------------------------------------------------------
// 放置与效果
// ---------------------------------------------------------------------------

/**
 * 把仓储里第 storageIndex 枚板块放到 to，并结算所有随之而来的效果。
 *
 * 这是放置的唯一入口：普通放置与市政厅的额外放置都走它，所以"放置会触发什么"
 * 只写一遍。
 */
function performPlacement(
  config: RulesetConfig,
  state: GameState,
  storageIndex: number,
  to: Axial,
  events: GameEvent[],
): GameState {
  const player = currentPlayer(state)
  const board = config.playerBoards[player.boardId]
  if (board === undefined) throw new Error(`找不到玩家版图 ${player.boardId}`)

  const tile = player.storage[storageIndex]
  if (tile === undefined) throw new Error(`仓储第 ${storageIndex} 格是空的`)

  let s = withPlayer(state, {
    ...player,
    storage: player.storage.filter((_, index) => index !== storageIndex),
    estate: { ...player.estate, [axialKey(to)]: tile },
  })

  events.push({
    kind: 'placedTile',
    player: player.id,
    tileId: tile.id,
    color: tile.color,
    to,
    building: tile.color === 'building' ? tile.building : undefined,
    knowledge: tile.color === 'knowledge' ? tile.knowledge : undefined,
    animals: tile.color === 'animal' ? tile.animals : undefined,
  })

  switch (tile.color) {
    case 'castle': {
      // 官方：立即执行一次任意点数的额外行动（用虚拟骰子实现）
      s = { ...s, pendingExtraActions: s.pendingExtraActions + 1 }
      events.push({ kind: 'castleExtraAction', player: player.id })
      break
    }
    case 'animal': {
      const owner = currentPlayer(s)
      const result = scoreAnimalPlacement(
        owner,
        board,
        to,
        tile,
        capabilitiesOf(owner).animalTileBonusVp,
      )
      if (result.vp > 0) {
        s = withPlayer(s, { ...owner, vp: owner.vp + result.vp })
        events.push({
          kind: 'animalsScored',
          player: owner.id,
          vp: result.vp,
          tiles: result.scoredTiles,
        })
      }
      break
    }
    case 'ship': {
      // 官方：从**任意**一个货物格取走全部货物（与骰子点数无关），然后顺位前移
      const pending: PendingChoice = { kind: 'shipGoodsSpace', exclude: [] }
      if (canResolvePending(config, s, pending)) s = { ...s, pending: [pending, ...s.pending] }
      break
    }
    case 'building': {
      events.push({ kind: 'buildingEffect', player: player.id, building: tile.building })
      s = applyBuildingEffect(config, s, tile, to)
      break
    }
    case 'mine':
    case 'knowledge':
      // 矿：放置时无即时效果，阶段末给银币
      // 知识：持续型被动，靠 capabilitiesOf 生效
      break
  }

  return settleRegionCompletion(config, s, to, tile.color, events)
}

/** 区域完成计分 + 奖励板块争夺。 */
function settleRegionCompletion(
  config: RulesetConfig,
  state: GameState,
  to: Axial,
  placedColor: HexTile['color'],
  events: GameEvent[],
): GameState {
  const player = currentPlayer(state)
  const board = config.playerBoards[player.boardId]
  if (board === undefined) return state

  let s = state

  const completion = completedRegionAt(player, board, to, state.phaseIndex)
  if (completion !== undefined) {
    const owner = currentPlayer(s)
    s = withPlayer(s, { ...owner, vp: owner.vp + completion.vp })
    events.push({
      kind: 'regionCompleted',
      player: owner.id,
      regionId: completion.regionId,
      size: completion.size,
      vp: completion.vp,
    })
  }

  // 奖励板块只可能与刚放下的那枚板块的颜色有关（新覆盖某色必然是这一手）
  const owner = currentPlayer(s)
  const award = awardBonusTile(config, s, owner, placedColor)
  if (award !== undefined) {
    s = award.state
    events.push({
      kind: 'bonusTileClaimed',
      player: award.player.id,
      color: award.color,
      size: award.size,
      vp: award.vp,
    })
  }

  return s
}

/**
 * 八种建筑的一次性效果。
 *
 * 官方：若无法使用效果（例如编号仓库里已无对应颜色板块），建筑仍可放置，但效果作废。
 * 所以这里在压入待处理选择前会先确认"至少有一个解法"。
 */
function applyBuildingEffect(
  config: RulesetConfig,
  state: GameState,
  tile: BuildingTile,
  to: Axial,
): GameState {
  const def = buildingDef(tile.building)
  const player = currentPlayer(state)

  switch (def.effect.kind) {
    case 'gainVp':
      return withPlayer(state, { ...player, vp: player.vp + def.effect.amount })
    case 'gainWorkers':
      return withPlayer(state, { ...player, workers: player.workers + def.effect.amount })
    case 'gainSilverlings':
      return withPlayer(state, { ...player, silverlings: player.silverlings + def.effect.amount })
    case 'sellGoods': {
      const pending: PendingChoice = { kind: 'warehouseSellGoods' }
      return canResolvePending(config, state, pending)
        ? { ...state, pending: [pending, ...state.pending] }
        : state
    }
    case 'takeTileFromAnyDepot': {
      const pending: PendingChoice = {
        kind: 'takeTileFromAnyDepot',
        colors: def.effect.colors,
      }
      return canResolvePending(config, state, pending)
        ? { ...state, pending: [pending, ...state.pending] }
        : state
    }
    case 'placeExtraTileIgnoringColor': {
      const board = config.playerBoards[player.boardId]
      const space = board === undefined ? undefined : boardIndexOf(board).get(axialKey(to))
      const pending: PendingChoice = {
        kind: 'cityHallPlace',
        // Q8 的开关：默认保留点数限制
        requiredNumber: CITY_HALL_IGNORES_NUMBER ? null : (space?.number ?? null),
      }
      return canResolvePending(config, state, pending)
        ? { ...state, pending: [pending, ...state.pending] }
        : state
    }
  }
}

// ---------------------------------------------------------------------------
// 船只相关
// ---------------------------------------------------------------------------

/**
 * 从某个货物格取货。
 * 官方：货物仓储最多存 3 种不同颜色，同色叠放；装不下的留在原处。
 */
function takeGoodsFromSpace(
  player: PlayerState,
  goods: readonly GoodsKind[],
): { player: PlayerState; taken: GoodsKind[]; left: GoodsKind[] } {
  const stored: Record<string, number> = { ...player.goods }
  const kinds = new Set(
    Object.entries(stored)
      .filter(([, count]) => count > 0)
      .map(([kind]) => kind),
  )
  const taken: GoodsKind[] = []
  const left: GoodsKind[] = []

  for (const kind of goods) {
    const key = String(kind)
    if (kinds.has(key)) {
      stored[key] = (stored[key] ?? 0) + 1
      taken.push(kind)
      continue
    }
    if (kinds.size < GOODS_STORAGE_TYPES) {
      stored[key] = 1
      kinds.add(key)
      taken.push(kind)
      continue
    }
    left.push(kind)
  }

  return { player: { ...player, goods: stored }, taken, left }
}

/**
 * 顺位轨前移一格。
 *
 * 官方：放置船只后棋子向右移动一格；该格若被占用则叠在上面；
 * 若因此成为"最右且最上"，下一轮就是先手并拿到白骰。
 * 在 2 人局里这等价于与前一位置互换；3/4 人局的堆叠细节留待扩展时再做。
 */
function advanceTurnOrderForShip(
  state: GameState,
  playerId: PlayerId,
): { state: GameState; moved: boolean } {
  const index = state.turnOrder.indexOf(playerId)
  if (index <= 0) return { state, moved: false }

  const order = [...state.turnOrder]
  const previous = order[index - 1]
  if (previous === undefined) return { state, moved: false }
  order[index - 1] = playerId
  order[index] = previous
  return { state: { ...state, turnOrder: order }, moved: true }
}

function resolveShipGoods(config: RulesetConfig, state: GameState, space: DieValue): ApplyResult {
  const events: GameEvent[] = []
  let s: GameState = { ...state, pending: state.pending.slice(1) }

  const player = currentPlayer(s)
  const result = takeGoodsFromSpace(player, s.goodsSpaces[String(space)] ?? [])
  s = withPlayer(s, result.player)
  s = { ...s, goodsSpaces: { ...s.goodsSpaces, [String(space)]: result.left } }
  events.push({
    kind: 'shipTookGoods',
    player: player.id,
    space,
    taken: result.taken,
    left: result.left,
  })

  const advanced = advanceTurnOrderForShip(s, player.id)
  s = advanced.state
  if (advanced.moved) {
    events.push({
      kind: 'turnOrderAdvanced',
      player: player.id,
      isStartPlayer: s.turnOrder[0] === player.id,
    })
  }

  // 5 号知识板块：再取一个相邻货物格
  if (capabilitiesOf(currentPlayer(s)).shipTakesTwoGoodsSpaces) {
    const second: PendingChoice = { kind: 'shipGoodsSecondSpace', firstSpace: space }
    if (canResolvePending(config, s, second)) s = { ...s, pending: [second, ...s.pending] }
  }

  return { state: s, events }
}

// ---------------------------------------------------------------------------
// 行动执行
// ---------------------------------------------------------------------------

export function applyMove(config: RulesetConfig, state: GameState, move: Move): ApplyResult {
  if (state.finished) throw new Error('对局已经结束')
  if (currentPending(state) !== undefined) return applyPendingMove(config, state, move)
  return applyActionMove(config, state, move)
}

function applyActionMove(config: RulesetConfig, state: GameState, move: Move): ApplyResult {
  switch (move.kind) {
    case 'takeTile':
      return applyTakeTile(config, state, move)
    case 'placeTile':
      return applyPlaceTile(config, state, move)
    case 'sellGoods':
      return applySellGoods(state, move)
    case 'takeWorkers':
      return applyTakeWorkers(state, move)
    case 'buyTile':
      return applyBuyTile(config, state, move)
    case 'endTurn':
      return applyEndTurn(config, state)
    default:
      throw new Error(`当前没有待处理的选择，无法执行 ${move.kind}`)
  }
}

function applyTakeTile(
  config: RulesetConfig,
  state: GameState,
  move: Extract<Move, { kind: 'takeTile' }>,
): ApplyResult {
  const player = currentPlayer(state)
  const caps = capabilitiesOf(player)

  const slot = activeSlots(config.gameBoard, state.playerCount).find((s) => s.id === move.slotId)
  if (slot === undefined) throw new Error(`找不到编号仓库格位 ${move.slotId}`)
  const tile = state.depotSlots[slot.id] ?? null
  if (tile === null) throw new Error(`编号仓库格位 ${slot.id} 是空的`)

  const spent = spendDie(state, move.die, {
    value: slot.depot,
    freeAdjust: caps.freeDieAdjustOnTake,
  })
  const cleared: GameState = {
    ...spent.state,
    depotSlots: { ...spent.state.depotSlots, [slot.id]: null },
  }
  const put = putTileIntoStorage(cleared, tile, move.discardStorageIndex)

  return {
    state: put.state,
    events: [
      ...spent.events,
      { kind: 'tookTile', player: player.id, tileId: tile.id, color: tile.color },
      ...put.events,
    ],
  }
}

function applyPlaceTile(
  config: RulesetConfig,
  state: GameState,
  move: Extract<Move, { kind: 'placeTile' }>,
): ApplyResult {
  const player = currentPlayer(state)
  const board = config.playerBoards[player.boardId]
  if (board === undefined) throw new Error(`找不到玩家版图 ${player.boardId}`)
  const space = boardIndexOf(board).get(axialKey(move.to))
  if (space === undefined) throw new Error('目标格不在版图上')

  const problem = placementProblem(config, state, player, {
    storageIndex: move.storageIndex,
    to: move.to,
    ignoreColor: false,
    requiredNumber: space.number,
  })
  if (problem !== undefined) throw new Error(problem)

  const tile = player.storage[move.storageIndex]
  if (tile === undefined) throw new Error(`仓储第 ${move.storageIndex} 格是空的`)

  const spent = spendDie(state, move.die, {
    value: space.number,
    freeAdjust: capabilitiesOf(player).freeDieAdjustColors.has(tile.color),
  })

  const events: GameEvent[] = [...spent.events]
  const next = performPlacement(config, spent.state, move.storageIndex, move.to, events)
  return { state: next, events }
}

function applySellGoods(
  state: GameState,
  move: Extract<Move, { kind: 'sellGoods' }>,
): ApplyResult {
  const player = currentPlayer(state)
  const count = player.goods[String(move.goods)] ?? 0
  if (count <= 0) throw new Error(`没有 ${move.goods} 号货物可卖`)

  const spent = spendDie(state, move.die, { value: move.goods, freeAdjust: false })
  return sellGoodsInternal(spent.state, player.id, move.goods, count, spent.events)
}

function applyTakeWorkers(state: GameState, move: Extract<Move, { kind: 'takeWorkers' }>): ApplyResult {
  const caps = capabilitiesOf(currentPlayer(state))
  const spent = spendDie(state, move.die, { value: null, freeAdjust: false })
  const owner = currentPlayer(spent.state)

  const workers = caps.workersOnTakeWorkers
  const silverlings = caps.silverlingsOnTakeWorkers
  const next: PlayerState = {
    ...owner,
    workers: owner.workers + workers,
    silverlings: owner.silverlings + silverlings,
  }

  return {
    state: withPlayer(spent.state, next),
    events: [
      ...spent.events,
      { kind: 'tookWorkers', player: owner.id, workers, silverlings },
    ],
  }
}

function applyBuyTile(
  config: RulesetConfig,
  state: GameState,
  move: Extract<Move, { kind: 'buyTile' }>,
): ApplyResult {
  const player = currentPlayer(state)
  if (state.purchasedThisTurn) throw new Error('本回合已经购买过了（每回合限一次）')
  if (player.silverlings < 2) throw new Error('银币不足 2 枚，无法购买')

  let tile: HexTile | undefined
  let s = state

  // 先把来源取成 const：TypeScript 不会在回调里保留对参数属性的类型收窄
  const source = move.source

  if (source.kind === 'black') {
    const found = state.blackDepot.find((candidate) => candidate.id === source.tileId)
    if (found === undefined) throw new Error('黑洞里没有这枚板块')
    tile = found
    s = { ...s, blackDepot: s.blackDepot.filter((candidate) => candidate.id !== found.id) }
  } else {
    const slot = activeSlots(config.gameBoard, state.playerCount).find(
      (candidate) => candidate.id === source.slotId,
    )
    if (slot === undefined) throw new Error(`找不到编号仓库格位 ${source.slotId}`)
    const found = state.depotSlots[slot.id] ?? null
    if (found === null) throw new Error(`编号仓库格位 ${slot.id} 是空的`)
    tile = found
    s = { ...s, depotSlots: { ...s.depotSlots, [slot.id]: null } }
  }

  const paid: GameState = {
    ...s,
    purchasedThisTurn: true,
    players: s.players.map((p) => (p.id === player.id ? { ...p, silverlings: p.silverlings - 2 } : p)),
  }
  const put = putTileIntoStorage(paid, tile, move.discardStorageIndex)

  return {
    state: put.state,
    events: [
      { kind: 'boughtTile', player: player.id, tileId: tile.id, color: tile.color },
      ...put.events,
    ],
  }
}

/**
 * 结束回合。
 *
 * 之所以是显式动作：官方允许"在回合中任意时点"从黑洞购买，包括两个骰子行动之后。
 * 如果用完两个骰子就自动结束回合，玩家永远没机会买。
 */
function applyEndTurn(config: RulesetConfig, state: GameState): ApplyResult {
  if (state.pending.length > 0) throw new Error('还有待处理的选择没有解决')
  if (state.actionsTakenThisTurn < ACTIONS_PER_TURN) {
    throw new Error(`本回合还没用完 ${ACTIONS_PER_TURN} 个行动`)
  }
  if (state.pendingExtraActions > 0) throw new Error('还有城堡额外行动没有执行')

  const player = currentPlayer(state)
  const events: GameEvent[] = [{ kind: 'turnEnded', player: player.id }]
  const before = state
  const after = advanceTurn(state, config)

  if (after.finished) {
    events.push({ kind: 'gameFinished' })
    return { state: after, events }
  }

  if (after.phaseIndex !== before.phaseIndex) {
    const gains = after.players.map((p) => p.silverlings - (playerById(before, p.id).silverlings))
    events.push({ kind: 'phaseEnded', phase: before.phaseIndex + 1, silverlings: gains })
    events.push({ kind: 'phaseStarted', phase: after.phaseIndex + 1 })
  } else if (after.roundIndex !== before.roundIndex) {
    events.push({
      kind: 'roundStarted',
      phase: after.phaseIndex + 1,
      round: after.roundIndex + 1,
      whiteDie: after.whiteDie,
    })
  }

  for (const p of after.players) {
    const values = (after.dice[p.id] ?? []).map((die) => die.value)
    if (values.length > 0) events.push({ kind: 'rolledDice', player: p.id, values })
  }

  return { state: after, events }
}

// ---------------------------------------------------------------------------
// 待处理选择
// ---------------------------------------------------------------------------

function applyPendingMove(config: RulesetConfig, state: GameState, move: Move): ApplyResult {
  const pending = currentPending(state)
  if (pending === undefined) throw new Error('当前没有待处理的选择')

  switch (pending.kind) {
    case 'shipGoodsSpace': {
      if (move.kind !== 'resolveShipGoodsSpace') {
        throw new Error(`当前要解决的是"选择货物格"，不能执行 ${move.kind}`)
      }
      return resolveShipGoods(config, state, move.space)
    }
    case 'shipGoodsSecondSpace': {
      if (move.kind !== 'resolveShipGoodsSecondSpace') {
        throw new Error(`当前要解决的是"选择相邻货物格"，不能执行 ${move.kind}`)
      }
      if (!goodsSpaceNeighbours(pending.firstSpace).includes(move.space)) {
        throw new Error('第二格必须与第一格相邻')
      }
      return resolveShipGoods(config, state, move.space)
    }
    case 'warehouseSellGoods': {
      if (move.kind !== 'resolveWarehouseSellGoods') {
        throw new Error(`当前要解决的是"仓库卖出货物"，不能执行 ${move.kind}`)
      }
      const player = currentPlayer(state)
      const count = player.goods[String(move.goods)] ?? 0
      if (count <= 0) throw new Error(`没有 ${move.goods} 号货物可卖`)
      const s: GameState = { ...state, pending: state.pending.slice(1) }
      return sellGoodsInternal(s, player.id, move.goods, count, [])
    }
    case 'takeTileFromAnyDepot': {
      if (move.kind !== 'resolveTakeTileFromAnyDepot') {
        throw new Error(`当前要解决的是"从任意仓库取板块"，不能执行 ${move.kind}`)
      }
      return resolveTakeTileFromAnyDepot(config, state, pending.colors, move.slotId, move.discardStorageIndex)
    }
    case 'cityHallPlace': {
      if (move.kind !== 'resolveCityHallPlace') {
        throw new Error(`当前要解决的是"市政厅再放一枚"，不能执行 ${move.kind}`)
      }
      const player = currentPlayer(state)
      const problem = placementProblem(config, state, player, {
        storageIndex: move.storageIndex,
        to: move.to,
        ignoreColor: true,
        requiredNumber: pending.requiredNumber,
      })
      if (problem !== undefined) throw new Error(problem)
      const s: GameState = { ...state, pending: state.pending.slice(1) }
      const events: GameEvent[] = []
      return { state: performPlacement(config, s, move.storageIndex, move.to, events), events }
    }
  }
}

function resolveTakeTileFromAnyDepot(
  config: RulesetConfig,
  state: GameState,
  colors: readonly HexTile['color'][],
  slotId: string,
  discardStorageIndex: number | undefined,
): ApplyResult {
  const player = currentPlayer(state)
  const slot = activeSlots(config.gameBoard, state.playerCount).find((s) => s.id === slotId)
  if (slot === undefined) throw new Error(`找不到编号仓库格位 ${slotId}`)
  if (!colors.includes(slot.color)) throw new Error(`这个效果只能取 ${colors.join(' / ')} 类的板块`)

  const tile = state.depotSlots[slot.id] ?? null
  if (tile === null) throw new Error(`编号仓库格位 ${slot.id} 是空的`)

  const s: GameState = {
    ...state,
    pending: state.pending.slice(1),
    depotSlots: { ...state.depotSlots, [slot.id]: null },
  }
  const put = putTileIntoStorage(s, tile, discardStorageIndex)

  return {
    state: put.state,
    events: [
      { kind: 'tookTile', player: player.id, tileId: tile.id, color: tile.color },
      ...put.events,
    ],
  }
}
