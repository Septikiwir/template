create extension if not exists "pgcrypto";

do $$
begin
  create type public.tenant_role as enum ('admin', 'user');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan text not null default 'free',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  default_tenant_id uuid references public.tenants(id),
  is_superadmin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tenant_memberships (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.tenant_role not null default 'user',
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create table if not exists public.contacts (
  id bigserial primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  nama text not null,
  nomor text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, nomor)
);

create table if not exists public.tenant_suspensions (
  id bigserial primary key,
  tenant_id uuid references public.tenants(id) on delete cascade,
  tenant_name text not null,
  target_type text not null check (target_type in ('tenant', 'user')),
  target_label text not null,
  reason text not null,
  status text not null default 'suspended' check (status in ('suspended', 'restored')),
  suspended_by_label text not null,
  suspended_at timestamptz not null default now(),
  restored_by_label text,
  restored_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.permission_overrides (
  id bigserial primary key,
  tenant_id uuid references public.tenants(id) on delete cascade,
  tenant_name text not null,
  target_label text not null,
  reason text not null,
  expires_at timestamptz not null,
  granted_by_label text not null,
  active boolean not null default true,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.superadmin_audit_logs (
  id bigserial primary key,
  tenant_id uuid references public.tenants(id) on delete cascade,
  tenant_name text,
  actor_label text not null,
  action text not null,
  details text not null,
  created_at timestamptz not null default now()
);

create index if not exists contacts_tenant_id_idx on public.contacts (tenant_id);
create index if not exists contacts_created_at_idx on public.contacts (created_at desc);
create index if not exists tenant_memberships_user_id_idx on public.tenant_memberships (user_id);
create index if not exists tenant_memberships_tenant_id_idx on public.tenant_memberships (tenant_id);
create index if not exists tenant_suspensions_status_idx on public.tenant_suspensions (status);
create index if not exists tenant_suspensions_created_at_idx on public.tenant_suspensions (created_at desc);
create index if not exists permission_overrides_active_idx on public.permission_overrides (active);
create index if not exists permission_overrides_created_at_idx on public.permission_overrides (created_at desc);
create index if not exists superadmin_audit_logs_created_at_idx on public.superadmin_audit_logs (created_at desc);

create or replace function public.is_superadmin()
returns boolean language sql stable
security definer
set search_path = public
as $$
  select coalesce((select is_superadmin from public.app_users where id = auth.uid()), false);
$$;

create or replace function public.is_tenant_member(tid uuid)
returns boolean language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.tenant_memberships m
    where m.user_id = auth.uid() and m.tenant_id = tid
  );
$$;

create or replace function public.is_tenant_admin(tid uuid)
returns boolean language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.tenant_memberships m
    where m.user_id = auth.uid() and m.tenant_id = tid and m.role = 'admin'
  );
$$;

alter table public.tenants enable row level security;

drop policy if exists "tenants_select" on public.tenants;
create policy "tenants_select"
on public.tenants
for select
to authenticated
using (public.is_superadmin() or public.is_tenant_member(id));

drop policy if exists "tenants_insert" on public.tenants;
create policy "tenants_insert"
on public.tenants
for insert
to authenticated
with check (public.is_superadmin());

drop policy if exists "tenants_update" on public.tenants;
create policy "tenants_update"
on public.tenants
for update
to authenticated
using (public.is_superadmin() or public.is_tenant_admin(id))
with check (public.is_superadmin() or public.is_tenant_admin(id));

drop policy if exists "tenants_delete" on public.tenants;
create policy "tenants_delete"
on public.tenants
for delete
to authenticated
using (public.is_superadmin());

alter table public.app_users enable row level security;

drop policy if exists "app_users_select" on public.app_users;
create policy "app_users_select"
on public.app_users
for select
to authenticated
using (auth.uid() = id or public.is_superadmin());

drop policy if exists "app_users_insert" on public.app_users;
create policy "app_users_insert"
on public.app_users
for insert
to authenticated
with check (auth.uid() = id or public.is_superadmin());

drop policy if exists "app_users_update" on public.app_users;
create policy "app_users_update"
on public.app_users
for update
to authenticated
using (auth.uid() = id or public.is_superadmin())
with check (auth.uid() = id or public.is_superadmin());

alter table public.tenant_memberships enable row level security;

drop policy if exists "tenant_memberships_select" on public.tenant_memberships;
create policy "tenant_memberships_select"
on public.tenant_memberships
for select
to authenticated
using (public.is_superadmin() or public.is_tenant_member(tenant_id));

drop policy if exists "tenant_memberships_mutate" on public.tenant_memberships;
create policy "tenant_memberships_mutate"
on public.tenant_memberships
for all
to authenticated
using (public.is_superadmin() or public.is_tenant_admin(tenant_id))
with check (public.is_superadmin() or public.is_tenant_admin(tenant_id));

alter table public.contacts enable row level security;

drop policy if exists "contacts_select" on public.contacts;
create policy "contacts_select"
on public.contacts
for select
to authenticated
using (public.is_superadmin() or public.is_tenant_member(tenant_id));

drop policy if exists "contacts_insert" on public.contacts;
create policy "contacts_insert"
on public.contacts
for insert
to authenticated
with check (public.is_superadmin() or public.is_tenant_member(tenant_id));

drop policy if exists "contacts_update" on public.contacts;
create policy "contacts_update"
on public.contacts
for update
to authenticated
using (public.is_superadmin() or public.is_tenant_member(tenant_id))
with check (public.is_superadmin() or public.is_tenant_member(tenant_id));

drop policy if exists "contacts_delete" on public.contacts;
create policy "contacts_delete"
on public.contacts
for delete
to authenticated
using (public.is_superadmin() or public.is_tenant_member(tenant_id));

alter table public.tenant_suspensions enable row level security;

drop policy if exists "tenant_suspensions_select" on public.tenant_suspensions;
create policy "tenant_suspensions_select"
on public.tenant_suspensions
for select
to authenticated
using (public.is_superadmin());

drop policy if exists "tenant_suspensions_mutate" on public.tenant_suspensions;
create policy "tenant_suspensions_mutate"
on public.tenant_suspensions
for all
to authenticated
using (public.is_superadmin())
with check (public.is_superadmin());

alter table public.permission_overrides enable row level security;

drop policy if exists "permission_overrides_select" on public.permission_overrides;
create policy "permission_overrides_select"
on public.permission_overrides
for select
to authenticated
using (public.is_superadmin());

drop policy if exists "permission_overrides_mutate" on public.permission_overrides;
create policy "permission_overrides_mutate"
on public.permission_overrides
for all
to authenticated
using (public.is_superadmin())
with check (public.is_superadmin());

alter table public.superadmin_audit_logs enable row level security;

drop policy if exists "superadmin_audit_logs_select" on public.superadmin_audit_logs;
create policy "superadmin_audit_logs_select"
on public.superadmin_audit_logs
for select
to authenticated
using (public.is_superadmin());

drop policy if exists "superadmin_audit_logs_insert" on public.superadmin_audit_logs;
create policy "superadmin_audit_logs_insert"
on public.superadmin_audit_logs
for insert
to authenticated
with check (public.is_superadmin());
