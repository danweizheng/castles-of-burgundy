import type { PlayerState } from '../../engine/types'
import { GOODS_KINDS, type GoodsKind } from '../../engine/types'
import { TILE_COLOR_CSS, TILE_COLOR_LABEL, goodsCss, tileGlyph } from '../tiles'

/**
 * 玩家资源面板：银币 / 工人 / 分数 / 货物仓储 / 板块仓储 / 奖励板块。
 *
 * 仓储里的板块是"可以点"的候选（放置时要选一枚），货物同理（卖货时要选一色）。
 * 不可点的一律 disabled，这样"能点的地方"永远等于"引擎允许的地方"。
 */

export interface PlayerPanelProps {
  readonly player: PlayerState
  readonly title: string
  readonly compact?: boolean
  /** 可选的仓储下标 */
  readonly storageTargets?: ReadonlySet<number> | undefined
  readonly onTapStorage?: ((index: number) => void) | undefined
  /** 可卖的货物颜色 */
  readonly goodsTargets?: ReadonlySet<GoodsKind> | undefined
  readonly onTapGoods?: ((kind: GoodsKind) => void) | undefined
}

export function PlayerPanel({
  player,
  title,
  compact = false,
  storageTargets,
  onTapStorage,
  goodsTargets,
  onTapGoods,
}: PlayerPanelProps) {
  const goodsKinds = GOODS_KINDS.filter((kind) => (player.goods[String(kind)] ?? 0) > 0)
  const bonusColors = Object.keys(player.bonusTiles)

  return (
    <section className={compact ? 'panel panel--compact' : 'panel'}>
      <header className="panel__head">
        <span className="panel__title">{title}</span>
        <span className="panel__stats">
          <span className="stat">分数 <b>{player.vp}</b></span>
          <span className="stat">银币 <b>{player.silverlings}</b></span>
          <span className="stat">工人 <b>{player.workers}</b></span>
        </span>
      </header>

      <div className="row">
        <span className="row__label">仓储</span>
        <div className="row__items">
          {Array.from({ length: 3 }, (_, index) => {
            const tile = player.storage[index]
            const targeted = storageTargets?.has(index) ?? false
            if (tile === undefined) {
              return (
                <span key={index} className="tileface tileface--empty">
                  空
                </span>
              )
            }
            const glyph = tileGlyph(tile)
            return (
              <button
                key={index}
                type="button"
                className={targeted ? 'tileface tileface--button tileface--target' : 'tileface tileface--button'}
                style={{ background: glyph.color }}
                disabled={!targeted}
                onClick={() => onTapStorage?.(index)}
                title={glyph.label}
              >
                <span className="tileface__text">{glyph.text}</span>
                {glyph.sub === undefined ? null : <span className="tileface__sub">{glyph.sub}</span>}
              </button>
            )
          })}
        </div>
      </div>

      <div className="row">
        <span className="row__label">货物</span>
        <div className="row__items">
          {goodsKinds.length === 0 ? (
            <span className="muted">无</span>
          ) : (
            goodsKinds.map((kind) => {
              const targeted = goodsTargets?.has(kind) ?? false
              return (
                <button
                  key={kind}
                  type="button"
                  className={targeted ? 'goodschip goodschip--button goodschip--target' : 'goodschip goodschip--button'}
                  style={{ background: goodsCss(kind) }}
                  disabled={!targeted}
                  onClick={() => onTapGoods?.(kind)}
                  title={`货物 ${kind}`}
                >
                  {player.goods[String(kind)] ?? 0}
                </button>
              )
            })
          )}
        </div>
      </div>

      {bonusColors.length > 0 ? (
        <div className="row">
          <span className="row__label">奖励</span>
          <div className="row__items">
            {bonusColors.map((color) => (
              <span
                key={color}
                className="bonuschip"
                style={{ background: TILE_COLOR_CSS[color as keyof typeof TILE_COLOR_CSS] }}
                title={TILE_COLOR_LABEL[color as keyof typeof TILE_COLOR_LABEL]}
              >
                {player.bonusTiles[color] === 'large' ? '大' : '小'}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {player.soldGoods !== undefined && Object.keys(player.soldGoods).length > 0 ? (
        <div className="row">
          <span className="row__label">已卖出</span>
          <div className="row__items">
            {Object.entries(player.soldGoods).map(([kind, count]) => (
              <span
                key={kind}
                className="goodschip goodschip--sold"
                style={{ background: goodsCss(Number(kind) as GoodsKind) }}
                title={`货物 ${kind}`}
              >
                {count}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  )
}
