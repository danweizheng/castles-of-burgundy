import { beforeEach, describe, expect, it } from 'vitest'
import { opponentMove } from '../../ai/opponentMove'
import { applyMove } from '../../engine/apply'
import { moveKey, type Move } from '../../engine/moves'
import { useGameStore } from '../gameStore'

/**
 * 陈旧动作守卫。
 *
 * 场景：按钮持有的是**渲染那一刻**算出来的动作。手机上的快速连点，
 * 或者 React 还没来得及重渲染就再次触发，都会送来一个此刻已不合法的动作。
 * 直接交给 applyMove 会抛异常，而异常发生在 React 事件处理器里 ——
 * 没有错误边界时就是白屏（错误边界本身也是这一轮加的）。
 */

function startDeterministicGame(seed = 20240101): void {
  useGameStore.getState().newGame(seed)
  const afterNew = useGameStore.getState()
  const board = afterNew.config.playerBoards[afterNew.state.players[0]!.boardId]!
  afterNew.chooseStartingCastle(board.startingSpace)

  useGameStore.setState((current) => {
    const human = current.humanPlayerId
    const others = current.state.turnOrder.filter((id) => id !== human)
    return {
      autoOpponent: false,
      state: {
        ...current.state,
        activePlayerId: human,
        startPlayerId: human,
        turnIndex: 0,
        turnOrder: [human, ...others],
      },
    }
  })
}

function usedDiceCount(): number {
  const snapshot = useGameStore.getState()
  return (snapshot.state.dice[snapshot.humanPlayerId] ?? []).filter((die) => die.used).length
}

describe('动作标识 moveKey', () => {
  it('结构相同即相同，与键的书写顺序无关', () => {
    expect(moveKey({ kind: 'takeWorkers', die: { kind: 'die', index: 0 } })).toBe(
      moveKey({ die: { kind: 'die', index: 0 }, kind: 'takeWorkers' }),
    )
  })

  it('骰子序号不同视为不同动作', () => {
    expect(moveKey({ kind: 'takeWorkers', die: { kind: 'die', index: 0 } })).not.toBe(
      moveKey({ kind: 'takeWorkers', die: { kind: 'die', index: 1 } }),
    )
  })

  it('可选字段"缺席"与"存在"必须区分（否则弃牌与不弃牌会被当成同一个动作）', () => {
    const without: Move = { kind: 'takeTile', die: { kind: 'die', index: 0 }, slotId: 'a' }
    const withDiscard: Move = {
      kind: 'takeTile',
      die: { kind: 'die', index: 0 },
      slotId: 'a',
      discardStorageIndex: 0,
    }
    expect(moveKey(without)).not.toBe(moveKey(withDiscard))
  })

  it('目标格位不同视为不同动作', () => {
    expect(
      moveKey({ kind: 'placeTile', die: { kind: 'die', index: 0 }, storageIndex: 0, to: { q: 0, r: 0 } }),
    ).not.toBe(
      moveKey({ kind: 'placeTile', die: { kind: 'die', index: 0 }, storageIndex: 0, to: { q: 1, r: 0 } }),
    )
  })
})

describe('立刻落盘（页面被隐藏时必须写到盘上）', () => {
  beforeEach(() => {
    startDeterministicGame()
    useGameStore.setState({ lastSavedAt: null })
  })

  it('前提校验：防抖窗口内确实还没有落盘 —— 否则"立刻落盘"就没有意义', () => {
    // 新局与选出生点都会 scheduleSave，但 400ms 内不该写完
    expect(useGameStore.getState().lastSavedAt).toBeNull()
  })

  it('saveNow 会立刻写完并记下时间', async () => {
    await useGameStore.getState().saveNow()
    expect(useGameStore.getState().lastSavedAt).not.toBeNull()
    expect(useGameStore.getState().saveError).toBeNull()
  })

  it('saveNow 之后即使再等到防抖时间过去，也不会出错或清掉结果', async () => {
    await useGameStore.getState().saveNow()
    const savedAt = useGameStore.getState().lastSavedAt
    await new Promise((resolve) => setTimeout(resolve, 500))
    // 取消掉的防抖任务不该再写一次（写一次会刷新时间戳，这里是"没有被覆盖"的弱断言，
    // 更强的"写了几次"需要注入可计数的存储，当前存储是模块内部件，不做过度设计）
    expect(useGameStore.getState().lastSavedAt).not.toBeNull()
    expect(useGameStore.getState().saveError).toBeNull()
    expect(savedAt).not.toBeNull()
  })

  it('把局面改掉之后立刻落盘，写的是新局面的时间戳（不是沿用旧的）', async () => {
    await useGameStore.getState().saveNow()
    const first = useGameStore.getState().lastSavedAt
    await new Promise((resolve) => setTimeout(resolve, 5))
    const store = useGameStore.getState()
    const move = store.moves.find((candidate) => candidate.kind === 'takeWorkers')!
    store.play(move)
    useGameStore.setState({ lastSavedAt: null })
    await useGameStore.getState().saveNow()
    expect(useGameStore.getState().lastSavedAt).not.toBeNull()
    expect(first).not.toBeNull()
  })
})

