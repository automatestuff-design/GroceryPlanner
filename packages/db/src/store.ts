import type { PlannerStore } from "@mealplan/assistant";
import type { ExtraItem, Household, Member, PlanRequest, WeekPlan } from "@mealplan/core";
import { asUser, type Claims, type Db, type Tx } from "./pool";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface HouseholdRow {
  id: string; name: string; mode: Household["mode"]; diet: Household["diet"]; pantry: string[];
}
interface MemberRow {
  id: string; name: string; age_group: Member["ageGroup"]; age: number | null; sex: Member["sex"] | null;
  height_cm: string | null; weight_kg: string | null; activity: Member["activity"] | null;
  allergies: Member["allergies"]; dislikes: string[]; portion_override: string | null; macro_targets: Member["macroTargets"] | null;
}

/**
 * PlannerStore on Supabase Postgres. One instance per request, bound to the caller's
 * verified JWT claims; every query runs as that user under row-level security.
 * The first call for a new user creates their household (ensure_household()).
 */
export class PostgresStore implements PlannerStore {
  private householdId?: string;

  constructor(private pool: Db, private claims: Claims) {}

  private tx<T>(fn: (tx: Tx) => Promise<T>) {
    return asUser(this.pool, this.claims, fn);
  }

  private assertSelf(userId: string) {
    if (userId !== this.claims.sub) throw new Error("Store is bound to a different user");
  }

  private async ensureHousehold(tx: Tx): Promise<string> {
    if (this.householdId) return this.householdId;
    const name = typeof this.claims.user_metadata === "object" ? (this.claims.user_metadata as { name?: string }).name : undefined;
    const { rows } = await tx.query<{ id: string }>("select ensure_household($1) as id", [name ?? null]);
    this.householdId = rows[0]!.id;
    return this.householdId;
  }

  async getHousehold(userId: string): Promise<Household> {
    this.assertSelf(userId);
    return this.tx(async (tx) => loadHousehold(tx, await this.ensureHousehold(tx)));
  }

