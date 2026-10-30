-- Stage 1: real PostgreSQL foundation. No public Data API access is granted.
-- Run once as the project database administrator. Existing objects cause rollback.
begin;
create schema bruff_private;
revoke all on schema bruff_private from public, anon, authenticated;
alter default privileges in schema bruff_private revoke all on tables from public, anon, authenticated;
alter default privileges in schema bruff_private revoke execute on functions from public, anon, authenticated;

create table bruff_private.schema_versions (
  version text primary key, applied_at timestamptz not null default now()
);
create table bruff_private.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  globally_paused boolean not null default true,
  created_at timestamptz not null default now()
);
create table bruff_private.memberships (
  workspace_id uuid not null references bruff_private.workspaces(id),
  user_id uuid not null references auth.users(id),
  role text not null check (role in ('owner','admin','operator','viewer')),
  status text not null default 'invited' check (status in ('active','disabled','invited')),
  created_at timestamptz not null default now(),
  primary key (workspace_id,user_id)
);
create index memberships_user on bruff_private.memberships(user_id,workspace_id);
create table bruff_private.creator_accounts (
  workspace_id uuid not null references bruff_private.workspaces(id),
  id uuid not null default gen_random_uuid(),
  display_name text not null check (length(trim(display_name)) between 1 and 120),
  provider text, external_id text,
  connection_status text not null default 'disconnected'
    check (connection_status in ('disconnected','pending','connected','error')),
  created_at timestamptz not null default now(),
  primary key (workspace_id,id),
  unique (workspace_id,provider,external_id),
  check (connection_status <> 'connected' or (provider is not null and external_id is not null))
);
create table bruff_private.account_grants (
  workspace_id uuid not null, user_id uuid not null, creator_id uuid not null,
  permission text not null check (permission in ('read','notes','drafts','send','settings')),
  primary key (workspace_id,user_id,creator_id,permission),
  foreign key (workspace_id,user_id) references bruff_private.memberships(workspace_id,user_id),
  foreign key (workspace_id,creator_id) references bruff_private.creator_accounts(workspace_id,id)
);
create table bruff_private.fans (
  workspace_id uuid not null, creator_id uuid not null, id text not null check (length(id) between 1 and 128),
  display_name text not null check (length(display_name) between 1 and 200),
  primary key (workspace_id,creator_id,id),
  foreign key (workspace_id,creator_id) references bruff_private.creator_accounts(workspace_id,id)
);
create table bruff_private.fan_notes (
  workspace_id uuid not null, creator_id uuid not null, fan_id text not null,
  body text not null default '' check (length(body) <= 5000),
  updated_by uuid not null, updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version > 0),
  primary key (workspace_id,creator_id,fan_id),
  foreign key (workspace_id,creator_id,fan_id) references bruff_private.fans(workspace_id,creator_id,id),
  foreign key (workspace_id,updated_by) references bruff_private.memberships(workspace_id,user_id)
);
create table bruff_private.drafts (
  workspace_id uuid not null, creator_id uuid not null, fan_id text not null, user_id uuid not null,
  body text not null default '' check (length(body) <= 10000),
  version bigint not null default 1 check (version > 0), updated_at timestamptz not null default now(),
  primary key (workspace_id,creator_id,fan_id,user_id),
  foreign key (workspace_id,creator_id,fan_id) references bruff_private.fans(workspace_id,creator_id,id),
  foreign key (workspace_id,user_id) references bruff_private.memberships(workspace_id,user_id)
);
create table bruff_private.bruff_settings (
  workspace_id uuid not null, creator_id uuid not null,
  mode text not null default 'off' check (mode in ('off','selected','all')),
  review_required boolean not null default true,
  config jsonb not null default '{}' check (jsonb_typeof(config)='object'),
  version bigint not null default 1 check (version > 0),
  primary key (workspace_id,creator_id),
  foreign key (workspace_id,creator_id) references bruff_private.creator_accounts(workspace_id,id)
);
create table bruff_private.bruff_chat_overrides (
  workspace_id uuid not null, creator_id uuid not null, fan_id text not null,
  mode text not null check (mode in ('manual','enabled')),
  primary key (workspace_id,creator_id,fan_id),
  foreign key (workspace_id,creator_id,fan_id) references bruff_private.fans(workspace_id,creator_id,id)
);

