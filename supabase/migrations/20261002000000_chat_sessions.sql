-- Dossify: multiple chat sessions per workspace.
--
-- A session belongs to one user in one workspace. Messages belong to one session.
-- Documents stay workspace-wide: every session in a workspace searches the same documents.

create table public.chat_sessions (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title         text not null default 'New chat' check (char_length(btrim(title)) between 1 and 120),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),  -- last activity, for "recent chats" ordering
  -- Target for chat_messages' composite FK: a message can only live in a session of the same
  -- workspace AND the same user.
  unique (id, workspace_id, user_id)
);
create index chat_sessions_recent_idx on public.chat_sessions (workspace_id, user_id, updated_at desc);

alter table public.chat_sessions enable row level security;

create policy "chat sessions: own sessions in accessible workspaces" on public.chat_sessions
  for all to authenticated
  using (user_id = (select auth.uid()) and private.can_access_workspace(workspace_id))
  with check (user_id = (select auth.uid()) and private.can_access_workspace(workspace_id));

-- ---------------------------------------------------------------------------
-- Attach messages to sessions (backfilling existing threads as "Earlier chat")
-- ---------------------------------------------------------------------------

alter table public.chat_messages add column session_id uuid;

insert into public.chat_sessions (workspace_id, user_id, title, created_at, updated_at)
select workspace_id, user_id, 'Earlier chat', min(created_at), max(created_at)
from public.chat_messages
group by workspace_id, user_id;

update public.chat_messages m
set session_id = s.id
from public.chat_sessions s
where s.workspace_id = m.workspace_id and s.user_id = m.user_id and m.session_id is null;

alter table public.chat_messages alter column session_id set not null;

alter table public.chat_messages
  add constraint chat_messages_session_fk
  foreign key (session_id, workspace_id, user_id)
  references public.chat_sessions (id, workspace_id, user_id) on delete cascade;

create index chat_messages_session_idx on public.chat_messages (session_id, created_at);

-- Keep "recent chats" ordering fresh: any new message bumps its session.
-- Runs as the inserting user; RLS already lets them update their own session.
create function private.touch_chat_session()
returns trigger language plpgsql set search_path = '' as $$
begin
  update public.chat_sessions set updated_at = now() where id = new.session_id;
  return new;
end;
$$;

create trigger chat_messages_touch_session
  after insert on public.chat_messages
  for each row execute function private.touch_chat_session();
-- (Deliberately no updated_at trigger on chat_sessions: renaming a chat shouldn't reorder the list.)
