import type { LogEntry } from '../../store/gameStore'
import { TILE_COLOR_CSS } from '../tiles'

export interface LogPanelProps {
  readonly entries: readonly LogEntry[]
  readonly humanPlayerId: string
}

/** 对局日志：中文播报，最新在最上面。 */
export function LogPanel({ entries, humanPlayerId }: LogPanelProps) {
  const recent = [...entries].reverse().slice(0, 60)

  return (
    <section className="log">
      {recent.map((entry) => (
        <div key={entry.id} className={entry.player === humanPlayerId ? 'log__entry log__entry--me' : 'log__entry'}>
          {entry.player === undefined ? null : (
            <span
              className="log__player"
              style={{ background: entry.player === humanPlayerId ? TILE_COLOR_CSS.ship : TILE_COLOR_CSS.building }}
            >
              {entry.player === humanPlayerId ? '你' : '对手'}
            </span>
          )}
          <span className="log__text">{entry.text}</span>
        </div>
      ))}
      {recent.length === 0 ? <p className="muted">暂无记录</p> : null}
    </section>
  )
}
