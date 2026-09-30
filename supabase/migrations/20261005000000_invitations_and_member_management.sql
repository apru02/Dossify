-- Dossify: invite teammates to organization accounts, and manage members.
--
-- Invitation links carry a random token; only its SHA-256 hash is stored. Accepting requires the
-- signed-in user's email to match the invited email, so a leaked link alone isn't enough.
-- Personal accounts can't invite anyone (and a trigger already stops them gaining members).

create function private.is_team_org(org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.organizations where id = org and kind = 'organization');
$$;
grant execute on function private.is_team_org(uuid) to authenticated;

create table public.organization_invitations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  email            text not null check (email = lower(btrim(email)) and email like '%_@_%' and char_length(email) <= 320),
  role             public.org_role not null default 'member' check (role in ('admin', 'member')),
  token_hash       text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by       uuid default auth.uid() references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null default now() + interval '7 days',
  accepted_at      timestamptz,
  accepted_by      uuid references auth.users (id) on delete set null,
  revoked_at       timestamptz,
  check (accepted_at is null or revoked_at is null)
);
-- One open invitation per email per organization (resending rotates the token on the same row).
create unique index organization_invitations_open_idx
  on public.organization_invitations (organization_id, email)
  where accepted_at is null and revoked_at is null;

alter table public.organization_invitations enable row level security;

create policy "invitations: admins read" on public.organization_invitations
  for select to authenticated
  using (private.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

create policy "invitations: admins invite (team accounts only)" on public.organization_invitations
  for insert to authenticated
  with check (
    private.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
    and private.is_team_org(organization_id)
    and invited_by = (select auth.uid())
    and accepted_at is null and revoked_at is null
  );

-- Resend (rotate token/expiry) and revoke. Accepting happens only through accept_invitation().
create policy "invitations: admins resend or revoke" on public.organization_invitations
  for update to authenticated
  using (private.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]) and accepted_at is null)
  with check (private.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]) and accepted_at is null);

-- ---------------------------------------------------------------------------
-- Member management (roles are changed / members removed by owners and admins)
-- ---------------------------------------------------------------------------

-- Owners/admins can change the role of anyone except the owner, and can't create a second owner.
create policy "members: admins change roles" on public.organization_members
  for update to authenticated
  using (private.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]) and role <> 'owner')
  with check (private.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]) and role <> 'owner');

-- Owners/admins can remove anyone except the owner; anyone except the owner can leave.
create policy "members: admins remove, members leave" on public.organization_members
  for delete to authenticated
  using (
    role <> 'owner'
    and (
      private.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
      or user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- RPCs used by the invite link page
-- ---------------------------------------------------------------------------

-- What the invite page shows. Callable before login (the token holder is the invitee).
create function public.get_invitation(p_token_hash text)
returns table (organization_name text, inviter_name text, email text, role public.org_role, status text)
language sql stable security definer set search_path = '' as $$
  select
    o.name,
    coalesce(p.full_name, p.email, 'A teammate'),
    i.email,
    i.role,
    case
      when i.accepted_at is not null then 'accepted'
      when i.revoked_at is not null then 'revoked'
      when i.expires_at < now() then 'expired'
      else 'pending'
    end
  from public.organization_invitations i
  join public.organizations o on o.id = i.organization_id
  left join public.profiles p on p.id = i.invited_by
  where i.token_hash = p_token_hash;
$$;
revoke execute on function public.get_invitation(text) from public;
grant execute on function public.get_invitation(text) to anon, authenticated;

-- Join the organization. Returns the workspace to open (the organization's oldest).
create function public.accept_invitation(p_token_hash text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user  uuid := auth.uid();
  v_email text;
  v_inv   public.organization_invitations;
  v_ws    uuid;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select * into v_inv from public.organization_invitations where token_hash = p_token_hash for update;
  if not found then raise exception 'invitation_not_found' using errcode = 'P0001'; end if;
  if v_inv.revoked_at is not null then raise exception 'invitation_revoked' using errcode = 'P0001'; end if;

  if v_inv.accepted_at is not null then
    -- Idempotent for the person who accepted it (double-click, refresh).
    if v_inv.accepted_by <> v_user then raise exception 'invitation_used' using errcode = 'P0001'; end if;
  else
    if v_inv.expires_at < now() then raise exception 'invitation_expired' using errcode = 'P0001'; end if;
    select lower(email) into v_email from auth.users where id = v_user;
    if v_email is distinct from v_inv.email then
      raise exception 'invitation_email_mismatch' using errcode = 'P0001';
    end if;

    insert into public.organization_members (organization_id, user_id, role)
    values (v_inv.organization_id, v_user, v_inv.role)
    on conflict (organization_id, user_id) do nothing;

    update public.organization_invitations
    set accepted_at = now(), accepted_by = v_user
    where id = v_inv.id;
  end if;

  select id into v_ws from public.workspaces
  where organization_id = v_inv.organization_id
  order by created_at
  limit 1;
  return v_ws;
end;
$$;
revoke execute on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;
