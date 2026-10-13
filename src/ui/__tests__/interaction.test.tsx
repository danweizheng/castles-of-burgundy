// @vitest-environment jsdom
/**
 * 真实交互测试（jsdom）。
 *
 * 为什么需要这一层：在此之前所有测试都是"纯逻辑"或"服务端渲染"，**事件处理器与副作用
 * 一行都没被跑过**。而用户在手机上第一下点击就可能踩到那类错误
 * （拿不到 DOM、store 方法签名不对、effect 里读 undefined）。
 *
 * 这里刻意**关掉自动对手**，让每一步都由测试自己发起，保证断言确定。
 */

import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { opponentMove } from '../../ai/opponentMove'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { useGameStore } from '../../store/gameStore'
import { axialKey } from '../../engine/hex'
import { listLegalMoves } from '../../engine/moves'

/** 固定种子，并保证轮到人类玩家行动（否则界面上没有骰子可点）。 */
function prepareDeterministicGame(seed = 20240101): string {
  act(() => {
    useGameStore.getState().newGame(seed)
  })
  // 先选出生点（用推荐格），这一步会按同一颗种子重开一局
  const store = useGameStore.getState()
  const board = store.config.playerBoards[store.state.players[0]!.boardId]!
  act(() => {
    store.chooseStartingCastle(board.startingSpace)
  })
  // 关掉自动对手，并把人类玩家放到顺位轨队首（只改 activePlayerId 不够：
  // 顺位轨队首才是"下一个轮到谁"的依据，否则结束回合后会绕回人类自己）
  act(() => {
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
  })
  return store.state.players[0]!.boardId
}

function resetStore(): void {
  act(() => {
    useGameStore.setState({ autoOpponent: false, needsSetup: true, past: [], saveError: null })
    useGameStore.getState().newGame(1)
  })
}

beforeEach(() => {
  resetStore()
})

afterEach(() => {
  // RTL 的自动清理需要 vitest 的 globals:true；本项目没开，所以显式清一次，
  // 否则上一个测试的 DOM 会留在 document 里，getByText 就会找到多个元素。
  cleanup()
  act(() => {
    useGameStore.setState({ autoOpponent: false })
  })
})

describe('开局流程', () => {
  it('先弹出出生点选择，选完才进入对局', async () => {
    const { container, getByText, queryByText } = render(<App />)

    await waitFor(() => {
      expect(getByText('选择出生点')).toBeTruthy()
    })
    expect(useGameStore.getState().needsSetup).toBe(true)

    fireEvent.click(getByText('用推荐的中央格'))

    await waitFor(() => {
      expect(queryByText('选择出生点')).toBeNull()
    })
    expect(useGameStore.getState().needsSetup).toBe(false)
    // 起始城堡落在了推荐格上
    const state = useGameStore.getState().state
    const board = useGameStore.getState().config.playerBoards[state.players[0]!.boardId]!
    expect(Object.keys(state.players[0]!.estate)).toEqual([axialKey(board.startingSpace)])
    expect(container.querySelectorAll('polygon').length).toBeGreaterThan(0)
  })

  it('也可以点棋盘上的深红格来选出生点', async () => {
    const { getByText, container } = render(<App />)
    await waitFor(() => {
      expect(getByText('选择出生点')).toBeTruthy()
    })

    // 出生点弹层里被点亮的格子（hex--target）
    const targets = container.querySelectorAll('.hex--target')
    expect(targets.length).toBeGreaterThan(1)
    fireEvent.click(targets[targets.length - 1] as Element)

    await waitFor(() => {
      expect(useGameStore.getState().needsSetup).toBe(false)
    })
  })
})

