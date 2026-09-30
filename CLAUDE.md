@AGENTS.md

# Dossify

Multi-workspace AI document assistant: users upload documents into a workspace, chat with an assistant that answers **only** from that workspace's documents (with citations), and the assistant can call tools (save tasks, post summaries). All workspaces share **one** vector store, and isolation is enforced by the query and by Postgres RLS.

Tagline: "Your documents, more done."

## Stack

- **Next.js 16** (App Router, TypeScript, React 19, Server Actions). APIs differ from older Next.js: read `node_modules/next/dist/docs/` before using an unfamiliar API. Middleware is now `src/proxy.ts`.
- **Tailwind CSS v4.** Brand tokens are in `src/app/globals.css` (`@theme`). No component library; small primitives live in `src/components/ui/`.
- **Supabase:** Auth (email/password + Google OAuth), Postgres, pgvector, RLS on every table. Client: `@supabase/ssr`.
- **Gemini** (`@google/genai`): `gemini-embedding-001` (768 dims) for embeddings, and a fallback chain of "-latest" flash models for chat (see "AI pipeline" below).
- **unpdf** (serverless pdf.js) for PDF text, **react-markdown** for rendering answers (no raw HTML).
- **Vitest** + **PGlite** (in-memory Postgres + pgvector) for tests that run the real migrations.
- **Zod** validates every input: forms, server actions and, later, LLM tool arguments.
- Hosted on **Vercel**. Everything must stay on free, no-credit-card tiers.

## Commands

```bash
npm run dev      # http://localhost:3000 (needs .env.local, see .env.example)
npm run lint
npx tsc --noEmit
npm test         # unit + DB isolation tests (PGlite runs supabase/migrations/*.sql)
npm run test:ai  # opt-in live Gemini end-to-end RAG test (rate-limited, needs GEMINI_API_KEY)
npm run build
```

Run lint, typecheck, `npm test` and build before calling any task done. Run `npm run test:ai` after touching the prompt, chunking, retrieval or model settings.

## Layout

```
src/
  proxy.ts                         session refresh + coarse route gating (not authorization)
  app/
    page.tsx                       landing
    (auth)/login, (auth)/signup    auth pages; actions.ts holds all auth server actions
    auth/callback/route.ts         OAuth / PKCE code exchange
    auth/confirm/route.ts          email-confirmation (token_hash) links
    onboarding/                    first-run: pick account type, create account + first workspace
    dashboard/page.tsx             redirects to the last-used (cookie) or first workspace
    w/[workspaceId]/               the app shell; every page is scoped to one workspace
      page.tsx                     "New chat" (session is created by the first question)
      c/[sessionId]/page.tsx       one chat session
      chat-actions.ts              askQuestion, retryAnswer, renameSession, deleteSession
      documents/                   upload (dropzone → uploadDocument action), list, delete
    w/actions.ts                   workspace server actions
  components/{ui,brand,app,chat}/
  lib/
    auth.ts                        getCurrentUser / requireUser (getUser(), cached per request)
    urls.ts                        safeNext() (open-redirect guard), siteUrl()
    supabase/{server,proxy,env}.ts
    data/                          typed, RLS-backed queries (one file per domain)
    ai/                            Gemini client, embeddings, generateWithFallback, retry
    ingest/                        parse (pdf/md/txt) → chunk (pure) → ingest (idempotent orchestration)
    rag/                           retrieve (RPC), select (similarity gate), prompt, citations (pure)
    chat/answer.ts                 fills a pending assistant message; never throws
    chat/run-turn.ts               multi-step tool loop (≤4 tool rounds, then a final answer without tools)
    tools/                         registry (Zod schemas → Gemini declarations), execute (validate → gate → run → log),
                                   services (Supabase-backed, workspace-pinned), slack (webhook + escaping)
    integrations/                  Slack OAuth ("Add to Slack"), OAuth state (CSRF), encrypted per-workspace store
    crypto/secret-box.ts           AES-256-GCM seal/open with context (workspace id) as associated data
  app/api/integrations/slack/      connect (start OAuth, admins only) and callback (verify state, exchange, save)
  app/w/[workspaceId]/settings/    Integrations: Add to Slack / test message / disconnect
supabase/migrations/               SQL, applied in order (SQL editor or `supabase db push`)
test/                              PGlite DB helpers, isolation tests, live AI pipeline test
```

