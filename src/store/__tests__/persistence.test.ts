import { describe, expect, it } from 'vitest'
import { createGame } from '../../engine/setup'
import type { GameState } from '../../engine/state'
import { CONFIG, BASE_STATE } from '../../engine/__tests__/testUtils'
import {
  SAVE_FORMAT,
  buildSaveFile,
  createMemoryStorage,
  decodeSave,
  decodeSaveText,
  describeSave,
  encodeSave,
  loadSave,
  validateState,
  writeSave,
  type SaveLogEntry,
} from '../persistence'

const LOG: SaveLogEntry[] = [
  { id: 1, player: undefined, text: '新对局开始' },
  { id: 2, player: 'p1', text: '掷出 3 / 5' },
]

function saveOf(state: GameState) {
  return buildSaveFile({ state, log: LOG, difficulty: 'hard', now: 1_700_000_000_000 })
}

describe('存档编解码', () => {
  it('编码后再解码得到等价的存档', () => {
    const save = saveOf(BASE_STATE)
    const result = decodeSave(CONFIG, JSON.parse(encodeSave(save)))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.save.seed).toBe(BASE_STATE.seed)
    expect(result.save.difficulty).toBe('hard')
    expect(result.save.savedAt).toBe(1_700_000_000_000)
    expect(result.save.state.players).toHaveLength(2)
    expect(result.save.log).toHaveLength(2)
  })

  it('存档里完整保留对局状态（能继续列出合法行动）', () => {
    const save = saveOf(BASE_STATE)
    const result = decodeSave(CONFIG, JSON.parse(encodeSave(save)))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(validateState(CONFIG, result.save.state)).toBeUndefined()
  })

  it('日志只保留最近 60 条（存档体积与日志长度无关）', () => {
    const many: SaveLogEntry[] = Array.from({ length: 500 }, (_, i) => ({
      id: i,
      player: 'p1',
      text: `事件 ${i}`,
    }))
    const save = buildSaveFile({ state: BASE_STATE, log: many, difficulty: 'normal', now: 0 })
    expect(save.log).toHaveLength(60)
    expect(save.log[59]?.text).toBe('事件 499')
  })

  it('describeSave 给出时间、阶段与种子', () => {
    const text = describeSave(saveOf(BASE_STATE))
    expect(text).toContain('第 A 阶段')
    expect(text).toContain(String(BASE_STATE.seed))
    expect(text).toContain('第 1 轮')
  })
})

describe('存档校验会拒绝坏数据（而不是让对局崩掉）', () => {
  it('不是对象', () => {
    expect(decodeSave(CONFIG, 42).ok).toBe(false)
    expect(decodeSave(CONFIG, null).ok).toBe(false)
    expect(decodeSave(CONFIG, 'abc').ok).toBe(false)
  })

  it('格式版本不符', () => {
    const bad = { ...saveOf(BASE_STATE), format: SAVE_FORMAT + 1 }
    const result = decodeSave(CONFIG, bad)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('格式版本')
  })

  it('规则集版本不符（版图数据换了）', () => {
    const bad = { ...saveOf(BASE_STATE), rulesetVersion: 'v-old' }
    const result = decodeSave(CONFIG, bad)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('规则集版本')
  })

  it('没有对局状态', () => {
    const { state: _state, ...withoutState } = saveOf(BASE_STATE)
    void _state
    const result = decodeSave(CONFIG, withoutState)
    expect(result.ok).toBe(false)
  })

  it('玩家引用了不存在的版图', () => {
    const broken: GameState = {
      ...BASE_STATE,
      players: BASE_STATE.players.map((player, index) =>
        index === 0 ? { ...player, boardId: '不存在的版图' } : player,
      ),
    }
    expect(validateState(CONFIG, broken)).toContain('不存在的版图')
    expect(decodeSave(CONFIG, { ...saveOf(BASE_STATE), state: broken }).ok).toBe(false)
  })

  it('阶段序号越界', () => {
    const broken: GameState = { ...BASE_STATE, phaseIndex: 9 }
    expect(validateState(CONFIG, broken)).toContain('阶段序号越界')
  })

  it('顺位轨为空', () => {
    const broken: GameState = { ...BASE_STATE, turnOrder: [] }
    expect(validateState(CONFIG, broken)).toContain('顺位轨')
  })

  it('对局已结束时不再检查合法行动（终局本来就没有行动）', () => {
    const finished: GameState = { ...createGame(CONFIG, { seed: 5 }), finished: true }
    expect(validateState(CONFIG, finished)).toBeUndefined()
  })

  it('非 JSON 文本给出可读错误', () => {
    const result = decodeSaveText(CONFIG, '{坏掉的 json')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('不是合法的 JSON')
  })

  it('损坏的日志条目被过滤成空文本，而不是让整份存档失败', () => {
    const raw = { ...saveOf(BASE_STATE), log: [{ id: 'x' }, 'garbage', { id: 3, player: 'p2', text: 'ok' }] }
    const result = decodeSave(CONFIG, raw)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.save.log).toHaveLength(2)
    expect(result.save.log[0]?.text).toBe('')
    expect(result.save.log[1]?.text).toBe('ok')
  })
})

describe('存储后端', () => {
  it('内存实现可读可写可清', async () => {
    const storage = createMemoryStorage()
    expect(await storage.read()).toBeUndefined()
    await writeSave(storage, saveOf(BASE_STATE))
    const loaded = await loadSave(CONFIG, storage)
    expect(loaded.found).toBe(true)
    expect(loaded.result?.ok).toBe(true)
    await storage.clear()
    expect((await loadSave(CONFIG, storage)).found).toBe(false)
  })

  it('没有存档时 found=false（不是错误）', async () => {
    const outcome = await loadSave(CONFIG, createMemoryStorage())
    expect(outcome.found).toBe(false)
    expect(outcome.result).toBeUndefined()
  })

  it('存档损坏时 found=true 且带错误原因（界面要能提示"存档坏了，开新局吧"）', async () => {
    const outcome = await loadSave(CONFIG, createMemoryStorage({ nonsense: true }))
    expect(outcome.found).toBe(true)
    expect(outcome.result?.ok).toBe(false)
  })

  it('写入后读取到的内容与内存里的对象无关（避免共享引用被后续改动污染）', async () => {
    const storage = createMemoryStorage()
    const save = saveOf(BASE_STATE)
    await writeSave(storage, save)
    const peeked = storage.peek() as { state: GameState }
    expect(peeked.state).not.toBe(save.state)
    expect(peeked.state.seed).toBe(save.state.seed)
  })
})
