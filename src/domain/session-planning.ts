export const SESSION_MINUTES = [15, 25, 45, 60] as const

/** 所有推荐入口使用同一规则，只缩短建议时长，不越过今日额度。 */
export function affordableMinutes(remaining: number, preferred = 25): number | undefined {
  return [...SESSION_MINUTES].reverse().find((minutes) => minutes <= preferred && minutes <= remaining)
}
