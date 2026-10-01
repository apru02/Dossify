# Dossify

![Dossify](public/brand/dossify-logo.png)

**Your documents, more done.** Dossify is a multi-workspace AI document assistant. Upload documents into a workspace, ask questions and get answers grounded in (and cited from) that workspace only, and let the assistant take actions such as saving tasks.

Two kinds of accounts:

- **Personal:** just you, with as many private workspaces as you like.
- **Organization:** shared workspaces for a team. Members can access every workspace in the organization.

> Status: accounts, workspaces, team invitations, document ingestion, grounded streaming chat with citations, chat sessions and tool calling (tasks + per-workspace Slack) are done (see [CLAUDE.md](CLAUDE.md) → Status).

## Test account

A throwaway demo account for reviewers:

| | |
|---|---|
| Email | `dev.begings@gmail.com` |
| Password | `demo123456` |

Log in with **email and password** (not "Continue with Google"). Please don't change the password, so others can use it too. The sample documents are in [`demo data/`](demo%20data/).

## Tech stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · Supabase (Auth, Postgres, RLS, pgvector) · Gemini · Zod · Vercel

## Run locally

Requirements: Node.js 20+ and a free [Supabase](https://supabase.com) project.

```bash
npm install
cp .env.example .env.local   # then fill in the values (see below)
npm run dev                  # http://localhost:3000
```

### Environment variables

| Variable | Where to find it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase → Project Settings → API Keys → **Publishable key** (or the legacy `anon` key) |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` locally; your production URL on Vercel |
| `GEMINI_API_KEY` | [Google AI Studio → API keys](https://aistudio.google.com/apikey) (free, no card). Server-only. |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` | Your Slack app's credentials (see "Slack" below). Server-only; optional. |
| `INTEGRATIONS_ENCRYPTION_KEY` | 32 random bytes, base64 (`openssl rand -base64 32`). Encrypts each workspace's Slack connection. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` | Any SMTP provider, used to email team invitations. Optional: without it, admins copy the invite link. |

Optional: `GEMINI_CHAT_MODELS` (comma-separated fallback chain), `GEMINI_EMBEDDING_MODEL`, `RAG_MIN_SIMILARITY`. The defaults are in `.env.example`.

The publishable key is designed to be public. Every table is protected by Row-Level Security, and the app never uses a service-role/secret key.

## One-time Supabase setup

### 1. Create the database schema

In the Supabase dashboard, open **SQL Editor → New query**. Run each file in [`supabase/migrations/`](supabase/migrations/) **in order**. Paste its contents and click **Run**, one query per file:

1. `20260930000000_accounts_and_workspaces.sql`: accounts, members, workspaces
2. `20261001000000_documents_and_chat.sql`: pgvector, documents, chunks, chat messages, `match_document_chunks()`
3. `20261002000000_chat_sessions.sql`: multiple chat sessions per workspace (existing history moves into an "Earlier chat" session)
4. `20261003000000_tasks_and_tool_calls.sql`: tasks and the append-only tool-call log
5. `20261004000000_workspace_integrations.sql`: per-workspace Slack connections (encrypted)
6. `20261005000000_invitations_and_member_management.sql`: team invitations, role changes, removing/leaving

(Alternatively, with the Supabase CLI: `supabase link --project-ref <ref>` then `supabase db push`.)

### 2. Configure auth URLs

Go to **Authentication → URL Configuration** and set:

- **Site URL:** `http://localhost:3000` for now. Change it to your Vercel URL when you deploy.
- **Redirect URLs:** add both
  - `http://localhost:3000/**`
  - `https://<your-vercel-app>.vercel.app/**` (once deployed)

### 3. Email sign-up

Go to **Authentication → Sign In / Providers → Email**:

- **Recommended for development and demos:** turn **Confirm email** OFF. Users are signed in immediately after sign-up. Supabase's built-in mailer is heavily rate-limited, so confirmation emails can be slow or blocked.
- **If you keep it ON:** go to **Authentication → Emails → Confirm signup** and change the link in the template to:
  ```
  {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/onboarding
  ```
  This makes the link work even if it's opened in a different browser.

### 4. Google sign-in

1. In [Google Cloud Console](https://console.cloud.google.com/), create (or pick) a project.
2. Go to **APIs & Services → OAuth consent screen**:
   - Choose **External** and fill in the app name (Dossify), support email and developer email.
   - Add the scopes `openid`, `.../auth/userinfo.email` and `.../auth/userinfo.profile`.
   - While the app is in *Testing*, add your Google account(s) as **test users**, or publish the app.
3. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**.
   - **Authorized JavaScript origins:** `http://localhost:3000` and later `https://<your-vercel-app>.vercel.app`.
   - **Authorized redirect URIs:** `https://<your-project-ref>.supabase.co/auth/v1/callback`. This is Supabase's callback, not the app's. The exact URL is shown on the Supabase Google provider page.
4. Copy the **Client ID** and **Client secret**. In Supabase, go to **Authentication → Sign In / Providers → Google**, enable it, paste both values and save.

No credit card is required at any step.

## How auth works

```
/signup  ── choose Personal or Organization ──┬── email + password ── signUp() ──┐
                                              └── Google ── OAuth ── /auth/callback
                                                                                   ▼
                     /onboarding  (account type and org name pre-filled from sign-up)
                                                                                   ▼
               create_account() RPC: org + owner membership + first workspace (one transaction)
                                                                                   ▼
                                    /w/<workspaceId>  (app shell with workspace switcher)
```

- `src/proxy.ts` refreshes the session cookie on each request and sends signed-out users to `/login`.
- Every workspace page loads the workspace through the user's own Supabase client. RLS returns nothing for workspaces you don't belong to, and the app responds with a 404.
- Personal accounts can never gain a second member. A database trigger enforces this, not just the UI.

## How documents and chat work

```
Upload (PDF / Markdown / TXT, ≤ 4 MB)
  → sha256 of the bytes: same file already in this workspace? → "already uploaded", nothing duplicated
  → parse (PDF text per page · Markdown heading path · plain text)
  → chunk (~2,000 chars, ~300 overlap; never spans two PDF pages)
  → embed with gemini-embedding-001 (768 dims)
  → one shared table `document_chunks`, every row tagged with workspace_id

Question (in a chat session; the first question of a "New chat" creates the session and names it)
  → saved to chat_messages first (never lost), plus a "pending" answer row
  → embed question → match_document_chunks(workspace_id, …): filter INSIDE the vector query, runs under RLS
  → best similarity < 0.60 → "I don't know" without calling the LLM
  → otherwise the top chunks go to Gemini as numbered, delimited <source> blocks, and it must cite [n]
    or say "I don't know"; document text is treated as data, never instructions
  → answer + citations (document, page/section, snippet) + retrieval scores saved; failures are retryable
```

## Streaming

Answers stream token by token from `POST /api/chat` as newline-delimited JSON events:
- `start` (session and message ids)
- `status` ("Searching…", "Saving a task…")
- `delta` (text)
- `tool` (each tool result as it happens)
- `done` (the saved answer, with citations, tools, model and latency)

Behaviour worth knowing:
- The question is saved before streaming starts. The server finishes and saves the answer even if the browser disconnects.
- Text streams only when the answer is grounded in matching sources. Otherwise the reply might be replaced by "I don't know", so only tool events stream.
- The endpoint rejects cross-origin requests and requires a session.

## Teams: invitations and roles

Organization accounts can invite people from **Members**.

**Invitations**
- An owner or admin enters an email and a role (member or admin). Dossify emails a link, and the admin also gets a copyable link (useful when SMTP isn't set up).
- The link is valid for 7 days. The database stores only the SHA-256 hash of the 256-bit token.
- **Accepting requires signing in with the invited email address**, so a forwarded link alone isn't enough.
- A new user signs up straight from the link (no account-type step) and lands in the organization's workspace. An existing user logs in and clicks **Join**.
- Admins can **resend** an invite (new token, old link stops working, 7 more days) or **revoke** it.

**Roles**
- **Owner** can't be removed or demoted.
- **Admins** can invite, change roles (member ↔ admin), remove members, and manage Slack and documents.
- **Members** can use every workspace in the organization and can leave.
- These rules are enforced by RLS policies and `accept_invitation()`, not just the UI. Personal accounts can't invite anyone.

## Tools the assistant can call

| Tool | What it does | Guardrails |
|---|---|---|
| `save_task(title, due_date?, notes?)` | Adds a task to the current workspace (Tasks page) | Runs only if your message asks for it (e.g. "remind me", "add a task"); at most 5 per message |
| `list_tasks(status?, limit?)` | Reads the workspace's tasks | Read-only; at most 3 per message |
| `send_summary(title, summary)` | Posts to the team's Slack channel | Runs only if your message asks to send/share/post; once per message; Slack mentions and links are escaped |

The model proposes a call and the server decides:
- Arguments are validated with strict Zod schemas. Unknown tools and extra keys (such as a `workspace_id`) are rejected.
- The workspace always comes from your session.
- The model can chain tools, e.g. save a task and then list tasks, for up to 4 rounds.
- Every attempt, including blocked ones, is recorded on the **Tool Logs** page.
- Retrying a failed answer never repeats a task save or a Slack post that already succeeded.

### Slack (per workspace)

Each Dossify workspace connects **its own** Slack channel: **Settings → Integrations → Add to Slack**. Owners and admins can connect, disconnect or send a test message.

- It's standard Slack OAuth v2 with only the `incoming-webhook` scope. Dossify registers one Slack app, and each install returns a webhook for the channel the user picks.
- The webhook (and token) are encrypted with AES-256-GCM before being stored. The key is `INTEGRATIONS_ENCRYPTION_KEY`, and the workspace id is bound as associated data. Members can see which channel is connected, but never the URL.
- `send_summary` posts to the current workspace's channel. If none is connected, it tells the user to connect Slack in Settings.
- The OAuth round-trip is protected by a one-time `state` nonce, checked against an httpOnly cookie.

**One-time app setup (deployment owner):**
1. At https://api.slack.com/apps, choose **Create New App → From scratch**.
2. Under **OAuth & Permissions → Redirect URLs**, add `https://<your-domain>/api/integrations/slack/callback`.
3. Under **Incoming Webhooks**, turn it on.
4. Under **Manage Distribution**, activate public distribution so other Slack workspaces can install it.
5. Copy the Client ID and Client Secret into your environment.

## Tests

```bash
npm test          # unit tests + database isolation tests (in-memory Postgres with the real migrations)
npm run test:ai   # live Gemini tests: RAG pipeline + multi-step tool calling (needs GEMINI_API_KEY; rate-limited)
```

The isolation tests put a secret in one workspace and verify that no query from another workspace can retrieve it, even with a perfect vector match or a forged workspace id.

## Deploying (Vercel)

1. Push this repo to GitHub, then **Import** it in Vercel (Hobby plan, free).
2. Add the environment variables, including `GEMINI_API_KEY`. Set `NEXT_PUBLIC_SITE_URL` to your Vercel URL.
3. Add the Vercel URL to Supabase's redirect URLs and to Google's authorized JavaScript origins (steps 2 and 4 above).

## Project docs

- [CLAUDE.md](CLAUDE.md): architecture, tenancy model, rules and conventions (also used as AI assistant context)
