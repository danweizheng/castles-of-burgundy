import { useMemo, useState } from 'react'
import { TILE_COLOR_CSS, TILE_COLOR_LABEL, goodsCss } from '../ui/tiles'
import { DIE_VALUES, TILE_COLORS, type DieValue, type TileColor } from '../engine/types'
import { SYNTHETIC_BOARD } from '../engine/data/boards/synthetic'
import {
  boardToJson,
  cellKey,
  cellsFromJson,
  createCanvas,
  deriveBoard,
  type EditorCell,
} from './model'
import './editor.css'

/**
 * 版图录入器（开发工具，不参与对局）。
 *
 * 为什么要有它：引擎里唯一的假数据就是版图。照片交给视觉模型读更快，但读错了很难发现；
 * 录入器由你对着实物点，产出的是"你亲眼确认过"的数据，而且当场能看到
 * 区域划分、格数统计与引擎校验的结果。
 *
 * 区域不用手工划：官方把区域定义为"同色相连的连续区域"，所以按同色连通块自动派生，
 * 手工划反而容易和引擎的连通判定不一致。
 */

type Tool =
  | { readonly kind: 'color'; readonly value: TileColor }
  | { readonly kind: 'number'; readonly value: DieValue }
  | { readonly kind: 'start' }
  | { readonly kind: 'erase' }

const SQRT3 = Math.sqrt(3)

function hexCenter(q: number, r: number, size: number): { x: number; y: number } {
  return { x: size * SQRT3 * (q + r / 2), y: size * 1.5 * r }
}

function hexCorners(size: number): Array<readonly [number, number]> {
  const corners: Array<readonly [number, number]> = []
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI / 180) * (60 * i - 30)
    corners.push([size * Math.cos(angle), size * Math.sin(angle)])
  }
  return corners
}

function applyTool(cell: EditorCell, tool: Tool): EditorCell {
  switch (tool.kind) {
    case 'color':
      return {
        ...cell,
        active: true,
        color: tool.value,
        // 颜色改成非深红时，原来的"起始格"标记要撤掉，否则会导出一张自相矛盾的版图
        isStart: cell.isStart && tool.value === 'castle',
      }
    case 'number':
      return { ...cell, active: true, number: tool.value }
    case 'start':
      return { ...cell, active: true, color: 'castle', isStart: true }
    case 'erase':
      return { ...cell, active: false, isStart: false }
  }
}

