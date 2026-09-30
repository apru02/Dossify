// Per-workspace Slack connections: encryption at rest + RLS on who can see/change them.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { open, seal } from "@/lib/crypto/secret-box";
import { createTestDb, type TestDb } from "./helpers/db";

const KEY = Buffer.alloc(32, 7).toString("base64");

describe("secret box (AES-256-GCM)", () => {
  beforeEach(() => {
    vi.stubEnv("INTEGRATIONS_ENCRYPTION_KEY", KEY);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("round-trips and never stores plaintext", () => {
    const sealed = seal("https://hooks.slack.com/services/T/B/SECRET", "workspace:A:slack");
    expect(sealed.startsWith("v1:")).toBe(true);
    expect(sealed).not.toContain("SECRET");
    expect(open(sealed, "workspace:A:slack")).toBe("https://hooks.slack.com/services/T/B/SECRET");
  });

  it("uses a fresh IV every time", () => {
    expect(seal("same", "ctx")).not.toBe(seal("same", "ctx"));
  });

  it("refuses a ciphertext copied into another workspace", () => {
    const sealed = seal("secret", "workspace:A:slack");
    expect(() => open(sealed, "workspace:B:slack")).toThrow();
  });

  it("detects tampering", () => {
    const sealed = seal("secret", "ctx");
    const bytes = Buffer.from(sealed.slice(3), "base64");
    bytes[bytes.length - 1] ^= 1;
    expect(() => open(`v1:${bytes.toString("base64")}`, "ctx")).toThrow();
  });

  it("fails loudly without a proper key", () => {
    vi.stubEnv("INTEGRATIONS_ENCRYPTION_KEY", "too-short");
    expect(() => seal("x", "ctx")).toThrow(/32 bytes/);
  });
});

describe("workspace_integrations RLS", () => {
  let t: TestDb;
  let owner: string, member: string, outsider: string, ws: string, otherWs: string;
  const row = (workspace: string, user: string) => [workspace, "v1:ciphertext", user];
  const insert = "insert into workspace_integrations (workspace_id, provider, channel_name, secret_ciphertext, connected_by) values ($1,'slack','#general',$2,$3) returning id";

  beforeAll(async () => {
    t = await createTestDb();
    [owner, member, outsider] = await Promise.all(["o@x.com", "m@x.com", "x@x.com"].map(t.createUser));
    ws = (await t.as<{ id: string }>(owner, "select public.create_account('organization', 'Acme', 'Team') id"))[0].id;
    otherWs = (await t.as<{ id: string }>(outsider, "select public.create_account('personal', null, 'Mine') id"))[0].id;
    const [{ organization_id }] = await t.as<{ organization_id: string }>(owner, "select organization_id from workspaces where id = $1", [ws]);
    await t.db.query("insert into organization_members values ($1, $2, 'member')", [organization_id, member]);
  });

  it("lets only workspace admins connect", async () => {
    expect(await t.expectDenied(member, insert, row(ws, member))).toMatch(/row-level security/);
    expect(await t.expectDenied(outsider, insert, row(ws, outsider))).toMatch(/row-level security/);
    expect(await t.as(owner, insert, row(ws, owner))).toHaveLength(1);
  });

  it("allows one Slack connection per workspace", async () => {
    expect(await t.expectDenied(owner, insert, row(ws, owner))).toMatch(/duplicate key/);
  });

  it("rejects plaintext secrets", async () => {
    const msg = await t.expectDenied(outsider, "insert into workspace_integrations (workspace_id, provider, secret_ciphertext) values ($1,'slack','https://hooks.slack.com/services/T/B/X')", [otherWs]);
    expect(msg).toMatch(/check constraint/);
  });

  it("members can see the connection (ciphertext only); outsiders can't", async () => {
    expect(await t.as(member, "select channel_name from workspace_integrations where workspace_id = $1", [ws])).toEqual([{ channel_name: "#general" }]);
    expect(await t.as(outsider, "select * from workspace_integrations where workspace_id = $1", [ws])).toEqual([]);
  });

  it("members can't repoint or remove it; admins can", async () => {
    expect(await t.as(member, "update workspace_integrations set secret_ciphertext = 'v1:attacker' returning id")).toEqual([]);
    expect(await t.as(member, "delete from workspace_integrations returning id")).toEqual([]);
    expect(await t.as(owner, "delete from workspace_integrations where workspace_id = $1 returning id", [ws])).toHaveLength(1);
  });
});

describe("Slack OAuth", () => {
  it("accepts the callback only with the state issued for this browser", async () => {
    const { newOAuthState, verifyOAuthState } = await import("@/lib/integrations/oauth-state");
    const { state, cookie } = newOAuthState("ws-123");
    expect(verifyOAuthState(cookie, state)).toBe("ws-123");
    expect(verifyOAuthState(cookie, "forged")).toBeNull();
    expect(verifyOAuthState(undefined, state)).toBeNull();
    expect(verifyOAuthState(newOAuthState("ws-123").cookie, state)).toBeNull(); // another flow's cookie
  });

  it("asks Slack only for the incoming-webhook scope", async () => {
    const { slackAuthorizeUrl } = await import("@/lib/integrations/slack-oauth");
    const url = new URL(slackAuthorizeUrl({ clientId: "123.456", redirectUri: "https://dossify.app/api/integrations/slack/callback", state: "abc" }));
    expect(url.origin + url.pathname).toBe("https://slack.com/oauth/v2/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "123.456",
      scope: "incoming-webhook",
      redirect_uri: "https://dossify.app/api/integrations/slack/callback",
      state: "abc",
    });
  });

  it("exchanges the code with client credentials and returns the channel webhook", async () => {
    const { exchangeSlackCode } = await import("@/lib/integrations/slack-oauth");
    const fetchMock = vi.fn(async () =>
      Response.json({
        ok: true,
        access_token: "xoxb-token",
        team: { id: "T1", name: "Acme" },
        incoming_webhook: { url: "https://hooks.slack.com/services/T1/B1/X", channel: "#general", channel_id: "C1", configuration_url: "https://acme.slack.com/services/B1" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const install = await exchangeSlackCode({ clientId: "id", clientSecret: "secret", code: "c0de", redirectUri: "https://x/cb" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    vi.unstubAllGlobals();
    expect(url).toBe("https://slack.com/api/oauth.v2.access");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("id:secret").toString("base64")}`);
    expect(String(init.body)).toBe("code=c0de&redirect_uri=https%3A%2F%2Fx%2Fcb");
    expect(install.incoming_webhook).toMatchObject({ channel: "#general", url: "https://hooks.slack.com/services/T1/B1/X" });
  });

  it("surfaces Slack's OAuth error code", async () => {
    const { exchangeSlackCode, SlackOAuthError } = await import("@/lib/integrations/slack-oauth");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: false, error: "invalid_code" })));
    await expect(exchangeSlackCode({ clientId: "id", clientSecret: "s", code: "old", redirectUri: "https://x/cb" })).rejects.toThrow(SlackOAuthError);
    vi.unstubAllGlobals();
  });
});
