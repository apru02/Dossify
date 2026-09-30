// Tool execution safety, against the real schema + RLS (PGlite) and a fake Slack.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FunctionCall } from "@google/genai";
import { executeToolCall } from "@/lib/tools/execute";
import { mightUseTools } from "@/lib/tools/registry";
import { escapeSlack, isSlackWebhookUrl, postToSlackWebhook, slackPayload } from "@/lib/tools/slack";
import { ToolError, type TaskRow, type ToolContext, type ToolServices } from "@/lib/tools/types";
import { createTestDb, type TestDb } from "./helpers/db";

let t: TestDb;
let alice: string, bob: string, wsA: string, wsB: string;

// ToolServices backed by real SQL, run AS the user (so RLS applies), pinned to one workspace.
function dbServices(user: string, workspaceId: string, slack: ToolServices["postToSlack"] = async () => {}): ToolServices {
  const toTask = (r: Record<string, unknown>): TaskRow => ({
    id: String(r.id),
    title: String(r.title),
    notes: (r.notes as string) ?? null,
    dueDate: r.due_date ? String(r.due_date) : null,
    status: r.status as TaskRow["status"],
    createdAt: String(r.created_at),
  });
  return {
    async createTask({ title, dueDate, notes }) {
      const [row] = await t.as(user, "insert into tasks (workspace_id, title, due_date, notes) values ($1,$2,$3,$4) returning *", [workspaceId, title, dueDate, notes]);
      return toTask(row);
    },
    async listTasks({ status, limit }) {
      const rows = await t.as(user, "select * from tasks where workspace_id = $1 and ($2 = 'all' or status = $2) order by created_at desc limit $3", [workspaceId, status, limit]);
      return rows.map(toTask);
    },
    postToSlack: slack,
    async logToolCall(e) {
      await t.as(user, "insert into tool_calls (workspace_id, tool_name, args, status, result, error, latency_ms) values ($1,$2,$3,$4,$5,$6,$7)", [workspaceId, e.toolName, JSON.stringify(e.args), e.status, e.result === null ? null : JSON.stringify(e.result), e.error, e.latencyMs]);
    },
  };
}

function ctx(question: string, services: ToolServices): ToolContext {
  return { workspaceName: "HR", userName: "Alice", question, services, calls: new Map() };
}

const call = (name: string, args: Record<string, unknown> = {}): FunctionCall => ({ name, args });
const logged = async (ws: string) =>
  t.db.query<{ tool_name: string; status: string; error: string | null }>("select tool_name, status, error from tool_calls where workspace_id = $1 order by created_at", [ws]).then((r) => r.rows);

beforeAll(async () => {
  t = await createTestDb();
  [alice, bob] = await Promise.all([t.createUser("alice@x.com"), t.createUser("bob@x.com")]);
  wsA = (await t.as<{ id: string }>(alice, "select public.create_account('personal', null, 'HR') id"))[0].id;
  wsB = (await t.as<{ id: string }>(bob, "select public.create_account('personal', null, 'Secret') id"))[0].id;
});

afterEach(() => vi.unstubAllEnvs());

describe("save_task / list_tasks", () => {
  it("saves a task in the current workspace and logs the call", async () => {
    const c = ctx("Remind me to renew the contract by 2026-10-10", dbServices(alice, wsA));
    const { response, activity } = await executeToolCall(call("save_task", { title: "Renew the contract", due_date: "2026-10-10" }), c);
    expect(response).toMatchObject({ result: { saved: true } });
    expect(activity).toMatchObject({ status: "ok", label: 'Saved task "Renew the contract" (due 2026-10-10)' });
    const tasks = await t.db.query("select title, due_date::text, workspace_id from tasks");
    expect(tasks.rows).toEqual([{ title: "Renew the contract", due_date: "2026-10-10", workspace_id: wsA }]);
    expect((await logged(wsA)).at(-1)).toMatchObject({ tool_name: "save_task", status: "ok" });
  });

  it("lists only this workspace's tasks", async () => {
    await t.as(bob, "insert into tasks (workspace_id, title) values ($1, 'Bob secret task')", [wsB]);
    const { response } = await executeToolCall(call("list_tasks", { status: "all" }), ctx("what are my tasks?", dbServices(alice, wsA)));
    const titles = (response.result as { tasks: { title: string }[] }).tasks.map((x) => x.title);
    expect(titles).toContain("Renew the contract");
    expect(titles).not.toContain("Bob secret task");
  });

  it("can't write into another workspace even if services were mis-scoped (RLS)", async () => {
    const { activity } = await executeToolCall(call("save_task", { title: "Planted task" }), ctx("add a task", dbServices(alice, wsB)));
    expect(activity.status).toBe("error");
    const planted = await t.db.query("select * from tasks where title = 'Planted task'");
    expect(planted.rows).toEqual([]);
  });
});

