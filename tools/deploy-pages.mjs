#!/usr/bin/env node
/**
 * 把 dist 发布到 gh-pages 分支（GitHub Pages 走 HTTPS，iPhone 才能装成 PWA）。
 *
 * 为什么不把 dist 提交进 main：构建产物不该进主分支历史。
 * 为什么用临时目录造一个一次性仓库：这样 gh-pages 分支永远只有构建产物，
 * 且 force push 不会污染主仓库的对象库。
 *
 * 用法：先 pnpm build，再 node tools/deploy-pages.mjs
 */

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const branch = process.env.GH_BRANCH ?? 'gh-pages'
const distDir = join(process.cwd(), 'dist')

// 临时仓库里没有 remote，所以这里直接取主仓库的 origin URL
const remoteUrl =
  process.env.GH_REMOTE_URL ??
  execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: process.cwd() }).toString().trim()

if (!existsSync(distDir)) {
  console.error('找不到 dist/，请先运行 pnpm build')
  process.exit(1)
}

function run(command, args, cwd) {
  console.log(`$ ${command} ${args.join(' ')}`)
  execFileSync(command, args, { cwd, stdio: 'inherit' })
}

const work = mkdtempSync(join(tmpdir(), 'cob-pages-'))

try {
  cpSync(distDir, work, { recursive: true })
  // GitHub Pages 默认走 Jekyll，会忽略下划线开头的文件；关掉它更保险
  writeFileSync(join(work, '.nojekyll'), '')

  run('git', ['init', '-q'], work)
  run('git', ['add', '-A'], work)
  run(
    'git',
    ['-c', 'user.name=deploy', '-c', 'user.email=deploy@local', 'commit', '-q', '-m', 'deploy'],
    work,
  )
  run('git', ['push', '--force', remoteUrl, `HEAD:${branch}`], work)

  // 发布后立刻自检：把线上产物的资源图整条走一遍。
  // 传入本次构建的 JS 资源名，好让自检先等 Pages 换成新构建再检查。
  const indexHtml = readFileSync(join(distDir, 'index.html'), 'utf8')
  const asset = /src="\.\/(assets\/[^"]+\.js)"/.exec(indexHtml)?.[1]
  console.log('')
  // 用 process.execPath 而不是字面量 'node'：这个脚本可能在 PATH 里没有 node 的环境下运行
  run(
    process.execPath,
    [join(process.cwd(), 'tools', 'check-deploy.mjs'), ...(asset ? ['--expect', asset] : [])],
    process.cwd(),
  )

  console.log(`\n已发布到 ${branch}。Pages 生效后地址在仓库的 Settings → Pages。`)
} finally {
  rmSync(work, { recursive: true, force: true })
}
