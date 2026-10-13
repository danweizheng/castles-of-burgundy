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
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const remote = process.env.GH_REMOTE ?? 'origin'
const branch = process.env.GH_BRANCH ?? 'gh-pages'
const distDir = join(process.cwd(), 'dist')

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
  run('git', ['push', '--force', remote, `HEAD:${branch}`], work)

  console.log(`\n已发布到 ${branch}。Pages 生效后地址在仓库的 Settings → Pages。`)
} finally {
  rmSync(work, { recursive: true, force: true })
}
