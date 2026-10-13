import { describe, expect, it } from 'vitest'
import { cloneRng, createRng, nextInt, pickOne, rollDie, shuffle } from '../rng'

describe('确定性随机数', () => {
  it('同一种子产生完全相同的序列（存档/回放的前提）', () => {
    const a = createRng(20240101)
    const b = createRng(20240101)
    const seqA = Array.from({ length: 50 }, () => nextInt(a, 1000))
    const seqB = Array.from({ length: 50 }, () => nextInt(b, 1000))
    expect(seqA).toEqual(seqB)
  })

  it('不同种子产生不同序列', () => {
    const a = createRng(1)
    const b = createRng(2)
    const seqA = Array.from({ length: 50 }, () => nextInt(a, 1000))
    const seqB = Array.from({ length: 50 }, () => nextInt(b, 1000))
    expect(seqA).not.toEqual(seqB)
  })

  it('种子为 0 也不会退化', () => {
    const a = createRng(0)
    const seq = Array.from({ length: 20 }, () => nextInt(a, 100))
    expect(new Set(seq).size).toBeGreaterThan(5)
  })

  it('克隆后的状态独立推进', () => {
    const a = createRng(42)
    nextInt(a, 100)
    const b = cloneRng(a)
    expect(nextInt(a, 1_000_000)).toBe(nextInt(b, 1_000_000))
  })

  it('nextInt 始终落在 [0, max) 内', () => {
    const rng = createRng(7)
    for (let i = 0; i < 5000; i += 1) {
      const v = nextInt(rng, 7)
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(7)
    }
  })

  it('nextInt 拒绝非法上界', () => {
    const rng = createRng(7)
    expect(() => nextInt(rng, 0)).toThrow()
    expect(() => nextInt(rng, -3)).toThrow()
    expect(() => nextInt(rng, 2.5)).toThrow()
  })

  it('骰子只出 1–6，且六个面都会出现', () => {
    const rng = createRng(2024)
    const faces = new Set<number>()
    for (let i = 0; i < 6000; i += 1) {
      const d = rollDie(rng)
      expect(d).toBeGreaterThanOrEqual(1)
      expect(d).toBeLessThanOrEqual(6)
      faces.add(d)
    }
    expect([...faces].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('骰子分布大致均匀（每面偏差不超过 15%）', () => {
    const rng = createRng(99)
    const counts = [0, 0, 0, 0, 0, 0, 0]
    const total = 60_000
    for (let i = 0; i < total; i += 1) {
      const d = rollDie(rng)
      counts[d] = (counts[d] ?? 0) + 1
    }
    for (let face = 1; face <= 6; face += 1) {
      const expected = total / 6
      const actual = counts[face] ?? 0
      expect(Math.abs(actual - expected) / expected).toBeLessThan(0.15)
    }
  })

  it('洗牌是排列且确定性：元素不增不减', () => {
    const source = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    const a = shuffle(createRng(5), source)
    const b = shuffle(createRng(5), source)
    expect(a).toEqual(b)
    expect([...a].sort((x, y) => x - y)).toEqual(source)
    // 入参不被修改
    expect(source).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('洗牌确实打乱了顺序（极小概率误报可接受）', () => {
    const source = Array.from({ length: 52 }, (_, i) => i)
    const shuffled = shuffle(createRng(1234), source)
    expect(shuffled).not.toEqual(source)
  })

  it('pickOne 只在给定集合内取值，空数组抛错', () => {
    const rng = createRng(88)
    const pool = ['cow', 'pig', 'sheep', 'chicken']
    for (let i = 0; i < 100; i += 1) {
      expect(pool).toContain(pickOne(rng, pool))
    }
    expect(() => pickOne(rng, [])).toThrow()
  })
})
