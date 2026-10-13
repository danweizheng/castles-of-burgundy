/**
 * "离线就绪"状态。
 *
 * 为什么需要它：这个应用的使用场景就是"装到主屏，然后上飞机玩"。
 * 但用户没法从界面上知道"现在断网还能不能用"——第一次访问时 Service Worker 刚装上、
 * 还没接管页面，要等它接管完成才算真的缓存好了。
 *
 * 判定很简单：`navigator.serviceWorker.controller` 非空就说明 SW 已经在接管这个页面，
 * 也就是所有预缓存资源都已经拿到本地了（sw.js 的预缓存清单是安装时一次性写进去的）。
 */

import { useEffect, useState } from 'react'

export type OfflineState =
  /** 浏览器不支持 Service Worker（例如测试环境），或者不是安全上下文 */
  | 'unsupported'
  /** SW 已注册但还没接管页面：首次访问时属于这个阶段 */
  | 'preparing'
  /** SW 已接管：此时断网也能打开 */
  | 'ready'

interface ServiceWorkerLike {
  readonly controller: unknown
}

interface NavigatorLike {
  readonly serviceWorker?: ServiceWorkerLike | undefined
}

/** 纯判定函数，便于单测。 */
export function readOfflineState(source: NavigatorLike): OfflineState {
  if (source.serviceWorker === undefined) return 'unsupported'
  return source.serviceWorker.controller === null || source.serviceWorker.controller === undefined
    ? 'preparing'
    : 'ready'
}

export function offlineLabel(state: OfflineState): string {
  switch (state) {
    case 'ready':
      return '离线：已就绪'
    case 'preparing':
      return '离线：正在缓存…（首次访问请保持联网片刻）'
    case 'unsupported':
      return '离线：当前环境不支持'
  }
}

export function useOfflineState(): OfflineState {
  const [state, setState] = useState<OfflineState>(() =>
    typeof navigator === 'undefined' ? 'unsupported' : readOfflineState(navigator),
  )

  useEffect(() => {
    if (typeof navigator === 'undefined') return
    const serviceWorker = navigator.serviceWorker
    if (serviceWorker === undefined) return

    let timer: number | undefined
    const update = (): void => {
      const next = readOfflineState(navigator)
      setState(next)
      // 一旦就绪就停止轮询：没必要一直问
      if (next === 'ready' && timer !== undefined) {
        window.clearInterval(timer)
        timer = undefined
      }
    }

    serviceWorker.addEventListener('controllerchange', update)
    // controllerchange 在"当前页面被接管"时不一定立刻触发，所以补一个短轮询兜底
    timer = window.setInterval(update, 1500)
    update()

    return () => {
      serviceWorker.removeEventListener('controllerchange', update)
      if (timer !== undefined) window.clearInterval(timer)
    }
  }, [])

  return state
}
