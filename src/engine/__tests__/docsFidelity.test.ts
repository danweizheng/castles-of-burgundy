import { describe, expect, it } from 'vitest'
import { BUILDINGS } from '../data/buildings'
import { KNOWLEDGE_TILES } from '../data/knowledge'
import { OFFICIAL_BLACK_TILE_INVENTORY, OFFICIAL_TILE_INVENTORY } from '../tiles'

/**
 * 文档保真度检查：**文档里声称的事实，必须与现实一致**。
 *
 * 起因是一次元检查：扫描文档里的数字主张，发现一批已经过期的 ——
 * 最典型的是 README 写着 AI"平均 154.4 分 vs 94.9 分"，而那是我调 AI 之前的数字，
 * 之后一路变成 159.8 : 96.8，文档却没人再动过。文档里的数字不会自己报错，
 * 只会**安静地变成假话**，而读它的人（包括几个月后的我）会当真。
 *
 * 这里做三类检查：
 *   1. 文档里提到的每个 `tools/xxx` 脚本、每个 `pnpm xxx` 命令都真实存在
 *      （改名或删除后文档会失效，这是最常见的文档腐烂方式）
 *   2. 文档里引用的**结构性数字**与代码一致（板块数、建筑数、知识板块数……）
 *   3. 当前状态类文档里**不许出现会漂移的计数**（用例数、提交数、自检项数）——
 *      这类数字每改一次代码就过期，正确做法是写"跑 X 会打印"，而不是抄一份数字
 */

