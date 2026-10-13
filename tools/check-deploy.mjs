#!/usr/bin/env node
/**
 * 部署后自检：把线上产物的**资源图**整条走一遍。
 *
 * 为什么需要它：手工敲几条 curl 只能证明"首页能打开"，而那些真正会让 PWA 在手机上坏掉的
 * 问题都不在这条路径上 —— 子目录下的相对路径写错、某个图标没被打进产物、
 * service worker 的预缓存清单里有一条 404（离线时才会暴露）。这些都只有把
 * index.html 引用的每一个资源、以及 sw.js 里每一条预缓存条目都取一遍才能发现。
 *
 * 用法：
 *   node tools/check-deploy.mjs
 *   node tools/check-deploy.mjs --expect-same index.html --expect-same sw.js
 *     ↑ 等线上这两个文件与本地 dist 逐字节一致，再开始自检。
 *       （早先只有一个 --expect <JS 资源名>，它只是在首页里找一个子串 ——
 *        如果这次只改了 index.html 或 public/ 里的东西，JS 哈希不变，
 *        旧首页同样含那个子串，于是自检会**对着旧部署通过**。sw.js 的预缓存清单
 *        在任何被缓存资源变化时都会变，所以它是"新构建真的上线了"的完整信号。）
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const BASE = (process.env.DEPLOY_URL ?? 'https://danweizheng.github.io/castles-of-burgundy/').replace(
  /\/?$/,
  '/',
)

const EXPECT_INDEX = process.argv.indexOf('--expect')
const EXPECT = EXPECT_INDEX >= 0 ? process.argv[EXPECT_INDEX + 1] : undefined

/** 需要"与本地构建逐字节一致"才算新构建上线的文件 */
const EXPECT_SAME = process.argv.reduce((paths, value, index, all) => {
  if (value === '--expect-same' && all[index + 1] !== undefined) paths.push(all[index + 1])
  return paths
}, [])

const DIST_DIR = process.env.DIST_DIR ?? 'dist'
// 等待参数可配置：验证"线上仍是旧构建"这条路径时不必真等三分钟
const WAIT_ATTEMPTS = Number(process.env.DEPLOY_WAIT_ATTEMPTS ?? 18)
const WAIT_MS = Number(process.env.DEPLOY_WAIT_MS ?? 10_000)

const failures = []
const checked = []

/** 行尾差异会带来无意义的比较失败，比较前先归一化。 */
function normalize(text) {
  return text.replace(/\r\n/g, '\n')
}

