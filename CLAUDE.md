@AGENTS.md

# Dossify

Multi-workspace AI document assistant: users upload documents into a workspace, chat with an assistant that answers **only** from that workspace's documents (with citations), and the assistant can call tools (save tasks, post summaries). All workspaces share **one** vector store, and isolation is enforced by the query and by Postgres RLS.

Tagline: "Your documents, more done."

## Stack

- **Next.js 16** (App Router, TypeScript, React 19, Server Actions). APIs differ from older Next.js: read `node_modules/next/dist/docs/` before using an unfamiliar API. Middleware is now `src/proxy.ts`.
- **Tailwind CSS v4.** Brand tokens are in `src/app/globals.css` (`@theme`). No component library; small primitives live in `src/components/ui/`.
- **Supabase:** Auth (email/password + Google OAuth), Postgres, pgvector (added later), RLS on every table. Client: `@supabase/ssr`.
- **Gemini** (`@google/genai`) for chat, tool calling and embeddings (planned).
- **Zod** validates every input: forms, server actions and, later, LLM tool arguments.
- Hosted on **Vercel**. Everything must stay on free, no-credit-card tiers.

## Commands

```bash
npm run dev      # http://localhost:3000 (needs .env.local, see .env.example)
npm run lint
npx tsc --noEmit
npm run build
```

Run lint, typecheck and build before calling any task done.

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
    w/actions.ts                   workspace server actions
  components/{ui,brand,app}/
  lib/
    auth.ts                        getCurrentUser / requireUser (getUser(), cached per request)
    urls.ts                        safeNext() (open-redirect guard), siteUrl()
    supabase/{server,proxy,env}.ts
    data/                          typed, RLS-backed queries (one file per domain)
supabase/migrations/               SQL, applied in order (SQL editor or `supabase db push`)
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
- [ ] Document upload + ingestion (parse → chunk → embed → pgvector, idempotent by content hash)
- [ ] Workspace-scoped RAG chat with citations and "I don't know"
- [ ] Tool calling (`save_task`, `list_tasks`, `send_summary` via Discord webhook) + tool-call log
- [ ] Dashboard data (documents, chat history, tool logs)
- [ ] Stretch: streaming, retrieval debug view, hybrid search, observability
- [ ] Seed script, README test instructions, AI_NOTES.md