const RAW = import.meta.glob('../../../{README.md,docs/*.md,package.json}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/** glob 键是相对本文件的，解析成"仓库根相对路径" */
const SELF_DIR = ((): string => {
  const marker = '/src/'
  const at = import.meta.url.indexOf(marker)
  if (at < 0) throw new Error(`无法从 ${import.meta.url} 推出 src 目录`)
  // 本文件在 src/engine/__tests__/，所以要回到仓库根需要退三级
  return `src/${import.meta.url.slice(at + marker.length).replace(/\/[^/]+$/, '')}`
})()

function resolveRepoPath(key: string): string {
  const parts = SELF_DIR.split('/')
  for (const segment of key.split('/')) {
    if (segment === '.' || segment === '') continue
    if (segment === '..') parts.pop()
    else parts.push(segment)
  }
  return parts.join('/')
}

const FILES = Object.fromEntries(
  Object.entries(RAW).map(([key, text]) => [resolveRepoPath(key), text]),
)

const README = FILES['README.md']
const ENGINEERING = FILES['docs/工程说明.md']
const PACKAGE_JSON = FILES['package.json']
if (README === undefined || ENGINEERING === undefined || PACKAGE_JSON === undefined) {
  throw new Error('没能读到 README.md / docs/工程说明.md / package.json')
}

const TOOL_FILES = import.meta.glob('../../../tools/*', { eager: true, query: '?url' })
const TOOL_NAMES = new Set(
  Object.keys(TOOL_FILES).map((key) => key.replace(/^(\.\.\/)+/, '')),
)

const SCRIPTS = new Set(Object.keys((JSON.parse(PACKAGE_JSON) as { scripts: Record<string, string> }).scripts))
/** pnpm 自带的子命令，不是 package.json 脚本 */
const PNPM_BUILTINS = new Set(['install', 'add', 'remove', 'exec', 'dlx', 'why', 'update', 'i'])

/** 当前状态类的文档：可以引用结构性数字，但不许抄会漂移的计数 */
const CURRENT_DOCS: ReadonlyArray<readonly [string, string]> = [
  ['README.md', README],
  ['docs/工程说明.md', ENGINEERING],
]

describe('文档保真度：提到的文件与命令必须真实存在', () => {
  it('文档里提到的每个 tools/ 脚本都存在', () => {
    const mentioned = new Set<string>()
    for (const [, text] of CURRENT_DOCS) {
      for (const match of text.matchAll(/tools\/[\w.-]+\.(?:mjs|ps1|py)/g)) mentioned.add(match[0])
    }
    expect(mentioned.size, '当前状态文档里应当至少提到几个脚本').toBeGreaterThan(3)

    const missing = [...mentioned].filter((path) => !TOOL_NAMES.has(path))
    expect(missing, `这些脚本被文档提到但不存在（改名或删掉了？）：${missing.join('、')}`).toEqual([])
  })

  it('文档里提到的每个 pnpm 命令都存在', () => {
    const mentioned = new Set<string>()
    for (const [, text] of CURRENT_DOCS) {
      for (const match of text.matchAll(/pnpm ([\w:.-]+)/g)) mentioned.add(match[1]!)
    }
    expect(mentioned.size).toBeGreaterThan(2)

    const missing = [...mentioned].filter(
      (name) => !SCRIPTS.has(name) && !PNPM_BUILTINS.has(name),
    )
    expect(missing, `这些 pnpm 命令被文档提到但不存在：${missing.join('、')}`).toEqual([])
  })
})

describe('文档保真度：结构性数字与代码一致', () => {
  it('"26 张知识板块"与代码一致', () => {
    expect(README + ENGINEERING).toContain('26 张知识板块')
    expect(KNOWLEDGE_TILES).toHaveLength(26)
  })

  it('"8 种建筑"与代码一致', () => {
    expect(README + ENGINEERING).toContain('8 种建筑')
    expect(BUILDINGS).toHaveLength(8)
  })

  it('"164 枚板块"与库存一致', () => {
    expect(ENGINEERING).toContain('164 枚板块')
    // 注意：库存数组的**元素个数**是"规格条数"，不是枚数；每条的 count 才是枚数
    const total = [...OFFICIAL_TILE_INVENTORY, ...OFFICIAL_BLACK_TILE_INVENTORY].reduce(
      (sum, spec) => sum + spec.count,
      0,
    )
    expect(total).toBe(164)
  })

  it('启动画面的张数与文档里写的一致', () => {
    const splashes = import.meta.glob('../../../public/splash/*.png', { eager: true, query: '?url' })
    const count = Object.keys(splashes).length
    // 张数从实际文件数反推：加了尺寸却忘了改文档，这条就会红
    expect(ENGINEERING, `工程说明里应当写"${count} 张"启动画面`).toContain(`${count} 张`)
  })
})

describe('文档保真度：不许抄会漂移的计数', () => {
  /**
   * 这些数字每改一次代码就过期，而文档里过期了不会报错。
   * 正确写法是"跑 pnpm test 会打印"或"以输出为准"，而不是抄一份数字。
   * （历史记录类文档 docs/开发方案.md 不在此列：它按轮次记录当时的数字，属于档案。）
   */
  const BANNED: ReadonlyArray<readonly [RegExp, string]> = [
    [/\d+\s*个用例/, '用例数'],
    [/\d+\s*个测试/, '测试数'],
    [/\d+\s*个提交/, '提交数'],
    [/\d+\s*项资源图自检/, '自检项数'],
    // 跑一次测试或调一次参数就会变的实测结果，同属"抄进文档就会过期"这一类。
    // README 里曾长期写着"平均 154.4 分 vs 94.9 分"，那是调 AI 之前的数字。
    [/平均 \d+(?:\.\d+)? 分/, '实测均分'],
    [/\d+(?:\.\d+)? 分 vs \d+(?:\.\d+)? 分/, '实测比分'],
    [/\|\s*用例数\s*\|/, '用例数表格列'],
  ]

  for (const [pattern, label] of BANNED) {
    it(`当前状态文档里不出现具体的${label}`, () => {
      const offenders: string[] = []
      for (const [name, text] of CURRENT_DOCS) {
        text.split('\n').forEach((line, index) => {
          if (pattern.test(line)) offenders.push(`${name}:${index + 1} ${line.trim()}`)
        })
      }
      expect(
        offenders,
        `这些地方抄了会随开发漂移的${label} —— 改成"跑 xxx 会打印"或"以输出为准"：\n${offenders.join('\n')}`,
      ).toEqual([])
    })
  }
})
