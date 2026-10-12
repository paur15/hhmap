-- =====================================================================
--  Hechtkarte Irland – Erweiterung "Einladungscode"
--
--  So geht's: Supabase-Dashboard → SQL Editor → "New query" →
--  dieses Skript einfügen → "Run". Darf mehrfach ausgeführt werden.
--
--  Wer bei der Registrierung den richtigen Einladungscode angibt, wird
--  automatisch auf die Gästeliste gesetzt. Den Code legt der Verwalter
--  in der App fest (Gästeliste → Einladung). Höchstens 10 Fehlversuche
--  pro Stunde und Konto.
-- =====================================================================

-- Einstellungen (genau eine Zeile); nur Verwalter dürfen sie lesen und ändern
create table if not exists public.app_settings (
  id          boolean primary key default true check (id),
  invite_code text check (invite_code is null or char_length(invite_code) between 6 and 40),
  updated_at  timestamptz not null default now()
);
insert into public.app_settings (id) values (true) on conflict (id) do nothing;

alter table public.app_settings enable row level security;
grant select, update on public.app_settings to authenticated;

drop policy if exists "settings_select" on public.app_settings;
create policy "settings_select" on public.app_settings
  for select to authenticated
  using (public.is_admin());

drop policy if exists "settings_update" on public.app_settings;
create policy "settings_update" on public.app_settings
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Fehlversuche (nur über die Funktion unten erreichbar)
create table if not exists public.join_attempts (
  email text not null,
  at    timestamptz not null default now()
);
create index if not exists join_attempts_email_at_idx on public.join_attempts (email, at);
alter table public.join_attempts enable row level security;
revoke all on public.join_attempts from anon, authenticated;

-- Mit Einladungscode freischalten.
-- Ergebnis: 'ok', 'wrong', 'too_many', 'no_code' oder 'not_signed_in'
create or replace function public.join_with_code(code text)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  me    text := public.current_email();
  want  text;
  tries integer;
begin
  if auth.uid() is null or me = '' then
    return 'not_signed_in';
  end if;
  if exists (select 1 from public.members where email = me) then
    return 'ok';
  end if;

  select count(*) into tries
  from public.join_attempts
  where email = me and at > now() - interval '1 hour';
  if tries >= 10 then
    return 'too_many';
  end if;

  select invite_code into want from public.app_settings where id;
  if want is null or want = '' then
    return 'no_code';
  end if;

  -- Groß-/Kleinschreibung, Leerzeichen und Bindestriche spielen keine Rolle
  if upper(regexp_replace(coalesce(code, ''), '[^A-Za-z0-9]', '', 'g'))
     <> upper(regexp_replace(want, '[^A-Za-z0-9]', '', 'g')) then
    insert into public.join_attempts (email) values (me);
    return 'wrong';
  end if;

  insert into public.members (email, is_admin) values (me, false)
  on conflict (email) do nothing;
  delete from public.join_attempts where email = me;
  return 'ok';
end;
$$;

revoke all on function public.join_with_code(text) from public, anon;
grant execute on function public.join_with_code(text) to authenticated;

-- Datenschnittstelle sofort informieren
notify pgrst, 'reload schema';

-- Fertig. Ergebnis "Success. No rows returned" ist richtig.