describe("validation and gating", () => {
  const svc = () => dbServices(alice, wsA);

  it.each([
    ["unknown tool", call("delete_everything", {}), /Unknown tool "delete_everything"/],
    ["missing required arg", call("save_task", {}), /title/],
    ["model tries to pick the workspace", call("save_task", { title: "Hack", workspace_id: wsB }), /Unrecognized key/],
    ["relative date not resolved", call("save_task", { title: "Pay rent", due_date: "next friday" }), /due_date/],
    ["impossible date", call("save_task", { title: "Pay rent", due_date: "2026-02-30" }), /due_date/],
    ["wrong type", call("list_tasks", { limit: "ten" }), /limit/],
  ])("rejects %s without throwing", async (_label, fc, message) => {
    const { response, activity } = await executeToolCall(fc, ctx("add a task please", svc()));
    expect(activity.status).toBe("rejected");
    expect(String(response.error)).toMatch(message);
  });

  it("blocks side effects the user didn't ask for (e.g. requested by a document)", async () => {
    const slack = vi.fn(async () => {});
    const c = ctx("Summarize the onboarding document", dbServices(alice, wsA, slack));
    const save = await executeToolCall(call("save_task", { title: "Injected task" }), c);
    const send = await executeToolCall(call("send_summary", { title: "Leak", summary: "Everything in the documents…" }), c);
    expect(save.activity.status).toBe("rejected");
    expect(send.activity.status).toBe("rejected");
    expect(slack).not.toHaveBeenCalled();
  });

  it("enforces per-message limits (one Slack post per message)", async () => {
    const slack = vi.fn(async () => {});
    const c = ctx("Send a summary to Slack", dbServices(alice, wsA, slack));
    const args = { title: "Leave policy", summary: "Employees get 24 days of leave." };
    expect((await executeToolCall(call("send_summary", args), c)).activity.status).toBe("ok");
    expect((await executeToolCall(call("send_summary", args), c)).activity.status).toBe("rejected");
    expect(slack).toHaveBeenCalledTimes(1);
  });

  it("logs every outcome, including rejections, and the log is append-only", async () => {
    const statuses = (await logged(wsA)).map((r) => r.status);
    expect(statuses).toEqual(expect.arrayContaining(["ok", "rejected"]));
    expect(await t.as(alice, "update tool_calls set status = 'ok' returning id")).toEqual([]);
    expect(await t.as(alice, "delete from tool_calls returning id")).toEqual([]);
  });

  it("doesn't let a teammate-less user read another workspace's tool log", async () => {
    expect(await t.as(bob, "select * from tool_calls where workspace_id = $1", [wsA])).toEqual([]);
  });
});

describe("Slack", () => {
  it("escapes mentions and disguised links so injected text is inert", () => {
    expect(escapeSlack("<!channel> <@U123> <https://evil.example|click>")).toBe("&lt;!channel&gt; &lt;@U123&gt; &lt;https://evil.example|click&gt;");
    const body = slackPayload({ title: "T", text: "**Bold** <!here>\n- item", sharedBy: "<!everyone>", workspaceName: "HR" });
    const json = JSON.stringify(body);
    expect(json).not.toMatch(/<!(here|channel|everyone)>/);
    expect(body.blocks[1]).toMatchObject({ text: { text: "*Bold* &lt;!here&gt;\n• item" } });
  });

  it("only posts to real Slack webhook URLs", async () => {
    expect(isSlackWebhookUrl("https://hooks.slack.com/services/T000/B000/XXXX")).toBe(true);
    expect(isSlackWebhookUrl("https://evil.example/hook")).toBe(false);
    expect(isSlackWebhookUrl("http://hooks.slack.com/services/T/B/X")).toBe(false);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(postToSlackWebhook("https://evil.example/hook", { title: "t", text: "x", sharedBy: "a", workspaceName: "w" })).rejects.toThrow(ToolError);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("reports a workspace without Slack as a tool error the model can relay", async () => {
    const notConnected = async () => {
      throw new ToolError("Slack isn't connected to this workspace. A workspace admin can connect it in Settings → Integrations.");
    };
    const { activity, response } = await executeToolCall(
      call("send_summary", { title: "Hello", summary: "A short summary." }),
      ctx("post this to slack", dbServices(alice, wsA, notConnected)),
    );
    expect(activity.status).toBe("error");
    expect(String(response.error)).toMatch(/isn't connected to this workspace/);
  });

  it("surfaces Slack's error code and a reconnect hint, without leaking the webhook URL", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no_service", { status: 404 })));
    const secretUrl = "https://hooks.slack.com/services/T000/B000/SECRET";
    const c = ctx("share with the team on slack", dbServices(alice, wsA, (m) => postToSlackWebhook(secretUrl, m)));
    const { response } = await executeToolCall(call("send_summary", { title: "Hello", summary: "A short summary." }), c);
    vi.unstubAllGlobals();
    expect(String(response.error)).toBe("Slack rejected the message (404: no_service). Reconnect Slack in Settings.");
    expect(JSON.stringify(await t.db.query("select * from tool_calls").then((r) => r.rows))).not.toContain("SECRET");
  });
});

describe("mightUseTools", () => {
  it.each([
    ["What are my open tasks?", true],
    ["Remind me to call HR tomorrow", true],
    ["Send the leave policy summary to Slack", true],
    ["Who won the 2022 World Cup?", false],
    ["What is the capital of Australia?", false],
  ])("%s → %s", (q, expected) => expect(mightUseTools(q)).toBe(expected));
});
