-- =====================================================================
--  Hechtkarte Irland – Erweiterung "Fischarten"
--
--  So geht's: Supabase-Dashboard → SQL Editor → "New query" →
--  dieses Skript einfügen → "Run". Darf mehrfach ausgeführt werden.
--  Bestehende Fänge werden automatisch als Hecht eingetragen.
-- =====================================================================

-- Neue Spalte: Fischart ("hecht", "barsch", "aal" oder freier Name, z. B. "Brasse")
alter table public.catches add column if not exists species text not null default 'hecht';

alter table public.catches drop constraint if exists catches_species_check;
alter table public.catches add constraint catches_species_check
  check (char_length(species) between 1 and 40);

-- Länge jetzt 5–200 cm (vorher 20–160), damit auch kleine Barsche passen
alter table public.catches drop constraint if exists catches_length_cm_check;
alter table public.catches add constraint catches_length_cm_check
  check (length_cm between 5 and 200);

-- Datenschnittstelle sofort über die neue Spalte informieren
notify pgrst, 'reload schema';

-- Fertig. Ergebnis "Success. No rows returned" ist richtig.
