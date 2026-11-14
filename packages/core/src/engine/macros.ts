import type { ActivityLevel, Macros, Member, PlanTrack } from "../types";

const ACTIVITY: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  "very-active": 1.9,
};

/** Mifflin–St Jeor resting energy, kcal/day. */
export function restingEnergy(m: Required<Pick<Member, "sex" | "age" | "heightCm" | "weightKg">>): number {
  const base = 10 * m.weightKg + 6.25 * m.heightCm - 5 * m.age;
  return Math.round(m.sex === "male" ? base + 5 : base - 161);
}

/**
 * Daily targets for one adult. Standard track: 1.2 g/kg protein.
 * Longevity track: 1.6 g/kg protein (muscle span), ≥30 g fiber, fat ~30% of energy.
 * Returns null when body stats are missing; the planner then uses meal-type mode.
 */
export function dailyTargets(member: Member, track: PlanTrack): Macros | null {
  const { sex, age, heightCm, weightKg } = member;
  if (!sex || !age || !heightCm || !weightKg) {
    return member.macroTargets?.calories ? fill(member.macroTargets) : null;
  }
  const calories = Math.round(restingEnergy({ sex, age, heightCm, weightKg }) * ACTIVITY[member.activity ?? "light"]);
  const proteinPerKg = track === "longevity" ? 1.6 : 1.2;
  const proteinG = Math.round(weightKg * proteinPerKg);
  const fatG = Math.round((calories * 0.3) / 9);
  const carbsG = Math.max(0, Math.round((calories - proteinG * 4 - fatG * 9) / 4));
  const fiberG = track === "longevity" ? 30 : Math.round((calories / 1000) * 14);
  return { ...fill({ calories, proteinG, carbsG, fatG, fiberG }), ...stripUndefined(member.macroTargets) };
}

export function sumMacros(list: Macros[]): Macros {
  return list.reduce(
    (a, b) => ({
      calories: a.calories + b.calories,
      proteinG: a.proteinG + b.proteinG,
      carbsG: a.carbsG + b.carbsG,
      fatG: a.fatG + b.fatG,
      fiberG: a.fiberG + b.fiberG,
    }),
    fill({}),
  );
}

/** Normalised distance between a day's macros and its targets (0 = perfect). */
export function macroDistance(actual: Macros, target: Macros): number {
  const keys: (keyof Macros)[] = ["calories", "proteinG", "carbsG", "fatG"];
  const weights: Record<string, number> = { calories: 1, proteinG: 1.5, carbsG: 0.7, fatG: 0.7 };
  return keys.reduce((d, k) => {
    const t = target[k] || 1;
    return d + (weights[k] ?? 1) * Math.abs(actual[k] - t) / t;
  }, 0);
}

function fill(p: Partial<Macros>): Macros {
  return { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0, ...stripUndefined(p) };
}

function stripUndefined<T extends object>(o: T | undefined): Partial<T> {
  if (!o) return {};
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
