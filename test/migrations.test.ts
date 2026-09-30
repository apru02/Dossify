// Upgrade path: chat history written before sessions existed must survive the migration.
import { describe, expect, it } from "vitest";
import { createTestDb } from "./helpers/db";

describe("20261002000000_chat_sessions backfill", () => {
  it("moves each user's existing thread into an 'Earlier chat' session per workspace", async () => {
    const t = await createTestDb({ upTo: "20261001000000_documents_and_chat.sql" });
    const [alice, bob] = await Promise.all([t.createUser("a@x.com"), t.createUser("b@x.com")]);
    const wsA = (await t.as<{ id: string }>(alice, "select public.create_account('personal', null, 'A') id"))[0].id;
    const wsB = (await t.as<{ id: string }>(bob, "select public.create_account('personal', null, 'B') id"))[0].id;

    const [{ id: q }] = await t.as<{ id: string }>(alice, "insert into chat_messages (workspace_id, role, content) values ($1,'user','old question') returning id", [wsA]);
    await t.as(alice, "insert into chat_messages (workspace_id, role, content, reply_to) values ($1,'assistant','old answer',$2)", [wsA, q]);
    await t.as(bob, "insert into chat_messages (workspace_id, role, content) values ($1,'user','bob question')", [wsB]);

    await t.migrate();

    const sessions = await t.db.query<{ user_id: string; title: string; n: number }>(
      "select s.user_id, s.title, count(m.id)::int n from chat_sessions s join chat_messages m on m.session_id = s.id group by s.id order by n desc",
    );
    expect(sessions.rows).toEqual([
      { user_id: alice, title: "Earlier chat", n: 2 },
      { user_id: bob, title: "Earlier chat", n: 1 },
    ]);
    const orphans = await t.db.query<{ n: number }>("select count(*)::int n from chat_messages where session_id is null");
    expect(orphans.rows[0].n).toBe(0);
  });
});
