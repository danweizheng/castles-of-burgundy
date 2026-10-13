import type { Move } from '../../engine/moves'

export interface ChooserOption {
  readonly label: string
  readonly move: Move
}

export interface ChooserSheetProps {
  readonly title: string
  readonly options: readonly ChooserOption[]
  readonly onPick: (move: Move) => void
  readonly onCancel: () => void
}

/**
 * 二选一弹层。
 *
 * 出现的场合很少但都很容易出错：仓储满时"先弃哪一枚"、同一个格子能放多枚时"放哪一枚"、
 * 买板块时"从哪个来源买"。与其在界面上把这些组合都铺开，不如让玩家点完之后再确认一次。
 */
export function ChooserSheet({ title, options, onPick, onCancel }: ChooserSheetProps) {
  return (
    <div className="sheet" role="dialog" aria-modal="true">
      <div className="sheet__panel">
        <h2 className="sheet__title">{title}</h2>
        <div className="sheet__list">
          {options.map((option, index) => (
            <button
              key={`${option.label}-${index}`}
              type="button"
              className="btn btn--block"
              onClick={() => onPick(option.move)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn--ghost btn--block" onClick={onCancel}>
          取消
        </button>
      </div>
    </div>
  )
}
