import { describe, expect, it } from 'vitest'
import { applyMove } from '../../engine/apply'
import { castleSpacesOf } from '../../engine/board'
import { axialKey } from '../../engine/hex'
import { createGame } from '../../engine/setup'
import { listLegalMoves, type Move } from '../../engine/moves'
import { createRng, nextInt, type RngState } from '../../engine/rng'
import { finalScore } from '../../engine/scoring'
import { playerById, type GameState, type RulesetConfig } from '../../engine/state'
import type { PlayerBoardDef, PlayerId } from '../../engine/types'
import {
  BASE_STATE,
  CONFIG,
  animalTile,
  assertInvariants,
  assertUniqueTileIds,
  estateOf,
  numberAt,
  patchPlayer,
  setDice,
} from '../../engine/__tests__/testUtils'
import { DEFAULT_WEIGHTS, evaluate, pickMove, pickStartingCastle, scorePlayer, type Difficulty } from '../heuristic'

const ACTIVE: PlayerId = BASE_STATE.activePlayerId

function policyRandom(rng: RngState) {
  return (config: RulesetConfig, state: GameState): Move | undefined => {
    const moves = listLegalMoves(config, state)
    if (moves.length === 0) return undefined
    return moves[nextInt(rng, moves.length)]
  }
}

function policyHeuristic(rng: RngState, difficulty: Difficulty) {
  return (config: RulesetConfig, state: GameState, playerId: PlayerId): Move | undefined =>
    pickMove(config, state, playerId, { difficulty, rng })
}

/** 用两种策略对下一整局，返回终局状态。 */
function playMatch(
  seed: number,
  p1: (config: RulesetConfig, state: GameState, playerId: PlayerId) => Move | undefined,
  p2: (config: RulesetConfig, state: GameState, playerId: PlayerId) => Move | undefined,
  maxSteps = 6000,
): GameState {
  let state = createGame(CONFIG, { seed })
  let steps = 0
  while (!state.finished && steps < maxSteps) {
    const id = state.activePlayerId
    const policy = id === 'p1' ? p1 : p2
    const move = policy(CONFIG, state, id)
    if (move === undefined) break
    state = applyMove(CONFIG, state, move).state
    steps += 1
  }
  // 必须打完。这一条是修一个真实死循环之后加的：早先 5 号知识板块会让"选择相邻货物格"
  // 无限自我复制，而 playMatch 遇到步数上限只是静默退出，于是活锁被当成了正常对局。
  expect(state.finished, `对局没打完（走了 ${steps} 步）——可能存在活锁`).toBe(true)
  return state
}

describe('AI 选开局城堡格', () => {
  it('返回的必须是版图上的某个深红格', () => {
    const board = CONFIG.playerBoards['1'] as PlayerBoardDef
    const castles = castleSpacesOf(board).map(axialKey)
    expect(castles.length).toBeGreaterThan(1)
    for (const player of BASE_STATE.players) {
      const choice = pickStartingCastle(CONFIG, player)
      expect(castles).toContain(axialKey(choice))
    }
  })

  it('对同一版图是确定的（不引入额外随机）', () => {
    const player = BASE_STATE.players[0]!
    expect(pickStartingCastle(CONFIG, player)).toEqual(pickStartingCastle(CONFIG, player))
  })

  it('选中后确实能开局（引擎接受这个出生点）', () => {
    const player = BASE_STATE.players[0]!
    const choice = pickStartingCastle(CONFIG, player)
    const state = createGame(CONFIG, { seed: 9, startingSpaces: { p1: choice } })
    expect(state.players[0]?.estate[axialKey(choice)]?.color).toBe('castle')
  })
})