describe('撤销要跳过对手的回合', () => {
  beforeEach(() => {
    startDeterministicGame()
  })

  /** 让人类用完两颗骰子并结束回合，把控制权交给对手。 */
  function handOverToOpponent(): void {
    const store = useGameStore.getState()
    const human = store.humanPlayerId
    for (const die of [0, 1]) {
      const move = useGameStore
        .getState()
        .moves.find(
          (candidate) =>
            candidate.kind === 'takeWorkers' &&
            candidate.die.kind === 'die' &&
            candidate.die.index === die,
        )
      expect(move, `找不第 ${die} 颗骰子的取工人动作`).toBeDefined()
      useGameStore.getState().play(move!)
    }
    const endTurn = useGameStore.getState().moves.find((move) => move.kind === 'endTurn')
    expect(endTurn, '用完两颗骰子后应当能结束回合').toBeDefined()
    useGameStore.getState().play(endTurn!)
    expect(useGameStore.getState().state.activePlayerId).not.toBe(human)
  }

  it('前提：对手走过一步之后，只回退一步会落在"轮到对手"的局面上', () => {
    // 这正是缺陷的成因：自动对手会在轮到它时立刻重走，玩家看到的是"撤销没反应"。
    handOverToOpponent()
    const store = useGameStore.getState()
    const aiMove = opponentMove(store.config, store.state, 'normal')
    expect(aiMove).toBeDefined()
    store.play(aiMove!)

    const beforeUndo = useGameStore.getState().past
    // 「只回退一步会落到哪」看的是**最后一份**快照：撤销就是把它恢复成当前局面
    const lastSnapshot = beforeUndo[beforeUndo.length - 1]
    expect(lastSnapshot).toBeDefined()
    expect(lastSnapshot!.state.activePlayerId).not.toBe(useGameStore.getState().humanPlayerId)
  })

  it('撤销会跳过对手的动作，直接回到人类自己上一次决定的时刻', () => {
    handOverToOpponent()
    const store = useGameStore.getState()
    const human = store.humanPlayerId
    store.play(opponentMove(store.config, store.state, 'normal')!)

    // 对手已经动过，局面不该轮到人类
    expect(useGameStore.getState().state.activePlayerId).not.toBe(human)

    useGameStore.getState().undo()

    const after = useGameStore.getState().state
    // 关键：撤销之后必须轮到人类，否则自动对手会立刻重走、玩家会觉得撤销没反应
    expect(after.activePlayerId).toBe(human)
    // 而且回到的是"用完两颗骰子"的那个点（人类自己的上一次决定）
    expect(after.actionsTakenThisTurn).toBe(2)
    expect(useGameStore.getState().past.every((snapshot) => snapshot.state.activePlayerId === human)).toBe(
      true,
    )
  })

  it('连续撤销可以一步步收回自己的每个决定，且始终停在人类的回合', () => {
    handOverToOpponent()
    const store = useGameStore.getState()
    const human = store.humanPlayerId
    store.play(opponentMove(store.config, store.state, 'normal')!)

    const actionCounts: number[] = []
    for (let step = 0; step < 6; step += 1) {
      if (useGameStore.getState().past.length === 0) break
      useGameStore.getState().undo()
      const state = useGameStore.getState().state
      expect(state.activePlayerId).toBe(human)
      actionCounts.push(state.actionsTakenThisTurn)
    }

    // 应当能一路退回开局（已用行动数递减到 0）
    expect(actionCounts.length).toBeGreaterThanOrEqual(2)
    expect(actionCounts[actionCounts.length - 1]).toBe(0)
  })

  it('没有任何对手动作时，撤销仍然只退一步（原有行为不变）', () => {
    const store = useGameStore.getState()
    const move = store.moves.find((candidate) => candidate.kind === 'takeWorkers')!
    store.play(move)
    expect(usedDiceCount()).toBe(1)

    useGameStore.getState().undo()
    expect(usedDiceCount()).toBe(0)
  })
})

