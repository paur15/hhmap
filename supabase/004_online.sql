-- =====================================================================
--  Hechtkarte Irland – Erweiterung "Wer ist online?"
--
--  So geht's: Supabase-Dashboard → SQL Editor → "New query" →
--  dieses Skript einfügen → "Run". Darf mehrfach ausgeführt werden.
--
--  Jede geöffnete Karte meldet sich etwa alle 45 Sekunden.
--  Als "online" gilt, wer sich in den letzten 2 Minuten gemeldet hat.
--  Sichtbar nur für Mitglieder der Gästeliste.
-- =====================================================================

create table if not exists public.presence (
  email      text primary key default lower(coalesce(auth.jwt() ->> 'email', '')),
  name       text not null check (char_length(name) between 1 and 40),
  last_seen  timestamptz not null default now()
);

-- E-Mail und Zeitstempel setzt immer die Datenbank, nicht der Browser.
create or replace function public.presence_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.email := public.current_email();
  new.last_seen := now();
  return new;
end;
$$;

drop trigger if exists presence_touch on public.presence;
create trigger presence_touch
  before insert or update on public.presence
  for each row execute function public.presence_touch();

alter table public.presence enable row level security;
grant select, insert, update, delete on public.presence to authenticated;

drop policy if exists "presence_select" on public.presence;
create policy "presence_select" on public.presence
  for select to authenticated
  using (public.is_member());

drop policy if exists "presence_insert" on public.presence;
create policy "presence_insert" on public.presence
  for insert to authenticated
  with check (public.is_member() and email = public.current_email());

drop policy if exists "presence_update" on public.presence;
create policy "presence_update" on public.presence
  for update to authenticated
  using (email = public.current_email())
  with check (public.is_member() and email = public.current_email());

drop policy if exists "presence_delete" on public.presence;
create policy "presence_delete" on public.presence
  for delete to authenticated
  using (email = public.current_email() or public.is_admin());

-- Wer ist gerade online? (Zeitfenster wird in der Datenbank berechnet;
-- security_invoker sorgt dafür, dass die Zugriffsregeln oben gelten.)
create or replace view public.online_now
with (security_invoker = true) as
  select name, email, last_seen
  from public.presence
  where last_seen > now() - interval '2 minutes';

grant select on public.online_now to authenticated;

-- Datenschnittstelle sofort informieren
notify pgrst, 'reload schema';

-- Fertig. Ergebnis "Success. No rows returned" ist richtig.