## Tenancy model (read before touching data code)

- `organizations` is the **account**. `kind` is either:
  - `personal`: exactly one member. A DB trigger enforces this.
  - `organization`: many members, with roles `owner` / `admin` / `member`.
- `workspaces` belong to one organization. **Every member of an org can access all of its workspaces.**
- A signed-in user may belong to several organizations (e.g. their personal account plus an employer's org).
- Onboarding calls the `create_account(kind, name, workspace_name)` RPC. It creates the org, the owner membership and the first workspace in one transaction, and is idempotent.
- Access helpers live in the `private` schema, which is not exposed over the API: `is_org_member`, `has_org_role`, `can_access_workspace`, `shares_org_with`. RLS policies use them.

## Non-negotiable rules

1. **Never trust a client-supplied workspace id.** Always load the workspace through the user-scoped Supabase client (RLS) and treat "no row" as 404. Do this in every page, action and route handler, not only in the layout.
2. **The server-side Supabase client acts as the user.** Don't add a service-role/secret key to the app. If one is ever needed (seed scripts), it stays out of `src/` and out of `NEXT_PUBLIC_*`.
3. **New tables get RLS in the same migration**, with policies based on `private.can_access_workspace(workspace_id)` or `private.is_org_member(organization_id)`. Every workspace-scoped table has a `workspace_id` column.
4. **Vector search must filter by workspace inside the SQL query**, i.e. `WHERE workspace_id = $1` in the same statement as `ORDER BY embedding <=> $2`. Never filter results afterwards in JS.
5. **LLM tools never take `workspace_id` or `user_id` as arguments.** The server injects them from the session. Tool arguments are validated with a strict Zod schema; unknown tools and invalid arguments return an error result and are logged. The loop never throws.
6. **Retrieved document text is data, not instructions.** Wrap it in delimiters, and don't expose destructive tools.
7. **Secrets:** never commit `.env*` (only `.env.example`), never log keys or webhook URLs, and never import server modules into client components (`import "server-only"` guards them).
8. **Redirect targets from query strings go through `safeNext()`.**
9. **Migrations are append-only.** Add a new timestamped file; don't edit an applied one.

## AI pipeline (decisions and why)

- **Chunking:** ~2,000 chars with ~300 overlap, paragraph → sentence → word splitting. **Hard break at every PDF page** (citations name one page), and a soft break at Markdown sections. Embedded text gets a "Document: … / Section: …" header; stored content stays clean.
- **Idempotency:** `documents` is unique on `(workspace_id, content_hash)` (sha256 of bytes). Re-uploading a ready file is a no-op; a failed or stale-processing file is reprocessed in place (old chunks deleted first).
- **Retrieval:** `match_document_chunks(workspace_id, embedding, k, min)` is `security invoker` (RLS applies) with the workspace filter in the WHERE clause. No HNSW index yet: exact search is correct at this size, and filtered HNSW can under-return.
- **"I don't know":** two layers. (1) A similarity gate: best < `RAG_MIN_SIMILARITY` (0.60) means refuse with no LLM call. Calibrated: answerable questions 0.69–0.78, off-topic 0.50–0.57. (2) The prompt requires the exact `NO_ANSWER` sentence for near-topic questions the gate can't catch (e.g. "parental leave" vs a leave policy scored 0.64).
- **Prompt injection:** sources go in numbered `<source>` blocks, and document text that could close or forge the delimiters is neutralised (`escapeSourceText`). The system prompt says source text is data. Answers render through react-markdown (no raw HTML). Tools, when added, must still be safe even if the model is fooled.
- **Models:** `GEMINI_CHAT_MODELS` is tried in order. One retry on 429/5xx/timeout, and a 404 skips to the next model (pinned old models get retired). 20s per call, 45s total budget (Vercel `maxDuration = 60`). `thinkingLevel: LOW`, temperature 0.2.
- **Reliability:** the question and a `pending` answer row are saved before any AI call. Failures set `status = 'error'` with a friendly message, and the UI shows Retry. A `pending` row older than 90s is shown as interrupted and is retryable.
- **Chat sessions:** a workspace has many sessions per user (`chat_sessions`), created lazily by the first question and titled from it. Conversation history sent to the LLM comes from the current session only. **Retrieval always searches all of the workspace's documents**, whatever the session. Sessions and messages are private to their user (RLS), even in a shared org workspace, and a composite FK `(session_id, workspace_id, user_id)` stops a message landing in another user's or workspace's session.
- **Tools:** `save_task`, `list_tasks`, `send_summary`. `send_summary` posts to the **current workspace's own** Slack channel, connected via "Add to Slack" in Settings.
  - Tools reach data only through `ToolServices`, which is pinned server-side to one workspace, session and message. The model never supplies ids.
  - Side-effect tools have `requiresIntent`: they run only if the **user's latest message** asks for that action, so document text can't trigger them.
  - `maxPerTurn` limits per tool. On a retry, side effects that already succeeded are marked used, so there are no duplicate tasks or posts.
  - Every attempt is written to the append-only `tool_calls` table, which feeds the Tool Logs page and the chips under answers.
  - Slack text is escaped (`&`, `<`, `>`) in both blocks and the fallback `text`, so `<!channel>` or disguised links can't be injected. The webhook URL must match `hooks.slack.com` and is never logged.
- **Integrations (secrets without a service-role key):** a workspace's Slack webhook and token are sealed with AES-256-GCM (`INTEGRATIONS_ENCRYPTION_KEY`) before insert, using `workspace:<id>:slack` as associated data. The row is readable by members (RLS) but useless without the server key, and a ciphertext copied to another workspace won't decrypt. Only admins can insert, update or delete. A check constraint rejects anything not prefixed `v1:`. Rotating the key requires reconnecting.
- **Gate with tools:** no matching sources plus no tool-like intent (`mightUseTools`) means "I don't know" with no LLM call. With no sources, a reply is kept only if a tool succeeded; otherwise it's forced to `NO_ANSWER`.
- **Gotcha:** pdf.js detaches the ArrayBuffer it receives. Always pass `bytes.slice()`.

## Conventions

- Server Components by default. Add `"use client"` only for interactivity (forms with `useActionState`, dropdowns).
- Mutations are Server Actions that validate with Zod, return `{ error?, fieldErrors? }` for forms, and `redirect()` on success.
- Log the Supabase error `code` and `message` on the server (`console.error`), and show the user a friendly message. Never show raw DB errors.
- Styling: only brand tokens (`bg-primary`, `text-muted`, `border-line`, `bg-lavender`, `bg-canvas`, `text-ink`, `shadow-card`). No raw hex values in components. Radius: `rounded-xl` for controls, `rounded-2xl`/`rounded-3xl` for cards.
- Icons: `lucide-react`. Font: Inter (`next/font`).
- Keep files small and named by what they do. Match the surrounding code's comment density: explain *why*, not *what*.

## Brand

| Token | Hex | Use |
|---|---|---|
| primary | #6C3DF5 | main brand color, primary buttons, active states |
| secondary | #8B6BFF | UI elements, highlights |
| accent | #22D3EE | actions, links, success accents |
| ink (dark) | #0F172A | text, dark backgrounds |
| canvas (light) | #F5F7FF | app background |
| muted | #64748B | secondary text |

Logos: `public/brand/dossify-icon.png` (mark) and `public/brand/dossify-logo.png` (mark + wordmark). In the UI the wordmark is rendered as live Inter Bold text next to the mark (`components/brand/logo.tsx`), so it also works on dark backgrounds.

## Status / roadmap

- [x] Auth: email + Google, personal vs organization accounts, onboarding, workspace switcher, app shell
- [ ] Invitations for organization accounts (email invite → accept flow)
- [x] Document upload + ingestion (parse → chunk → embed → pgvector, idempotent by content hash)
- [x] Workspace-scoped RAG chat with citations and "I don't know"
- [x] Tool calling (`save_task`, `list_tasks`, `send_summary` via Slack webhook) + tool-call log
- [x] Dashboard data (documents, chat sessions, tasks, tool logs)
- [ ] Stretch: streaming, retrieval debug view, hybrid search, observability
- [ ] Seed script, README test instructions, AI_NOTES.md
