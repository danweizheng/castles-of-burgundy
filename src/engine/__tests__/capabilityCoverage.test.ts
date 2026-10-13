import { describe, expect, it } from 'vitest'
import { BUILDING_SCORING_KNOWLEDGE, K } from '../data/knowledge'

/**
 * 知识板块 → 能力 → 规则代码 的**静态覆盖检查**。
 *
 * 为什么值得单写一组：能力派生层（capabilities.ts）本身有测试，但那是"算出来的能力对不对"。
 * 真正难发现的是**另一个方向**：某个能力被派生出来了，却没有任何规则代码读它。
 * 那种情况下派生层测试全绿，而**对应的知识板块在游戏里毫无效果** ——
 * 玩家花行动买了一张板块、放下去，什么都没发生，也不会报任何错。
 *
 * 这里从源码文本做三条断言：
 *   1. 26 张知识板块的编号全部出现在能力派生里（新增板块忘了接线会失败）
 *   2. 每一个能力字段都至少被一处规则代码读到（派生了没人读会失败）
 *   3. 每个能力字段的注释都标了对应的知识板块编号（便于审计"哪张板块产生哪个能力"）
 *
 * 用 import.meta.glob 读源码而不是 node:fs：项目是纯浏览器端，tsconfig 只带
 * vite/client 类型，没有 node 类型；Vite 自带的 glob 正好够用，也不必为此加依赖。
 */