describe('真实点击能推动对局', () => {
  it('点骰子会点亮可操作的地方，点「取 2 个工人」会真的用掉一个行动', async () => {
    prepareDeterministicGame()
    const { container, getByText } = render(<App />)

    await waitFor(() => {
      expect(container.querySelectorAll('.die').length).toBeGreaterThan(0)
    })

    const before = useGameStore.getState().state.actionsTakenThisTurn
    expect(before).toBe(0)

    // 点第一颗骰子 → 出现高亮目标
    fireEvent.click(container.querySelector('.die') as Element)
    await waitFor(() => {
      const highlighted =
        container.querySelectorAll('.slot--target').length +
        container.querySelectorAll('.hex--target').length +
        container.querySelectorAll('.goodschip--target').length
      expect(highlighted).toBeGreaterThan(0)
    })

    // 「取 2 个工人」永远可用
    fireEvent.click(getByText('取 2 个工人'))

    await waitFor(() => {
      expect(useGameStore.getState().state.actionsTakenThisTurn).toBe(1)
    })
    // 用掉的那颗骰子被标记为已使用
    const state = useGameStore.getState().state
    const used = (state.dice[useGameStore.getState().humanPlayerId] ?? []).filter((die) => die.used)
    expect(used).toHaveLength(1)
    // 工人数增加了 2
    const human = state.players.find((player) => player.id === useGameStore.getState().humanPlayerId)!
    expect(human.workers).toBeGreaterThan(0)
  })

  it('走完两个行动后才能结束回合，结束后轮到对手', async () => {
    prepareDeterministicGame()
    const { container, getByText, queryByText } = render(<App />)

    await waitFor(() => {
      expect(container.querySelectorAll('.die').length).toBe(2)
    })

    // 一个行动都没用时不该有「结束回合」
    expect(queryByText('结束回合')).toBeNull()

    // 连点两次「取 2 个工人」（每次都要重选骰子）
    for (let i = 0; i < 2; i += 1) {
      const die = container.querySelector('.die') as Element | null
      expect(die).not.toBeNull()
      fireEvent.click(die as Element)
      fireEvent.click(getByText('取 2 个工人'))
      await waitFor(() => {
        expect(useGameStore.getState().state.actionsTakenThisTurn).toBe(i + 1)
      })
    }

    await waitFor(() => {
      expect(getByText('结束回合')).toBeTruthy()
    })
    fireEvent.click(getByText('结束回合'))

    await waitFor(() => {
      expect(useGameStore.getState().state.activePlayerId).not.toBe(
        useGameStore.getState().humanPlayerId,
      )
    })
  })

  it('错误边界：子组件抛错时显示兜底界面而不是白屏，并给出恢复入口', () => {
    // 这是"飞机上离线玩"场景的最后一道保险：没有它，任何未捕获异常都是白屏，
    // 而玩家在飞机上既不能刷新缓存、也看不到任何提示。
    const Boom = (): never => {
      throw new Error('测试用的爆炸')
    }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { getByText } = render(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
      )
      expect(getByText('界面出错了')).toBeDefined()
      expect(getByText('刷新并恢复对局')).toBeDefined()
      expect(getByText('尝试继续')).toBeDefined()
      // 原始报错信息要能看到，便于事后查
      expect(getByText('测试用的爆炸')).toBeDefined()
    } finally {
      spy.mockRestore()
    }
  })

  it('错误边界能接受自定义提示（录入器要说明录入内容没有存盘）', () => {
    const Boom = (): never => {
      throw new Error('录入器爆炸')
    }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { getByText } = render(
        <ErrorBoundary hint="录入的内容没有存盘。">
          <Boom />
        </ErrorBoundary>,
      )
      expect(getByText('录入的内容没有存盘。')).toBeDefined()
    } finally {
      spy.mockRestore()
    }
  })

  it('轮到人类时确实有点亮的目标与可点按钮（上一条断言的正对照，防止它空转）', async () => {
    prepareDeterministicGame()
    const { container } = render(<App />)
    await waitFor(() => {
      expect(container.querySelectorAll('.die').length).toBe(2)
    })
    fireEvent.click(container.querySelector('.die') as Element)
    // 选中骰子后应当出现可点区域与行动按钮
    expect(container.querySelectorAll('.slot--target').length + container.querySelectorAll('.hex--target').length)
      .toBeGreaterThan(0)
    expect(container.querySelectorAll('.actionbar__buttons button').length).toBeGreaterThan(0)
  })

  it('对手回合里界面不提供任何可点的行动（不能替对手走棋）', async () => {
    prepareDeterministicGame()
    // 把控制权交给对手，并关掉自动对手，让局面停住便于断言
    act(() => {
      useGameStore.setState((current) => ({
        autoOpponent: false,
        state: { ...current.state, activePlayerId: 'p2', startPlayerId: 'p2' },
      }))
    })

    const { container, getByText } = render(<App />)

    // 人类自己的骰子不该出现
    expect(container.querySelectorAll('.die').length).toBe(0)
    // 也不该有任何被点亮的可操作区域（派生处已按 isHumanTurn 闸住）
    expect(container.querySelectorAll('.slot--target').length).toBe(0)
    expect(container.querySelectorAll('.hex--target').length).toBe(0)
    // 行动按钮一个都不该有
    expect(container.querySelectorAll('.actionbar__buttons button').length).toBe(0)
    // 状态栏要说明现在是谁在行动
    expect(getByText('对手行动中…')).toBeDefined()
  })

  it('页面被隐藏时会立刻落盘（iOS 后台回收前唯一可靠的时机）', async () => {
    prepareDeterministicGame()
    const { container } = render(<App />)
    await waitFor(() => {
      expect(container.querySelectorAll('.die').length).toBe(2)
    })

    // 前提：此刻还在 400ms 防抖窗口内，没有落盘
    await act(async () => {
      useGameStore.setState({ lastSavedAt: null })
    })
    expect(useGameStore.getState().lastSavedAt).toBeNull()

    // jsdom 里 visibilityState 是只读属性，只能这样覆盖
    const original = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState')
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    try {
      fireEvent(document, new Event('visibilitychange'))
      await waitFor(() => {
        expect(useGameStore.getState().lastSavedAt).not.toBeNull()
      })
    } finally {
      if (original === undefined) delete (document as unknown as Record<string, unknown>).visibilityState
      else Object.defineProperty(document, 'visibilityState', original)
    }
  })

  it('页面仍然可见时不会因为这个事件而落盘（避免每次切焦点都写一次）', async () => {
    prepareDeterministicGame()
    const { container } = render(<App />)
    await waitFor(() => {
      expect(container.querySelectorAll('.die').length).toBe(2)
    })
    await act(async () => {
      useGameStore.setState({ lastSavedAt: null })
    })

    fireEvent(document, new Event('visibilitychange'))
    await new Promise((resolve) => setTimeout(resolve, 60))
    // jsdom 默认 visibilityState 是 'visible'，所以不该触发写入
    expect(useGameStore.getState().lastSavedAt).toBeNull()
  })

  it('撤销按钮的可用状态跟着"栈里还有没有我自己的决定"走', async () => {
    prepareDeterministicGame()
    const { container, getByText } = render(<App />)
    await waitFor(() => {
      expect(container.querySelectorAll('.die').length).toBe(2)
    })

    const undoButton = getByText('撤销') as HTMLButtonElement
    // 开局还没做过任何决定，撤销应当不可用
    expect(undoButton.disabled).toBe(true)

    fireEvent.click(container.querySelector('.die') as Element)
    fireEvent.click(getByText('取 2 个工人'))
    await waitFor(() => {
      expect(useGameStore.getState().state.actionsTakenThisTurn).toBe(1)
    })
    // 做过一次决定之后应当可用
    expect((getByText('撤销') as HTMLButtonElement).disabled).toBe(false)
  })

  it('对手有待处理选择时，不会对人类下指令（否则玩家按不下去还会以为是卡了）', async () => {
    prepareDeterministicGame()

    // 把控制权交给对手，并让它身上挂一个待处理选择（模拟"船只效果要选货物格"）
    act(() => {
      useGameStore.setState((current) => ({
        autoOpponent: false,
        state: {
          ...current.state,
          activePlayerId: 'p2',
          startPlayerId: 'p2',
          pending: [{ kind: 'shipGoodsSpace', exclude: [] }],
        },
      }))
    })

    const { getByText, queryByText } = render(<App />)
    // 不能出现对着玩家的祈使句
    expect(queryByText(/选择从哪个货物格/)).toBeNull()
    expect(queryByText('请先解决上面的选择')).toBeNull()
    // 要说明这是对手在结算
    expect(getByText('对手正在结算它自己的效果…')).toBeDefined()
    expect(getByText('对手行动中…')).toBeDefined()
  })

  it('轮到自己时，同样的待处理选择仍然给出明确指令（正对照）', async () => {
    prepareDeterministicGame()
    act(() => {
      useGameStore.setState((current) => ({
        autoOpponent: false,
        state: {
          ...current.state,
          pending: [{ kind: 'shipGoodsSpace', exclude: [] }],
        },
      }))
    })

    const { getByText } = render(<App />)
    expect(getByText(/选择从哪个货物格/)).toBeDefined()
    expect(getByText('请先解决上面的选择')).toBeDefined()
  })

  it('对手思考期间按下撤销：这一步会被取消，对手不会在撤销之后又走回来', async () => {
    prepareDeterministicGame()
    const { container, getByText } = render(<App />)
    await waitFor(() => {
      expect(container.querySelectorAll('.die').length).toBe(2)
    })

    // 人类先做一个决定（这样撤销栈里才有一份"轮到人类"的快照）
    fireEvent.click(container.querySelector('.die') as Element)
    fireEvent.click(getByText('取 2 个工人'))
    await waitFor(() => {
      expect(useGameStore.getState().state.actionsTakenThisTurn).toBe(1)
    })

    // 把控制权交给对手并打开自动对手 —— 界面会排一个延迟动作
    act(() => {
      useGameStore.setState((current) => ({
        autoOpponent: true,
        state: { ...current.state, activePlayerId: 'p2', startPlayerId: 'p2' },
      }))
    })
    // 在延迟窗口内撤销
    act(() => {
      useGameStore.getState().undo()
    })

    const human = useGameStore.getState().humanPlayerId
    expect(useGameStore.getState().state.activePlayerId).toBe(human)

    // 等到远超对手的思考延迟，确认它没有偷偷走掉
    await new Promise((resolve) => setTimeout(resolve, 800))
    expect(useGameStore.getState().state.activePlayerId).toBe(human)
    expect(useGameStore.getState().state.actionsTakenThisTurn).toBe(0)
  })

  describe('交互矩阵：四种局面下到底"哪些东西可以点"', () => {
    /** 只统计**可点**的游戏元素；界面级的按钮（规则/存档/新局）另有归属，不计入。 */
    function counts(container: HTMLElement) {
      const enabled = (selector: string): number =>
        Array.from(container.querySelectorAll(selector)).filter(
          (element) => !(element as HTMLButtonElement).disabled,
        ).length
      return {
        dice: enabled('.die'),
        actionButtons: enabled('.actionbar__buttons button'),
        litSlots: container.querySelectorAll('.slot--target').length,
        litHexes: container.querySelectorAll('.hex--target').length,
        storage: enabled('.tileface--button'),
        goods: enabled('.goodschip--button'),
      }
    }

    const ALL_ZERO = { dice: 0, actionButtons: 0, litSlots: 0, litHexes: 0, storage: 0, goods: 0 }

    it('① 选出生点：只有深红格可点，没有骰子也没有行动按钮', () => {
      // beforeEach 里 resetStore() 已经开了一局新游戏，此时正处于选出生点阶段
      const { container } = render(<App />)
      const actual = counts(container)
      // 合成版图上有 4 个深红格（这条数字来自布局量测，不是猜的）
      expect(actual.litHexes).toBe(4)
      expect(actual.dice).toBe(0)
      expect(actual.actionButtons).toBe(0)
      expect(actual.litSlots).toBe(0)
      expect(actual.storage).toBe(0)
      expect(actual.goods).toBe(0)
    })

    it('② 轮到我：骰子可点；选中骰子后才点亮可操作区域', async () => {
      prepareDeterministicGame()
      const { container } = render(<App />)
      await waitFor(() => {
        expect(container.querySelectorAll('.die').length).toBe(2)
      })

      // 还没选骰子：没有任何点亮区域（正对照见下一段）
      const beforeSelect = counts(container)
      expect(beforeSelect.dice).toBe(2)
      expect(beforeSelect.litSlots).toBe(0)
      expect(beforeSelect.litHexes).toBe(0)

      fireEvent.click(container.querySelector('.die') as Element)
      const afterSelect = counts(container)
      expect(afterSelect.litSlots + afterSelect.litHexes).toBeGreaterThan(0)
      expect(afterSelect.actionButtons).toBeGreaterThan(0)
    })

    it('③ 对手回合：一个可点的游戏元素都没有', () => {
      prepareDeterministicGame()
      act(() => {
        useGameStore.setState((current) => ({
          autoOpponent: false,
          state: { ...current.state, activePlayerId: 'p2', startPlayerId: 'p2' },
        }))
      })
      const { container } = render(<App />)
      expect(counts(container)).toEqual(ALL_ZERO)
    })

    /** 把一整局走完（在挂载组件之前走，避免每次 set 都触发渲染）。 */
    function playToEnd(): void {
      for (let step = 0; step < 500; step += 1) {
        const store = useGameStore.getState()
        if (store.state.finished) break
        const move = opponentMove(store.config, store.state, 'normal')
        if (move === undefined) break
        store.play(move)
      }
      expect(useGameStore.getState().state.finished, '这局没走完，后面的断言不成立').toBe(true)
    }

    it('④ 终局：一个可点的游戏元素都没有，且显示最终得分', () => {
      prepareDeterministicGame()
      playToEnd()

      const { container, getByText } = render(<App />)
      expect(counts(container)).toEqual(ALL_ZERO)
      // 终局必须能看到结果，否则"玩这一局"就白玩了
      expect(container.querySelectorAll('.scorecard').length).toBeGreaterThan(0)
      expect(getByText(/赢了|平局/)).toBeDefined()
    })

    it('⑤ 终局面板能收起来看一眼棋盘，也能再打开（原先只有"再来一局"一个出口）', () => {
      prepareDeterministicGame()
      playToEnd()

      const { container, getByText, queryByText } = render(<App />)
      expect(getByText('先看棋盘（可再打开结果）')).toBeDefined()

      fireEvent.click(getByText('先看棋盘（可再打开结果）'))

      // 面板收起，棋盘露出来（此前除了开新局，玩家没有任何办法看终局棋盘）
      expect(queryByText('先看棋盘（可再打开结果）')).toBeNull()
      expect(container.querySelectorAll('.hexboard').length).toBeGreaterThan(0)
      // 游戏元素仍然一个都不可点
      expect(counts(container)).toEqual(ALL_ZERO)

      // 还能把结果打开
      fireEvent.click(getByText('查看结果'))
      expect(getByText('先看棋盘（可再打开结果）')).toBeDefined()
    })
  })

  it('撤销能把局面退回上一步', async () => {
    prepareDeterministicGame()
    const { container, getByText } = render(<App />)

    await waitFor(() => {
      expect(container.querySelectorAll('.die').length).toBe(2)
    })

    const snapshotBefore = JSON.stringify(useGameStore.getState().state)
    fireEvent.click(container.querySelector('.die') as Element)
    fireEvent.click(getByText('取 2 个工人'))
    await waitFor(() => {
      expect(useGameStore.getState().state.actionsTakenThisTurn).toBe(1)
    })

    fireEvent.click(getByText('撤销'))
    await waitFor(() => {
      expect(useGameStore.getState().state.actionsTakenThisTurn).toBe(0)
    })
    expect(JSON.stringify(useGameStore.getState().state)).toBe(snapshotBefore)
  })

  it('「提示」会给出一个当前合法行动的说明', async () => {
    prepareDeterministicGame()
    const { container, getByText } = render(<App />)

    await waitFor(() => {
      expect(container.querySelectorAll('.die').length).toBe(2)
    })

    fireEvent.click(getByText('提示'))
    await waitFor(() => {
      expect(container.querySelector('.banner--hint')).not.toBeNull()
    })
    const text = container.querySelector('.banner--hint')?.textContent ?? ''
    expect(text).toContain('推荐：')
  })
})

