// In-memory Postgres (PGlite + pgvector) with a minimal stand-in for Supabase's `auth` schema,
// so the real migrations and RLS policies can be tested without a Supabase project.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";

const MIGRATIONS = path.resolve(__dirname, "../../supabase/migrations");

export type TestDb = Awaited<ReturnType<typeof createTestDb>>;

// `upTo` stops after that migration file (inclusive), so upgrade/backfill paths can be tested;
// call `migrate()` to apply the rest.
export async function createTestDb({ upTo }: { upTo?: string } = {}) {
  const db = await PGlite.create({ extensions: { vector } });
  await db.exec(`
    create role anon; create role authenticated;
    create schema extensions; grant usage on schema extensions to authenticated, anon;
    create schema auth;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;
    grant usage on schema public to authenticated, anon;
  `);
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  const applied = new Set<string>();
  async function migrate(until?: string) {
    for (const file of files) {
      if (applied.has(file)) continue;
      if (until && file > until) break;
      await db.exec(readFileSync(path.join(MIGRATIONS, file), "utf8"));
      applied.add(file);
    }
    // Supabase's default grants (RLS still decides which rows are visible).
    await db.exec(`
      grant select, insert, update, delete on all tables in schema public to authenticated;
      grant usage on all sequences in schema public to authenticated;
    `);
  }
  await migrate(upTo);

  let n = 0;
  async function createUser(email: string) {
    const id = `00000000-0000-0000-0000-${String(++n).padStart(12, "0")}`;
    await db.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
    return id;
  }

  // Run a query as a signed-in user (role `authenticated`, auth.uid() = userId), like PostgREST.
  async function as<T = Record<string, unknown>>(userId: string, sql: string, params: unknown[] = []) {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${userId}', false); set role authenticated;`);
    try {
      return (await db.query<T>(sql, params)).rows;
    } finally {
      await db.exec("reset role");
    }
  }

  async function expectDenied(userId: string, sql: string, params: unknown[] = []) {
    try {
      await as(userId, sql, params);
    } catch (e) {
      return (e as Error).message;
    }
    throw new Error(`Expected query to be rejected: ${sql}`);
  }

  return { db, createUser, as, expectDenied, migrate };
}

export const vec = (values: number[], dims = 768) =>
  `[${Array.from({ length: dims }, (_, i) => values[i] ?? 0).join(",")}]`;
