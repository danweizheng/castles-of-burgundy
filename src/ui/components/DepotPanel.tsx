import { activeSlotsFor } from '../../engine/gameBoard'
import type { GameState, RulesetConfig } from '../../engine/state'
import { DIE_VALUES, type DieValue, type HexTile } from '../../engine/types'
import { goodsCss, tileGlyph } from '../tiles'

/**
 * 中央版图区：6 个编号仓库（每个仓库有若干"印了颜色"的格位）+ 各自的货物格。
 *
 * 布局用纵向 6 行而不是 6 列横排：手机竖屏下横排 6 个仓库每格只剩 40px 左右，
 * 既放不下字也点不准。
 */

export interface DepotPanelProps {
  readonly config: RulesetConfig
  readonly state: GameState
  readonly highlightedSlotIds: ReadonlySet<string>
  readonly onTapSlot: (slotId: string) => void
  readonly highlightedGoodsSpaces?: ReadonlySet<DieValue> | undefined
  readonly onTapGoodsSpace?: ((space: DieValue) => void) | undefined
}

function TileFace({ tile }: { readonly tile: HexTile | null }) {
  if (tile === null) return <span className="tileface tileface--empty">空</span>
  const glyph = tileGlyph(tile)
  return (
    <span className="tileface" style={{ background: glyph.color }} title={glyph.label}>
      <span className="tileface__text">{glyph.text}</span>
      {glyph.sub === undefined ? null : <span className="tileface__sub">{glyph.sub}</span>}
    </span>
  )
}

export function DepotPanel({
  config,
  state,
  highlightedSlotIds,
  onTapSlot,
  highlightedGoodsSpaces,
  onTapGoodsSpace,
}: DepotPanelProps) {
  return (
    <div className="depots">
      {DIE_VALUES.map((depot) => {
        const slots = activeSlotsFor(config.gameBoard, depot, state.playerCount)
        const goods = state.goodsSpaces[String(depot)] ?? []
        const goodsTargeted = highlightedGoodsSpaces?.has(depot) ?? false

        return (
          <div className="depot" key={depot}>
            <div className="depot__num">{depot}</div>

            <div className="depot__slots">
              {slots.map((slot) => {
                const targeted = highlightedSlotIds.has(slot.id)
                return (
                  <button
                    key={slot.id}
                    type="button"
                    className={targeted ? 'slot slot--target' : 'slot'}
                    disabled={!targeted}
                    onClick={() => onTapSlot(slot.id)}
                    aria-label={`第 ${depot} 号仓库格位`}
                  >
                    <TileFace tile={state.depotSlots[slot.id] ?? null} />
                  </button>
                )
              })}
            </div>

            <button
              type="button"
              className={goodsTargeted ? 'goodsbin goodsbin--target' : 'goodsbin'}
              disabled={!goodsTargeted}
              onClick={() => onTapGoodsSpace?.(depot)}
              aria-label={`第 ${depot} 号货物格`}
            >
              {goods.length === 0 ? (
                <span className="goodsbin__empty">—</span>
              ) : (
                goods.map((kind, index) => (
                  <span
                    key={`${kind}-${index}`}
                    className="goodschip"
                    style={{ background: goodsCss(kind) }}
                  />
                ))
              )}
            </button>
          </div>
        )
      })}
    </div>
  )
}
