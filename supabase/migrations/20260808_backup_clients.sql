-- RAFD Cloud Backup — service-role-only metadata.
-- Apply this migration in the Supabase project before deploying backup-api.
create extension if not exists pgcrypto;

create table if not exists public.rafd_backup_clients (
  store_id text primary key,
  token_hash text not null check (token_hash ~ '^[a-f0-9]{64}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.rafd_backup_clients enable row level security;

-- The table deliberately has no public policies. The Edge Function uses the
-- service-role key after checking the customer token.

insert into storage.buckets (id, name, public)
values ('rafd-backups', 'rafd-backups', false)
on conflict (id) do update set public = excluded.public;
