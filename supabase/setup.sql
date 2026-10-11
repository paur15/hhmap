-- =====================================================================
--  Hechtkarte Irland – Datenbank einrichten
--
--  So geht's: Supabase-Dashboard → SQL Editor → "New query" →
--  dieses komplette Skript einfügen → "Run".
--  Das Skript darf auch mehrfach ausgeführt werden; es überschreibt
--  keine vorhandenen Fänge oder Mitglieder.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Tabellen
-- ---------------------------------------------------------------------

-- Gästeliste: nur wer hier steht, sieht die Karte und darf eintragen.
create table if not exists public.members (
  email      text primary key check (email = lower(email) and position('@' in email) > 1),
  is_admin   boolean not null default false,
  added_at   timestamptz not null default now()
);

-- Fänge
create table if not exists public.catches (
  id          uuid primary key default gen_random_uuid(),
  owner_email text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  angler      text not null check (char_length(angler) between 1 and 40),
  caught_on   date not null,
  water       text check (char_length(water) <= 60),
  lat         double precision not null check (lat between -90 and 90),
  lng         double precision not null check (lng between -180 and 180),
  length_cm   integer not null check (length_cm between 20 and 160),
  weight_kg   numeric(4,1) check (weight_kg > 0 and weight_kg <= 30),
  lure        text check (char_length(lure) <= 40),
  released    boolean not null default true,
  note        text check (char_length(note) <= 280),
  photo_path  text check (char_length(photo_path) <= 200),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists catches_caught_on_idx on public.catches (caught_on desc);


-- ---------------------------------------------------------------------
-- 2. Hilfsfunktionen
-- ---------------------------------------------------------------------

-- E-Mail-Adresse des angemeldeten Nutzers (klein geschrieben)
create or replace function public.current_email()
returns text
language sql stable
set search_path = ''
as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

-- Steht der angemeldete Nutzer auf der Gästeliste?
create or replace function public.is_member()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.members m where m.email = public.current_email())
$$;

-- Ist der angemeldete Nutzer Verwalter?
create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.members m where m.email = public.current_email() and m.is_admin)
$$;

-- Zustand für die App: gibt es schon einen Verwalter, bin ich Mitglied/Verwalter?
create or replace function public.setup_state()
returns json
language sql stable security definer
set search_path = ''
as $$
  select json_build_object(
    'has_admin', exists (select 1 from public.members where is_admin),
    'is_member', public.is_member(),
    'is_admin',  public.is_admin()
  )
$$;

-- Erster Start: Wer das als Erster aufruft, wird Verwalter.
-- Funktioniert nur, solange es noch keinen Verwalter gibt.
create or replace function public.claim_admin()
returns boolean
language plpgsql security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or public.current_email() = '' then
    return false;
  end if;
  if exists (select 1 from public.members where is_admin) then
    return false;
  end if;
  insert into public.members (email, is_admin)
  values (public.current_email(), true)
  on conflict (email) do update set is_admin = true;
  return true;
end;
$$;

-- Für die Wach-halten-Automatik (GitHub Action). Gibt nur die Uhrzeit zurück.
create or replace function public.keepalive()
returns timestamptz
language sql stable
set search_path = ''
as $$
  select now()
$$;

revoke all on function public.setup_state() from public, anon;
revoke all on function public.claim_admin() from public, anon;
grant execute on function public.setup_state() to authenticated;
grant execute on function public.claim_admin() to authenticated;
grant execute on function public.is_member() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.current_email() to authenticated;
grant execute on function public.keepalive() to anon, authenticated;

-- Besitzer und Anlagedatum eines Fangs bleiben beim Bearbeiten unverändert.
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

drop trigger if exists catches_touch on public.catches;
create trigger catches_touch
  before insert or update on public.catches
  for each row execute function public.catches_touch();


-- ---------------------------------------------------------------------
-- 3. Zugriffsregeln (Row Level Security)
-- ---------------------------------------------------------------------

alter table public.members enable row level security;
alter table public.catches enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.members to authenticated;
grant select, insert, update, delete on public.catches to authenticated;

-- Gästeliste
drop policy if exists "members_select" on public.members;
create policy "members_select" on public.members
  for select to authenticated
  using (public.is_member());

drop policy if exists "members_insert" on public.members;
create policy "members_insert" on public.members
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists "members_update" on public.members;
create policy "members_update" on public.members
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "members_delete" on public.members;
create policy "members_delete" on public.members
  for delete to authenticated
  using (public.is_admin() and email <> public.current_email());

-- Fänge: alle Mitglieder lesen; eintragen nur als man selbst;
-- ändern/löschen nur eigene Fänge (Verwalter: alle).
drop policy if exists "catches_select" on public.catches;
create policy "catches_select" on public.catches
  for select to authenticated
  using (public.is_member());

drop policy if exists "catches_insert" on public.catches;
create policy "catches_insert" on public.catches
  for insert to authenticated
  with check (public.is_member() and owner_email = public.current_email());

drop policy if exists "catches_update" on public.catches;
create policy "catches_update" on public.catches
  for update to authenticated
  using (public.is_member() and (owner_email = public.current_email() or public.is_admin()))
  with check (public.is_member());

drop policy if exists "catches_delete" on public.catches;
create policy "catches_delete" on public.catches
  for delete to authenticated
  using (public.is_member() and (owner_email = public.current_email() or public.is_admin()));


-- ---------------------------------------------------------------------
-- 4. Live-Aktualisierung: neue Fänge erscheinen sofort bei allen
-- ---------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'catches'
  ) then
    alter publication supabase_realtime add table public.catches;
  end if;
end;
$$;


-- ---------------------------------------------------------------------
-- 5. Fotospeicher (privat, nur für Mitglieder, max. 5 MB pro Bild)
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "photos_select" on storage.objects;
create policy "photos_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'photos' and public.is_member());

drop policy if exists "photos_insert" on storage.objects;
create policy "photos_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'photos' and public.is_member());

drop policy if exists "photos_delete" on storage.objects;
create policy "photos_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'photos' and public.is_member()
         and (owner_id = (select auth.uid())::text or public.is_admin()));


-- Fertig. Ergebnis "Success. No rows returned" ist richtig.
