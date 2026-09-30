# Dossify

![Dossify](public/brand/dossify-logo.png)

**Your documents, more done.** Dossify is a multi-workspace AI document assistant. Upload documents into a workspace, ask questions and get answers grounded in (and cited from) that workspace only, and let the assistant take actions such as saving tasks.

Two kinds of accounts:

- **Personal:** just you, with as many private workspaces as you like.
- **Organization:** shared workspaces for a team. Members can access every workspace in the organization.

> Status: authentication, accounts, onboarding and the workspace shell are done. Document ingestion, RAG chat and tool calling come next (see [CLAUDE.md](CLAUDE.md) → Status).

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

The publishable key is designed to be public. Every table is protected by Row-Level Security, and the app never uses a service-role/secret key.

## One-time Supabase setup

### 1. Create the database schema

In the Supabase dashboard, open **SQL Editor → New query**. Paste the contents of [`supabase/migrations/20260930000000_accounts_and_workspaces.sql`](supabase/migrations/20260930000000_accounts_and_workspaces.sql) and click **Run**.

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

## Deploying (Vercel)

1. Push this repo to GitHub, then **Import** it in Vercel (Hobby plan, free).
2. Add the three environment variables. Set `NEXT_PUBLIC_SITE_URL` to your Vercel URL.
3. Add the Vercel URL to Supabase's redirect URLs and to Google's authorized JavaScript origins (steps 2 and 4 above).

## Project docs

- [CLAUDE.md](CLAUDE.md): architecture, tenancy model, rules and conventions (also used as AI assistant context)