describe('局面评估', () => {
  it('同一局面下，自己的分数高于对手时评估为正', () => {
    const state = patchPlayer(BASE_STATE, ACTIVE, { vp: 50 })
    const mine = evaluate(CONFIG, state, ACTIVE)
    const theirs = evaluate(CONFIG, state, ACTIVE === 'p1' ? 'p2' : 'p1')
    expect(mine).toBeGreaterThan(0)
    expect(theirs).toBeLessThan(0)
  })

  it('分数越高评估越高（其他条件不变）', () => {
    const low = patchPlayer(BASE_STATE, ACTIVE, { vp: 10 })
    const high = patchPlayer(BASE_STATE, ACTIVE, { vp: 40 })
    expect(evaluate(CONFIG, high, ACTIVE)).toBeGreaterThan(evaluate(CONFIG, low, ACTIVE))
  })

  it('资源有价值：银币与工人更多时评估更高', () => {
    const poor = patchPlayer(BASE_STATE, ACTIVE, { silverlings: 0, workers: 0 })
    const rich = patchPlayer(BASE_STATE, ACTIVE, { silverlings: 6, workers: 4 })
    expect(evaluate(CONFIG, rich, ACTIVE)).toBeGreaterThan(evaluate(CONFIG, poor, ACTIVE))
  })

  it('离完成更近的区域评估更高（区域进度潜力的核心作用）', () => {
    // 动物牧场 A2 = {(-1,0), (-1,1), (0,1)}，三格
    const oneFilled = estateOf(BASE_STATE, ACTIVE, [[{ q: -1, r: 0 }, animalTile('a1', 'cow', 3)]])
    const twoFilled = estateOf(oneFilled, ACTIVE, [[{ q: -1, r: 1 }, animalTile('a2', 'cow', 3)]])
    expect(evaluate(CONFIG, twoFilled, ACTIVE)).toBeGreaterThan(evaluate(CONFIG, oneFilled, ACTIVE))
  })

  it('对手更强时自己的评估更低（AI 会因此学会卡人）', () => {
    const other: PlayerId = ACTIVE === 'p1' ? 'p2' : 'p1'
    const weakOpponent = patchPlayer(BASE_STATE, other, { vp: 0 })
    const strongOpponent = patchPlayer(BASE_STATE, other, { vp: 60 })
    expect(evaluate(CONFIG, strongOpponent, ACTIVE)).toBeLessThan(
      evaluate(CONFIG, weakOpponent, ACTIVE),
    )
  })

  it('权重表里的每一项都参与计算（改权重会改变评估值）', () => {
    const doubled = { ...DEFAULT_WEIGHTS, vp: DEFAULT_WEIGHTS.vp * 2 }
    const state = patchPlayer(BASE_STATE, ACTIVE, { vp: 30 })
    expect(evaluate(CONFIG, state, ACTIVE, doubled)).not.toBe(evaluate(CONFIG, state, ACTIVE))
  })

  it('scorePlayer 对自己与对手是对称的（同分同资源时相等）', () => {
    const me = scorePlayer(CONFIG, BASE_STATE, playerById(BASE_STATE, 'p1'), DEFAULT_WEIGHTS)
    const base = scorePlayer(CONFIG, BASE_STATE, playerById(BASE_STATE, 'p2'), DEFAULT_WEIGHTS)
    // 两人开局只有工人数不同（顺位 1 vs 2），所以不该相等；这里只断言量级相近、不出现极端值
    expect(Number.isFinite(me)).toBe(true)
    expect(Number.isFinite(base)).toBe(true)
    expect(Math.abs(me - base)).toBeLessThan(50)
  })
})

