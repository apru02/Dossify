-- Dossify: accounts (personal / organization), members, workspaces.
--
-- Tenancy model
--   organization  = the account. kind 'personal' (exactly one member) or 'organization' (many).
--   workspace     = belongs to one organization. Every org member can access every workspace in it.
--   Access to ANY workspace-scoped row is decided by private.can_access_workspace(), and RLS is on
--   for every table, so even a buggy query from the app cannot read another tenant's rows.

create schema if not exists private;
grant usage on schema private to authenticated;

create type public.account_kind as enum ('personal', 'organization');
create type public.org_role as enum ('owner', 'admin', 'member');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text,
  avatar_url  text,
  created_at  timestamptz not null default now()
);

create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  kind        public.account_kind not null,
  created_by  uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table public.organization_members (
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  role             public.org_role not null default 'member',
  created_at       timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index organization_members_user_id_idx on public.organization_members (user_id);

create table public.workspaces (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text not null check (char_length(btrim(name)) between 1 and 60),
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now()
);
create index workspaces_organization_id_idx on public.workspaces (organization_id);

-- ---------------------------------------------------------------------------
-- Access helpers (security definer so RLS policies can use them without recursion)
-- ---------------------------------------------------------------------------

create function private.is_org_member(org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members
    where organization_id = org and user_id = (select auth.uid())
  );
$$;

create function private.has_org_role(org uuid, roles public.org_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members
    where organization_id = org and user_id = (select auth.uid()) and role = any (roles)
  );
$$;

create function private.can_access_workspace(ws uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.workspaces w
    join public.organization_members m on m.organization_id = w.organization_id
    where w.id = ws and m.user_id = (select auth.uid())
  );
$$;

create function private.shares_org_with(other uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.organization_members me
    join public.organization_members them on them.organization_id = me.organization_id
    where me.user_id = (select auth.uid()) and them.user_id = other
  );
$$;

grant execute on all functions in schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.workspaces enable row level security;

create policy "profiles: read self and teammates" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or private.shares_org_with(id));

create policy "profiles: update self" on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "organizations: members read" on public.organizations
  for select to authenticated
  using (private.is_org_member(id));

create policy "organizations: owners/admins update" on public.organizations
  for update to authenticated
  using (private.has_org_role(id, array['owner', 'admin']::public.org_role[]))
  with check (private.has_org_role(id, array['owner', 'admin']::public.org_role[]));

-- Inserts into organizations / organization_members only happen through create_account()
-- (and, later, an invitation-accept function). No direct insert policy = no direct inserts.
create policy "members: members read their org roster" on public.organization_members
  for select to authenticated
  using (private.is_org_member(organization_id));

create policy "workspaces: members read" on public.workspaces
  for select to authenticated
  using (private.is_org_member(organization_id));

create policy "workspaces: members create" on public.workspaces
  for insert to authenticated
  with check (private.is_org_member(organization_id) and created_by = (select auth.uid()));

create policy "workspaces: owners/admins rename" on public.workspaces
  for update to authenticated
  using (private.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]))
  with check (private.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

create policy "workspaces: owners/admins delete" on public.workspaces
  for delete to authenticated
  using (private.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

-- ---------------------------------------------------------------------------
-- Invariants
-- ---------------------------------------------------------------------------

-- A personal account can never gain a second member, whatever code path tries it.
create function private.enforce_personal_single_member()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select kind from public.organizations where id = new.organization_id) = 'personal'
     and exists (
       select 1 from public.organization_members
       where organization_id = new.organization_id and user_id <> new.user_id
     ) then
    raise exception 'Personal accounts cannot have additional members' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger organization_members_personal_single_member
  before insert or update on public.organization_members
  for each row execute function private.enforce_personal_single_member();

-- Every new auth user gets a profile row (works for email and Google sign-ups).
create function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- RPC: onboarding. Creates the account, the owner membership and a first workspace
-- in one transaction. Idempotent: calling it again returns the existing workspace.
-- ---------------------------------------------------------------------------

create function public.create_account(
  p_kind public.account_kind,
  p_name text,
  p_workspace_name text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_org  uuid;
  v_ws   uuid;
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  -- Serialise concurrent calls for the same user (double-clicks, retries).
  perform pg_advisory_xact_lock(hashtext('create_account:' || v_user::text));

  select w.id into v_ws
  from public.organization_members m
  join public.workspaces w on w.organization_id = m.organization_id
  where m.user_id = v_user and m.role = 'owner'
  order by w.created_at
  limit 1;
  if v_ws is not null then
    return v_ws;
  end if;

  p_name := nullif(btrim(p_name), '');
  p_workspace_name := coalesce(nullif(btrim(p_workspace_name), ''), 'General');

  if p_kind = 'organization' and p_name is null then
    raise exception 'Organization name is required' using errcode = '22023';
  end if;

  insert into public.organizations (name, kind, created_by)
  values (coalesce(p_name, 'Personal'), p_kind, v_user)
  returning id into v_org;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_org, v_user, 'owner');

  insert into public.workspaces (organization_id, name, created_by)
  values (v_org, p_workspace_name, v_user)
  returning id into v_ws;

  return v_ws;
end;
$$;

revoke execute on function public.create_account(public.account_kind, text, text) from public, anon;
grant execute on function public.create_account(public.account_kind, text, text) to authenticated;
