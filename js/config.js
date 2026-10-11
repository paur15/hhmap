/* Zugangsdaten der Hechtkarte.
   Alle drei Werte sind für den Einsatz in einer öffentlichen Webseite gedacht:
   - Supabase "publishable key": geschützt durch die Zugriffsregeln in supabase/setup.sql
   - Esri-Schlüssel: nur für die Adresse https://paur15.github.io freigegeben,
     nur mit Basemap-Rechten; läuft nach spätestens einem Jahr ab.
   Niemals hier eintragen: Supabase "secret key" oder das Datenbank-Passwort. */
window.HK_CONFIG = {
  supabaseUrl: "https://pdbmazwkujjwuscdjxsw.supabase.co",
  supabaseKey: "sb_publishable_DDWbN-dfiwH5JQEsNBuwZA_d33Oxs-0",
  esriKey: "AAPTaFSrHcPhAiTmtob_i-H_bcQ..H8NI3KyDHJqy_JqpETgGt3NTVYnZKhAumblwmCCDvw45AWNe6CaT5hWCXLEPAPDgY7kPR09PW5YJq3tJY7zbl2GrHVgQog4ZULW6VFD8ClMMMQsKLcJyV62EoQx4mB-Xi1AdJ1lDVbvXGgzshj-mYLgvU9ic8_Pl1rbUNakRFKvNpf24KPJt1y4kami_N0_NDKWmpsZspnu6NEVeA9jIEStW77CVTh8qN9p4nl3wIEbJw3XAANElAT1_8LQK8DGy"
};