-- Helpers never accept a caller-supplied identity. They are not exposed as RPC.
create function bruff_private.is_member(w uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from bruff_private.memberships m
    where m.workspace_id=w and m.user_id=auth.uid() and m.status='active');
$$;
create function bruff_private.can_access(w uuid,c uuid,p text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p in ('read','notes','drafts','send','settings') and exists (
    select 1 from bruff_private.memberships m
    join bruff_private.creator_accounts a on a.workspace_id=m.workspace_id and a.id=c
    where m.workspace_id=w and m.user_id=auth.uid() and m.status='active'
    and (m.role in ('owner','admin') or (
      (m.role='operator' or (m.role='viewer' and p='read')) and exists (
        select 1 from bruff_private.account_grants g where g.workspace_id=w
        and g.creator_id=c and g.user_id=m.user_id and g.permission=p
      )
    ))
  );
$$;

-- All tables protected; no INSERT/UPDATE/DELETE policy permits self-promotion.
alter table bruff_private.schema_versions enable row level security;
revoke all on table bruff_private.schema_versions from public, anon, authenticated;
alter table bruff_private.workspaces enable row level security;
revoke all on table bruff_private.workspaces from public, anon, authenticated;
alter table bruff_private.memberships enable row level security;
revoke all on table bruff_private.memberships from public, anon, authenticated;
alter table bruff_private.creator_accounts enable row level security;
revoke all on table bruff_private.creator_accounts from public, anon, authenticated;
alter table bruff_private.account_grants enable row level security;
revoke all on table bruff_private.account_grants from public, anon, authenticated;
alter table bruff_private.fans enable row level security;
revoke all on table bruff_private.fans from public, anon, authenticated;
alter table bruff_private.fan_notes enable row level security;
revoke all on table bruff_private.fan_notes from public, anon, authenticated;
alter table bruff_private.drafts enable row level security;
revoke all on table bruff_private.drafts from public, anon, authenticated;
alter table bruff_private.bruff_settings enable row level security;
revoke all on table bruff_private.bruff_settings from public, anon, authenticated;
alter table bruff_private.bruff_chat_overrides enable row level security;
revoke all on table bruff_private.bruff_chat_overrides from public, anon, authenticated;
revoke all on all functions in schema bruff_private from public, anon, authenticated;
create policy workspace_read on bruff_private.workspaces for select to authenticated
  using (bruff_private.is_member(id));
create policy member_self_read on bruff_private.memberships for select to authenticated
  using (user_id=auth.uid() and status='active');
create policy account_read on bruff_private.creator_accounts for select to authenticated
  using (bruff_private.can_access(workspace_id,id,'read'));
create policy grant_self_read on bruff_private.account_grants for select to authenticated
  using (user_id=auth.uid() and bruff_private.can_access(workspace_id,creator_id,'read'));
create policy fan_read on bruff_private.fans for select to authenticated
  using (bruff_private.can_access(workspace_id,creator_id,'read'));
create policy note_read on bruff_private.fan_notes for select to authenticated
  using (bruff_private.can_access(workspace_id,creator_id,'read'));
create policy draft_self_read on bruff_private.drafts for select to authenticated
  using (user_id=auth.uid() and bruff_private.can_access(workspace_id,creator_id,'read')
    and bruff_private.can_access(workspace_id,creator_id,'drafts'));
create policy settings_read on bruff_private.bruff_settings for select to authenticated
  using (bruff_private.can_access(workspace_id,creator_id,'settings'));
create policy overrides_read on bruff_private.bruff_chat_overrides for select to authenticated
  using (bruff_private.can_access(workspace_id,creator_id,'settings'));

insert into bruff_private.workspaces(name) values ('BRUFF');
insert into bruff_private.schema_versions(version) values ('202610300001_private_foundation');
commit;
