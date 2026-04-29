-- Backfill + Seed Script
-- Run this in Supabase SQL Editor AFTER applying schema.sql
-- This populates tenants, app_users, memberships, and sample contacts

begin;

-- 1. Create two sample tenants
insert into public.tenants (id, name, plan) values
  ('11111111-1111-1111-1111-111111111111', 'Tenant A (User)', 'free'),
  ('22222222-2222-2222-2222-222222222222', 'Tenant B (Admin)', 'pro')
on conflict do nothing;

-- 2. Get existing auth user and create/update app_users entry
-- NOTE: Replace 'fizah-hanif@wedding.com' with your actual auth email
do $$
declare
  user_id uuid;
begin
  -- Get the existing user by email
  select id into user_id from auth.users where email = 'fizah-hanif@wedding.com';
  
  if user_id is not null then
    -- Insert or ignore if already exists
    insert into public.app_users (id, email, full_name, default_tenant_id, is_superadmin)
    values (user_id, 'fizah-hanif@wedding.com', 'Fizah Hanif', '11111111-1111-1111-1111-111111111111', false)
    on conflict (id) do nothing;
  end if;
end $$;

-- 3. Add user memberships (fizah-hanif as user in Tenant A, as admin in Tenant B)
insert into public.tenant_memberships (tenant_id, user_id, role)
select t.id, u.id, 'user'::public.tenant_role
from public.tenants t
  join public.app_users u on u.email = 'fizah-hanif@wedding.com'
  where t.id = '11111111-1111-1111-1111-111111111111'
on conflict do nothing;

insert into public.tenant_memberships (tenant_id, user_id, role)
select t.id, u.id, 'admin'::public.tenant_role
from public.tenants t
  join public.app_users u on u.email = 'fizah-hanif@wedding.com'
  where t.id = '22222222-2222-2222-2222-222222222222'
on conflict do nothing;

-- 4. Create sample contacts in Tenant A
insert into public.contacts (tenant_id, user_id, nama, nomor, priority, kategori, is_sent, is_present, added_via)
select '11111111-1111-1111-1111-111111111111', u.id, name, phone, 'Reguler', 'Teman', false, false, 'manual'
from (
  values
    ('Budi Santoso', '628123456789'),
    ('Siti Nurhaliza', '628234567890'),
    ('Ahmad Rahman', '628345678901')
) as data(name, phone),
public.app_users u
where u.email = 'fizah-hanif@wedding.com'
on conflict do nothing;

-- 5. Create sample contacts in Tenant B
insert into public.contacts (tenant_id, user_id, nama, nomor, priority, kategori, is_sent, is_present, added_via)
select '22222222-2222-2222-2222-222222222222', u.id, name, phone, 'VIP', 'Keluarga', false, false, 'manual'
from (
  values
    ('Hana Ryan', '628456789012'),
    ('Rani Wijaya', '628567890123'),
    ('Dwi Prasetyo', '628678901234')
) as data(name, phone),
public.app_users u
where u.email = 'fizah-hanif@wedding.com'
on conflict do nothing;

-- 6. Seed superadmin dashboard samples
insert into public.tenant_suspensions (
  tenant_id,
  tenant_name,
  target_type,
  target_label,
  reason,
  status,
  suspended_by_label,
  suspended_at,
  restored_by_label,
  restored_at
)
values
  (
    '22222222-2222-2222-2222-222222222222',
    'Tenant B (Admin)',
    'tenant',
    'Tenant B (Admin)',
    'Billing gagal dan perlu review manual',
    'suspended',
    'system',
    now() - interval '3 days',
    null,
    null
  ),
  (
    '11111111-1111-1111-1111-111111111111',
    'Tenant A (User)',
    'user',
    'Support Engineer Demo',
    'Abuse/spam investigation selesai dan akun dipulihkan',
    'restored',
    'superadmin@wedding.com',
    now() - interval '10 days',
    'superadmin@wedding.com',
    now() - interval '8 days'
  )
on conflict do nothing;

insert into public.permission_overrides (
  tenant_id,
  tenant_name,
  target_label,
  reason,
  expires_at,
  granted_by_label,
  active,
  granted_at,
  revoked_at
)
values
  (
    '11111111-1111-1111-1111-111111111111',
    'Tenant A (User)',
    'Support Engineer Demo',
    'Temporary support access for incident response',
    now() + interval '2 hours',
    'superadmin@wedding.com',
    true,
    now() - interval '30 minutes',
    null
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    'Tenant B (Admin)',
    'Finance Reviewer',
    'Invoice audit and compliance review',
    now() - interval '1 day',
    'superadmin@wedding.com',
    false,
    now() - interval '2 days',
    now() - interval '1 day'
  )
on conflict do nothing;

insert into public.superadmin_audit_logs (tenant_id, tenant_name, actor_label, action, details, created_at)
values
  (
    '11111111-1111-1111-1111-111111111111',
    'Tenant A (User)',
    'superadmin@wedding.com',
    'create_tenant',
    'Default settings generated and admin assignment prepared',
    now() - interval '2 days'
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    'Tenant B (Admin)',
    'superadmin@wedding.com',
    'temporary_override',
    'Allow support access for 2 hours',
    now() - interval '30 minutes'
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    'Tenant B (Admin)',
    'superadmin@wedding.com',
    'restore_suspension',
    'Suspension restored after billing update',
    now() - interval '8 days'
  )
on conflict do nothing;

commit;
