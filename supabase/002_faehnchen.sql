-- =====================================================================
--  Hechtkarte Irland – Erweiterung "Fähnchen"
--
--  So geht's: Supabase-Dashboard → SQL Editor → "New query" →
--  dieses Skript einfügen → "Run". Darf mehrfach ausgeführt werden.
--  (Ist bereits in setup.sql enthalten; nur nötig, wenn setup.sql
--   vor dem 11.10.2026 ausgeführt wurde.)
-- =====================================================================

create table if not exists public.spots (
  id          uuid primary key default gen_random_uuid(),
  owner_email text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  label       text not null check (char_length(label) between 1 and 60),
  kind        text not null default 'sonstiges'
              check (kind in ('hotspot', 'slip', 'achtung', 'unterkunft', 'parken', 'sonstiges')),
  note        text check (char_length(note) <= 280),
  lat         double precision not null check (lat between -90 and 90),
  lng         double precision not null check (lng between -180 and 180),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Besitzer und Anlagedatum bleiben beim Bearbeiten unverändert.
create or replace function public.catches_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.owner_email := old.owner_email;
    new.created_at  := old.created_at;
  end if;
  return new;
end;
$$;

drop trigger if exists spots_touch on public.spots;
create trigger spots_touch
  before insert or update on public.spots
  for each row execute function public.catches_touch();

alter table public.spots enable row level security;
grant select, insert, update, delete on public.spots to authenticated;

drop policy if exists "spots_select" on public.spots;
create policy "spots_select" on public.spots
  for select to authenticated
  using (public.is_member());

drop policy if exists "spots_insert" on public.spots;
create policy "spots_insert" on public.spots
  for insert to authenticated
  with check (public.is_member() and owner_email = public.current_email());

drop policy if exists "spots_update" on public.spots;
create policy "spots_update" on public.spots
  for update to authenticated
  using (public.is_member() and (owner_email = public.current_email() or public.is_admin()))
  with check (public.is_member());

drop policy if exists "spots_delete" on public.spots;
create policy "spots_delete" on public.spots
  for delete to authenticated
  using (public.is_member() and (owner_email = public.current_email() or public.is_admin()));

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'spots'
  ) then
    alter publication supabase_realtime add table public.spots;
  end if;
end;
$$;

-- Fertig. Ergebnis "Success. No rows returned" ist richtig.