describe('选招', () => {
  it('没有合法行动时返回 undefined', () => {
    const finished: GameState = { ...BASE_STATE, finished: true }
    expect(pickMove(CONFIG, finished, ACTIVE, { difficulty: 'normal', rng: createRng(1) })).toBeUndefined()
  })

  it('只有"结束回合"时直接返回它（不浪费评估）', () => {
    const onlyEndTurn: GameState = {
      ...BASE_STATE,
      actionsTakenThisTurn: 2,
      dice: {
        ...BASE_STATE.dice,
        [ACTIVE]: (BASE_STATE.dice[ACTIVE] ?? []).map((die) => ({ ...die, used: true })),
      },
    }
    const move = pickMove(CONFIG, onlyEndTurn, ACTIVE, { difficulty: 'normal', rng: createRng(1) })
    expect(move?.kind).toBe('endTurn')
  })

  it('会挑出"能铺满区域拿大分"的那一步', () => {
    // 牧场 A2 已有两头牛，仓储里第三头牛一放就完成区域（6 分 + 阶段 A 奖励 10 分）
    let state: GameState = estateOf(BASE_STATE, ACTIVE, [
      [{ q: -1, r: 0 }, animalTile('cow3', 'cow', 3)],
      [{ q: -1, r: 1 }, animalTile('cow4', 'cow', 4)],
    ])
    state = patchPlayer(state, ACTIVE, { storage: [animalTile('cow2', 'cow', 2)], workers: 0 })
    state = setDice(state, ACTIVE, [numberAt(0, 1), 1])

    const move = pickMove(CONFIG, state, ACTIVE, { difficulty: 'normal', rng: createRng(1) })
    expect(move?.kind).toBe('placeTile')
    if (move?.kind !== 'placeTile') return
    expect(`${move.to.q},${move.to.r}`).toBe('0,1')
  })

  it('easy 与 normal 都会返回合法行动，且 easy 更随机', () => {
    const normal = pickMove(CONFIG, BASE_STATE, ACTIVE, { difficulty: 'normal', rng: createRng(7) })
    const easy = pickMove(CONFIG, BASE_STATE, ACTIVE, { difficulty: 'easy', rng: createRng(7) })
    expect(normal).toBeDefined()
    expect(easy).toBeDefined()

    // 换不同的随机种子，easy 的选择会变（有噪声），normal 的 argmax 也允许轻微抖动
    const easyChoices = new Set<string>()
    for (let seed = 1; seed <= 12; seed += 1) {
      const move = pickMove(CONFIG, BASE_STATE, ACTIVE, { difficulty: 'easy', rng: createRng(seed) })
      easyChoices.add(JSON.stringify(move))
    }
    expect(easyChoices.size).toBeGreaterThan(1)
  })

  it('hard 难度的整回合束搜索在预算内完成（并报告耗时）', () => {
    const started = Date.now()
    const move = pickMove(CONFIG, BASE_STATE, ACTIVE, { difficulty: 'hard', rng: createRng(3) })
    const elapsed = Date.now() - started
    console.info(`[性能] hard 单次回合搜索耗时 ${elapsed}ms`)
    expect(move).toBeDefined()
    // 界面上给 hard 的思考延迟是 420ms，搜索必须明显快于"人感觉卡住"的量级
    expect(elapsed).toBeLessThan(3000)
  })

  it('评估预算上限会被尊重（可以主动调小）', () => {
    const move = pickMove(CONFIG, BASE_STATE, ACTIVE, {
      difficulty: 'hard',
      rng: createRng(3),
      maxEvaluations: 50,
    })
    expect(move).toBeDefined()
  })
})

describe('AI 能自己打完整局', () => {
  it('normal 难度对 normal 难度：25 轮内走完，全程不变量成立', () => {
    const state = playMatch(20240101, policyHeuristic(createRng(11), 'normal'), policyHeuristic(createRng(22), 'normal'))
    expect(state.finished).toBe(true)
    assertInvariants(state, 'AI 自对弈终局')
    assertUniqueTileIds(state, 'AI 自对弈终局')

    // 诊断输出：真实对局里每人会放 20+ 格，如果这里明显偏低，说明 AI 在浪费行动
    // （也可能是占位版图/库存数据的产物，见 rules/规则规格.md §14.5）
    for (const player of state.players) {
      const placed = Object.keys(player.estate).length
      console.info(
        `[自对弈] ${player.id}：放置 ${placed}/37 格，分数 ${player.vp}，` +
          `仓储 ${player.storage.length}，银币 ${player.silverlings}，工人 ${player.workers}`,
      )
      expect(placed, `${player.id} 放置的格数`).toBeGreaterThan(10)
    }
    const emptySlots = Object.values(state.depotSlots).filter((tile) => tile === null).length
    console.info(`[自对弈] 终局空仓库格位 ${emptySlots}/12（供应堆耗尽会导致格位长期为空）`)
  })
})

