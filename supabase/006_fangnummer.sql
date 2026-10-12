-- =====================================================================
--  Hechtkarte Irland – Erweiterung "Fang-Nummer"
--
--  So geht's: Supabase-Dashboard → SQL Editor → "New query" →
--  dieses Skript einfügen → "Run". Darf mehrfach ausgeführt werden.
--
--  Jeder Fang bekommt eine eindeutige Nummer. Neue Fänge ohne Nummer
--  erhalten automatisch die nächste freie (höchste + 1). Die Nummer
--  lässt sich in der App ändern, z. B. beim Übertragen der Papierkarte.
--  Vorhandene Fänge ohne Nummer werden nach Fangdatum durchnummeriert.
-- =====================================================================

alter table public.catches add column if not exists nr integer;

-- Vorhandene Fänge ohne Nummer nach Datum durchnummerieren
with base as (
  select coalesce(max(nr), 0) as start from public.catches
), ordered as (
  select id, row_number() over (order by caught_on, created_at, id) as rn
  from public.catches
  where nr is null
)
update public.catches c
set nr = base.start + ordered.rn
from ordered, base
where c.id = ordered.id;

alter table public.catches drop constraint if exists catches_nr_check;
alter table public.catches add constraint catches_nr_check check (nr between 1 and 999999);

create unique index if not exists catches_nr_key on public.catches (nr);

-- Automatische Nummer, wenn keine angegeben ist
create or replace function public.catches_autonr()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.nr is null then
    perform pg_advisory_xact_lock(4711);   -- gleichzeitige Einträge nacheinander nummerieren
    select coalesce(max(nr), 0) + 1 into new.nr from public.catches;
  end if;
  return new;
end;
$$;

drop trigger if exists catches_autonr on public.catches;
create trigger catches_autonr
  before insert or update on public.catches
  for each row execute function public.catches_autonr();

-- Datenschnittstelle sofort informieren
notify pgrst, 'reload schema';

-- Fertig. Ergebnis "Success. No rows returned" ist richtig.