const RAW = import.meta.glob('../../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/**
 * glob 的键是**相对本文件**的（同目录是 './x.ts'，上一级是 '../y.ts'）。
 * 所以必须正经解析成 src 相对路径，不能简单剥掉 '../' ——
 * 早先那样剥会把 engine/ 这层前缀也一起吃掉。
 */
const SELF_URL = import.meta.url
const SELF_DIR = ((): string => {
  const marker = '/src/'
  const at = SELF_URL.indexOf(marker)
  if (at < 0) throw new Error(`无法从 ${SELF_URL} 推出 src 目录`)
  return SELF_URL.slice(at + marker.length).replace(/\/[^/]+$/, '')
})()

function resolveSrcPath(key: string): string {
  const parts = SELF_DIR.split('/')
  for (const segment of key.split('/')) {
    if (segment === '.' || segment === '') continue
    if (segment === '..') parts.pop()
    else parts.push(segment)
  }
  return parts.join('/')
}

const FILES = Object.entries(RAW)
  .map(([key, text]) => ({ path: resolveSrcPath(key), text }))
  // 测试文件自己不算"被规则代码读到"
  .filter((file) => !file.path.includes('__tests__'))

const definitionFile = FILES.find((file) => file.path === 'engine/capabilities.ts')
if (definitionFile === undefined) {
  // 把实际拿到的路径打出来：glob 的键在不同环境下可能不同，报错时要能一眼看出原因
  const sample = FILES.map((file) => file.path).slice(0, 12).join('、') || '（一个都没有）'
  throw new Error(`没能读到 engine/capabilities.ts；glob 拿到 ${FILES.length} 个文件：${sample}`)
}
const DEFINITION: string = definitionFile.text

/** 参与"读取能力"的文件：引擎 + AI + 界面 + store，都可能在读 caps.xxx */
const CONSUMERS = FILES.filter((file) => file.path !== 'engine/capabilities.ts')

/** 从 Capabilities 接口里取出字段名。 */
function capabilityFields(): string[] {
  const match = /export interface Capabilities \{([\s\S]*?)\n\}/.exec(DEFINITION)
  if (match === null) throw new Error('没能从 capabilities.ts 里解析出 Capabilities 接口')
  const fields: string[] = []
  for (const line of match[1]!.split('\n')) {
    const field = /^\s{2}readonly (\w+):/.exec(line)
    if (field !== null) fields.push(field[1]!)
  }
  return fields
}

const FIELDS = capabilityFields()

describe('静态覆盖：知识板块 → 能力', () => {
  it('能解析出能力字段（解析器本身没坏，后面的断言才有意义）', () => {
    // 当前是 17 个。数量变了要顺手确认是"加了能力"还是"解析器坏了"，而不是让断言空转。
    expect(FIELDS.length).toBe(17)
    expect(FIELDS).toContain('ignoreBuildingLimitPerCity')
    expect(FIELDS).toContain('finalVpPerBonusTile')
    // 解析器要真的读到接口体，而不是从别处凑出 17 个词
    expect(DEFINITION).toContain('export interface Capabilities')
  })

  it('26 张知识板块的编号不重不漏地落在两张表里', () => {
    // K 只放"改规则/计分"的具名常量（18 个），16–23 那八个建筑计分板块在另一张表里。
    // 两者并集必须**恰好**是 1–26：少了就是有板块没接线，重了就是编号冲突。
    expect(Object.keys(K), 'K 常量表的规模').toHaveLength(18)
    expect(Object.keys(BUILDING_SCORING_KNOWLEDGE), '建筑计分表的规模').toHaveLength(8)

    const ids = [...Object.values(K), ...Object.keys(BUILDING_SCORING_KNOWLEDGE).map(Number)]
    const unique = new Set(ids)
    expect(unique.size, `编号有重复：${ids.length} 个值只有 ${unique.size} 个不同`).toBe(ids.length)

    const missing = Array.from({ length: 26 }, (_, index) => index + 1).filter((id) => !unique.has(id))
    expect(missing, `这些知识板块编号没有出现在任何映射表里：${missing.join('、')}`).toEqual([])
    expect(Math.max(...ids)).toBe(26)
  })

  it('K 里的每个具名常量都真的被用到（直接写 K.x，或经数据表间接引用）', () => {
    // 注意不能只查 capabilities.ts：9/10/11 三张板块是通过 FREE_DIE_ADJUST_KNOWLEDGE
    // 那张"颜色 → 编号"表间接生效的（数据表在 data/knowledge.ts 里）。
    // 这是更好的设计，所以断言要接受两种引用方式。
    const missing = Object.keys(K).filter((name) => {
      const pattern = new RegExp(`K\\.${name}\\b`)
      return !FILES.some((file) => pattern.test(file.text))
    })
    expect(missing, `这些 K 常量在任何源码里都没被引用：${missing.join('、')}`).toEqual([])
  })

  it('每一个能力都被规则代码真的读到（派生了却没人读 = 那张板块没有效果）', () => {
    const unread: string[] = []
    for (const field of FIELDS) {
      const pattern = new RegExp(`\\b${field}\\b`)
      if (!CONSUMERS.some((file) => pattern.test(file.text))) unread.push(field)
    }
    expect(
      unread,
      `以下能力被派生了但没有任何规则代码读它 —— 对应知识板块在游戏里不会有任何效果：${unread.join('、')}`,
    ).toEqual([])
  })

  it('每个能力的注释都标了对应的知识板块编号（便于审计）', () => {
    const block = /export interface Capabilities \{([\s\S]*?)\n\}/.exec(DEFINITION)![1]!
    const lines = block.split('\n')
    for (const field of FIELDS) {
      const index = lines.findIndex((line) => line.includes(`readonly ${field}:`))
      expect(index, `${field} 找不到声明行`).toBeGreaterThan(-1)

      // 取声明行上方**连续的**注释块，断言整块里出现"号"。
      // 不能只取最近一行：多行注释块的收尾行是孤立的 '*/'，会先被命中。
      const block: string[] = []
      let cursor = index - 1
      while (cursor >= 0) {
        const trimmed = lines[cursor]!.trim()
        if (!trimmed.startsWith('*') && !trimmed.startsWith('/**')) break
        block.push(trimmed)
        cursor -= 1
      }
      expect(block.length, `${field} 上方没有注释块`).toBeGreaterThan(0)
      expect(block.join(' '), `${field} 的注释块里没有标注知识板块编号`).toMatch(/号/)
    }
  })
})
