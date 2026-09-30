// Tenant isolation, enforced by the database itself (real migrations + RLS on PGlite).
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, vec, type TestDb } from "./helpers/db";

let t: TestDb;
let alice: string, bob: string, carol: string; // alice: personal; bob: org owner; carol: bob's teammate
let wsA: string, wsB: string, orgB: string, docA: string, docB: string;
const hash = (c: string) => c.repeat(64);

const search = (user: string, ws: string, q: string, min = 0) =>
  t.as<{ content: string; similarity: number }>(
    user,
    "select content, similarity from match_document_chunks($1, $2::extensions.vector, 5, $3)",
    [ws, q, min],
  );

beforeAll(async () => {
  t = await createTestDb();
  [alice, bob, carol] = await Promise.all(["alice@x.com", "bob@x.com", "carol@x.com"].map(t.createUser));
  wsA = (await t.as<{ id: string }>(alice, "select public.create_account('personal', null, 'Alice docs') id"))[0].id;
  wsB = (await t.as<{ id: string }>(bob, "select public.create_account('organization', 'Acme', 'Falcon') id"))[0].id;
  orgB = (await t.as<{ id: string }>(bob, "select id from organizations"))[0].id;
  await t.db.query("insert into organization_members values ($1, $2, 'member')", [orgB, carol]);

  const insertDoc = (user: string, ws: string, name: string, h: string) =>
    t.as<{ id: string }>(
      user,
      "insert into documents (workspace_id, name, mime_type, size_bytes, content_hash, status) values ($1,$2,'text/plain',10,$3,'ready') returning id",
      [ws, name, h],
    );
  docA = (await insertDoc(alice, wsA, "handbook.txt", hash("a")))[0].id;
  docB = (await insertDoc(bob, wsB, "falcon.txt", hash("b")))[0].id;

  const insertChunk = (user: string, ws: string, doc: string, content: string, v: number[]) =>
    t.as(user, "insert into document_chunks (workspace_id, document_id, chunk_index, content, embedding) values ($1,$2,0,$3,$4::extensions.vector)", [ws, doc, content, vec(v)]);
  await insertChunk(alice, wsA, docA, "Employees get 24 days of leave.", [0.9, 0.1, 0]);
  await insertChunk(bob, wsB, docB, "The launch codename is BLUEBIRD-7.", [0, 0.1, 0.95]);
});

const codenameQuery = vec([0.05, 0.05, 0.9]);

describe("workspace isolation in the shared vector store", () => {
  it("never returns another workspace's chunks, even for a perfect match", async () => {
    const rows = await search(alice, wsA, codenameQuery);
    expect(rows.map((r) => r.content).join(" ")).not.toContain("BLUEBIRD");
  });

  it("returns nothing when a user passes someone else's workspace id", async () => {
    expect(await search(alice, wsB, codenameQuery)).toEqual([]);
  });

  it("lets organization members search their shared workspace", async () => {
    expect((await search(carol, wsB, codenameQuery))[0].content).toContain("BLUEBIRD-7");
  });

  it("applies the similarity floor inside the query", async () => {
    expect(await search(alice, wsA, codenameQuery, 0.9)).toEqual([]);
  });

  it("hides chunks of documents that aren't ready", async () => {
    await t.db.query("update documents set status = 'processing' where id = $1", [docB]);
    expect(await search(bob, wsB, codenameQuery)).toEqual([]);
    await t.db.query("update documents set status = 'ready' where id = $1", [docB]);
  });

  it("rejects chunks tagged with a workspace other than their document's", async () => {
    const msg = await t.expectDenied(bob, "insert into document_chunks (workspace_id, document_id, chunk_index, content, embedding) values ($1,$2,9,'x',$3::extensions.vector)", [wsB, docA, vec([1])]);
    expect(msg).toMatch(/foreign key|row-level security/);
  });

  it("rejects uploads and chunks into a workspace the user can't access", async () => {
    expect(await t.expectDenied(alice, "insert into documents (workspace_id, name, mime_type, size_bytes, content_hash) values ($1,'x','text/plain',1,$2)", [wsB, hash("c")])).toMatch(/row-level security/);
    expect(await t.expectDenied(alice, "insert into document_chunks (workspace_id, document_id, chunk_index, content, embedding) values ($1,$2,5,'x',$3::extensions.vector)", [wsB, docB, vec([1])])).toMatch(/row-level security/);
  });
});

describe("idempotent ingestion", () => {
  it("allows a file once per workspace, but the same file in another workspace", async () => {
    expect(await t.expectDenied(alice, "insert into documents (workspace_id, name, mime_type, size_bytes, content_hash) values ($1,'again.txt','text/plain',1,$2)", [wsA, hash("a")])).toMatch(/duplicate key/);
    const other = await t.as(bob, "insert into documents (workspace_id, name, mime_type, size_bytes, content_hash) values ($1,'copy.txt','text/plain',1,$2) returning id", [wsB, hash("a")]);
    expect(other).toHaveLength(1);
  });

  it("allows each chunk index once per document", async () => {
    expect(await t.expectDenied(alice, "insert into document_chunks (workspace_id, document_id, chunk_index, content, embedding) values ($1,$2,0,'dup',$3::extensions.vector)", [wsA, docA, vec([1])])).toMatch(/duplicate key/);
  });
});

describe("chat privacy", () => {
  it("keeps each user's thread private, even from teammates", async () => {
    await t.as(bob, "insert into chat_messages (workspace_id, role, content) values ($1,'user','private question')", [wsB]);
    expect(await t.as(carol, "select * from chat_messages")).toEqual([]);
  });

  it("blocks writing chat into another workspace or as another user", async () => {
    expect(await t.expectDenied(alice, "insert into chat_messages (workspace_id, role, content) values ($1,'user','x')", [wsB])).toMatch(/row-level security/);
    expect(await t.expectDenied(alice, "insert into chat_messages (workspace_id, user_id, role, content) values ($1,$2,'user','x')", [wsA, bob])).toMatch(/row-level security/);
  });
});

describe("accounts", () => {
  it("never lets a personal account gain a second member", async () => {
    const orgA = (await t.as<{ id: string }>(alice, "select id from organizations"))[0].id;
    await expect(t.db.query("insert into organization_members values ($1, $2, 'member')", [orgA, carol])).rejects.toThrow(/Personal accounts/);
  });

  it("only lets the uploader or an admin delete a document (chunks cascade)", async () => {
    expect(await t.as(carol, "delete from documents where id = $1 returning id", [docB])).toEqual([]);
    expect(await t.as(bob, "delete from documents where id = $1 returning id", [docB])).toHaveLength(1);
    const left = await t.db.query<{ n: number }>("select count(*)::int n from document_chunks where document_id = $1", [docB]);
    expect(left.rows[0].n).toBe(0);
  });
});
