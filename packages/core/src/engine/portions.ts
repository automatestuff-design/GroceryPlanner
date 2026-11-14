import type { AgeGroup, Household, Member } from "../types";

/** Adult-equivalent serving per age group. Starting values to tune with real families. */
export const PORTION_BY_AGE: Record<AgeGroup, number> = {
  adult: 1,
  teen: 1.15,
  child: 0.6,
  toddler: 0.35,
};

export function portionFactor(member: Member): number {
  return member.portionOverride ?? PORTION_BY_AGE[member.ageGroup];
}

/** Members who eat a meal. Personal mode plans for the first adult only. */
export function eatersFor(household: Household): Member[] {
  if (household.mode === "personal") {
    const me = household.members.find((m) => m.ageGroup === "adult") ?? household.members[0];
    return me ? [me] : [];
  }
  return household.members;
}

/** Servings to cook, rounded up to the nearest half serving. */
export function servingsToCook(eaters: Member[]): number {
  const raw = eaters.reduce((sum, m) => sum + portionFactor(m), 0);
  return Math.ceil(raw * 2) / 2;
}