function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function BoardEditor() {
  const [cells, setCells] = useState<EditorCell[]>(() => createCanvas())
  const [boardId, setBoardId] = useState('1')
  const [boardName, setBoardName] = useState('玩家版图 No.1')
  const [tool, setTool] = useState<Tool>({ kind: 'color', value: 'building' })
  const [message, setMessage] = useState<string | null>(null)
  const [importText, setImportText] = useState('')

  const derived = useMemo(() => deriveBoard(cells, boardId, boardName), [cells, boardId, boardName])
  const json = useMemo(() => (derived.board === undefined ? '' : boardToJson(derived.board)), [derived])

  const size = 24
  const placed = cells.map((cell) => {
    const { x, y } = hexCenter(cell.q, cell.r, size)
    return { cell, x, y }
  })
  const xs = placed.map((p) => p.x)
  const ys = placed.map((p) => p.y)
  const pad = size * 1.2
  const minX = Math.min(...xs) - pad
  const minY = Math.min(...ys) - pad
  const width = Math.max(...xs) - Math.min(...xs) + pad * 2
  const height = Math.max(...ys) - Math.min(...ys) + pad * 2
  const corners = hexCorners(size)

  function tapCell(cell: EditorCell): void {
    setCells((previous) => {
      const updated = applyTool(cell, tool)
      return previous.map((current) => {
        if (cellKey(current) !== cellKey(cell)) {
          // 「起始格」是唯一的：设新的同时清掉旧的
          return tool.kind === 'start' && current.isStart ? { ...current, isStart: false } : current
        }
        return updated
      })
    })
  }

  function loadExample(): void {
    const restored = cellsFromJson(createCanvas(), boardToJson(SYNTHETIC_BOARD))
    if (restored.cells === undefined) {
      setMessage(restored.error ?? '载入示例失败')
      return
    }
    setCells(restored.cells)
    setBoardId(SYNTHETIC_BOARD.id)
    setBoardName(SYNTHETIC_BOARD.name)
    setMessage('已载入合成版图作为示例：可以在此基础上修改，或先清空再从零录入')
  }

  return (
    <div className="editor">
      <header className="editor__head">
        <h1>版图录入器</h1>
        <p className="muted">
          对着实物点格子。选颜色再点格子＝标该格颜色（同时让它存在）；选数字再点格子＝标点数。
          「起始格」是开局城堡的推荐位置；「删除」把格子标成不存在。
        </p>
      </header>

      <section className="editor__tools">
        <div className="editor__group">
          <span className="editor__label">颜色</span>
          {TILE_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className={
                tool.kind === 'color' && tool.value === color ? 'chip chip--on' : 'chip'
              }
              style={{ background: TILE_COLOR_CSS[color] }}
              onClick={() => setTool({ kind: 'color', value: color })}
            >
              {TILE_COLOR_LABEL[color]}
            </button>
          ))}
        </div>

        <div className="editor__group">
          <span className="editor__label">点数</span>
          {DIE_VALUES.map((value) => (
            <button
              key={value}
              type="button"
              className={tool.kind === 'number' && tool.value === value ? 'chip chip--on' : 'chip'}
              onClick={() => setTool({ kind: 'number', value })}
            >
              {value}
            </button>
          ))}
        </div>

        <div className="editor__group">
          <span className="editor__label">其它</span>
          <button
            type="button"
            className={tool.kind === 'start' ? 'chip chip--on' : 'chip'}
            onClick={() => setTool({ kind: 'start' })}
          >
            起始格
          </button>
          <button
            type="button"
            className={tool.kind === 'erase' ? 'chip chip--on' : 'chip'}
            onClick={() => setTool({ kind: 'erase' })}
          >
            删除
          </button>
        </div>
      </section>

      <section className="editor__canvas">
        <svg
          viewBox={`${minX} ${minY} ${width} ${height}`}
          className="editor__svg"
          role="img"
          aria-label="版图画布"
        >
          {placed.map(({ cell, x, y }) => {
            const key = cellKey(cell)
            const points = corners.map(([dx, dy]) => `${x + dx},${y + dy}`).join(' ')
            const fill = cell.active ? TILE_COLOR_CSS[cell.color] : '#1b150e'
            return (
              <g key={key} onClick={() => tapCell(cell)} className="editor__cell">
                <polygon
                  points={points}
                  fill={fill}
                  stroke={cell.isStart ? '#ffd76a' : cell.active ? TILE_COLOR_CSS[cell.color] : '#3d3225'}
                  strokeWidth={cell.isStart ? size * 0.22 : size * 0.07}
                  strokeDasharray={cell.active ? undefined : `${size * 0.18} ${size * 0.14}`}
                  strokeLinejoin="round"
                />
                {cell.active ? (
                  <text
                    x={x}
                    y={y}
                    className="editor__num"
                    fontSize={size * 0.95}
                    textAnchor="middle"
                    dominantBaseline="central"
                  >
                    {cell.number}
                  </text>
                ) : null}
                {cell.isStart ? (
                  <text
                    x={x}
                    y={y + size * 0.62}
                    className="editor__start"
                    fontSize={size * 0.5}
                    textAnchor="middle"
                    dominantBaseline="central"
                  >
                    起始
                  </text>
                ) : null}
              </g>
            )
          })}
        </svg>
      </section>

      <section className="editor__report">
        <div className="editor__row">
          <label>
            版图编号
            <input value={boardId} onChange={(event) => setBoardId(event.target.value)} size={3} />
          </label>
          <label>
            名称
            <input value={boardName} onChange={(event) => setBoardName(event.target.value)} />
          </label>
        </div>

        <p className="editor__summary">{derived.summary}</p>

        {derived.issues.length === 0 ? (
          <p className="ok">校验通过：这张版图可以直接替换进引擎。</p>
        ) : (
          <ul className="editor__issues">
            {derived.issues.map((issue, index) => (
              <li key={index} className={issue.severity === 'error' ? 'bad' : 'warn'}>
                {issue.severity === 'error' ? '错误' : '提示'}：{issue.message}
              </li>
            ))}
          </ul>
        )}

        {message === null ? null : <p className="muted">{message}</p>}

        <div className="editor__buttons">
          <button
            type="button"
            className="btn btn--primary"
            disabled={json === ''}
            onClick={() => downloadText(`board-${boardId}.json`, json)}
          >
            下载 JSON
          </button>
          <button
            type="button"
            className="btn"
            disabled={json === ''}
            onClick={() => {
              void navigator.clipboard
                ?.writeText(json)
                .then(() => setMessage('JSON 已复制到剪贴板'))
                .catch(() => setMessage('复制失败，请用下面的文本框手动全选复制'))
            }}
          >
            复制 JSON
          </button>
          <button type="button" className="btn" onClick={loadExample}>
            载入示例
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setCells(createCanvas())
              setMessage('画布已清空')
            }}
          >
            清空
          </button>
        </div>

        <label className="editor__import">
          从 JSON 导入（覆盖当前画布）
          <textarea
            rows={3}
            value={importText}
            placeholder="把导出的 JSON 粘到这里，然后点下面的按钮"
            onChange={(event) => setImportText(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn"
          onClick={() => {
            const restored = cellsFromJson(createCanvas(), importText)
            if (restored.cells === undefined) {
              setMessage(restored.error ?? '导入失败')
              return
            }
            setCells(restored.cells)
            setMessage('已导入')
          }}
        >
          导入到画布
        </button>

        <label className="editor__import">
          当前版图 JSON（可手动全选复制，方便从手机传到电脑）
          <textarea rows={6} readOnly value={json} />
        </label>
      </section>

      <footer className="editor__foot muted">
        <span>
          货物色卡参考：{DIE_VALUES.map((value) => (
            <span key={value} className="goodschip" style={{ background: goodsCss(value) }} />
          ))}
        </span>
        <span>区域由"同色连通块"自动派生，不需要手工划边界。</span>
      </footer>
    </div>
  )
}
