import { playerById, type GameState, type RulesetConfig } from '../../engine/state'
import type { PlayerId } from '../../engine/types'
import { threatsFor } from '../threats'
import { HexBoard } from './HexBoard'
import { PlayerPanel } from './PlayerPanel'

export interface OpponentSheetProps {
  readonly config: RulesetConfig
  readonly state: GameState
  readonly opponentId: PlayerId
  readonly onClose: () => void
}

/**
 * 对手领地放大视图。
 *
 * 手机上那块缩略图只有百来像素高，而本作 2 人局的核心就是卡位 ——
 * 看不清对手的版图等于玩不到重点。这里给全尺寸棋盘 + 资源 + 威胁清单。
 */
export function OpponentSheet({ config, state, opponentId, onClose }: OpponentSheetProps) {
  const opponent = playerById(state, opponentId)
  const board = config.playerBoards[opponent.boardId]
  const threats = threatsFor(config, state, opponentId)

  return (
    <div className="sheet" role="dialog" aria-modal="true">
      <div className="sheet__panel">
        <h2 className="sheet__title">对手的领地</h2>

        {threats.length === 0 ? (
          <p className="muted">对手目前没有接近完成的区域或颜色。</p>
        ) : (
          <>
            <p className="muted">对手快到什么程度（用来决定要不要卡他）：</p>
            <ul className="threatlist">
              {threats.map((threat) => (
                <li
                  key={`${threat.kind}-${threat.label}`}
                  className={threat.remaining === 1 ? 'threat threat--urgent' : 'threat'}
                >
                  只差 <b>{threat.remaining}</b> 格：{threat.label}（完成得 {threat.value} 分）
                </li>
              ))}
            </ul>
          </>
        )}

        {board === undefined ? null : <HexBoard board={board} estate={opponent.estate} size={15} />}

        <PlayerPanel player={opponent} title="对手的资源" />

        <button type="button" className="btn btn--ghost btn--block" onClick={onClose}>
          关闭
        </button>
      </div>
    </div>
  )
}
