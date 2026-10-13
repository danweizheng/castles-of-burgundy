import type { BoardSpace, HexTile, PlayerBoardDef } from '../../engine/types'
import { axialKey } from '../../engine/hex'
import { TILE_COLOR_CSS, TILE_COLOR_DARK, TILE_COLOR_LABEL, tileGlyph } from '../tiles'

/**
 * 玩家领地渲染（SVG）。
 *
 * 为什么用 SVG 而不是 Canvas：单张版图只有 37 个六边形，SVG 性能完全够用，
 * 而且是矢量（任意 DPI 清晰）、点击命中检测免费、样式动画用 CSS 就能写。
 *
 * 六边形朝向取"尖顶"（pointy-top）。朝向只影响观感，不影响相邻关系。
 */

const SQRT3 = Math.sqrt(3)

function center(q: number, r: number, size: number): { x: number; y: number } {
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

export interface HexBoardProps {
  readonly board: PlayerBoardDef
  readonly estate: Readonly<Record<string, HexTile>>
  /** 可以点击的落点：坐标键 → 可用的仓储下标 */
  readonly targets?: ReadonlyMap<string, readonly number[]> | undefined
  readonly onTapSpace?: ((space: BoardSpace) => void) | undefined
  readonly size?: number
  /** 紧凑模式：不显示点数，用于对手小版图 */
  readonly compact?: boolean
}

export function HexBoard({
  board,
  estate,
  targets,
  onTapSpace,
  size = 17,
  compact = false,
}: HexBoardProps) {
  const placed = board.spaces.map((space) => {
    const { x, y } = center(space.q, space.r, size)
    return { space, x, y }
  })

  const xs = placed.map((p) => p.x)
  const ys = placed.map((p) => p.y)
  const padding = size * 1.25
  const minX = Math.min(...xs) - padding
  const minY = Math.min(...ys) - padding
  const width = Math.max(...xs) - Math.min(...xs) + padding * 2
  const height = Math.max(...ys) - Math.min(...ys) + padding * 2
  const corners = hexCorners(size)

  return (
    <svg
      className="hexboard"
      viewBox={`${minX} ${minY} ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={board.name}
    >
      {placed.map(({ space, x, y }) => {
        const key = axialKey(space)
        const tile = estate[key]
        const isTarget = targets?.has(key) ?? false
        const points = corners.map(([dx, dy]) => `${x + dx},${y + dy}`).join(' ')
        const fill = tile === undefined ? TILE_COLOR_DARK[space.color] : TILE_COLOR_CSS[space.color]
        const glyph = tile === undefined ? undefined : tileGlyph(tile)

        return (
          <g
            key={key}
            className={isTarget ? 'hex hex--target' : 'hex'}
            onClick={onTapSpace === undefined ? undefined : () => onTapSpace(space)}
          >
            <title>{`${space.number} 点 · ${TILE_COLOR_LABEL[space.color]}${
              glyph === undefined ? '（空）' : `（${glyph.label}）`
            }`}</title>
            <polygon
              points={points}
              fill={isTarget ? TILE_COLOR_CSS[space.color] : fill}
              stroke={isTarget ? '#ffd76a' : TILE_COLOR_CSS[space.color]}
              strokeWidth={isTarget ? size * 0.2 : size * 0.09}
              strokeLinejoin="round"
            />

            {tile === undefined ? (
              compact ? null : (
                <text
                  x={x}
                  y={y}
                  className="hex__num"
                  fontSize={size * 0.92}
                  textAnchor="middle"
                  dominantBaseline="central"
                >
                  {space.number}
                </text>
              )
            ) : (
              <>
                <text
                  x={x}
                  y={glyph?.sub === undefined ? y : y - size * 0.1}
                  className="hex__glyph"
                  fontSize={size * (compact ? 0.85 : 1.0)}
                  textAnchor="middle"
                  dominantBaseline="central"
                >
                  {glyph?.text}
                </text>
                {glyph?.sub === undefined || compact ? null : (
                  <text
                    x={x + size * 0.44}
                    y={y + size * 0.48}
                    className="hex__sub"
                    fontSize={size * 0.6}
                    textAnchor="middle"
                    dominantBaseline="central"
                  >
                    {glyph.sub}
                  </text>
                )}
              </>
            )}
          </g>
        )
      })}
    </svg>
  )
}