  async saveHousehold(userId: string, h: Household): Promise<void> {
    this.assertSelf(userId);
    await this.tx(async (tx) => {
      const hid = await this.ensureHousehold(tx);
      await tx.query(
        `update households set name = $2, mode = $3, diet = $4, pantry = $5 where id = $1`,
        [hid, h.name, h.mode, h.diet, h.pantry],
      );
      const keep = h.members.filter((m) => UUID.test(m.id)).map((m) => m.id);
      await tx.query("delete from members where household_id = $1 and not (id = any($2::uuid[]))", [hid, keep]);
      for (const m of h.members) {
        const params = [
          hid, m.name, m.ageGroup, m.age ?? null, m.sex ?? null, m.heightCm ?? null, m.weightKg ?? null, m.activity ?? null,
          m.allergies, m.dislikes, m.portionOverride ?? null, m.macroTargets ? JSON.stringify(m.macroTargets) : null,
        ];
        if (UUID.test(m.id)) {
          const res = await tx.query(
            `insert into members (household_id, name, age_group, age, sex, height_cm, weight_kg, activity, allergies, dislikes, portion_override, macro_targets, id)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
             on conflict (id) do update set name = excluded.name, age_group = excluded.age_group, age = excluded.age, sex = excluded.sex,
               height_cm = excluded.height_cm, weight_kg = excluded.weight_kg, activity = excluded.activity, allergies = excluded.allergies,
               dislikes = excluded.dislikes, portion_override = excluded.portion_override, macro_targets = excluded.macro_targets
             where members.household_id = excluded.household_id
             returning id`,
            [...params, m.id],
          );
          // An id that already exists in another household is skipped by the WHERE above; refuse it loudly.
          if (res.rowCount === 0) throw new Error(`Member ${m.id} belongs to another household`);
        } else {
          await tx.query(
            `insert into members (household_id, name, age_group, age, sex, height_cm, weight_kg, activity, allergies, dislikes, portion_override, macro_targets)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            params,
          );
        }
      }
    });
  }

  async getCurrentPlan(householdId: string): Promise<{ plan: WeekPlan; request: PlanRequest } | null> {
    return this.tx(async (tx) => {
      const { rows } = await tx.query<{ id: string; week_start: string; strategy: WeekPlan["strategy"]; track: WeekPlan["track"]; request: Omit<PlanRequest, "household">; meals: WeekPlan["meals"]; created_at: Date }>(
        "select id, to_char(week_start, 'YYYY-MM-DD') as week_start, strategy, track, request, meals, created_at from plans where household_id = $1 and is_current",
        [householdId],
      );
      const row = rows[0];
      if (!row) return null;
      const household = await loadHousehold(tx, householdId);
      return {
        plan: { id: row.id, householdId, weekStart: row.week_start, strategy: row.strategy, track: row.track, meals: row.meals, createdAt: row.created_at.toISOString() },
        request: { ...row.request, household },
      };
    });
  }

  async savePlan(plan: WeekPlan, request: PlanRequest): Promise<void> {
    const { household: _snapshot, ...rest } = request;
    await this.tx(async (tx) => {
      await tx.query("update plans set is_current = false where household_id = $1 and is_current and id <> $2", [plan.householdId, plan.id]);
      await tx.query(
        `insert into plans (id, household_id, week_start, strategy, track, request, meals, is_current)
         values ($1, $2, $3, $4, $5, $6, $7, true)
         on conflict (id) do update set meals = excluded.meals, request = excluded.request, is_current = true`,
        [plan.id, plan.householdId, plan.weekStart, plan.strategy, plan.track, JSON.stringify(rest), JSON.stringify(plan.meals)],
      );
    });
  }

  async getConversation(userId: string, key: string): Promise<unknown[]> {
    this.assertSelf(userId);
    return this.tx(async (tx) => {
      const { rows } = await tx.query<{ messages: unknown[] }>("select messages from conversations where user_id = $1 and key = $2", [userId, key]);
      return rows[0]?.messages ?? [];
    });
  }

  async saveConversation(userId: string, key: string, messages: unknown[]): Promise<void> {
    this.assertSelf(userId);
    await this.tx(async (tx) => {
      const hid = await this.ensureHousehold(tx);
      await tx.query(
        `insert into conversations (household_id, user_id, key, messages, updated_at) values ($1, $2, $3, $4, now())
         on conflict (user_id, key) do update set messages = excluded.messages, updated_at = now()`,
        [hid, userId, key, JSON.stringify(messages)],
      );
    });
  }

  // ---------- grocery list ----------
  // RLS limits every query to the caller's households; the household_id filters
  // additionally keep a user with two households from editing the wrong list.

  async getCheckedKeys(planId: string): Promise<string[]> {
    return this.tx(async (tx) => {
      const { rows } = await tx.query<{ item_key: string }>("select item_key from shopping_checks where plan_id = $1 and checked", [planId]);
      return rows.map((r) => r.item_key);
    });
  }

  async setChecked(planId: string, key: string, checked: boolean): Promise<void> {
    await this.tx(async (tx) => {
      if (checked) {
        await tx.query(
          `insert into shopping_checks (plan_id, item_key, checked) values ($1, $2, true)
           on conflict (plan_id, item_key) do update set checked = true`,
          [planId, key],
        );
      } else {
        await tx.query("delete from shopping_checks where plan_id = $1 and item_key = $2", [planId, key]);
      }
    });
  }

  async listExtras(householdId: string): Promise<ExtraItem[]> {
    return this.tx(async (tx) => {
      const { rows } = await tx.query<ExtraRow>(
        "select id, name, quantity, checked from shopping_extras where household_id = $1 order by created_at, id",
        [householdId],
      );
      return rows.map(toExtra);
    });
  }

  async addExtras(householdId: string, items: { name: string; quantity?: string }[]): Promise<ExtraItem[]> {
    if (!items.length) return [];
    return this.tx(async (tx) => {
      const added: ExtraItem[] = [];
      for (const i of items) {
        const { rows } = await tx.query<ExtraRow>(
          "insert into shopping_extras (household_id, name, quantity) values ($1, $2, $3) returning id, name, quantity, checked",
          [householdId, i.name.trim(), i.quantity?.trim() || null],
        );
        added.push(toExtra(rows[0]!));
      }
      return added;
    });
  }

  async updateExtra(householdId: string, id: string, patch: { checked?: boolean; name?: string; quantity?: string | null }): Promise<ExtraItem | null> {
    if (!UUID.test(id)) return null;
    return this.tx(async (tx) => {
      const { rows } = await tx.query<ExtraRow>(
        `update shopping_extras set
           checked = coalesce($3, checked),
           name = coalesce($4, name),
           quantity = case when $5 then $6 else quantity end
         where household_id = $1 and id = $2
         returning id, name, quantity, checked`,
        [householdId, id, patch.checked ?? null, patch.name?.trim() ?? null, patch.quantity !== undefined, patch.quantity?.trim() || null],
      );
      return rows[0] ? toExtra(rows[0]) : null;
    });
  }

  async removeExtras(householdId: string, ids: string[]): Promise<number> {
    const valid = ids.filter((id) => UUID.test(id));
    if (!valid.length) return 0;
    return this.tx(async (tx) => {
      const res = await tx.query("delete from shopping_extras where household_id = $1 and id = any($2::uuid[])", [householdId, valid]);
      return res.rowCount ?? 0;
    });
  }
}

interface ExtraRow { id: string; name: string; quantity: string | null; checked: boolean }
const toExtra = (r: ExtraRow): ExtraItem => ({ id: r.id, name: r.name, quantity: r.quantity ?? undefined, checked: r.checked });

async function loadHousehold(tx: Tx, hid: string): Promise<Household> {
  const { rows } = await tx.query<HouseholdRow>("select id, name, mode, diet, pantry from households where id = $1", [hid]);
  const h = rows[0];
  if (!h) throw new Error("Household not found");
  const members = await tx.query<MemberRow>(
    `select id, name, age_group, age, sex, height_cm, weight_kg, activity, allergies, dislikes, portion_override, macro_targets
     from members where household_id = $1 order by case age_group when 'adult' then 0 when 'teen' then 1 when 'child' then 2 else 3 end, name`,
    [hid],
  );
  return {
    id: h.id,
    name: h.name,
    mode: h.mode,
    diet: h.diet,
    pantry: h.pantry,
    members: members.rows.map((m) => ({
      id: m.id,
      name: m.name,
      ageGroup: m.age_group,
      age: m.age ?? undefined,
      sex: m.sex ?? undefined,
      heightCm: num(m.height_cm),
      weightKg: num(m.weight_kg),
      activity: m.activity ?? undefined,
      allergies: m.allergies,
      dislikes: m.dislikes,
      portionOverride: num(m.portion_override),
      macroTargets: m.macro_targets ?? undefined,
    })),
  };
}

const num = (v: string | null) => (v === null ? undefined : Number(v));
