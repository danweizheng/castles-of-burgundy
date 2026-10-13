import { describe, expect, it } from 'vitest'
import { offlineLabel, readOfflineState, type OfflineState } from '../useOfflineReady'

describe('离线就绪判定', () => {
  it('没有 serviceWorker 时视为不支持（测试环境、非安全上下文都是这样）', () => {
    expect(readOfflineState({})).toBe('unsupported')
    expect(readOfflineState({ serviceWorker: undefined })).toBe('unsupported')
  })

  it('SW 已注册但还没接管页面 → 正在缓存（首次访问就是这一阶段）', () => {
    expect(readOfflineState({ serviceWorker: { controller: null } })).toBe('preparing')
    expect(readOfflineState({ serviceWorker: { controller: undefined } })).toBe('preparing')
  })

  it('SW 已接管页面 → 离线就绪', () => {
    expect(readOfflineState({ serviceWorker: { controller: {} } })).toBe('ready')
  })

  it('三种状态都有中文说明，且不会出现空字符串', () => {
    const states: OfflineState[] = ['unsupported', 'preparing', 'ready']
    for (const state of states) {
      const label = offlineLabel(state)
      expect(label.length).toBeGreaterThan(0)
      expect(label).toContain('离线')
    }
    expect(offlineLabel('ready')).toContain('已就绪')
    expect(offlineLabel('preparing')).toContain('正在缓存')
  })
})
