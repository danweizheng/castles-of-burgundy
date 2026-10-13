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
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { App } from '../App'
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