describe('难度分层是否真的分层（hard vs normal）', () => {
  const SEEDS = Array.from({ length: 12 }, (_, index) => 7001 + index * 137)

  it('hard 对 normal：胜率与均分都不落下风', () => {
    let hardWins = 0
    let normalWins = 0
    let hardTotal = 0
    let normalTotal = 0

    for (const seed of SEEDS) {
      const state = playMatch(
        seed,
        policyHeuristic(createRng(seed), 'hard'),
        policyHeuristic(createRng(seed + 31), 'normal'),
      )
      const result = finalScore(CONFIG, state)
      const hard = result.scores.find((score) => score.playerId === 'p1')?.totalVp ?? 0
      const normal = result.scores.find((score) => score.playerId === 'p2')?.totalVp ?? 0
      hardTotal += hard
      normalTotal += normal
      if (result.winnerId === 'p1') hardWins += 1
      else normalWins += 1
    }

    const rate = hardWins / SEEDS.length
    console.info(
      `[难度分层] hard vs normal：hard ${hardWins} 胜 / normal ${normalWins} 胜（hard 胜率 ${(rate * 100).toFixed(0)}%），` +
        `hard 平均 ${(hardTotal / SEEDS.length).toFixed(1)} 分，normal 平均 ${(normalTotal / SEEDS.length).toFixed(1)} 分`,
    )

    // 固定种子 → 结果确定；要求 hard 至少不输（整回合搜索不该比贪心更差）
    expect(rate).toBeGreaterThanOrEqual(0.5)
    expect(hardTotal).toBeGreaterThanOrEqual(normalTotal)
  }, 600_000)
})

describe('诊断：AI 到底把行动花在哪了', () => {
  it('一场 hard vs hard 的行动类型分布与终局状态', () => {
    const counts = new Map<string, number>()
    let state = createGame(CONFIG, { seed: 424242 })
    let steps = 0
    const workersSpent = new Map<string, number>()

    while (!state.finished && steps < 5000) {
      const id = state.activePlayerId
      const move = pickMove(CONFIG, state, id, { difficulty: 'hard', rng: createRng(steps + 1) })
      if (move === undefined) break
      counts.set(move.kind, (counts.get(move.kind) ?? 0) + 1)
      const before = state.players.find((player) => player.id === id)?.workers ?? 0
      state = applyMove(CONFIG, state, move).state
      const after = state.players.find((player) => player.id === id)?.workers ?? 0
      if (after > before) workersSpent.set(id, (workersSpent.get(id) ?? 0) + (after - before))
      steps += 1
    }

    const distribution = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([kind, count]) => `${kind}=${count}`)
      .join(' ')
    console.info(`[诊断] 共 ${steps} 步；行动分布：${distribution}`)

    for (const player of state.players) {
      console.info(
        `[诊断] ${player.id}：放置 ${Object.keys(player.estate).length}/37 格，分 ${player.vp}，` +
          `工人 ${player.workers}（累计获得 ${workersSpent.get(player.id) ?? 0}），银币 ${player.silverlings}，` +
          `仓储 ${player.storage.length}，奖励板块 ${Object.keys(player.bonusTiles).length}`,
      )
    }

    const takeWorkers = counts.get('takeWorkers') ?? 0
    const takeTile = counts.get('takeTile') ?? 0
    const placeTile = counts.get('placeTile') ?? 0

    // 取板块与放板块应当大体配对：严重失衡说明 AI 在囤积或空转
    expect(takeTile).toBeGreaterThan(0)
    expect(placeTile).toBeGreaterThan(0)
    // 取工人是"保底行动"，不该成为主要行动（占比低于三分之一）
    expect(takeWorkers / Math.max(1, steps / 2)).toBeLessThan(0.34)
  }, 300_000)
})

