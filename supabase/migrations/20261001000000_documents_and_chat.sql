-- Dossify: documents, chunks (one shared vector store for ALL workspaces) and chat messages.
--
-- Isolation rules
--   * Every row carries workspace_id, and RLS checks it with private.can_access_workspace().
--   * Chunk search filters by workspace_id INSIDE the vector query (match_document_chunks).
--   * Composite foreign keys make it impossible for a chunk to be tagged with a different
--     workspace than its document (or a reply to point into another workspace).

create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create function private.is_workspace_admin(ws uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.workspaces w
    join public.organization_members m on m.organization_id = w.organization_id
    where w.id = ws and m.user_id = (select auth.uid()) and m.role in ('owner', 'admin')
  );
$$;
grant execute on function private.is_workspace_admin(uuid) to authenticated;

create function private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Documents
-- ---------------------------------------------------------------------------

create type public.document_status as enum ('processing', 'ready', 'failed');

create table public.documents (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 255),
  mime_type     text not null,
  size_bytes    integer not null check (size_bytes > 0),
  content_hash  text not null check (content_hash ~ '^[0-9a-f]{64}$'),  -- sha256 of the file bytes
  status        public.document_status not null default 'processing',
  error         text,
  page_count    integer,
  chunk_count   integer not null default 0,
  uploaded_by   uuid default auth.uid() references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- Idempotent ingestion: the same file can exist once per workspace.
  unique (workspace_id, content_hash),
  -- Target for the chunks' composite foreign key.
  unique (id, workspace_id)
);
create index documents_workspace_created_idx on public.documents (workspace_id, created_at desc);

create trigger documents_touch_updated_at
  before update on public.documents
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Chunks: the single shared vector store
-- ---------------------------------------------------------------------------

create table public.document_chunks (
  id            bigint generated always as identity primary key,
  workspace_id  uuid not null,
  document_id   uuid not null,
  chunk_index   integer not null check (chunk_index >= 0),
  content       text not null,
  page_start    integer,
  page_end      integer,
  section       text,
  token_count   integer,
  embedding     extensions.vector(768) not null,
  unique (document_id, chunk_index),
  foreign key (document_id, workspace_id)
    references public.documents (id, workspace_id) on delete cascade
);
create index document_chunks_workspace_idx on public.document_chunks (workspace_id);

-- No ANN (HNSW) index on purpose: with a WHERE workspace_id filter, an HNSW scan can return
-- fewer than k rows for small workspaces. Exact search is correct and fast at this scale.
-- If this grows, add: create index ... using hnsw (embedding extensions.vector_cosine_ops);
-- and set hnsw.iterative_scan = relaxed_order for filtered queries.

-- ---------------------------------------------------------------------------
-- Chat messages (each user has their own thread per workspace)
-- ---------------------------------------------------------------------------

create table public.chat_messages (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  role           text not null check (role in ('user', 'assistant')),
  content        text not null default '' check (char_length(content) <= 20000),
  status         text not null default 'complete' check (status in ('pending', 'complete', 'error')),
  error          text,
  reply_to       uuid,
  citations      jsonb not null default '[]'::jsonb,
  retrieval      jsonb,         -- which chunks were retrieved, with scores (debugging / isolation proof)
  model          text,
  prompt_tokens  integer,
  output_tokens  integer,
  latency_ms     integer,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (reply_to, workspace_id) references public.chat_messages (id, workspace_id) on delete cascade,
  check (role = 'user' or reply_to is not null)
);
create index chat_messages_thread_idx on public.chat_messages (workspace_id, user_id, created_at);

create trigger chat_messages_touch_updated_at
  before update on public.chat_messages
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.documents enable row level security;
alter table public.document_chunks enable row level security;
alter table public.chat_messages enable row level security;

create policy "documents: members read" on public.documents
  for select to authenticated using (private.can_access_workspace(workspace_id));

create policy "documents: members upload" on public.documents
  for insert to authenticated
  with check (private.can_access_workspace(workspace_id) and uploaded_by = (select auth.uid()));

create policy "documents: members update processing state" on public.documents
  for update to authenticated
  using (private.can_access_workspace(workspace_id))
  with check (private.can_access_workspace(workspace_id));

create policy "documents: uploader or admin deletes" on public.documents
  for delete to authenticated
  using (
    private.can_access_workspace(workspace_id)
    and (uploaded_by = (select auth.uid()) or private.is_workspace_admin(workspace_id))
  );

create policy "chunks: members read" on public.document_chunks
  for select to authenticated using (private.can_access_workspace(workspace_id));

create policy "chunks: members insert" on public.document_chunks
  for insert to authenticated with check (private.can_access_workspace(workspace_id));

create policy "chunks: members delete" on public.document_chunks
  for delete to authenticated using (private.can_access_workspace(workspace_id));

create policy "chat: own messages in accessible workspaces" on public.chat_messages
  for all to authenticated
  using (user_id = (select auth.uid()) and private.can_access_workspace(workspace_id))
  with check (user_id = (select auth.uid()) and private.can_access_workspace(workspace_id));

-- ---------------------------------------------------------------------------
-- Workspace-scoped vector search
-- ---------------------------------------------------------------------------

-- security invoker: runs as the calling user, so RLS applies on top of the explicit filter.
create function public.match_document_chunks(
  p_workspace_id    uuid,
  p_query_embedding extensions.vector(768),
  p_match_count     integer default 6,
  p_min_similarity  double precision default 0
)
returns table (
  chunk_id       bigint,
  document_id    uuid,
  document_name  text,
  chunk_index    integer,
  page_start     integer,
  page_end       integer,
  section        text,
  content        text,
  similarity     double precision
)
language sql stable security invoker set search_path = public, extensions
as $$
  select
    c.id, c.document_id, d.name, c.chunk_index, c.page_start, c.page_end, c.section, c.content,
    1 - (c.embedding <=> p_query_embedding) as similarity
  from public.document_chunks c
  join public.documents d on d.id = c.document_id and d.workspace_id = c.workspace_id
  where c.workspace_id = p_workspace_id          -- the isolation boundary, inside the vector query
    and d.status = 'ready'
    and 1 - (c.embedding <=> p_query_embedding) >= p_min_similarity
  order by c.embedding <=> p_query_embedding
  limit least(greatest(p_match_count, 1), 20);
$$;

revoke execute on function public.match_document_chunks(uuid, extensions.vector, integer, double precision) from public, anon;
grant execute on function public.match_document_chunks(uuid, extensions.vector, integer, double precision) to authenticated;
