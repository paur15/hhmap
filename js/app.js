/* Hechtkarte Irland – App-Logik
   Daten: Supabase (Tabelle catches, Gästeliste members, Fotos im Bucket "photos")
   Karte: Leaflet mit Esri-Luftbildern (Fallback: OpenStreetMap) */
(function () {
"use strict";

const CFG = window.HK_CONFIG;
const LOUGHS = window.HK_LOUGHS || { lakes: [], small: [] };
const $ = id => document.getElementById(id);
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});

const state = {
  session: null, email: "", isAdmin: false,
  catches: [], loaded: false, year: "all", angler: "all", sel: null,
  editing: null, formOpen: false, draft: null, waterAuto: true, saving: false,
  photoFile: null, photoRemoved: false, photoUrls: new Map(), photoUrlsAt: 0,
  firstFit: false, signup: false,
  spots: [], spotsMissing: false, flagOpen: false, flagEditing: null, flagDraft: null, flagKind: "hotspot"
};

const LURES = ["Gummifisch", "Jerkbait", "Wobbler", "Spinner", "Blinker", "Spinnerbait", "Swimbait", "Köderfisch", "Hechtfliege", "Twitchbait"];
const IRELAND = [[51.40, -10.62], [55.40, -5.45]];

/* ---------------------------------------------------------------- helpers */
const nf1 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const df = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short", year: "numeric" });
function fmtDate(s) { if (!s) return "ohne Datum"; const [y, m, d] = s.split("-").map(Number); return df.format(new Date(y, m - 1, d)); }
function lbOz(kg) { let oz = Math.round(kg * 35.27396); const lb = Math.floor(oz / 16); oz -= lb * 16; return lb + " lb" + (oz ? " " + oz + " oz" : ""); }
function fmtKg(kg) { return nf1.format(kg) + " kg"; }
function today() { const d = new Date(), p = n => String(n).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); }
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
function distKm(a, b) { const R = 6371, r = Math.PI / 180; const x = (b[1] - a[1]) * r * Math.cos((a[0] + b[0]) / 2 * r), y = (b[0] - a[0]) * r; return Math.sqrt(x * x + y * y) * R; }
function radius(len) { return len ? Math.max(6, Math.min(15, 6 + (len - 50) * 0.16)) : 7; }
function canModify(c) { return c.owner === state.email || state.isAdmin; }
function validEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }
function newId() { return (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)); }
function setMsg(id, text, ok) { const m = $(id); m.textContent = text || ""; m.hidden = !text; m.classList.toggle("ok", !!ok); }

function fromRow(r) {
  const lat = Number(r.lat), lng = Number(r.lng);
  if (!isFinite(lat) || !isFinite(lng)) return null;
  const kg = r.weight_kg == null ? null : Number(r.weight_kg);
  return {
    id: r.id, owner: (r.owner_email || "").toLowerCase(), angler: r.angler || "Unbekannt",
    date: r.caught_on || "", water: r.water || "", lat, lng,
    len: r.length_cm ? Number(r.length_cm) : null, kg: kg && kg > 0 ? kg : null,
    lure: r.lure || "", released: r.released !== false, note: r.note || "",
    photo: r.photo_path || null, created: r.created_at || ""
  };
}

function isNetwork(e) { const m = String((e && e.message) || e || "").toLowerCase(); return m.includes("failed to fetch") || m.includes("networkerror") || m.includes("load failed") || m.includes("network"); }
function explainDb(e) {
  if (!e) return "Unbekannter Fehler.";
  if (isNetwork(e)) return "Keine Verbindung. Prüf dein Netz und versuch es noch einmal. Deine Eingaben bleiben im Formular.";
  if (e.code === "42501" || /row-level security/i.test(e.message || "")) return "Dafür fehlt dir die Berechtigung.";
  if (e.code === "PGRST116") return "Der Eintrag wurde nicht gefunden, oder du darfst ihn nicht ändern.";
  if (e.code === "23514") return "Ein Wert liegt außerhalb des erlaubten Bereichs.";
  return "Das hat nicht geklappt: " + (e.message || "unbekannter Fehler");
}
function authError(e) {
  const m = String((e && e.message) || "").toLowerCase(), code = e && e.code;
  if (code === "invalid_credentials" || m.includes("invalid login")) return "E-Mail oder Passwort stimmt nicht.";
  if (code === "user_already_exists" || m.includes("already registered")) return "Für diese Adresse gibt es schon ein Konto. Melde dich an.";
  if (code === "weak_password" || m.includes("password should")) return "Das Passwort ist zu schwach. Nimm mindestens 8 Zeichen.";
  if (code === "email_not_confirmed") return "Diese Adresse ist noch nicht bestätigt. Der Verwalter muss in Supabase „Confirm email“ ausschalten.";
  if (code === "signup_disabled") return "Neue Registrierungen sind in Supabase abgeschaltet.";
  if (code === "email_address_invalid") return "Diese E-Mail-Adresse wird nicht akzeptiert.";
  if (code === "over_request_rate_limit" || code === "over_email_send_rate_limit" || (e && e.status === 429)) return "Zu viele Versuche. Warte ein paar Minuten.";
  if (isNetwork(e)) return "Keine Verbindung. Prüf deine Internetverbindung.";
  return "Das hat nicht geklappt: " + ((e && e.message) || "unbekannter Fehler");
}

let noticeKind = "", noticeTimer = null;
function showNotice(msg, isErr, kind, ms) {
  const n = $("notice"); n.textContent = msg; n.classList.toggle("err", !!isErr); n.hidden = false;
  noticeKind = kind || ""; clearTimeout(noticeTimer);
  if (ms) noticeTimer = setTimeout(hideNotice, ms);
}
function hideNotice() { $("notice").hidden = true; noticeKind = ""; }

/* ---------------------------------------------------------------- screens */
function show(id) {
  ["splash", "authScreen", "gateScreen", "appScreen"].forEach(s => { $(s).hidden = s !== id; });
}

/* ---------------------------------------------------------------- auth */
function setMode(signup) {
  state.signup = signup;
  $("tabLogin").setAttribute("aria-selected", String(!signup));
  $("tabSignup").setAttribute("aria-selected", String(signup));
  $("authPw2Wrap").hidden = !signup;
  $("authHint").hidden = !signup;
  $("authPw").setAttribute("autocomplete", signup ? "new-password" : "current-password");
  $("authSubmit").textContent = signup ? "Konto anlegen" : "Anmelden";
  setMsg("authMsg", "");
}
$("tabLogin").addEventListener("click", () => setMode(false));
$("tabSignup").addEventListener("click", () => setMode(true));

$("authForm").addEventListener("submit", async ev => {
  ev.preventDefault();
  const email = $("authEmail").value.trim().toLowerCase();
  const pw = $("authPw").value;
  if (!validEmail(email)) { setMsg("authMsg", "Bitte eine gültige E-Mail-Adresse eingeben."); $("authEmail").focus(); return; }
  if (state.signup) {
    if (pw.length < 8) { setMsg("authMsg", "Das Passwort braucht mindestens 8 Zeichen."); $("authPw").focus(); return; }
    if (pw !== $("authPw2").value) { setMsg("authMsg", "Die beiden Passwörter stimmen nicht überein."); $("authPw2").focus(); return; }
  } else if (!pw) { setMsg("authMsg", "Bitte dein Passwort eingeben."); $("authPw").focus(); return; }

  const btn = $("authSubmit"); btn.disabled = true; setMsg("authMsg", "");
  try {
    const res = state.signup
      ? await sb.auth.signUp({ email, password: pw })
      : await sb.auth.signInWithPassword({ email, password: pw });
    if (res.error) { setMsg("authMsg", authError(res.error)); return; }
    if (!res.data.session) {
      setMsg("authMsg", "Das Konto wurde angelegt, aber Supabase verlangt noch eine E-Mail-Bestätigung. Der Verwalter muss unter Authentication → Sign In / Providers → Email „Confirm email“ ausschalten.");
      return;
    }
    state.session = res.data.session;
    $("authPw").value = ""; $("authPw2").value = "";
    await enter();
  } catch (e) {
    setMsg("authMsg", authError(e));
  } finally { btn.disabled = false; }
});