describe('终局之后的交互', () => {
  beforeEach(() => {
    startDeterministicGame()
  })

  /** 用对手决策把一局打完（两边都由同一个策略驱动，直到结束）。 */
  function playToEnd(maxMoves = 400): void {
    for (let step = 0; step < maxMoves; step += 1) {
      const store = useGameStore.getState()
      if (store.state.finished) return
      const move = opponentMove(store.config, store.state, 'normal')
      if (move === undefined) return
      store.play(move)
    }
  }

  it('打完一局之后：没有合法动作、分数固定、任何动作都被忽略', () => {
    playToEnd()
    const finished = useGameStore.getState()
    expect(finished.state.finished, '这局没打完，后面的断言就不成立').toBe(true)
    expect(finished.moves).toEqual([])

    const vpBefore = finished.state.players.map((player) => player.vp)
    const stateBefore = finished.state

    // 终局后无论提交什么（含结束回合），都必须被忽略
    for (const move of [{ kind: 'endTurn' } as const, { kind: 'takeWorkers', die: { kind: 'die', index: 0 } } as const]) {
      expect(() => useGameStore.getState().play(move)).not.toThrow()
    }
    expect(useGameStore.getState().state).toBe(stateBefore)
    expect(useGameStore.getState().state.players.map((player) => player.vp)).toEqual(vpBefore)
  })

  it('引擎在终局时会拒绝执行动作（三层防护里最深的一层）', () => {
    playToEnd()
    const store = useGameStore.getState()
    expect(() =>
      applyMove(store.config, store.state, { kind: 'endTurn' }),
    ).toThrow(/已经结束/)
  })

  it('终局之后仍然可以撤销，把最后一手收回来', () => {
    playToEnd()
    const before = useGameStore.getState().state
    expect(before.finished).toBe(true)

    useGameStore.getState().undo()

    const after = useGameStore.getState().state
    // 撤销会跳过对手的快照，所以收回的是人类自己最后那一手
    expect(after.finished).toBe(false)
    expect(after.activePlayerId).toBe(useGameStore.getState().humanPlayerId)
    // 撤销之后又能继续走：合法动作列表不为空
    expect(useGameStore.getState().moves.length).toBeGreaterThan(0)
  })
})

describe('守卫的前提：陈旧动作直接交给引擎会怎样', () => {
  beforeEach(() => {
    startDeterministicGame()
  })

  it('同一个骰子动作第二次直接交给 applyMove 会抛异常 —— 这正是需要守卫的原因', () => {
    const store = useGameStore.getState()
    const move = store.moves.find((candidate) => candidate.kind === 'takeWorkers')!
    const once = applyMove(store.config, store.state, move)

    // 如果没有守卫，这个异常会发生在 React 事件处理器里
    expect(() => applyMove(store.config, once.state, move)).toThrow()
  })
})

describe('play 对陈旧动作的处理', () => {
  beforeEach(() => {
    startDeterministicGame()
  })

  it('同一个动作重复提交：第二次被忽略，不多花骰子、也不多一条撤销记录', () => {
    const store = useGameStore.getState()
    const move = store.moves.find((candidate) => candidate.kind === 'takeWorkers')
    expect(move).toBeDefined()

    store.play(move!)
    const stateAfterFirst = useGameStore.getState().state
    const diceAfterFirst = usedDiceCount()
    const undoDepthAfterFirst = useGameStore.getState().past.length

    // 模拟连点：同一个（此刻已不合法的）动作再提交一次
    expect(() => useGameStore.getState().play(move!)).not.toThrow()

    expect(useGameStore.getState().state).toBe(stateAfterFirst)
    expect(usedDiceCount()).toBe(diceAfterFirst)
    expect(useGameStore.getState().past).toHaveLength(undoDepthAfterFirst)
  })

  it('完全不合法的动作被忽略，且不会抛到调用方（事件处理器）', () => {
    const bogus: Move = { kind: 'resolveWarehouseSellGoods', goods: 1 }
    // 先确认它此刻真的不合法，否则这条测试就没有意义
    expect(useGameStore.getState().moves.some((move) => moveKey(move) === moveKey(bogus))).toBe(false)

    const before = useGameStore.getState().state
    expect(() => useGameStore.getState().play(bogus)).not.toThrow()
    expect(useGameStore.getState().state).toBe(before)
  })

  it('篡改过的动作（合法但字段被动过）同样被忽略', () => {
    const store = useGameStore.getState()
    const real = store.moves.find((candidate) => candidate.kind === 'takeTile')
    expect(real).toBeDefined()
    const tampered: Move = { ...(real as Extract<Move, { kind: 'takeTile' }>), slotId: '根本不存在的格位' }

    const before = useGameStore.getState().state
    expect(() => useGameStore.getState().play(tampered)).not.toThrow()
    expect(useGameStore.getState().state).toBe(before)
  })

  it('合法动作照常生效（守卫不能把关卡设得太严）', () => {
    const store = useGameStore.getState()
    const move = store.moves.find((candidate) => candidate.kind === 'takeWorkers')
    const before = usedDiceCount()
    store.play(move!)
    expect(usedDiceCount()).toBe(before + 1)
  })

  it('撤销之后，同一个动作又能重新提交（守卫看的是当前局面，不是历史）', () => {
    const store = useGameStore.getState()
    const move = store.moves.find((candidate) => candidate.kind === 'takeWorkers')!
    store.play(move)
    expect(usedDiceCount()).toBe(1)

    useGameStore.getState().undo()
    expect(usedDiceCount()).toBe(0)

    // 撤销后同一个动作重新合法：这时连点不该被误挡
    expect(() => useGameStore.getState().play(move)).not.toThrow()
    expect(usedDiceCount()).toBe(1)
  })
})