function localCopy(path) {
  try {
    return normalize(readFileSync(join(DIST_DIR, path), 'utf8'))
  } catch {
    return undefined
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function record(ok, label, detail) {
  if (ok) {
    checked.push(label)
  } else {
    failures.push(`${label}${detail === undefined ? '' : `：${detail}`}`)
  }
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail === undefined ? '' : `  ${detail}`}`)
}

async function get(url) {
  const response = await fetch(url, { redirect: 'follow' })
  return response
}

/** index.html 里引用的本地资源（跳过外链与 data:） */
function localRefs(html) {
  const refs = new Set()
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const value = match[1]
    if (/^(https?:)?\/\//.test(value) || value.startsWith('data:')) continue
    refs.add(value.replace(/^\.\//, ''))
  }
  return [...refs]
}

async function main() {
  if (!BASE.startsWith('https://')) {
    failures.push(`部署地址不是 HTTPS（${BASE}）—— iOS 装 PWA 必须有 HTTPS`)
  }

  console.log(`自检目标：${BASE}`)
  if (EXPECT !== undefined) console.log(`等待线上换成：${EXPECT}`)
  for (const path of EXPECT_SAME) console.log(`等待线上与本地一致：${path}`)

  // ---- 1. 首页 ----
  let html = ''
  let settled = EXPECT_SAME.length === 0 && EXPECT === undefined
  for (let attempt = 1; attempt <= WAIT_ATTEMPTS; attempt += 1) {
    const response = await get(BASE)
    if (response.status !== 200) {
      console.log(`  第 ${attempt} 次：首页 HTTP ${response.status}，等待…`)
      await sleep(WAIT_MS)
      continue
    }
    html = await response.text()

    // 逐字节比对：这是"新构建真的上线了"的完整信号
    let allSame = true
    for (const path of EXPECT_SAME) {
      const expected = localCopy(path)
      if (expected === undefined) {
        failures.push(`本地没有 ${join(DIST_DIR, path)}，无法比对（先 pnpm build）`)
        allSame = false
        break
      }
      const remote = await get(BASE + path)
      if (remote.status !== 200 || normalize(await remote.text()) !== expected) {
        allSame = false
        break
      }
    }

    if (!allSame) {
      console.log(`  第 ${attempt} 次：线上仍是旧构建，等待…`)
      await sleep(WAIT_MS)
      continue
    }
    if (EXPECT !== undefined && !html.includes(EXPECT)) {
      console.log(`  第 ${attempt} 次：首页还没引用 ${EXPECT}，等待…`)
      await sleep(WAIT_MS)
      continue
    }
    settled = true
    break
  }

  if (html === '') {
    failures.push('首页始终取不到 200')
    return
  }
  if (!settled) {
    failures.push(`等了 ${WAIT_ATTEMPTS} 次仍未等到新构建上线 —— 下面的检查是对着旧部署做的，结论不可信`)
  }
  for (const path of EXPECT_SAME) {
    record(localCopy(path) !== undefined, `本地存在 ${path}（比对基准）`)
  }
  record(html.includes('id="root"'), '首页含 #root 挂载点')
  record(html.includes('lang="zh-CN"'), '首页声明 lang="zh-CN"')
  if (EXPECT !== undefined) {
    record(html.includes(EXPECT), `首页已引用目标构建 ${EXPECT}`)
  }

  // ---- 2. index.html 引用的每个资源 ----
  const refs = localRefs(html)
  record(refs.length > 0, 'index.html 引用了本地资源', `${refs.length} 个`)
  for (const ref of refs) {
    const response = await get(BASE + ref)
    record(response.status === 200, `资源 ${ref}`, `HTTP ${response.status}`)
  }

  // ---- 3. manifest 与图标 ----
  const manifestResponse = await get(`${BASE}manifest.webmanifest`)
  record(manifestResponse.status === 200, 'manifest.webmanifest', `HTTP ${manifestResponse.status}`)
  if (manifestResponse.status === 200) {
    try {
      const manifest = JSON.parse(await manifestResponse.text())
      record(typeof manifest.name === 'string' && manifest.name.length > 0, 'manifest 有 name')
      record(manifest.display === 'standalone', 'manifest display=standalone', String(manifest.display))
      record(manifest.lang === 'zh-CN', 'manifest lang=zh-CN', String(manifest.lang))
      const icons = Array.isArray(manifest.icons) ? manifest.icons : []
      record(icons.length > 0, 'manifest 声明了图标', `${icons.length} 个`)
      record(
        icons.some((icon) => icon.purpose === 'maskable'),
        'manifest 含 maskable 图标',
      )
      record(
        icons.some((icon) => icon.sizes === '192x192') && icons.some((icon) => icon.sizes === '512x512'),
        'manifest 含 192 与 512 图标',
      )
      for (const icon of icons) {
        const response = await get(BASE + String(icon.src).replace(/^\.\//, ''))
        record(response.status === 200, `图标 ${icon.src}`, `HTTP ${response.status}`)
      }
    } catch (error) {
      failures.push(`manifest 不是合法 JSON：${String(error)}`)
    }
  }

  // ---- 4. service worker 的预缓存清单 ----
  const swResponse = await get(`${BASE}sw.js`)
  record(swResponse.status === 200, 'sw.js', `HTTP ${swResponse.status}`)
  if (swResponse.status === 200) {
    const sw = await swResponse.text()
    const entries = [...sw.matchAll(/url:"([^"]+)"/g)].map((match) => match[1])
    record(entries.length > 0, 'sw.js 有预缓存清单', `${entries.length} 条`)
    record(
      entries.every((url) => !url.startsWith('/')),
      '预缓存路径全是相对路径（子目录部署的关键）',
      entries.filter((url) => url.startsWith('/')).join(', ') || '全部相对',
    )
    const unique = [...new Set(entries)]
    for (const entry of unique) {
      const response = await get(BASE + entry)
      record(response.status === 200, `预缓存 ${entry}`, `HTTP ${response.status}`)
    }
  }

  // ---- 5. 离线能力的两个前提 ----
  const registerResponse = await get(`${BASE}registerSW.js`)
  record(registerResponse.status === 200, 'registerSW.js（自动注册 service worker）')
}

try {
  await main()
} catch (error) {
  failures.push(`自检本身出错：${String(error)}`)
}

console.log('')
console.log(`通过 ${checked.length} 项，失败 ${failures.length} 项`)
if (failures.length > 0) {
  console.log('失败明细：')
  for (const failure of failures) console.log(`  - ${failure}`)
  process.exit(1)
}
console.log('部署自检通过。')
