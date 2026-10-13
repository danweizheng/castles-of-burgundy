/**
 * 计分与各类"按人数变化"的数值表。
 *
 * 这一整个文件里除了少数几条已由官方规则确认，其余都是**集中在一处的常量**，
 * 目的就是让待确认的数值（Q1/Q2）只需要改一行，而不是散落在逻辑里。
 */

/**
 * 区域大小 → 基础分。索引即区域格数（索引 0 是占位）。
 *
 * 官方规则：区域大小 1–8 格，得分 1 至 36 分。⚠️ 待实物确认（Q1）。
 * 我按三角数 n(n+1)/2 实现：1, 3, 6, 10, 15, 21, 28, 36 —— 正好覆盖 1–36，
 * 且与"最大 8 格 → 36 分"完全吻合，因此把握度较高。
 */
export const REGION_SIZE_VP: readonly number[] = [0, 1, 3, 6, 10, 15, 21, 28, 36]

/** 区域最大格数（超出说明数据有误）。 */
export const MAX_REGION_SIZE = 8

/**
 * 阶段 A–E 每完成一个区域的额外分（与区域大小无关）。索引 0..4 = A..E。
 *
 * 官方原文只说"第一阶段 10 分到最后一阶段 2 分"。⚠️ 等差 10/8/6/4/2 待确认（Q2）。
 */
export const PHASE_COMPLETION_BONUS: readonly number[] = [10, 8, 6, 4, 2]

export const TOTAL_PHASES = 5
export const ROUNDS_PER_PHASE = 5
/** 每回合的行动数：每个行动消耗一颗骰子。 */
export const ACTIONS_PER_TURN = 2
/** 仓储区格数（左下角，板块）。 */
export const STORAGE_CAPACITY = 3
/** 货物仓储最多存放的不同颜色数（同色叠放）。 */
export const GOODS_STORAGE_TYPES = 3

export type SupportedPlayerCount = 2 | 3 | 4

function assertPlayerCount(playerCount: number): asserts playerCount is SupportedPlayerCount {
  if (playerCount !== 2 && playerCount !== 3 && playerCount !== 4) {
    throw new Error(`人数只能是 2/3/4，收到 ${playerCount}`)
  }
}

/**
 * 区域大小的基础分。
 * @param size 区域格数（1–8）
 */
export function regionSizeVp(size: number): number {
  if (!Number.isInteger(size) || size < 1 || size > MAX_REGION_SIZE) {
    throw new Error(`区域格数必须在 1–${MAX_REGION_SIZE} 之间，收到 ${size}`)
  }
  const vp = REGION_SIZE_VP[size]
  if (vp === undefined) throw new Error(`缺少区域格数 ${size} 的分数`)
  return vp
}

/**
 * 当前阶段完成一个区域的额外分。
 * @param phaseIndex 0 起算的阶段序号（A=0 … E=4）
 */
export function phaseCompletionBonus(phaseIndex: number): number {
  const vp = PHASE_COMPLETION_BONUS[phaseIndex]
  if (vp === undefined) throw new Error(`阶段序号必须在 0–4 之间，收到 ${phaseIndex}`)
  return vp
}

/** 完成一个区域的合计得分 = 大小分 + 阶段奖励分。 */
export function regionCompletionVp(size: number, phaseIndex: number): number {
  return regionSizeVp(size) + phaseCompletionBonus(phaseIndex)
}

/**
 * 卖货物时**每枚**货物的得分。
 * 官方：2/3/4 人局分别为 2/3/4 分。另外无论卖几枚都固定得 1 银币（见 SELL_GOODS_SILVERLINGS）。
 */
export function sellGoodsVpPerTile(playerCount: number): number {
  assertPlayerCount(playerCount)
  return playerCount
}

/** 卖货物（骰子行动或仓库效果）固定获得的银币数；3 号知识板块把它变成 2。 */
export const SELL_GOODS_SILVERLINGS = 1

/**
 * 奖励板块得分。官方：大方块 2/3/4 人局 = 5/6/7 分；小方块 = 2/3/4 分。
 * 也就是大方块 = 人数 + 3，小方块 = 人数。
 */
export function bonusTileVp(playerCount: number, size: 'large' | 'small'): number {
  assertPlayerCount(playerCount)
  return size === 'large' ? playerCount + 3 : playerCount
}

/** 终局：每 2 个工人 1 分（向下取整）。 */
export function workersToVp(workers: number): number {
  if (!Number.isInteger(workers) || workers < 0) {
    throw new Error(`工人数必须是非负整数，收到 ${workers}`)
  }
  return Math.floor(workers / 2)
}

/** 终局：每枚未卖出货物 1 分，每枚剩余银币 1 分。 */
export const FINAL_VP_PER_UNSOLD_GOODS = 1
export const FINAL_VP_PER_SILVERLING = 1

/** 拿满 100 分时把 100/200 分数板放上桌面（纯展示用）。 */
export const VP_TILE_THRESHOLD = 100
export const VP_TILE_SECOND_THRESHOLD = 200

/**
 * ⚠️ Q8：市政厅（City Hall）的「再放一枚、不受颜色限制」是否**也取消点数限制**。
 *
 * 官方原文只说 "regardless of colour"，没有提点数；而点数在正常放置里来自骰子，
 * 市政厅的额外放置不消耗骰子，所以两种读法都说得通。
 * 默认 false = 保留点数限制（数字须等于放置市政厅那一格的点数），这是更保守的读法。
 * 确认后改这一行即可，不影响其他任何代码。
 */
export const CITY_HALL_IGNORES_NUMBER = false
