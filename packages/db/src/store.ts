import type { PlannerStore } from "@mealplan/assistant";
import type { Household, Member, PlanRequest, WeekPlan } from "@mealplan/core";
import { asUser, type Claims, type Db, type Tx } from "./pool";
import { decrypt, encrypt } from "./secrets";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface HouseholdRow {
  id: string; name: string; mode: Household["mode"]; diet: Household["diet"]; pantry: string[];
  preferred_grocer: Household["preferredGrocer"] | null; postal_code: string | null;
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
        `update households set name = $2, mode = $3, diet = $4, pantry = $5, preferred_grocer = $6, postal_code = $7 where id = $1`,
        [hid, h.name, h.mode, h.diet, h.pantry, h.preferredGrocer ?? null, h.postalCode ?? null],
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

  async grocerToken(userId: string, grocer: string): Promise<string | undefined> {
    this.assertSelf(userId);
    return this.tx(async (tx) => {
      const { rows } = await tx.query<{ access_token_enc: string; expires_at: Date | null }>(
        "select access_token_enc, expires_at from grocer_accounts where user_id = $1 and grocer = $2",
        [userId, grocer],
      );
      const row = rows[0];
      if (!row || (row.expires_at && row.expires_at.getTime() < Date.now())) return undefined;
      return decrypt(row.access_token_enc);
    });
  }

  async saveGrocerToken(userId: string, grocer: string, t: { accessToken: string; refreshToken?: string; expiresIn: number }): Promise<void> {
    this.assertSelf(userId);
    await this.tx((tx) =>
      tx.query(
        `insert into grocer_accounts (user_id, grocer, access_token_enc, refresh_token_enc, expires_at)
         values ($1, $2, $3, $4, now() + make_interval(secs => $5))
         on conflict (user_id, grocer) do update set access_token_enc = excluded.access_token_enc,
           refresh_token_enc = excluded.refresh_token_enc, expires_at = excluded.expires_at`,
        [userId, grocer, encrypt(t.accessToken), t.refreshToken ? encrypt(t.refreshToken) : null, t.expiresIn],
      ),
    );
  }
}

async function loadHousehold(tx: Tx, hid: string): Promise<Household> {
  const { rows } = await tx.query<HouseholdRow>("select id, name, mode, diet, pantry, preferred_grocer, postal_code from households where id = $1", [hid]);
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
    preferredGrocer: h.preferred_grocer ?? undefined,
    postalCode: h.postal_code ?? undefined,
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