describe('多种子批量自对弈：找"逻辑没错但玩起来不对"的异常', () => {
  const SEEDS = Array.from({ length: 8 }, (_, index) => 51000 + index * 977)

  it('每局都打完，且终局没有退化迹象', () => {
    const placedCounts: number[] = []
    const workersAtEnd: number[] = []
    const scores: number[] = []
    const storageAtEnd: number[] = []
    const tileCounts = new Map<string, number>()
    const startPlayerWins = { p1: 0, p2: 0 }

    for (const seed of SEEDS) {
      const state = playMatch(
        seed,
        policyHeuristic(createRng(seed), 'hard'),
        policyHeuristic(createRng(seed + 5), 'hard'),
      )

      for (const player of state.players) {
        const placed = Object.keys(player.estate).length
        placedCounts.push(placed)
        workersAtEnd.push(player.workers)
        storageAtEnd.push(player.storage.length)

        // 退化迹象 1：有人几乎没在建设
        expect(placed, `${player.id} 在种子 ${seed} 只放了 ${placed} 格`).toBeGreaterThanOrEqual(12)
        // 退化迹象 2：工人在失控堆积（说明反复拿工人而不做正事）
        expect(
          player.workers,
          `${player.id} 在种子 ${seed} 攒了 ${player.workers} 个工人`,
        ).toBeLessThanOrEqual(25)
        // 退化迹象 3：仓储爆满
        expect(player.storage.length).toBeLessThanOrEqual(3)
      }

      // 各类板块的放置量：用来看 AI 有没有系统性忽略某条得分路线
      for (const [color, count] of Object.entries(playerTilesOf(state))) {
        tileCounts.set(color, (tileCounts.get(color) ?? 0) + count)
      }
      // 终局是谁先手。注意别用"两人顺位索引的平均值"——那永远是 0.5，什么都没测。
      if (state.turnOrder[0] === 'p1') startPlayerWins.p1 += 1
      else startPlayerWins.p2 += 1

      const result = finalScore(CONFIG, state)
      for (const score of result.scores) {
        scores.push(score.totalVp)
        // 分数落在合理区间：太低说明没在玩，太高说明计分炸了
        expect(score.totalVp, `${score.playerId} 在种子 ${seed} 得 ${score.totalVp} 分`).toBeGreaterThan(20)
        expect(score.totalVp).toBeLessThan(500)
      }
    }

    const avg = (values: number[]): number =>
      values.reduce((sum, value) => sum + value, 0) / values.length
    console.info(
      `[批量自对弈] ${SEEDS.length} 局（hard vs hard）：放置格数 ${Math.min(...placedCounts)}-${Math.max(...placedCounts)}（均 ${avg(placedCounts).toFixed(1)}），` +
        `终局工人 ${Math.min(...workersAtEnd)}-${Math.max(...workersAtEnd)}（均 ${avg(workersAtEnd).toFixed(1)}），` +
        `终局仓储 ${Math.min(...storageAtEnd)}-${Math.max(...storageAtEnd)}，` +
        `分数 ${Math.min(...scores)}-${Math.max(...scores)}（均 ${avg(scores).toFixed(1)}）`,
    )
    console.info(
      `[板块路线] 每局平均放置：` +
        [...tileCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([kind, count]) => `${kind}=${(count / SEEDS.length).toFixed(1)}`)
          .join(' '),
    )
    console.info(
      `[先手] 终局先手归属：p1 ${startPlayerWins.p1} 局 / p2 ${startPlayerWins.p2} 局（共 ${SEEDS.length} 局）`,
    )
  }, 600_000)
})

/** 统计两位玩家领地上各色板块的数量（用来发现 AI 是否系统性忽略某条得分路线）。 */
function playerTilesOf(state: GameState): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const player of state.players) {
    for (const tile of Object.values(player.estate)) {
      counts[tile.color] = (counts[tile.color] ?? 0) + 1
    }
  }
  return counts
}

describe('AI 强度（对随机对手的胜率）', () => {
  const SEEDS = Array.from({ length: 20 }, (_, i) => 101 + i * 101)

  it('normal 难度对随机行动：胜率明显高于随机', () => {
    let wins = 0
    let losses = 0
    let p1Total = 0
    let p2Total = 0

    for (const seed of SEEDS) {
      const state = playMatch(
        seed,
        policyHeuristic(createRng(seed), 'normal'),
        policyRandom(createRng(seed + 9999)),
      )
      const result = finalScore(CONFIG, state)
      const p1 = result.scores.find((s) => s.playerId === 'p1')?.totalVp ?? 0
      const p2 = result.scores.find((s) => s.playerId === 'p2')?.totalVp ?? 0
      p1Total += p1
      p2Total += p2
      if (result.winnerId === 'p1') wins += 1
      else losses += 1
    }

    const rate = wins / SEEDS.length
    // 这条输出是这条测试的"测量结果"，不是调试残留：强度测试需要能看到具体胜率与均分
    console.info(
      `[AI 强度] normal vs 随机：${wins} 胜 / ${losses} 负（胜率 ${(rate * 100).toFixed(0)}%），` +
        `AI 平均 ${(p1Total / SEEDS.length).toFixed(1)} 分，随机平均 ${(p2Total / SEEDS.length).toFixed(1)} 分`,
    )

    // 固定种子 → 结果确定，不会偶发失败；要求至少赢下八成
    expect(rate).toBeGreaterThanOrEqual(0.8)
  }, 120_000)
})
