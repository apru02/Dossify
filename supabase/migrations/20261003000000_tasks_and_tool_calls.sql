-- Dossify: tasks (a real side effect of tool calling) and an append-only tool-call audit log.
--
-- Both are workspace-scoped and visible to every member of the workspace: tasks are shared work,
-- and the tool log is the audit trail of what the assistant did in the workspace.

create table public.tasks (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces (id) on delete cascade,
  title              text not null check (char_length(btrim(title)) between 1 and 200),
  notes              text check (notes is null or char_length(notes) <= 1000),
  due_date           date,
  status             text not null default 'open' check (status in ('open', 'done')),
  created_by         uuid default auth.uid() references auth.users (id) on delete set null,
  source_message_id  uuid references public.chat_messages (id) on delete set null,
  created_at         timestamptz not null default now(),
  completed_at       timestamptz,
  check ((status = 'done') = (completed_at is not null))
);
create index tasks_workspace_status_idx on public.tasks (workspace_id, status, created_at desc);

create table public.tool_calls (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session_id    uuid,
  message_id    uuid,          -- the assistant message whose turn made the call
  tool_name     text not null check (char_length(tool_name) between 1 and 100),
  args          jsonb not null default '{}'::jsonb,
  status        text not null check (status in ('ok', 'rejected', 'error')),
  result        jsonb,
  error         text,
  latency_ms    integer,
  created_at    timestamptz not null default now(),
  -- The log outlives chats: deleting a chat only clears these links (not workspace_id/user_id).
  foreign key (session_id, workspace_id, user_id)
    references public.chat_sessions (id, workspace_id, user_id) on delete set null (session_id),
  foreign key (message_id, workspace_id)
    references public.chat_messages (id, workspace_id) on delete set null (message_id)
);
create index tool_calls_workspace_created_idx on public.tool_calls (workspace_id, created_at desc);
create index tool_calls_message_idx on public.tool_calls (message_id);

alter table public.tasks enable row level security;
alter table public.tool_calls enable row level security;

create policy "tasks: members read" on public.tasks
  for select to authenticated using (private.can_access_workspace(workspace_id));

create policy "tasks: members create" on public.tasks
  for insert to authenticated
  with check (private.can_access_workspace(workspace_id) and created_by = (select auth.uid()));

create policy "tasks: members update" on public.tasks
  for update to authenticated
  using (private.can_access_workspace(workspace_id))
  with check (private.can_access_workspace(workspace_id));

create policy "tasks: creator or admin deletes" on public.tasks
  for delete to authenticated
  using (
    private.can_access_workspace(workspace_id)
    and (created_by = (select auth.uid()) or private.is_workspace_admin(workspace_id))
  );

-- Append-only: members can read the workspace's log and add their own entries. No update/delete.
create policy "tool calls: members read" on public.tool_calls
  for select to authenticated using (private.can_access_workspace(workspace_id));

create policy "tool calls: log own calls" on public.tool_calls
  for insert to authenticated
  with check (private.can_access_workspace(workspace_id) and user_id = (select auth.uid()));