async function logout() {
  closeMenu();
  try { await sb.auth.signOut(); } catch (e) { /* ignore */ }
  teardown(); setMode(false); show("authScreen");
}
$("menuLogout").addEventListener("click", logout);
$("gateLogout").addEventListener("click", logout);

let gateAction = null;
function gate(kind, err) {
  setMsg("gateMsg", "");
  const t = $("gateTitle"), p = $("gateText"), b = $("gatePrimary");
  if (kind === "setup") {
    t.textContent = "Verwaltung übernehmen";
    p.textContent = "Für diese Karte gibt es noch keinen Verwalter. Wenn du die Karte eingerichtet hast, übernimm jetzt die Verwaltung. Danach setzt du deine Kollegen auf die Gästeliste.";
    b.textContent = "Ich bin der Verwalter";
    gateAction = async () => {
      const { data, error } = await sb.rpc("claim_admin");
      if (error) { setMsg("gateMsg", explainDb(error)); return; }
      if (!data) { setMsg("gateMsg", "Jemand anderes hat die Verwaltung schon übernommen."); }
      await enter();
    };
  } else if (kind === "pending") {
    t.textContent = "Noch nicht freigeschaltet";
    p.textContent = "Du bist als " + state.email + " angemeldet. Bitte den Verwalter der Karte, genau diese Adresse auf die Gästeliste zu setzen. Danach tippst du auf „Erneut prüfen“.";
    b.textContent = "Erneut prüfen";
    gateAction = enter;
  } else if (kind === "dbmissing") {
    t.textContent = "Datenbank noch nicht eingerichtet";
    p.textContent = "Die Karte findet ihre Datenbank-Funktionen nicht. Der Verwalter muss einmal das Skript supabase/setup.sql im SQL-Editor von Supabase ausführen.";
    b.textContent = "Erneut prüfen";
    gateAction = enter;
  } else {
    t.textContent = "Keine Verbindung";
    p.textContent = isNetwork(err) ? "Die Datenbank ist gerade nicht erreichbar. Prüf deine Internetverbindung." : explainDb(err);
    b.textContent = "Erneut versuchen";
    gateAction = enter;
  }
  show("gateScreen");
}
$("gatePrimary").addEventListener("click", async () => {
  const b = $("gatePrimary"); b.disabled = true;
  try { if (gateAction) await gateAction(); } finally { b.disabled = false; }
});

async function enter() {
  state.email = ((state.session && state.session.user && state.session.user.email) || "").toLowerCase();
  $("meEmail").textContent = state.email;
  let res;
  try { res = await sb.rpc("setup_state"); } catch (e) { return gate("error", e); }
  if (res.error) {
    if (res.error.code === "PGRST202" || res.error.code === "42883") return gate("dbmissing");
    return gate("error", res.error);
  }
  const st = res.data || {};
  if (!st.has_admin) return gate("setup");
  if (!st.is_member) return gate("pending");
  state.isAdmin = !!st.is_admin;
  $("menuMembers").hidden = !state.isAdmin;
  show("appScreen");
  initMap();
  map.invalidateSize();
  await reload();
  subscribe();
}

function teardown() {
  if (channel) { sb.removeChannel(channel); channel = null; }
  if (spotChannel) { sb.removeChannel(spotChannel); spotChannel = null; }
  if (state.formOpen) closeForm();
  if (state.flagOpen) closeFlagForm();
  state.spots = [];
  if (spotLayer) spotLayer.clearLayers();
  state.session = null; state.email = ""; state.isAdmin = false;
  state.catches = []; state.loaded = false; state.sel = null; state.firstFit = false;
  state.photoUrls.clear();
  if (catchLayer) catchLayer.clearLayers();
  markers.clear();
  hideNotice();
}

