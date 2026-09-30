-- Dossify: per-workspace integrations (Slack via "Add to Slack" OAuth).
--
-- Each Dossify workspace can connect its own Slack channel. The webhook URL / token are secrets:
-- the app server encrypts them (AES-256-GCM, key in the server's environment, workspace id bound
-- as associated data) before they reach the database. Members can read the row, but only ever see
-- ciphertext; the key never touches Postgres.

create table public.workspace_integrations (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces (id) on delete cascade,
  provider           text not null check (provider in ('slack')),
  -- Non-secret display metadata
  team_id            text,
  team_name          text,
  channel_id         text,
  channel_name       text,
  configuration_url  text,
  -- Secret, encrypted by the app server (never plaintext)
  secret_ciphertext  text not null check (secret_ciphertext like 'v1:%'),
  connected_by       uuid default auth.uid() references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (workspace_id, provider)
);

create trigger workspace_integrations_touch_updated_at
  before update on public.workspace_integrations
  for each row execute function private.touch_updated_at();

alter table public.workspace_integrations enable row level security;

create policy "integrations: members read" on public.workspace_integrations
  for select to authenticated using (private.can_access_workspace(workspace_id));

create policy "integrations: admins connect" on public.workspace_integrations
  for insert to authenticated
  with check (private.is_workspace_admin(workspace_id) and connected_by = (select auth.uid()));

create policy "integrations: admins reconnect" on public.workspace_integrations
  for update to authenticated
  using (private.is_workspace_admin(workspace_id))
  with check (private.is_workspace_admin(workspace_id) and connected_by = (select auth.uid()));

create policy "integrations: admins disconnect" on public.workspace_integrations
  for delete to authenticated using (private.is_workspace_admin(workspace_id));
