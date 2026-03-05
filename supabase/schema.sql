-- Raycast Bingo V1 schema bootstrap for Supabase
-- Apply in Supabase SQL editor or via migration tooling.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.bingos (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) > 0),
  theme text,
  owner_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists bingos_set_updated_at on public.bingos;
create trigger bingos_set_updated_at
before update on public.bingos
for each row execute function public.set_updated_at();

create table if not exists public.bingo_cells (
  id uuid primary key default gen_random_uuid(),
  bingo_id uuid not null references public.bingos(id) on delete cascade,
  text text not null check (char_length(text) > 0),
  prompt text,
  position int not null check (position >= 0),
  created_at timestamptz not null default now(),
  unique (bingo_id, position)
);

create table if not exists public.bingo_participants (
  id uuid primary key default gen_random_uuid(),
  bingo_id uuid not null references public.bingos(id) on delete cascade,
  participant_key text not null,
  display_name text not null default 'Anonymous',
  joined_at timestamptz not null default now(),
  unique (bingo_id, participant_key)
);

create table if not exists public.bingo_progress (
  id uuid primary key default gen_random_uuid(),
  bingo_id uuid not null references public.bingos(id) on delete cascade,
  participant_id uuid not null references public.bingo_participants(id) on delete cascade,
  cell_id uuid not null references public.bingo_cells(id) on delete cascade,
  status text not null check (status in ('todo', 'validated')),
  helped_by_participant_id uuid references public.bingo_participants(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (participant_id, cell_id)
);

drop trigger if exists bingo_progress_set_updated_at on public.bingo_progress;
create trigger bingo_progress_set_updated_at
before update on public.bingo_progress
for each row execute function public.set_updated_at();

create index if not exists idx_bingos_created_at on public.bingos(created_at desc);
create index if not exists idx_bingos_title on public.bingos(title);
create index if not exists idx_bingos_theme on public.bingos(theme);

create index if not exists idx_bingo_participants_bingo_id on public.bingo_participants(bingo_id);

create index if not exists idx_bingo_progress_bingo_id on public.bingo_progress(bingo_id);
create index if not exists idx_bingo_progress_participant_id on public.bingo_progress(participant_id);
create index if not exists idx_bingo_progress_status on public.bingo_progress(status);
create index if not exists idx_bingo_progress_helped_by on public.bingo_progress(helped_by_participant_id);

alter table public.bingos enable row level security;
alter table public.bingo_cells enable row level security;
alter table public.bingo_participants enable row level security;
alter table public.bingo_progress enable row level security;

-- V1 meetup mode policy set: open access for anon/authenticated users.
-- Tighten these policies once full user auth is enabled in the extension.

drop policy if exists bingos_public_select on public.bingos;
create policy bingos_public_select on public.bingos
for select
using (true);

drop policy if exists bingos_public_insert on public.bingos;
create policy bingos_public_insert on public.bingos
for insert
with check (true);

drop policy if exists bingos_public_update on public.bingos;
create policy bingos_public_update on public.bingos
for update
using (true)
with check (true);

drop policy if exists bingos_public_delete on public.bingos;
create policy bingos_public_delete on public.bingos
for delete
using (true);

drop policy if exists bingo_cells_public_select on public.bingo_cells;
create policy bingo_cells_public_select on public.bingo_cells
for select
using (true);

drop policy if exists bingo_cells_public_insert on public.bingo_cells;
create policy bingo_cells_public_insert on public.bingo_cells
for insert
with check (true);

drop policy if exists bingo_cells_public_update on public.bingo_cells;
create policy bingo_cells_public_update on public.bingo_cells
for update
using (true)
with check (true);

drop policy if exists bingo_cells_public_delete on public.bingo_cells;
create policy bingo_cells_public_delete on public.bingo_cells
for delete
using (true);

drop policy if exists bingo_participants_public_select on public.bingo_participants;
create policy bingo_participants_public_select on public.bingo_participants
for select
using (true);

drop policy if exists bingo_participants_public_insert on public.bingo_participants;
create policy bingo_participants_public_insert on public.bingo_participants
for insert
with check (true);

drop policy if exists bingo_participants_public_update on public.bingo_participants;
create policy bingo_participants_public_update on public.bingo_participants
for update
using (true)
with check (true);

drop policy if exists bingo_participants_public_delete on public.bingo_participants;
create policy bingo_participants_public_delete on public.bingo_participants
for delete
using (true);

drop policy if exists bingo_progress_public_select on public.bingo_progress;
create policy bingo_progress_public_select on public.bingo_progress
for select
using (true);

drop policy if exists bingo_progress_public_insert on public.bingo_progress;
create policy bingo_progress_public_insert on public.bingo_progress
for insert
with check (true);

drop policy if exists bingo_progress_public_update on public.bingo_progress;
create policy bingo_progress_public_update on public.bingo_progress
for update
using (true)
with check (true);

drop policy if exists bingo_progress_public_delete on public.bingo_progress;
create policy bingo_progress_public_delete on public.bingo_progress
for delete
using (true);
