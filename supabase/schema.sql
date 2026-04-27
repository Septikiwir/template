create table if not exists public.contacts (
  id bigserial primary key,
  user_id uuid not null default auth.uid(),
  nama text not null,
  nomor text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, nomor)
);

create index if not exists contacts_user_id_idx on public.contacts (user_id);
create index if not exists contacts_created_at_idx on public.contacts (created_at desc);

alter table public.contacts enable row level security;

-- Policy: Users can only see their own contacts
drop policy if exists "Users can view own contacts" on public.contacts;
create policy "Users can view own contacts"
on public.contacts
for select
to authenticated
using (auth.uid() = user_id);

-- Policy: Users can only insert their own contacts
drop policy if exists "Users can insert own contacts" on public.contacts;
create policy "Users can insert own contacts"
on public.contacts
for insert
to authenticated
with check (auth.uid() = user_id);

-- Policy: Users can only update their own contacts
drop policy if exists "Users can update own contacts" on public.contacts;
create policy "Users can update own contacts"
on public.contacts
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Policy: Users can only delete their own contacts
drop policy if exists "Users can delete own contacts" on public.contacts;
create policy "Users can delete own contacts"
on public.contacts
for delete
to authenticated
using (auth.uid() = user_id);
