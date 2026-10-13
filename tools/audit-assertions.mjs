#!/usr/bin/env node
/**
 * 断言质量审查。
 *
 * 为什么需要它：一个测试可以"永远绿"却什么都没验证 —— 最典型的是
 *   it('渲染不崩', () => { render(<App />) })            // 一条断言都没有
 *   expect(container.querySelector('.x')).toBeDefined()  // 只要不是 null 就过
 * 这类测试不会红，却会让人以为"这块有覆盖"。它们比没有测试更危险：
 * 没有测试时你至少知道自己没测。
 *
 * 这个脚本不判断对错，只做三件客观统计，供人工复核：
 *   1. 一条 expect 都没有的 it 块（完全空转）
 *   2. 只由弱断言构成的 it 块（toBeDefined / toBeTruthy 之类）
 *   3. 每个文件的弱断言占比
 *
 * 用法：node tools/audit-assertions.mjs [--verbose]
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const VERBOSE = process.argv.includes('--verbose')

/** 只要"不是 null/undefined"就过 —— 单独用几乎没有信息量 */
const WEAK = [/\.toBeDefined\(\)/, /\.toBeTruthy\(\)/, /\.not\.toBeUndefined\(\)/, /\.not\.toBeNull\(\)/]
/**
 * 真正能证伪某个具体值的断言。
 *
 * 两点容易漏（第一版都漏了，导致把好测试误报成弱测试）：
 * - `toBeUndefined` / `toBeNull` 也是"指定了具体期望值"，属于强断言；
 * - `getByText(...)` / `findByRole(...)` **找不到就抛异常**，本身就是断言，
 *   后面跟不跟 `toBeDefined()` 都无所谓。queryBy* 不抛，所以要靠 toBeNull 才算。
 */
const STRONG = [
  /\.toBe\(/,
  /\.toEqual\(/,
  /\.toStrictEqual\(/,
  /\.toContain\(/,
  /\.toThrow\(/,
  /\.toMatch\(/,
  /\.toBeGreaterThan\(/,
  /\.toBeLessThan\(/,
  /\.toHaveLength\(/,
  /\.toBeUndefined\(/,
  /\.toBeNull\(/,
  /\bgetBy[A-Z]\w*\(/,
  /\bfindBy[A-Z]\w*\(/,
  /\bgetAllBy[A-Z]\w*\(/,
]

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.test\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

/** 粗略地把文件切成 it(...) 块：够用，因为这个脚本只做统计不做语义分析。 */
function splitTests(source) {
  const lines = source.split('\n')
  const blocks = []
  let current = null
  let depth = 0

  for (const line of lines) {
    if (current === null) {
      const match = /\bit\(\s*(['"`])(.*?)\1/.exec(line)
      if (match !== null) {
        current = { name: match[2], lines: [line] }
        // 把测试名**替换**成占位符（而不是切掉），这样名字里的括号不参与计数，
        // 而 `it(` 自身的括号仍然计入。切掉会把基础深度算错、导致整块被截断。
        const withoutName = line.replace(match[0], "it('x'")
        depth =
          (withoutName.match(/\(/g) ?? []).length -
          (withoutName.match(/\)/g) ?? []).length +
          (withoutName.match(/\{/g) ?? []).length -
          (withoutName.match(/\}/g) ?? []).length
        continue
      }
      continue
    }
    current.lines.push(line)
    depth += (line.match(/\(/g) ?? []).length - (line.match(/\)/g) ?? []).length
    depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length
    if (depth <= 0) {
      blocks.push(current)
      current = null
    }
  }
  if (current !== null) blocks.push(current)
  return blocks
}

const files = walk(SRC)
let totalTests = 0
let totalExpects = 0
let totalWeak = 0
const noAssertion = []
const allWeak = []
const perFile = []

for (const file of files) {
  const source = readFileSync(file, 'utf8')
  const blocks = splitTests(source)
  let fileExpects = 0
  let fileWeak = 0

  for (const block of blocks) {
    const text = block.lines.join('\n')
    const expects = (text.match(/expect\(/g) ?? []).length
    const weak = WEAK.reduce((sum, pattern) => sum + (text.match(new RegExp(pattern, 'g')) ?? []).length, 0)
    const strong = STRONG.reduce((sum, pattern) => sum + (text.match(new RegExp(pattern, 'g')) ?? []).length, 0)

    totalTests += 1
    totalExpects += expects
    totalWeak += weak
    fileExpects += expects
    fileWeak += weak

    if (expects === 0) noAssertion.push({ file, name: block.name })
    else if (strong === 0 && weak > 0) allWeak.push({ file, name: block.name, weak })
  }

  perFile.push({
    file: relative(ROOT, file),
    tests: blocks.length,
    expects: fileExpects,
    weak: fileWeak,
  })
}

console.log(`共 ${totalTests} 个 it 块，${totalExpects} 条 expect，其中弱断言 ${totalWeak} 条`)
console.log('')

console.log(`【完全空转】一条 expect 都没有的 it 块：${noAssertion.length} 个`)
for (const entry of noAssertion) {
  console.log(`  ${relative(ROOT, entry.file)} :: ${entry.name}`)
}
console.log('')

console.log(`【只由弱断言构成】没有任何"能证伪具体值"的断言：${allWeak.length} 个`)
for (const entry of allWeak) {
  console.log(`  ${relative(ROOT, entry.file)} :: ${entry.name}（弱断言 ${entry.weak} 条）`)
}
console.log('')

if (VERBOSE) {
  console.log('【逐文件】按弱断言占比排序')
  const sorted = [...perFile].sort((a, b) => b.weak / Math.max(1, b.expects) - a.weak / Math.max(1, a.expects))
  for (const entry of sorted) {
    const ratio = entry.expects === 0 ? 0 : entry.weak / entry.expects
    console.log(
      `  ${(ratio * 100).toFixed(0).padStart(3)}%  ${String(entry.weak).padStart(3)}/${String(entry.expects).padEnd(4)}  ${entry.file}`,
    )
  }
}

if (noAssertion.length > 0) process.exitCode = 1
