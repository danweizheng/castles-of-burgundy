import { useEffect } from 'react'
import { useGameStore } from '../store/gameStore'
import { GameScreen } from './screens/GameScreen'

/**
 * 界面隐藏时立刻落盘。
 *
 * 为什么必须有：自动存档是 400ms 防抖的，如果玩家在窗口内切走应用或锁屏，
 * 这一次操作就白做了。iOS 对"添加到主屏"的 PWA 会在切到后台后很快挂起甚至回收，
 * 所以 **`visibilitychange`（以及 `pagehide`）是手机上唯一可靠的落盘时机** ——
 * 而手机正是这个应用的唯一目标平台。
 */
function useFlushSaveOnHide(): void {
  const saveNow = useGameStore((store) => store.saveNow)

  useEffect(() => {
    const flush = (): void => {
      if (document.visibilityState === 'hidden') void saveNow()
    }
    // pagehide 覆盖"切到后台后被回收"这条路径；visibilitychange 覆盖切应用/锁屏
    document.addEventListener('visibilitychange', flush)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', flush)
      window.removeEventListener('pagehide', flush)
    }
  }, [saveNow])
}

export function App() {
  useFlushSaveOnHide()
  return <GameScreen />
}
