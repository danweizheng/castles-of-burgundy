/**
 * 可序列化的确定性随机数发生器（mulberry32）。
 *
 * 设计约束：随机状态必须是 JSON 可序列化的纯数据，否则存档、撤销、AI 克隆
 * 全都会失效。所以这里不做类封装，只用一个 { s } 对象在原地推进。
 *
 * 用法约定：所有随机都必须显式传入 rng，引擎内部禁止调用 Math.random()。
 */

export interface RngState {
  /** 32 位内部状态 */
  s: number
}

export function createRng(seed: number): RngState {
  const normalized = seed >>> 0
  // 种子为 0 会让 mulberry32 退化，替换为一个非零常量
  return { s: normalized === 0 ? 0x9e3779b9 : normalized }
}

export function cloneRng(rng: RngState): RngState {
  return { s: rng.s }
}

/** 原地推进并返回下一个 32 位无符号整数。 */
export function nextUint32(rng: RngState): number {
  rng.s = (rng.s + 0x6d2b79f5) >>> 0
  let t = rng.s
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t = (t ^ (t + Math.imul(t ^ (t >>> 7), t | 61))) >>> 0
  return (t ^ (t >>> 14)) >>> 0
}

/** [0, maxExclusive) 内的均匀整数。 */
export function nextInt(rng: RngState, maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new Error(`nextInt 的取值上界必须是正整数，收到 ${maxExclusive}`)
  }
  return nextUint32(rng) % maxExclusive
}

/** 均匀分布的一颗骰子，取值 1–6。 */
export function rollDie(rng: RngState): number {
  return nextInt(rng, 6) + 1
}

/** Fisher–Yates 洗牌，返回新数组，不修改入参。 */
export function shuffle<T>(rng: RngState, items: readonly T[]): T[] {
  const result = items.slice()
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = nextInt(rng, i + 1)
    const a = result[i]
    const b = result[j]
    if (a === undefined || b === undefined) throw new Error('洗牌越界')
    result[i] = b
    result[j] = a
  }
  return result
}

/** 从数组中均匀取一个元素；空数组视为编程错误。 */
export function pickOne<T>(rng: RngState, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pickOne 不能用于空数组')
  const picked = items[nextInt(rng, items.length)]
  if (picked === undefined) throw new Error('pickOne 越界')
  return picked
}
