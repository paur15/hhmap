# hhmap
double H Fangkarte – das gemeinsame Hecht-Fangbuch für unsere Irland-Touren.

**Adresse:** https://paur15.github.io/hhmap/

Auf einer Luftbildkarte trägt jeder seine Fänge ein: Fischart (Hecht, Barsch, Aal oder andere), Fangstelle (Tippen auf die Karte, GPS oder Koordinaten aus Google Maps), Länge, Gewicht, Köder, zurückgesetzt ja/nein, Foto und Notiz. Dazu kommen beschriftete Fähnchen (Hotspot, Slipanlage, Untiefe/Felsen, Unterkunft, Parkplatz), Ortssuche, Rangliste, Meterhechte und Filter nach Jahr und Angler. Neue Fänge erscheinen sofort bei allen.

## Einrichtung (einmalig)

1. **Datenbank anlegen:** Im Supabase-Dashboard unter *SQL Editor → New query* den Inhalt von [`supabase/setup.sql`](supabase/setup.sql) einfügen und mit *Run* ausführen.
2. **E-Mail-Bestätigung ausschalten:** *Authentication → Sign In / Providers → Email* → „Confirm email“ aus, speichern. („Allow new users to sign up“ bleibt an.)
3. **Webseite veröffentlichen:** In GitHub unter *Settings → Pages* bei „Source“ *Deploy from a branch* wählen, Branch `main`, Ordner `/ (root)`, *Save*.
4. **Verwaltung übernehmen:** Die Adresse oben öffnen, mit deiner E-Mail registrieren und „Ich bin der Verwalter“ wählen. Das geht nur, solange es noch keinen Verwalter gibt.

## Kollegen einladen

1. Im Menü (Personen-Symbol oben rechts) → **Gästeliste verwalten** → E-Mail-Adresse hinzufügen.
2. Den Link aus demselben Fenster in die Gruppe schicken.
3. Jeder registriert sich mit genau der eingetragenen Adresse und einem eigenen Passwort.

Auf dem Handy: Seite öffnen → *Teilen → Zum Home-Bildschirm* (iPhone) bzw. *Menü → App installieren / Zum Startbildschirm* (Android).

## Wer darf was?

| | Mitglied | Verwalter |
|---|---|---|
| Fänge sehen | ja | ja |
| Fang eintragen | ja | ja |
| eigene Fänge ändern/löschen | ja | ja |
| Fänge anderer ändern/löschen | nein | ja |
| Gästeliste pflegen | nein | ja |

Wer nicht auf der Gästeliste steht, kann sich zwar registrieren, sieht aber keine Daten. Diese Regeln setzt die Datenbank selbst durch (Row Level Security), nicht nur die Webseite.

## Wartung

- **Passwort vergessen:** Supabase → *Authentication → Users* → Nutzer löschen. Danach registriert er sich mit derselben Adresse neu; seine Fänge bleiben ihm zugeordnet.
- **Esri-Schlüssel erneuern (jährlich):** Der Luftbild-Schlüssel läuft nach höchstens einem Jahr ab. Dann zeigt die Karte automatisch OpenStreetMap und einen Hinweis. Neuen Schlüssel bei location.arcgis.com erzeugen (Rechte: *Basemap styles service*, *Static basemap tiles*; Referrer: `https://paur15.github.io`) und in [`js/config.js`](js/config.js) bei `esriKey` eintragen.
- **Supabase wach halten:** Kostenlose Supabase-Projekte werden nach einer Woche ohne Nutzung pausiert. Die GitHub Action [`keepalive.yml`](.github/workflows/keepalive.yml) ruft die Datenbank deshalb zweimal pro Woche an. Kontrolle: Reiter *Actions* in GitHub.

## Datenschutz

- Fänge, Fotos und die Gästeliste liegen bei Supabase im Rechenzentrum Frankfurt; Zugriff nur für Mitglieder.
- Fotos werden vor dem Hochladen verkleinert; dabei gehen die eingebetteten Metadaten (z. B. GPS) verloren.
- Schriften und Bibliotheken liegen in diesem Repository; es werden keine Google Fonts oder CDNs geladen.
- Kartenkacheln kommen von Esri (Luftbild) bzw. OpenStreetMap; dabei sehen diese Dienste die IP-Adresse des Betrachters.
- Die Ortssuche fragt OpenStreetMap Nominatim; dabei werden Suchbegriff und IP-Adresse übertragen.

## Technik

Statische Webseite (HTML/CSS/JavaScript, kein Build-Schritt), gehostet auf GitHub Pages.

- Karte: [Leaflet](https://leafletjs.com) 1.9.4 – `vendor/leaflet/` (BSD-2-Clause)
- Daten und Anmeldung: [supabase-js](https://github.com/supabase/supabase-js) 2.117.2 – `vendor/supabase.js` (MIT)
- Luftbilder: Esri World Imagery, Beschriftung: Esri Imagery Labels
- Ortssuche: [OpenStreetMap Nominatim](https://nominatim.org) (nur auf Knopfdruck, max. 1 Anfrage/Sekunde)
- Schriften: Barlow, Barlow Condensed, IBM Plex Mono – `fonts/` (SIL Open Font License)
- Seen-Umrisse für den Gewässer-Vorschlag: Natural Earth (gemeinfrei)

| Datei | Inhalt |
|---|---|
| `index.html` | Seitenaufbau |
| `css/app.css` | Gestaltung |
| `js/app.js` | Anmeldung, Karte, Fangbuch, Fotos, Gästeliste |
| `js/config.js` | Supabase-Adresse, öffentliche Schlüssel |
| `js/loughs.js` | Seen-Daten für den Gewässer-Vorschlag |
| `supabase/setup.sql` | Tabellen, Zugriffsregeln, Fotospeicher (vollständig) |
| `supabase/002_faehnchen.sql` | Nachrüstung der Fähnchen-Tabelle für bestehende Installationen |
| `supabase/003_fischarten.sql` | Nachrüstung der Fischarten-Spalte für bestehende Installationen |
