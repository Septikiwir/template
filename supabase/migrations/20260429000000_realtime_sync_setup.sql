-- 1. Create settings table
create table if not exists public.settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  link text not null default 'https://nimantra.vercel.app/?to={nama}&token={id}',
  pesan text not null default 'Halo {nama}, kami mengundang Anda ke acara pernikahan kami. Detail undangan dapat dilihat pada link berikut: {link}',
  include_token boolean not null default true,
  updated_at timestamptz not null default now()
);

-- 2. Enable RLS
alter table public.settings enable row level security;

-- 3. Add RLS Policies
drop policy if exists "settings_select" on public.settings;
create policy "settings_select"
on public.settings
for select
to authenticated
using (public.is_superadmin() or public.is_tenant_member(tenant_id));

drop policy if exists "settings_upsert" on public.settings;
create policy "settings_upsert"
on public.settings
for all
to authenticated
using (public.is_superadmin() or public.is_tenant_member(tenant_id))
with check (public.is_superadmin() or public.is_tenant_member(tenant_id));

-- 4. Enable Realtime for contacts and settings
-- Note: This requires running as a superuser/admin in Supabase
-- If this fails, the user might need to enable it manually in the Supabase Dashboard
begin;
  -- Remove existing if any (to avoid duplicates)
  -- drop publication if exists supabase_realtime;
  -- create publication supabase_realtime;
  
  -- Add tables to publication
  alter publication supabase_realtime add table contacts;
  alter publication supabase_realtime add table settings;
exception when others then
  raise notice 'Could not automatically add to publication. Please ensure Realtime is enabled in Supabase Dashboard for contacts and settings tables.';
end;
