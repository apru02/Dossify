// Organization invitations and member management, enforced by the database (PGlite + real SQL).
import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./helpers/db";

let t: TestDb;
let owner: string, admin: string, member: string, invitee: string, stranger: string, personal: string;
let org: string, ws: string, personalOrg: string;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

const invite = (by: string, email: string, token: string, role = "member", organization = org) =>
  t.as<{ id: string }>(
    by,
    "insert into organization_invitations (organization_id, email, role, token_hash) values ($1,$2,$3,$4) returning id",
    [organization, email, role, hash(token)],
  );
const accept = (user: string, token: string) =>
  t.as<{ ws: string }>(user, "select public.accept_invitation($1) as ws", [hash(token)]).then((r) => r[0].ws);
const role = async (user: string) =>
  (await t.db.query<{ role: string }>("select role from organization_members where organization_id = $1 and user_id = $2", [org, user])).rows[0]?.role;

beforeAll(async () => {
  t = await createTestDb();
  [owner, admin, member, invitee, stranger, personal] = await Promise.all(
    ["owner@acme.com", "admin@acme.com", "member@acme.com", "new@acme.com", "stranger@x.com", "solo@x.com"].map(t.createUser),
  );
  ws = (await t.as<{ id: string }>(owner, "select public.create_account('organization', 'Acme', 'General') id"))[0].id;
  org = (await t.as<{ id: string }>(owner, "select organization_id id from workspaces where id = $1", [ws]))[0].id;
  await t.db.query("insert into organization_members values ($1,$2,'admin'), ($1,$3,'member')", [org, admin, member]);
  await t.as(personal, "select public.create_account('personal', null, 'Mine')");
  personalOrg = (await t.as<{ id: string }>(personal, "select id from organizations"))[0].id;
});

describe("creating invitations", () => {
  it("lets owners and admins invite; not members or outsiders", async () => {
    expect(await invite(owner, "a1@x.com", "t-a1")).toHaveLength(1);
    expect(await invite(admin, "a2@x.com", "t-a2", "admin")).toHaveLength(1);
    expect(await t.expectDenied(member, "insert into organization_invitations (organization_id, email, token_hash) values ($1,'m@x.com',$2)", [org, hash("t-m")])).toMatch(/row-level security/);
    expect(await t.expectDenied(stranger, "insert into organization_invitations (organization_id, email, token_hash) values ($1,'s@x.com',$2)", [org, hash("t-s")])).toMatch(/row-level security/);
  });

  it("never invites into a personal account", async () => {
    const msg = await t.expectDenied(personal, "insert into organization_invitations (organization_id, email, token_hash) values ($1,'friend@x.com',$2)", [personalOrg, hash("t-p")]);
    expect(msg).toMatch(/row-level security/);
  });

  it("can't invite someone as owner, and allows one open invite per email", async () => {
    expect(await t.expectDenied(owner, "insert into organization_invitations (organization_id, email, role, token_hash) values ($1,'o@x.com','owner',$2)", [org, hash("t-o")])).toMatch(/check constraint/);
    expect(await t.expectDenied(owner, "insert into organization_invitations (organization_id, email, token_hash) values ($1,'a1@x.com',$2)", [org, hash("t-dup")])).toMatch(/duplicate key/);
  });

  it("only admins can see the invitation list", async () => {
    expect((await t.as(admin, "select email from organization_invitations")).length).toBeGreaterThan(0);
    expect(await t.as(member, "select * from organization_invitations")).toEqual([]);
  });
});

describe("the invite link", () => {
  it("shows the invite details to the token holder, even before login", async () => {
    await invite(owner, "new@acme.com", "t-new");
    await t.db.exec("set role anon");
    const rows = (await t.db.query("select * from public.get_invitation($1)", [hash("t-new")])).rows;
    await t.db.exec("reset role");
    expect(rows).toEqual([expect.objectContaining({ organization_name: "Acme", email: "new@acme.com", role: "member", status: "pending" })]);
  });

  it("refuses a signed-in user whose email doesn't match", async () => {
    await expect(accept(stranger, "t-new")).rejects.toThrow(/invitation_email_mismatch/);
    expect(await role(stranger)).toBeUndefined();
  });

  it("adds the invited user with the invited role and lands them in a workspace", async () => {
    expect(await accept(invitee, "t-new")).toBe(ws);
    expect(await role(invitee)).toBe("member");
    expect((await t.as(invitee, "select id from workspaces")).map((r) => r.id)).toContain(ws);
  });

  it("is idempotent for the acceptor and single-use for everyone else", async () => {
    expect(await accept(invitee, "t-new")).toBe(ws);
    await expect(accept(stranger, "t-new")).rejects.toThrow(/invitation_used/);
  });

  it("rejects revoked, expired and unknown tokens", async () => {
    const [{ id }] = await invite(owner, "late@x.com", "t-late");
    const lateUser = await t.createUser("late@x.com");
    await t.as(owner, "update organization_invitations set revoked_at = now() where id = $1", [id]);
    await expect(accept(lateUser, "t-late")).rejects.toThrow(/invitation_revoked/);

    await invite(owner, "late@x.com", "t-late-2"); // a fresh invite is allowed after revoking
    await t.db.query("update organization_invitations set expires_at = now() - interval '1 minute' where token_hash = $1", [hash("t-late-2")]);
    await expect(accept(lateUser, "t-late-2")).rejects.toThrow(/invitation_expired/);

    await expect(accept(lateUser, "never-issued")).rejects.toThrow(/invitation_not_found/);
  });

  it("can't be accepted anonymously", async () => {
    await t.db.exec("set role anon");
    await expect(t.db.query("select public.accept_invitation($1)", [hash("t-a1")])).rejects.toThrow(/permission denied/);
    await t.db.exec("reset role");
  });
});

describe("managing members", () => {
  it("lets admins change roles, but never touch or create the owner", async () => {
    expect(await t.as(admin, "update organization_members set role = 'admin' where user_id = $1 returning user_id", [member])).toHaveLength(1);
    expect(await role(member)).toBe("admin");
    expect(await t.as(admin, "update organization_members set role = 'member' where user_id = $1 returning user_id", [owner])).toEqual([]);
    expect(await t.expectDenied(admin, "update organization_members set role = 'owner' where user_id = $1", [member])).toMatch(/row-level security/);
    await t.as(owner, "update organization_members set role = 'member' where user_id = $1", [member]);
  });

  it("doesn't let plain members change roles", async () => {
    expect(await t.as(invitee, "update organization_members set role = 'admin' where user_id = $1 returning user_id", [invitee])).toEqual([]);
    expect(await role(invitee)).toBe("member");
  });

  it("lets a member leave, lets admins remove members, and nobody can remove the owner", async () => {
    expect(await t.as(invitee, "delete from organization_members where user_id = $1 and organization_id = $2 returning user_id", [invitee, org])).toHaveLength(1);
    expect(await t.as(member, "delete from organization_members where user_id = $1 returning user_id", [admin])).toEqual([]);
    expect(await t.as(admin, "delete from organization_members where user_id = $1 returning user_id", [member])).toHaveLength(1);
    expect(await t.as(admin, "delete from organization_members where user_id = $1 returning user_id", [owner])).toEqual([]);
    expect(await t.as(owner, "delete from organization_members where user_id = $1 returning user_id", [owner])).toEqual([]);
  });

  it("a removed member immediately loses access to the workspaces", async () => {
    expect(await t.as(member, "select * from workspaces where id = $1", [ws])).toEqual([]);
  });
});
