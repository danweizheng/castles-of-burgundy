import { useRef, useState } from 'react'
import { useGameStore } from '../../store/gameStore'

function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export interface SaveMenuProps {
  readonly onClose: () => void
}

/**
 * 存档面板。
 *
 * 自动存档负责"随手关上也能接着下"，导出文件负责"iOS 清了存储也丢不了"。
 * 两者缺一不可：iOS 对长期未访问的站点会回收存储，而一局要下 25 轮。
 */
export function SaveMenu({ onClose }: SaveMenuProps) {
  const state = useGameStore((store) => store.state)
  const lastSavedAt = useGameStore((store) => store.lastSavedAt)
  const saveError = useGameStore((store) => store.saveError)
  const exportSaveText = useGameStore((store) => store.exportSaveText)
  const importSaveText = useGameStore((store) => store.importSaveText)
  const clearSave = useGameStore((store) => store.clearSave)
  const newGame = useGameStore((store) => store.newGame)

  const fileRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState<string | null>(null)

  return (
    <div className="sheet" role="dialog" aria-modal="true">
      <div className="sheet__panel">
        <h2 className="sheet__title">存档</h2>

        <p className="muted">
          每走一步都会自动存到本机。iOS 会清理长期不用的站点存储，所以重要局面建议导出成文件。
        </p>
        <p className="muted">
          最后自动存档：{lastSavedAt === null ? '还没有' : new Date(lastSavedAt).toLocaleString()}
          {' · '}
          种子 {state.seed}
        </p>

        {saveError === null ? null : <p className="banner banner--warn">{saveError}</p>}
        {message === null ? null : <p className="banner banner--hint">{message}</p>}

        <button
          type="button"
          className="btn btn--block"
          onClick={() => {
            downloadText(`勃艮第城堡-存档-${Date.now()}.json`, exportSaveText())
            setMessage('已导出 JSON 文件')
          }}
        >
          导出存档（下载 JSON）
        </button>

        <button type="button" className="btn btn--block" onClick={() => fileRef.current?.click()}>
          导入存档（选择 JSON 文件）
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file === undefined) return
            void file.text().then((text) => {
              const result = importSaveText(text)
              setMessage(result.ok ? '导入成功，已切换到该局面' : `导入失败：${result.error ?? '未知错误'}`)
            })
          }}
        />

        <button
          type="button"
          className="btn btn--block"
          onClick={() => {
            void clearSave().then(() => setMessage('已清除本机存档（导出过的文件不受影响）'))
          }}
        >
          清除本机存档
        </button>

        <button
          type="button"
          className="btn btn--block"
          onClick={() => {
            newGame()
            onClose()
          }}
        >
          放弃当前对局，开新局
        </button>

        <button type="button" className="btn btn--ghost btn--block" onClick={onClose}>
          关闭
        </button>
      </div>
    </div>
  )
}