/* ---------------------------------------------------------------- data */
let channel = null, spotChannel = null, reloadTimer = null;
function subscribeSpots() {
  if (spotChannel) return;
  spotChannel = sb.channel("spots-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "spots" }, scheduleReload)
    .subscribe();
}
function spotFromRow(r) {
  const lat = Number(r.lat), lng = Number(r.lng);
  if (!isFinite(lat) || !isFinite(lng)) return null;
  return { id: r.id, owner: (r.owner_email || "").toLowerCase(), label: r.label || "Fähnchen",
    kind: KIND_BY[r.kind] ? r.kind : "sonstiges", note: r.note || "", lat, lng };
}
async function reload() {
  const [cres, sres] = await Promise.all([
    sb.from("catches")
      .select("id,owner_email,angler,caught_on,water,lat,lng,length_cm,weight_kg,lure,released,note,photo_path,created_at")
      .order("caught_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(5000),
    sb.from("spots").select("id,owner_email,label,kind,note,lat,lng,created_at").order("label").limit(2000)
  ]);
  if (sres.error) {
    state.spots = [];
    state.spotsMissing = sres.error.code === "42P01" || sres.error.code === "PGRST205" || /spots/i.test(sres.error.message || "");
    if (state.spotsMissing && state.isAdmin && noticeKind !== "tiles")
      showNotice("Für die Fähnchen fehlt noch die Datenbank-Tabelle. Führe einmal supabase/002_faehnchen.sql im SQL-Editor von Supabase aus.", false, "spots");
  } else {
    state.spotsMissing = false;
    if (noticeKind === "spots") hideNotice();
    state.spots = (sres.data || []).map(spotFromRow).filter(Boolean);
    if (!spotChannel) subscribeSpots();
  }
  const { data, error } = cres;
  if (error) {
    state.loaded = true; render();
    showNotice("Die Fänge konnten nicht geladen werden. " + explainDb(error), true, "load");
    return;
  }
  if (noticeKind === "load") hideNotice();
  state.catches = (data || []).map(fromRow).filter(Boolean);
  state.loaded = true;
  if (state.sel && !state.catches.some(c => c.id === state.sel)) state.sel = null;
  await refreshPhotoUrls();
  render();
  if (!state.firstFit) { state.firstFit = true; fitToCatches(); }
}
function scheduleReload() { clearTimeout(reloadTimer); reloadTimer = setTimeout(() => { if (state.session) reload(); }, 400); }
function subscribe() {
  if (channel) return;
  channel = sb.channel("catches-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "catches" }, scheduleReload)
    .subscribe();
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && state.session && !$("appScreen").hidden) scheduleReload();
});

async function refreshPhotoUrls() {
  const now = Date.now();
  if (now - state.photoUrlsAt > 50 * 60 * 1000) { state.photoUrls.clear(); state.photoUrlsAt = now; }
  const need = [...new Set(state.catches.map(c => c.photo).filter(p => p && !state.photoUrls.has(p)))];
  if (!need.length) return;
  try {
    const { data, error } = await sb.storage.from("photos").createSignedUrls(need, 3600);
    if (error || !data) return;
    data.forEach(d => { if (d && d.signedUrl && d.path) state.photoUrls.set(d.path, d.signedUrl); });
  } catch (e) { /* Fotos sind optional */ }
}

/* ---------------------------------------------------------------- map */
let homeLayer = null, homeMarker = null;
let map = null, catchLayer = null, spotLayer = null, gpsLayer = null, searchLayer = null, draftMarker = null, flagMarker = null;
const markers = new Map();
const ESRI_ATTR = 'Powered by <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a> | Esri, Maxar, Earthstar Geographics, and the GIS User Community';

function initMap() {
  if (map) return;
  map = L.map("map", { zoomControl: true, minZoom: 3, maxZoom: 20, zoomSnap: 0.5, worldCopyJump: true });
  map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
  map.fitBounds(IRELAND, { padding: [8, 8] });

  map.createPane("labels");
  map.getPane("labels").style.zIndex = 350;
  map.getPane("labels").classList.add("labels-pane");

  const key = encodeURIComponent(CFG.esriKey);
  const imagery = L.tileLayer("https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=" + key,
    { maxNativeZoom: 19, maxZoom: 20, attribution: ESRI_ATTR });
  const labels = L.tileLayer("https://static-map-tiles-api.arcgis.com/arcgis/rest/services/static-basemap-tiles-service/v1/arcgis/imagery/labels/static/tile/{z}/{y}/{x}?token=" + key,
    { tileSize: 512, zoomOffset: -1, maxNativeZoom: 19, maxZoom: 20, pane: "labels" });
  const hybrid = L.layerGroup([imagery, labels]);
  const osm = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    { maxNativeZoom: 19, maxZoom: 20, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>-Mitwirkende' });

  (lsGet("hk-base") === "osm" ? osm : hybrid).addTo(map);
  catchLayer = L.layerGroup().addTo(map);
  spotLayer = L.layerGroup().addTo(map);
  homeLayer = L.layerGroup().addTo(map);
  const overlays = { "Fänge": catchLayer, "Fähnchen": spotLayer };
  if (addHomebase()) overlays["Homebase"] = homeLayer;
  L.control.layers({ "Luftbild": hybrid, "Karte (OpenStreetMap)": osm }, overlays, { position: "topright" }).addTo(map);
  const zoomCls = () => map.getContainer().classList.toggle("z-lo", map.getZoom() < 10);
  map.on("zoomend", zoomCls); zoomCls();
  map.on("baselayerchange", e => lsSet("hk-base", e.layer === osm ? "osm" : "img"));

  // Luftbilder nicht ladbar (z. B. Schlüssel abgelaufen) → auf OpenStreetMap ausweichen
  let ok = 0, bad = 0, warned = false;
  imagery.on("tileload", () => { ok++; });
  imagery.on("tileerror", () => {
    bad++;
    if (!warned && bad >= 6 && ok === 0) {
      warned = true;
      map.removeLayer(hybrid); osm.addTo(map);
      showNotice("Die Luftbilder konnten nicht geladen werden. Vermutlich ist der Esri-Schlüssel abgelaufen oder gesperrt. Bis dahin zeigt die Karte OpenStreetMap.", true, "tiles");
    }
  });
  // genaue Quellenangabe der Bilddaten von Esri holen
  fetch("https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer?f=json&token=" + key)
    .then(r => r.ok ? r.json() : null)
    .then(d => {
      if (d && typeof d.copyrightText === "string" && d.copyrightText.trim()) {
        const txt = d.copyrightText.replace(/[<>&]/g, "");
        const attr = 'Powered by <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a> | ' + txt;
        const onMap = map.hasLayer(imagery);
        if (onMap) map.attributionControl.removeAttribution(ESRI_ATTR);
        imagery.options.attribution = attr;
        if (onMap) map.attributionControl.addAttribution(attr);
      }
    }).catch(() => { /* Standardtext bleibt */ });

  const Locate = L.Control.extend({
    options: { position: "topleft" },
    onAdd() {
      const div = L.DomUtil.create("div", "leaflet-bar");
      const b = L.DomUtil.create("button", "locate-btn", div);
      b.type = "button"; b.title = "Mein Standort"; b.setAttribute("aria-label", "Mein Standort");
      b.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="currentColor"/><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.on(b, "click", () => locateMe(b));
      return div;
    }
  });
  new Locate().addTo(map);

  const FlagCtl = L.Control.extend({
    options: { position: "topleft" },
    onAdd() {
      const div = L.DomUtil.create("div", "leaflet-bar");
      const b = L.DomUtil.create("button", "flag-btn", div);
      b.type = "button"; b.title = "Fähnchen setzen"; b.setAttribute("aria-label", "Fähnchen setzen");
      b.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5 22V3" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M6 4h12l-3 4.5 3 4.5H6z" fill="currentColor"/></svg>';
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.on(b, "click", () => openFlagForm(null));
      return div;
    }
  });
  new FlagCtl().addTo(map);

  gpsLayer = L.layerGroup().addTo(map);
  searchLayer = L.layerGroup().addTo(map);
  map.on("click", e => {
    hideResults();
    if (state.formOpen) setDraft(e.latlng.lat, e.latlng.lng, false);
    else if (state.flagOpen) setFlagDraft(e.latlng.lat, e.latlng.lng);
  });
}

function fitToCatches() {
  const list = filtered();
  if (!list.length) return;
  const b = L.latLngBounds(list.map(c => [c.lat, c.lng]));
  map.fitBounds(b, { padding: [40, 40], maxZoom: 11 });
}

/* GPS */
function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject({ code: 0 }); return; }
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 });
  });
}
function geoError(err) {
  const c = err && err.code;
  if (c === 1) return "Der Standortzugriff wurde verweigert. Erlaube ihn für diese Seite in den Einstellungen deines Browsers.";
  if (c === 2) return "Dein Standort ist gerade nicht verfügbar.";
  if (c === 3) return "Die Ortung hat zu lange gedauert. Versuch es unter freiem Himmel noch einmal.";
  return "Dieses Gerät kann keinen Standort liefern.";
}
function showGps(pos) {
  const ll = [pos.coords.latitude, pos.coords.longitude];
  gpsLayer.clearLayers();
  L.circle(ll, { radius: Math.min(pos.coords.accuracy || 0, 2000), className: "gpsacc", interactive: false }).addTo(gpsLayer);
  L.marker(ll, { icon: L.divIcon({ className: "", html: '<div class="gpsdot"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }), interactive: false, keyboard: false }).addTo(gpsLayer);
  return ll;
}
function flyTo(ll, z) {
  const zoom = Math.max(map.getZoom(), z);
  if (reduceMotion) map.setView(ll, zoom); else map.flyTo(ll, zoom, { duration: 0.8 });
}
async function locateMe(btn) {
  btn.classList.add("busy");
  try { const pos = await getPosition(); flyTo(showGps(pos), 15); }
  catch (e) { showNotice(geoError(e), true, "gps", 9000); }
  finally { btn.classList.remove("busy"); }
}

/* Gewässer-Vorschlag */
function inRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function guessWater(lat, lng) {
  const pt = [lng, lat];
  for (const lk of LOUGHS.lakes) if (lk.r.some(r => inRing(pt, r))) return lk.n;
  let best = null, bestD = Infinity;
  for (const lk of LOUGHS.lakes) for (const r of lk.r) for (const p of r) {
    const d = distKm([lat, lng], [p[1], p[0]]); if (d < bestD) { bestD = d; best = lk.n; }
  }
  if (bestD <= 2) return best;
  for (const [n, la, ln] of LOUGHS.small) if (distKm([lat, lng], [la, ln]) <= 3.5) return n;
  return "";
}

/* Ortssuche über OpenStreetMap Nominatim.
   Nutzungsregeln: nur auf Knopfdruck suchen (kein Suchen beim Tippen),
   höchstens eine Anfrage pro Sekunde, Quelle angeben. */
let searchBusy = false, lastSearch = 0;
const searchIcon = L.divIcon({ className: "", html: '<div class="searchpin"></div>', iconSize: [22, 22], iconAnchor: [11, 11] });
function hideResults() { $("searchResults").hidden = true; }
function resultsInfo(text) {
  const ul = $("searchResults"); ul.textContent = "";
  ul.append(el("li", "info", text)); ul.hidden = false;
}
function goToPlace(lat, lng, name, bbox) {
  hideResults();
  searchLayer.clearLayers();
  L.marker([lat, lng], { icon: searchIcon, keyboard: false, interactive: false })
    .bindTooltip(name, { permanent: true, direction: "top", offset: [0, -12] }).addTo(searchLayer);
  if (bbox) {
    const b = L.latLngBounds([bbox[0], bbox[2]], [bbox[1], bbox[3]]);
    if (reduceMotion) map.fitBounds(b, { padding: [40, 40], maxZoom: 15 });
    else map.flyToBounds(b, { padding: [40, 40], maxZoom: 15, duration: 0.8 });
  } else flyTo([lat, lng], 14);
}
$("search").addEventListener("submit", async ev => {
  ev.preventDefault();
  const q = $("searchQ").value.trim();
  if (!q) { hideResults(); return; }
  const c = parseCoords(q);
  if (c) { goToPlace(c.lat, c.lng, c.lat.toFixed(5) + ", " + c.lng.toFixed(5)); $("searchQ").blur(); return; }
  if (searchBusy) return;
  const wait = 1100 - (Date.now() - lastSearch);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  searchBusy = true; lastSearch = Date.now();
  resultsInfo("Suche …");
  try {
    const params = new URLSearchParams({
      q, format: "jsonv2", limit: "6", "accept-language": "de,en",
      countrycodes: "ie,gb", viewbox: "-11.0,55.5,-5.3,51.3", bounded: "1"
    });
    const r = await fetch("https://nominatim.openstreetmap.org/search?" + params.toString(), { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const data = await r.json();
    const ul = $("searchResults"); ul.textContent = "";
    if (!Array.isArray(data) || !data.length) {
      ul.append(el("li", "info", "Nichts gefunden. Versuch es mit einem anderen Namen, z. B. „Lough Corrib“ oder „Oughterard“."));
    } else {
      data.forEach(p => {
        const lat = Number(p.lat), lng = Number(p.lon);
        if (!isFinite(lat) || !isFinite(lng)) return;
        const parts = String(p.display_name || "").split(",").map(s => s.trim()).filter(Boolean);
        const name = p.name || parts[0] || q;
        const detail = parts.filter(s => s !== name).slice(0, 3).join(", ");
        const bb = Array.isArray(p.boundingbox) && p.boundingbox.length === 4 ? p.boundingbox.map(Number) : null;
        const li = el("li"), b = el("button"); b.type = "button";
        b.append(el("span", "nm", name), el("span", "dt", detail));
        b.addEventListener("click", () => { goToPlace(lat, lng, name, bb && bb.every(isFinite) ? bb : null); $("searchQ").blur(); });
        li.append(b); ul.append(li);
      });
    }
    const src = el("li", "src"); src.append("Suche: © ");
    const a = el("a", null, "OpenStreetMap"); a.href = "https://www.openstreetmap.org/copyright"; a.target = "_blank"; a.rel = "noopener";
    src.append(a, "-Mitwirkende"); ul.append(src);
    ul.hidden = false;
  } catch (e) {
    resultsInfo("Die Ortssuche ist gerade nicht erreichbar. Versuch es gleich noch einmal.");
  } finally { searchBusy = false; }
});
$("searchQ").addEventListener("input", () => { if (!$("searchQ").value.trim()) { hideResults(); searchLayer && searchLayer.clearLayers(); } });
$("searchQ").addEventListener("keydown", e => { if (e.key === "Escape") { e.stopPropagation(); hideResults(); $("searchQ").blur(); } });

/* ---------------------------------------------------------------- popups */
function popupEl(c) {
  const d = el("div", "pop");
  const url = c.photo && state.photoUrls.get(c.photo);
  if (url) {
    const a = el("a"); a.href = url; a.target = "_blank"; a.rel = "noopener";
    const img = el("img"); img.src = url; img.alt = "Foto: " + (c.len ? c.len + " cm Hecht" : "Hecht") + " von " + c.angler; img.loading = "lazy";
    a.append(img); d.append(a);
  }
  const top = el("div", "top");
  const big = el("span", "big", c.len ? String(c.len) : "–"); if (c.len) big.append(el("small", null, " cm"));
  top.append(big);
  if (c.len >= 100) top.append(el("span", "badge", "Meterhecht"));
  if (c.kg) top.append(el("span", "w", fmtKg(c.kg) + " · " + lbOz(c.kg)));
  d.append(top);
  const dl = el("dl");
  const add = (k, v) => { if (v) dl.append(el("dt", null, k), el("dd", null, v)); };
  add("Angler", c.angler); add("Gewässer", c.water); add("Datum", fmtDate(c.date)); add("Köder", c.lure);
  add("Verbleib", c.released ? "Zurückgesetzt" : "Entnommen");
  d.append(dl);
  if (c.note) d.append(el("p", "note", c.note));
  d.append(el("span", "coord", c.lat.toFixed(5) + ", " + c.lng.toFixed(5)));
  const row = el("div", "row");
  const a = el("a", null, "In Google Maps öffnen");
  a.href = "https://www.google.com/maps?q=" + c.lat.toFixed(6) + "," + c.lng.toFixed(6); a.target = "_blank"; a.rel = "noopener";
  row.append(a);
  if (canModify(c)) {
    const b = el("button", "btn link", "Bearbeiten"); b.type = "button";
    b.addEventListener("click", () => { map.closePopup(); openForm(c); });
    row.append(b);
  }
  d.append(row);
  return d;
}

/* ---------------------------------------------------------------- render */
function filtered() {
  return state.catches.filter(c =>
    (state.year === "all" || c.date.slice(0, 4) === state.year) &&
    (state.angler === "all" || c.angler === state.angler));
}
function fillSelect(sel, values, allLabel, current) {
  const keep = values.includes(current) ? current : "all";
  sel.textContent = "";
  const o = el("option", null, allLabel); o.value = "all"; sel.append(o);
  values.forEach(v => { const op = el("option", null, v); op.value = v; sel.append(op); });
  sel.value = keep; return keep;
}
function fillDatalist(dl, values) { dl.textContent = ""; values.forEach(v => { const o = document.createElement("option"); o.value = v; dl.append(o); }); }

function render() {
  const years = [...new Set(state.catches.map(c => c.date.slice(0, 4)).filter(Boolean))].sort().reverse();
  const anglers = [...new Set(state.catches.map(c => c.angler))].sort((a, b) => a.localeCompare(b, "de"));
  state.year = fillSelect($("fYear"), years, "Alle Jahre", state.year);
  state.angler = fillSelect($("fAngler"), anglers, "Alle", state.angler);
  fillDatalist($("dlAngler"), anglers);
  const waters = new Set([...LOUGHS.lakes.map(l => l.n), ...LOUGHS.small.map(s => s[0]), "River Shannon", "River Erne", ...state.catches.map(c => c.water).filter(Boolean)]);
  fillDatalist($("dlWater"), [...waters].sort((a, b) => a.localeCompare(b, "de")));
  fillDatalist($("dlLure"), [...new Set([...state.catches.map(c => c.lure).filter(Boolean), ...LURES])]);

  const list = filtered();
  const lens = list.filter(c => c.len);
  $("sCount").textContent = String(list.length);
  const max = lens.reduce((m, c) => (!m || c.len > m.len) ? c : m, null);
  const sMax = $("sMax"); sMax.textContent = "";
  if (max) { sMax.append(String(max.len), el("small", null, "cm")); $("sMaxWho").textContent = "Größter · " + max.angler; }
  else { sMax.textContent = "–"; $("sMaxWho").textContent = "Größter"; }
  $("sMeter").textContent = String(lens.filter(c => c.len >= 100).length);
  const nAng = new Set(state.catches.map(c => c.angler)).size;
  $("sub").textContent = state.catches.length ? (state.catches.length + (state.catches.length === 1 ? " Fang" : " Fänge") + " von " + nAng + " Angler" + (nAng === 1 ? "" : "n")) : "Unser gemeinsames Fangbuch";

  const by = new Map();
  list.forEach(c => { const r = by.get(c.angler) || { n: 0, best: 0 }; r.n++; r.best = Math.max(r.best, c.len || 0); by.set(c.angler, r); });
  const rows = [...by.entries()].sort((a, b) => b[1].best - a[1].best || b[1].n - a[1].n).slice(0, 8);
  $("board").hidden = rows.length < 2;
  const tb = $("boardBody"); tb.textContent = "";
  rows.forEach(([name, r], i) => {
    const tr = el("tr");
    tr.append(el("td", "rank", String(i + 1)), el("td", "name", name), el("td", "n", r.n + (r.n === 1 ? " Fang" : " Fänge")), el("td", "best", r.best ? r.best + " cm" : "–"));
    tb.append(tr);
  });

  const ol = $("list"); ol.textContent = "";
  list.forEach(c => {
    const li = el("li", "catch" + (state.sel === c.id ? " sel" : "")); li.dataset.id = c.id;
    const b = el("button"); b.type = "button";
    const len = el("span", "len", c.len ? String(c.len) : "–"); if (c.len) len.append(el("small", null, "cm"));
    const meta = el("span", "meta");
    const who = el("span", "who", c.angler); if (c.water) who.append(el("span", null, " · " + c.water));
    const det = [fmtDate(c.date), c.lure, c.kg ? fmtKg(c.kg) : "", c.released ? "" : "entnommen", c.photo ? "mit Foto" : ""].filter(Boolean).join(" · ");
    meta.append(who, el("span", "det", det));
    b.append(len, meta, c.len >= 100 ? el("span", "badge", "Meterhecht") : el("span"));
    b.addEventListener("click", () => focusCatch(c.id, true));
    li.append(b); ol.append(li);
  });
  $("listCount").textContent = list.length ? (list.length === 1 ? "1 Eintrag" : list.length + " Einträge") : "";

  const empty = $("empty"); empty.textContent = "";
  if (!state.loaded) { empty.append(el("strong", null, "Fänge werden geladen …")); empty.hidden = false; }
  else if (!state.catches.length) {
    empty.append(el("strong", null, "Noch kein Hecht im Buch"),
      el("span", null, "Tippe auf „Fang eintragen“ und setz die Fangstelle auf der Karte. Jeder Fang erscheint sofort bei allen."));
    empty.hidden = false;
  } else if (!list.length) { empty.append(el("span", null, "Für diese Auswahl gibt es keine Fänge.")); empty.hidden = false; }
  else empty.hidden = true;

  renderMarkers(list);
  renderSpots();
}

function renderMarkers(list) {
  if (!map) return;
  let reopen = null;
  markers.forEach((m, id) => { if (m.isPopupOpen()) reopen = id; });
  catchLayer.clearLayers(); markers.clear();
  list.forEach(c => {
    const cls = "pin" + (c.len >= 100 ? " pin-gold" : "") + (state.sel === c.id ? " pin-sel" : "");
    const m = L.circleMarker([c.lat, c.lng], { radius: radius(c.len), className: cls, bubblingMouseEvents: false });
    m.bindPopup(() => popupEl(c), { maxWidth: 280, minWidth: 220, autoPanPadding: [24, 24] });
    m.on("click", () => select(c.id));
    m.addTo(catchLayer); markers.set(c.id, m);
  });
  [...list].sort((a, b) => (a.len || 0) - (b.len || 0)).forEach(c => markers.get(c.id).bringToFront());
  if (reopen && markers.has(reopen) && !state.formOpen) markers.get(reopen).openPopup();
}

function select(id) {
  state.sel = id;
  document.querySelectorAll(".catch").forEach(li => li.classList.toggle("sel", li.dataset.id === id));
  markers.forEach((m, mid) => { const p = m.getElement && m.getElement(); if (p) p.classList.toggle("pin-sel", mid === id); });
  const li = document.querySelector('.catch[data-id="' + CSS.escape(id) + '"]');
  if (li) li.scrollIntoView({ block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
}
function focusCatch(id, fly) {
  const m = markers.get(id); if (!m) return;
  select(id);
  if (fly) { flyTo(m.getLatLng(), 14); map.once("moveend", () => m.openPopup()); }
  else m.openPopup();
}

$("fYear").addEventListener("change", e => { state.year = e.target.value; render(); });
$("fAngler").addEventListener("change", e => { state.angler = e.target.value; render(); });

/* ---------------------------------------------------------------- form */
const draftIcon = L.divIcon({ className: "", html: '<div class="draft"></div>', iconSize: [34, 34], iconAnchor: [17, 17] });

function setDraft(lat, lng, fromInput) {
  state.draft = { lat, lng };
  if (!draftMarker) {
    draftMarker = L.marker([lat, lng], { icon: draftIcon, draggable: true, keyboard: false, zIndexOffset: 1000 }).addTo(map);
    draftMarker.on("dragend", () => { const p = draftMarker.getLatLng(); setDraft(p.lat, p.lng, false); });
  } else draftMarker.setLatLng([lat, lng]);
  if (!fromInput) $("fCoords").value = lat.toFixed(5) + ", " + lng.toFixed(5);
  $("coordHint").className = "hint";
  $("spot").classList.add("ok");
  $("spotText").textContent = "Markierung gesetzt. Du kannst sie auf der Karte verschieben.";
  $("maphint").hidden = true;
  if (state.waterAuto || !$("fWater").value.trim()) {
    const g = guessWater(lat, lng);
    if (g) { $("fWater").value = g; state.waterAuto = true; }
  }
}
function clearDraft() { if (draftMarker) { map.removeLayer(draftMarker); draftMarker = null; } state.draft = null; }

function parseCoords(s) {
  const m = s.trim().match(/^(-?\d{1,2}(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)$/);
  if (!m) return null;
  const lat = parseFloat(m[1].replace(",", ".")), lng = parseFloat(m[2].replace(",", "."));
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}
function updateLb() { const v = parseFloat($("fKg").value); $("lbHint").textContent = isFinite(v) && v > 0 ? "≈ " + lbOz(v) : ""; }

let previewUrl = null;
function setPreview(src) {
  const img = $("photoPreview");
  if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
  if (src) { img.src = src; img.hidden = false; $("photoRemove").hidden = false; $("photoPick").textContent = "Anderes Foto"; }
  else { img.removeAttribute("src"); img.hidden = true; $("photoRemove").hidden = true; $("photoPick").textContent = "Foto wählen"; }
}

let delArmed = false;
function openForm(c) {
  if (state.flagOpen) closeFlagForm();
  $("maphint").textContent = "Tippe auf die Karte, wo der Hecht gebissen hat";
  state.formOpen = true; state.editing = c ? c.id : null;
  $("formTitle").textContent = c ? "Fang bearbeiten" : "Neuer Fang";
  $("saveBtn").textContent = c ? "Änderungen speichern" : "Fang speichern";
  $("delBtn").hidden = !c; $("delBtn").textContent = "Löschen"; delArmed = false;
  setMsg("formErr", "");
  $("fAnglerIn").value = c ? c.angler : (lsGet("hk-angler") || "");
  $("fDate").value = c ? (c.date || today()) : today();
  $("fWater").value = c ? c.water : "";
  $("fLen").value = c && c.len ? c.len : "";
  $("fKg").value = c && c.kg ? c.kg : "";
  $("fLure").value = c ? c.lure : (lsGet("hk-lure") || "");
  $("fReleased").checked = c ? c.released : true;
  $("fNote").value = c ? c.note : "";
  $("fCoords").value = ""; $("coordHint").textContent = ""; $("photoHint").textContent = "";
  $("fPhoto").value = ""; state.photoFile = null; state.photoRemoved = false;
  setPreview(c && c.photo ? state.photoUrls.get(c.photo) : null);
  $("spot").classList.remove("ok");
  $("spotText").textContent = "Tippe auf die Karte, nimm deine Position oder füge Koordinaten aus Google Maps ein.";
  state.waterAuto = !c || !c.water;
  updateLb();
  clearDraft(); map.closePopup();
  if (c) { setDraft(c.lat, c.lng, false); state.waterAuto = false; }
  else $("maphint").hidden = false;
  map.getContainer().classList.add("placing");
  $("viewList").hidden = true; $("form").hidden = false; $("addBtn").hidden = true;
  $("form").closest(".panel").scrollTop = 0;
}
function closeForm() {
  state.formOpen = false; state.editing = null;
  clearDraft(); $("maphint").hidden = true;
  if (map) map.getContainer().classList.remove("placing");
  setPreview(null); state.photoFile = null;
  $("form").hidden = true; $("viewList").hidden = false; $("addBtn").hidden = false;
}

$("addBtn").addEventListener("click", () => openForm(null));
$("cancelBtn").addEventListener("click", closeForm);
$("fKg").addEventListener("input", updateLb);
$("fWater").addEventListener("input", () => { state.waterAuto = false; });
$("fCoords").addEventListener("input", () => {
  const v = $("fCoords").value, h = $("coordHint");
  if (!v.trim()) { h.textContent = ""; return; }
  const p = parseCoords(v);
  if (!p) { h.textContent = "Format: Breite, Länge – z. B. 53.4512, -9.2456"; h.className = "hint err"; return; }
  h.textContent = "";
  setDraft(p.lat, p.lng, true);
  flyTo([p.lat, p.lng], 13);
});
$("gpsBtn").addEventListener("click", async () => {
  const b = $("gpsBtn"), h = $("coordHint");
  b.disabled = true; b.textContent = "Orte …"; h.className = "hint"; h.textContent = "";
  try {
    const pos = await getPosition();
    const ll = showGps(pos);
    setDraft(ll[0], ll[1], false);
    h.textContent = "Genauigkeit ± " + Math.round(pos.coords.accuracy) + " m";
    flyTo(ll, 16);
  } catch (e) { h.textContent = geoError(e); h.className = "hint err"; }
  finally { b.disabled = false; b.textContent = "Meine Position"; }
});
$("fPhoto").addEventListener("change", () => {
  const f = $("fPhoto").files && $("fPhoto").files[0];
  $("photoHint").textContent = ""; $("photoHint").className = "hint";
  if (!f) return;
  if (!/^image\//.test(f.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(f.name)) { $("photoHint").textContent = "Das ist keine Bilddatei."; $("photoHint").className = "hint err"; return; }
  state.photoFile = f; state.photoRemoved = false;
  setPreview(null);
  previewUrl = URL.createObjectURL(f);
  const img = $("photoPreview"); img.src = previewUrl; img.hidden = false;
  $("photoRemove").hidden = false; $("photoPick").textContent = "Anderes Foto";
  $("photoHint").textContent = "Wird beim Speichern verkleinert hochgeladen.";
});
$("photoRemove").addEventListener("click", () => {
  state.photoFile = null; state.photoRemoved = true; $("fPhoto").value = "";
  setPreview(null); $("photoHint").textContent = "";
});

async function resizeImage(file) {
  const MAX = 1600;
  let src;
  try { src = await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch (e) {
    src = await new Promise((res, rej) => {
      const u = URL.createObjectURL(file), i = new Image();
      i.onload = () => res(i); i.onerror = () => rej(new Error("decode")); i.src = u;
    });
  }
  const w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
  const s = Math.min(1, MAX / Math.max(w, h));
  const cv = document.createElement("canvas"); cv.width = Math.round(w * s); cv.height = Math.round(h * s);
  cv.getContext("2d").drawImage(src, 0, 0, cv.width, cv.height);
  if (src.close) src.close();
  return await new Promise((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error("encode")), "image/jpeg", 0.82));
}

$("form").addEventListener("submit", async ev => {
  ev.preventDefault();
  if (state.saving) return;
  setMsg("formErr", "");
  const fail = (msg, id) => { setMsg("formErr", msg); if (id) $(id).focus(); };
  if (!state.draft) return fail("Setz zuerst die Fangstelle auf der Karte, nimm deine Position oder gib Koordinaten ein.");
  const angler = $("fAnglerIn").value.trim();
  if (!angler) return fail("Trag ein, wer den Hecht gefangen hat.", "fAnglerIn");
  const date = $("fDate").value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail("Bitte ein Datum wählen.", "fDate");
  const len = parseInt($("fLen").value, 10);
  if (!(len >= 20 && len <= 160)) return fail("Die Länge muss zwischen 20 und 160 cm liegen.", "fLen");
  const kgRaw = $("fKg").value.trim(); const kg = kgRaw ? parseFloat(kgRaw.replace(",", ".")) : null;
  if (kgRaw && !(kg > 0 && kg <= 30)) return fail("Das Gewicht muss zwischen 0,2 und 30 kg liegen.", "fKg");

  const prev = state.editing ? state.catches.find(c => c.id === state.editing) : null;
  const btn = $("saveBtn"); state.saving = true; btn.disabled = true;
  let uploaded = null;
  try {
    let photoPath = prev ? prev.photo : null;
    if (state.photoFile) {
      btn.textContent = "Foto wird hochgeladen …";
      let blob;
      try { blob = await resizeImage(state.photoFile); }
      catch (e) { throw { userMsg: "Das Foto konnte nicht gelesen werden. Versuch es mit einem JPG- oder PNG-Bild." }; }
      const path = newId() + ".jpg";
      const up = await sb.storage.from("photos").upload(path, blob, { contentType: "image/jpeg", upsert: false });
      if (up.error) throw { userMsg: "Das Foto konnte nicht hochgeladen werden. " + explainDb(up.error) };
      uploaded = path; photoPath = path;
    } else if (state.photoRemoved) photoPath = null;

    btn.textContent = "Speichert …";
    const row = {
      angler, caught_on: date, water: $("fWater").value.trim().slice(0, 60) || null,
      lat: Math.round(state.draft.lat * 1e6) / 1e6, lng: Math.round(state.draft.lng * 1e6) / 1e6,
      length_cm: len, weight_kg: kg ? Math.round(kg * 10) / 10 : null,
      lure: $("fLure").value.trim().slice(0, 40) || null, released: $("fReleased").checked,
      note: $("fNote").value.trim().slice(0, 280) || null, photo_path: photoPath
    };
    const q = state.editing
      ? sb.from("catches").update(row).eq("id", state.editing).select("id").single()
      : sb.from("catches").insert(row).select("id").single();
    const { data, error } = await q;
    if (error) throw error;

    if (prev && prev.photo && prev.photo !== photoPath) sb.storage.from("photos").remove([prev.photo]).catch(() => {});
    lsSet("hk-angler", angler); if (row.lure) lsSet("hk-lure", row.lure);
    const id = data.id;
    state.sel = id;
    closeForm();
    if (state.year !== "all" && date.slice(0, 4) !== state.year) state.year = "all";
    if (state.angler !== "all" && angler !== state.angler) state.angler = "all";
    await reload();
    focusCatch(id, false);
  } catch (e) {
    if (uploaded) sb.storage.from("photos").remove([uploaded]).catch(() => {});
    setMsg("formErr", e && e.userMsg ? e.userMsg : explainDb(e));
  } finally {
    state.saving = false; btn.disabled = false;
    btn.textContent = state.editing ? "Änderungen speichern" : "Fang speichern";
  }
});

$("delBtn").addEventListener("click", async () => {
  if (!state.editing) return;
  if (!delArmed) { delArmed = true; $("delBtn").textContent = "Wirklich löschen?"; return; }
  const b = $("delBtn"); b.disabled = true;
  const prev = state.catches.find(c => c.id === state.editing);
  try {
    const { data, error } = await sb.from("catches").delete().eq("id", state.editing).select("id");
    if (error) throw error;
    if (!data || !data.length) throw { code: "PGRST116" };
    if (prev && prev.photo) sb.storage.from("photos").remove([prev.photo]).catch(() => {});
    state.sel = null; closeForm(); await reload();
  } catch (e) { setMsg("formErr", explainDb(e)); }
  finally { b.disabled = false; }
});

document.addEventListener("keydown", e => {
  if (e.key !== "Escape" || document.querySelector("dialog[open]")) return;
  if (state.formOpen) closeForm(); else if (state.flagOpen) closeFlagForm();
});

/* ---------------------------------------------------------------- Homebase */
const HOME = (function () {
  const h = CFG.homebase;
  if (!h) return null;
  const lat = Number(h.lat), lng = Number(h.lng);
  if (h.lat == null || h.lng == null || !isFinite(lat) || !isFinite(lng)) return null;
  return { lat, lng, label: h.label || "Homebase", name: h.name || "", eircode: h.eircode || "" };
})();
const CASTLE_SVG = '<svg viewBox="0 0 40 42" width="48" height="50" aria-hidden="true">' +
  '<path d="M20 9V1.5" stroke="#2A2118" stroke-width="1.6" stroke-linecap="round"/>' +
  '<path d="M20.6 2h7l-2 2.6 2 2.6h-7z" fill="#DE6824" stroke="#2A2118" stroke-width="1"/>' +
  '<path d="M3 40V18h3v-3.5h2.6V18h2.2v-3.5h2.6V18H14V11h2.6V8h2.6v3h1.6V8h2.6v3H26v7h0.6v-3.5h2.6V18h2.2v-3.5h2.6V18H37v22z" fill="#E9DFC7" stroke="#2A2118" stroke-width="1.6" stroke-linejoin="round"/>' +
  '<path d="M16.5 40v-6.5a3.5 3.5 0 0 1 7 0V40z" fill="#2A2118"/>' +
  '<path d="M19.2 15.5h1.6v4h-1.6zM7.4 23h1.6v3.4H7.4zM31 23h1.6v3.4H31z" fill="#2A2118"/>' +
  '<path d="M14 18h12" stroke="#2A2118" stroke-width="1.2"/>' +
  '</svg>';
function homePopup() {
  const d = el("div", "pop");
  d.append(el("span", "ttl", HOME.label));
  if (HOME.name) d.append(el("span", null, HOME.name));
  if (HOME.eircode) d.append(el("span", "coord", "Eircode " + HOME.eircode));
  d.append(el("span", "coord", HOME.lat.toFixed(5) + ", " + HOME.lng.toFixed(5)));
  const a = el("a", null, "Route in Google Maps");
  a.href = "https://www.google.com/maps/dir/?api=1&destination=" + HOME.lat.toFixed(6) + "," + HOME.lng.toFixed(6);
  a.target = "_blank"; a.rel = "noopener";
  const row = el("div", "row"); row.append(a); d.append(row);
  return d;
}
function addHomebase() {
  if (!HOME) return false;
  const box = el("div", "castle");
  box.innerHTML = CASTLE_SVG;
  box.append(el("span", "castle-label", HOME.label));
  homeMarker = L.marker([HOME.lat, HOME.lng], {
    icon: L.divIcon({ className: "", html: box, iconSize: [48, 50], iconAnchor: [24, 48], popupAnchor: [0, -46] }),
    title: HOME.label, zIndexOffset: 500, riseOnHover: true
  }).bindPopup(homePopup, { maxWidth: 260, minWidth: 200 });
  homeMarker.addTo(homeLayer);
  return true;
}

/* ---------------------------------------------------------------- Fähnchen */
const KINDS = [
  { k: "hotspot", t: "Hotspot", s: "Hotspot" },
  { k: "slip", t: "Slipanlage", s: "Slip" },
  { k: "achtung", t: "Achtung (Untiefe, Felsen)", s: "Achtung" },
  { k: "unterkunft", t: "Unterkunft", s: "Unterkunft" },
  { k: "parken", t: "Parkplatz", s: "Parken" },
  { k: "sonstiges", t: "Sonstiges", s: "Sonstiges" }
];
const KIND_BY = Object.fromEntries(KINDS.map(k => [k.k, k]));
const FLAG_SVG = '<svg viewBox="0 0 24 30" width="24" height="30" aria-hidden="true"><path d="M4 2.5v26" stroke="#15201a" stroke-width="2.6" stroke-linecap="round"/><path d="M5.2 3h15.3l-4.2 5.2 4.2 5.2H5.2z" fill="currentColor" stroke="#15201a" stroke-width="1.3" stroke-linejoin="round"/></svg>';

function flagIcon(kind, label, draft) {
  const d = el("div", "flag fk-" + kind + (draft ? " draft-flag" : ""));
  d.innerHTML = FLAG_SVG;
  if (label) d.append(el("span", "flag-label", label));
  return L.divIcon({ className: "", html: d, iconSize: [24, 30], iconAnchor: [4, 29], popupAnchor: [8, -28] });
}

function spotPopup(s) {
  const d = el("div", "pop");
  d.append(el("span", "ttl", s.label));
  const kc = el("span", "kindchip fk-" + s.kind); kc.append(el("span", "sw"), KIND_BY[s.kind].t); d.append(kc);
  if (s.note) d.append(el("p", "note", s.note));
  d.append(el("span", "coord", s.lat.toFixed(5) + ", " + s.lng.toFixed(5)));
  const row = el("div", "row");
  const a = el("a", null, (s.kind === "slip" || s.kind === "unterkunft" || s.kind === "parken") ? "Route in Google Maps" : "In Google Maps öffnen");
  a.href = (s.kind === "slip" || s.kind === "unterkunft" || s.kind === "parken")
    ? "https://www.google.com/maps/dir/?api=1&destination=" + s.lat.toFixed(6) + "," + s.lng.toFixed(6)
    : "https://www.google.com/maps?q=" + s.lat.toFixed(6) + "," + s.lng.toFixed(6);
  a.target = "_blank"; a.rel = "noopener"; row.append(a);
  if (canModify(s)) {
    const b = el("button", "btn link", "Bearbeiten"); b.type = "button";
    b.addEventListener("click", () => { map.closePopup(); openFlagForm(s); });
    row.append(b);
  }
  d.append(row);
  return d;
}

const spotMarkers = new Map();
function renderSpots() {
  if (!map) return;
  spotLayer.clearLayers(); spotMarkers.clear();
  state.spots.forEach(s => {
    if (state.flagOpen && state.flagEditing === s.id) return;
    const m = L.marker([s.lat, s.lng], { icon: flagIcon(s.kind, s.label), title: s.label, riseOnHover: true });
    m.bindPopup(() => spotPopup(s), { maxWidth: 260, minWidth: 200 });
    m.addTo(spotLayer); spotMarkers.set(s.id, m);
  });
  const ul = $("spotList"); ul.textContent = "";
  if (HOME && homeMarker) {
    const li = el("li"), b = el("button"); b.type = "button";
    b.append(el("span", "sw castle-sw"), el("span", "lb", HOME.label + (HOME.name ? " · " + HOME.name : "")), el("span", "kd", "Burg"));
    b.addEventListener("click", () => {
      if (!map.hasLayer(homeLayer)) homeLayer.addTo(map);
      flyTo(homeMarker.getLatLng(), 15); map.once("moveend", () => homeMarker.openPopup());
    });
    li.append(b); ul.append(li);
  }
  [...state.spots].sort((a, b) => a.label.localeCompare(b.label, "de")).forEach(s => {
    const li = el("li"), b = el("button"); b.type = "button";
    const sw = el("span", "sw fk-" + s.kind);
    b.append(sw, el("span", "lb", s.label), el("span", "kd", KIND_BY[s.kind].s));
    b.addEventListener("click", () => {
      const m = spotMarkers.get(s.id); if (!m) return;
      if (!map.hasLayer(spotLayer)) spotLayer.addTo(map);
      flyTo(m.getLatLng(), 15); map.once("moveend", () => m.openPopup());
    });
    li.append(b); ul.append(li);
  });
  $("spotCount").textContent = state.spots.length ? String(state.spots.length) : "";
  $("spotEmpty").hidden = state.spots.length > 0 || !!HOME;
}

function buildKinds() {
  const box = $("flagKinds"); box.textContent = "";
  KINDS.forEach(k => {
    const lab = el("label", "kind fk-" + k.k);
    const inp = el("input"); inp.type = "radio"; inp.name = "flagKind"; inp.value = k.k;
    inp.addEventListener("change", () => { state.flagKind = k.k; if (flagMarker) flagMarker.setIcon(flagIcon(k.k, $("flagLabel").value.trim(), true)); });
    lab.append(inp, el("span", "sw"), k.s);
    box.append(lab);
  });
}
buildKinds();
function setKind(k) {
  state.flagKind = k;
  document.querySelectorAll('input[name="flagKind"]').forEach(i => { i.checked = i.value === k; });
}

function setFlagDraft(lat, lng) {
  state.flagDraft = { lat, lng };
  const icon = flagIcon(state.flagKind, $("flagLabel").value.trim(), true);
  if (!flagMarker) {
    flagMarker = L.marker([lat, lng], { icon, draggable: true, keyboard: false, zIndexOffset: 1000 }).addTo(map);
    flagMarker.on("dragend", () => { const p = flagMarker.getLatLng(); state.flagDraft = { lat: p.lat, lng: p.lng }; });
  } else { flagMarker.setLatLng([lat, lng]); flagMarker.setIcon(icon); }
  $("flagSpot").classList.add("ok");
  $("flagSpotText").textContent = "Fähnchen gesetzt. Du kannst es auf der Karte verschieben.";
  $("maphint").hidden = true;
}
function clearFlagDraft() { if (flagMarker) { map.removeLayer(flagMarker); flagMarker = null; } state.flagDraft = null; }

let flagDelArmed = false;
function openFlagForm(s) {
  if (state.spotsMissing) {
    showNotice(state.isAdmin
      ? "Für die Fähnchen fehlt noch die Datenbank-Tabelle. Führe einmal supabase/002_faehnchen.sql im SQL-Editor von Supabase aus."
      : "Die Fähnchen sind noch nicht eingerichtet. Sag dem Verwalter Bescheid.", true, "spots");
    return;
  }
  if (state.formOpen) closeForm();
  if (state.flagOpen) closeFlagForm();
  state.flagOpen = true; state.flagEditing = s ? s.id : null;
  $("flagTitle").textContent = s ? "Fähnchen bearbeiten" : "Neues Fähnchen";
  $("flagSave").textContent = s ? "Änderungen speichern" : "Fähnchen setzen";
  $("flagDel").hidden = !s; $("flagDel").textContent = "Löschen"; flagDelArmed = false;
  setMsg("flagErr", ""); $("flagHint").textContent = ""; $("flagHint").className = "hint";
  $("flagLabel").value = s ? s.label : "";
  $("flagNote").value = s ? s.note : "";
  setKind(s ? s.kind : (lsGet("hk-flagkind") || "hotspot"));
  $("flagSpot").classList.remove("ok");
  $("flagSpotText").textContent = "Tippe auf die Karte, wo das Fähnchen hin soll.";
  clearFlagDraft(); map.closePopup();
  if (!map.hasLayer(spotLayer)) spotLayer.addTo(map);
  if (s) { renderSpots(); setFlagDraft(s.lat, s.lng); }
  else { $("maphint").textContent = "Tippe auf die Karte, wo das Fähnchen hin soll"; $("maphint").hidden = false; }
  map.getContainer().classList.add("placing");
  $("viewList").hidden = true; $("flagForm").hidden = false; $("addBtn").hidden = true;
  $("flagForm").closest(".panel").scrollTop = 0;
}
function closeFlagForm() {
  const wasEditing = state.flagEditing;
  state.flagOpen = false; state.flagEditing = null;
  clearFlagDraft(); $("maphint").hidden = true;
  if (map) map.getContainer().classList.remove("placing");
  $("flagForm").hidden = true; $("viewList").hidden = false; $("addBtn").hidden = false;
  if (wasEditing) renderSpots();
}

$("flagCancel").addEventListener("click", closeFlagForm);
$("flagLabel").addEventListener("input", () => { if (flagMarker) flagMarker.setIcon(flagIcon(state.flagKind, $("flagLabel").value.trim(), true)); });
$("flagGps").addEventListener("click", async () => {
  const b = $("flagGps"), h = $("flagHint");
  b.disabled = true; b.textContent = "Orte …"; h.className = "hint"; h.textContent = "";
  try {
    const pos = await getPosition();
    const ll = showGps(pos);
    setFlagDraft(ll[0], ll[1]);
    h.textContent = "Genauigkeit ± " + Math.round(pos.coords.accuracy) + " m";
    flyTo(ll, 16);
  } catch (e) { h.textContent = geoError(e); h.className = "hint err"; }
  finally { b.disabled = false; b.textContent = "Meine Position"; }
});

$("flagForm").addEventListener("submit", async ev => {
  ev.preventDefault();
  setMsg("flagErr", "");
  if (!state.flagDraft) { setMsg("flagErr", "Tippe zuerst auf die Karte oder nimm deine Position."); return; }
  const label = $("flagLabel").value.trim();
  if (!label) { setMsg("flagErr", "Gib dem Fähnchen eine Beschriftung."); $("flagLabel").focus(); return; }
  const row = {
    label: label.slice(0, 60), kind: state.flagKind, note: $("flagNote").value.trim().slice(0, 280) || null,
    lat: Math.round(state.flagDraft.lat * 1e6) / 1e6, lng: Math.round(state.flagDraft.lng * 1e6) / 1e6
  };
  const b = $("flagSave"); b.disabled = true;
  try {
    const q = state.flagEditing
      ? sb.from("spots").update(row).eq("id", state.flagEditing).select("id").single()
      : sb.from("spots").insert(row).select("id").single();
    const { error } = await q;
    if (error) throw error;
    lsSet("hk-flagkind", row.kind);
    closeFlagForm();
    await reload();
  } catch (e) { setMsg("flagErr", explainDb(e)); }
  finally { b.disabled = false; }
});

$("flagDel").addEventListener("click", async () => {
  if (!state.flagEditing) return;
  if (!flagDelArmed) { flagDelArmed = true; $("flagDel").textContent = "Wirklich löschen?"; return; }
  const b = $("flagDel"); b.disabled = true;
  try {
    const { data, error } = await sb.from("spots").delete().eq("id", state.flagEditing).select("id");
    if (error) throw error;
    if (!data || !data.length) throw { code: "PGRST116" };
    closeFlagForm(); await reload();
  } catch (e) { setMsg("flagErr", explainDb(e)); }
  finally { b.disabled = false; }
});

/* ---------------------------------------------------------------- menu + dialogs */
function closeMenu() { $("menu").removeAttribute("open"); }
document.addEventListener("click", e => { if ($("menu").open && !$("menu").contains(e.target)) closeMenu(); });

$("menuPw").addEventListener("click", () => {
  closeMenu(); $("pwNew").value = ""; $("pwNew2").value = ""; setMsg("pwMsg", "");
  $("pwDlg").showModal();
});
$("pwForm").addEventListener("submit", async ev => {
  ev.preventDefault();
  const a = $("pwNew").value, b = $("pwNew2").value;
  if (a.length < 8) return setMsg("pwMsg", "Mindestens 8 Zeichen.");
  if (a !== b) return setMsg("pwMsg", "Die beiden Passwörter stimmen nicht überein.");
  const { error } = await sb.auth.updateUser({ password: a });
  if (error) return setMsg("pwMsg", authError(error));
  setMsg("pwMsg", "Passwort geändert.", true);
  setTimeout(() => $("pwDlg").close(), 1200);
});

$("menuMembers").addEventListener("click", async () => {
  closeMenu();
  $("shareUrl").value = location.origin + location.pathname.replace(/index\.html$/, "");
  setMsg("memberMsg", ""); $("memberEmail").value = ""; $("memberAdmin").checked = false;
  $("membersDlg").showModal();
  await loadMembers();
});
async function loadMembers() {
  const ul = $("memberList"); ul.textContent = "";
  const { data, error } = await sb.from("members").select("email,is_admin,added_at").order("added_at");
  if (error) { setMsg("memberMsg", explainDb(error)); return; }
  (data || []).forEach(m => {
    const li = el("li");
    const em = el("span", "em", m.email);
    if (m.email === state.email) em.append(el("span", "you", " · du"));
    li.append(em);
    if (m.is_admin) li.append(el("span", "badge", "Verwalter"));
    if (m.email !== state.email) {
      const b = el("button", "btn", "Entfernen"); b.type = "button";
      let armed = false;
      b.addEventListener("click", async () => {
        if (!armed) { armed = true; b.textContent = "Wirklich?"; b.classList.add("danger"); return; }
        b.disabled = true;
        const { error: err } = await sb.from("members").delete().eq("email", m.email);
        if (err) { setMsg("memberMsg", explainDb(err)); b.disabled = false; return; }
        setMsg("memberMsg", m.email + " wurde entfernt. Die Fänge bleiben erhalten.", true);
        loadMembers();
      });
      li.append(b);
    }
    ul.append(li);
  });
}
$("memberAdd").addEventListener("submit", async ev => {
  ev.preventDefault();
  const email = $("memberEmail").value.trim().toLowerCase();
  if (!validEmail(email)) return setMsg("memberMsg", "Bitte eine gültige E-Mail-Adresse eingeben.");
  const { error } = await sb.from("members").insert({ email, is_admin: $("memberAdmin").checked });
  if (error) return setMsg("memberMsg", error.code === "23505" ? "Diese Adresse steht schon auf der Liste." : explainDb(error));
  $("memberEmail").value = ""; $("memberAdmin").checked = false;
  setMsg("memberMsg", email + " ist jetzt auf der Gästeliste.", true);
  loadMembers();
});
$("copyUrl").addEventListener("click", async () => {
  const inp = $("shareUrl");
  try { await navigator.clipboard.writeText(inp.value); $("copyUrl").textContent = "Kopiert"; }
  catch (e) { inp.select(); }
  setTimeout(() => { $("copyUrl").textContent = "Kopieren"; }, 1800);
});

/* ---------------------------------------------------------------- start */
(async function boot() {
  sb.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT" && state.session) { teardown(); setMode(false); show("authScreen"); }
    else if (session && (event === "TOKEN_REFRESHED" || event === "USER_UPDATED")) state.session = session;
  });
  let session = null;
  try { const r = await sb.auth.getSession(); session = r.data && r.data.session; } catch (e) { /* offline */ }
  if (session) { state.session = session; await enter(); }
  else { setMode(false); show("authScreen"); }
})();

})();