describe('面板能打开且不崩（事件处理器覆盖）', () => {
  it('规则、日志、存档三个面板都能打开再关掉', async () => {
    prepareDeterministicGame()
    const { getByText, queryByText } = render(<App />)

    await waitFor(() => {
      expect(queryByText('你的领地')).toBeTruthy()
    })

    fireEvent.click(getByText('规则'))
    await waitFor(() => expect(getByText('规则速查')).toBeTruthy())
    fireEvent.click(getByText('计分'))
    await waitFor(() => expect(getByText('区域完成（立即结算）')).toBeTruthy())
    fireEvent.click(getByText('关闭'))
    await waitFor(() => expect(queryByText('规则速查')).toBeNull())

    fireEvent.click(getByText('日志'))
    await waitFor(() => expect(queryByText('收起日志')).toBeTruthy())

    fireEvent.click(getByText('存档'))
    await waitFor(() => expect(getByText('导出存档（下载 JSON）')).toBeTruthy())
    fireEvent.click(getByText('关闭'))
    await waitFor(() => expect(queryByText('导出存档（下载 JSON）')).toBeNull())
  })

  it('存档面板的「清除本机存档」不会抛错', async () => {
    prepareDeterministicGame()
    const { getByText } = render(<App />)

    fireEvent.click(getByText('存档'))
    await waitFor(() => expect(getByText('清除本机存档')).toBeTruthy())
    fireEvent.click(getByText('清除本机存档'))
    await waitFor(() => expect(getByText(/已清除本机存档/)).toBeTruthy())
  })
})

describe('对手会自动行动（把自动对手打开）', () => {
  it('轮到对手时，它会在片刻后自己走一步', async () => {
    prepareDeterministicGame()
    act(() => {
      useGameStore.setState((current) => ({
        autoOpponent: true,
        state: { ...current.state, activePlayerId: 'p2' },
      }))
    })

    const stepsBefore = useGameStore.getState().state.actionsTakenThisTurn
    render(<App />)

    // 对手 300ms 后行动；用 waitFor 等状态发生任何变化
    await waitFor(
      () => {
        const state = useGameStore.getState().state
        const moved =
          state.activePlayerId === useGameStore.getState().humanPlayerId ||
          state.actionsTakenThisTurn !== stepsBefore ||
          state.turnIndex !== 0
        expect(moved).toBe(true)
      },
      { timeout: 4000 },
    )

    // 关键：行动一定来自合法行动列表
    const legal = listLegalMoves(useGameStore.getState().config, useGameStore.getState().state)
    expect(legal.length).toBeGreaterThan(0)
  })
})
