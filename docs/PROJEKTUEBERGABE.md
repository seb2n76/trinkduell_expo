# TrinkDuell — Projektübergabe

> **Du willst wissen, was als Nächstes zu tun ist?**
> → [`NAECHSTE_SCHRITTE.md`](./NAECHSTE_SCHRITTE.md) ist die Arbeitsliste.
> Dieses Dokument hier erklärt das Projekt und die Fallen — lies es zuerst.

**Stand:** 08.08.2026 · letzter Commit `8c98931` · alles gepusht
**Repo:** https://github.com/seb2n76/trinkduell_expo (öffentlich)

Dieses Dokument ist so geschrieben, dass jemand ohne Vorwissen weiterarbeiten
kann. Es enthält bewusst auch die Fehler, die schon einmal passiert sind —
mehrere davon sind zweimal aufgetreten.

---

## 1. Was ist TrinkDuell?

Eine App, mit der man mit Freunden Getränke-Konsum spielerisch trackt:
Rangliste, Level/XP, Erfolge, Trinkspiele, Duelle, Feed, Karte.

Bewusst mit **verantwortungsvollem Rahmen** — nicht aus Prüderie, sondern weil
die App in den App/Play Store soll und dort sonst durchfällt: Alters-Gate 18+,
„Kater-Schutz" (Bonus-XP nach Wasser), Hydrations-Hinweise, und in allen
Spieltexten immer eine Wahl („oder trinke") statt Trinkzwang.

**Zielgruppe aktuell:** Beta mit Freunden des Betreibers.

---

## 2. Technik

| Bereich | Technologie |
|---|---|
| App | Expo SDK 55, React Native 0.83, TypeScript (strict), expo-router |
| Styling | NativeWind (Tailwind-Klassen) |
| Backend | Express (`server/index.js`, ~1900 Zeilen) |
| Datenbank | PostgreSQL — mit automatischem Fallback auf `server/db.json` |
| Auth | JWT (30 Tage), Passwörter bcrypt-gehasht |
| E-Mail | Resend (nur Passwort-Reset) |
| Karte | Leaflet + CARTO-„Dark Matter"-Kacheln (OSM-basiert, kein API-Key) |

**Wichtig:** `server/db.js` bedient **zwei** Datenbank-Modi. Jede Änderung an
Datenzugriffen muss in **beiden** Zweigen gemacht werden (`if (pool) {...}` für
Postgres, darunter der JSON-Zweig). Das wurde mehrfach übersehen.

### Infrastruktur

- **Backend:** Proxmox LXC-Container 103 („trinkDuell"), Docker Compose
  (`trinkduell-db` + `trinkduell-backend`), Code unter `/opt/trinkduell`
- **Öffentlich:** `https://api.trinkduell.com` via Cloudflare Tunnel
  (`trinkduell-lxctunnel`, als systemd-Dienst)
- **Web-App:** `https://webapp.trinkduell.com` auf Netlify, baut automatisch
  bei jedem Push auf `main`
- **Auto-Update:** stündlicher Cronjob auf dem Server (`git pull` + Rebuild)

Details in [`PROXMOX_DEPLOYMENT.md`](./PROXMOX_DEPLOYMENT.md) und
[`EMAIL_SETUP.md`](./EMAIL_SETUP.md).

> **Backend-Änderungen sind erst nach Server-Update live.** Netlify aktualisiert
> nur das Frontend. Wenn eine neue API-Route „nicht funktioniert", ist fast
> immer der Server noch alt.

---

## 3. Fallen, die schon zugeschlagen haben

Diese Liste ist der wichtigste Teil des Dokuments.

### 3.1 Express-Routen-Reihenfolge (zweimal passiert!)

`app.get("/api/users/:id")` fängt **alles** ab, was danach registriert wird —
`/api/users/me` und `/api/users/search` landeten so bei `:id = "me"` bzw.
`"search"` und lieferten 404. Die Suche war dadurch komplett tot.

**Regel:** Konkrete Pfade **immer vor** Parameter-Routen registrieren. In
`server/index.js` steht ein Kommentar an der Stelle — bitte dort lassen.

### 3.2 `Alert.alert` tut auf Web gar nichts

react-native-web ignoriert `Alert.alert` still. Dadurch war das Löschen von
Getränken im Browser komplett kaputt (Dialog erschien nie) und alle
Erfolgs-/Fehlermeldungen bei Freundschaftsanfragen unsichtbar.

**Regel:** Für Meldungen `notify()` benutzen (existiert in `(tabs)/_layout.tsx`
und `(tabs)/index.tsx`), für Rückfragen `Platform.OS === "web"` mit
`window.confirm` abfangen.

### 3.3 Offline-Fallbacks müssen dieselbe Filterung haben wie der Server

Der Feed zeigte Fremde an. Ursache war **nicht** der Server (der filterte
korrekt), sondern der Offline-Fallback im Client, der ungefiltert *alle* Logs
und Posts durchreichte. Derselbe Fehlertyp steckte in der Karte.

**Regel:** Jede serverseitige Sichtbarkeitsregel braucht ihr Gegenstück im
lokalen Fallback (`getFeedLocal`, `getMapCoordinatesLocal`,
`resolveFriendUserIdsLocal` in `mockData.ts`).

### 3.4 `config.ts` steht auf `production`

`ACTIVE_ENV` ist auf `"production"` — die App redet also mit dem **echten**
Server. Beim lokalen Testen auf `"local"` stellen und **vor dem Commit
zurücksetzen**. Einmal ist dadurch versehentlich ein Testaccount in der
Produktionsdatenbank gelandet.

### 3.5 Weitere

- **`server/db.json` ist gitignored** und enthält echte Nutzerdaten
  (E-Mails, Passwort-Hashes). Niemals committen.
- **Testdaten immer aufräumen.** Nach curl-/Browser-Tests die angelegten
  Nutzer wieder aus `db.json` entfernen.
- **Push & GPS funktionieren im Browser nicht** (native Module). Nur mit
  Dev-/EAS-Build testbar.
- **Avatar:** Ein leerer Wert in `PUT /api/users/:id` überschreibt das Bild
  **nicht** mehr (Schutz gegen Datenverlust). Es gibt bewusst keine
  „Avatar löschen"-Funktion.
- **Eine neue Umgebungsvariable braucht ZWEI Einträge.** Ein Wert in
  `server/.env` reicht nicht: Compose liest die Datei, gibt aber nur an den
  Container weiter, was im `environment:`-Block von
  `server/docker-compose.yml` explizit aufgelistet ist. Fehlt der Eintrag,
  sieht der Server die Variable nie — und das Symptom ist irreführend, weil
  der Wert auf dem Host ja korrekt gesetzt ist. Passiert mit den R2-Zugängen
  (17.08.2026). Also immer: `docker-compose.yml` **und**
  `server/.env.example`.

- **`server/docker-compose.yml` ist eine versionierte Repo-Datei.** Sie auf
  dem Server zu editieren bricht den stündlichen Auto-Update-Cronjob: `git
  pull` verweigert den Dienst, solange lokale Änderungen an einer getrackten
  Datei liegen. Änderungen daran gehören ins Repo, nicht auf den Server.

- **Schema-Änderungen: die Reihenfolge ist zwingend.** `schema.sql` läuft als
  **ein** Query und legt nur Tabellen an — `CREATE TABLE IF NOT EXISTS` fügt
  einer bestehenden Tabelle **keine** neuen Spalten hinzu. Neue Spalten
  gehören als `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` in `initPgSchema()`
  (`server/db.js`), und Indizes auf diesen Spalten **danach**.

  Wer einen solchen Index in `schema.sql` schreibt, baut eine Falle: er
  scheitert auf bestehenden Datenbanken, reißt als Teil desselben Querys alle
  folgenden Anweisungen mit — auch die `ALTER`-Zeilen — und damit entsteht die
  Spalte, die er braucht, nie. Genau so ist `drinks.ean` auf dem
  Produktionsserver gestrandet (17.08.2026). `tests/schema.test.js` prüft die
  Regel seitdem automatisch.

---

## 4. Was fertig ist

**Auth & Konto:** Registrierung/Login (bcrypt+JWT), Passwort-Reset per E-Mail
(Resend), Session überlebt Reload auch bei Serverausfall, Kontolöschung
in-app (Store-Pflicht), 18+-Alters-Gate, Datenschutz/AGB-Screens.

**Kern:** Getränke loggen (inkl. eigener Drinks), XP/Level mit
Level-Up-Aufgaben, Kater-Schutz (+25 % XP nach Wasser), 11 Erfolge,
Rangliste mit Zeitfiltern.

**Social:** Freundschaftsanfragen mit Live-Suche (Instagram-Stil),
Gruppen, Direkt- und Gruppenchat, **getrennte** Freunde-/Gruppen-Feeds,
Freunde-Radar (wer ist gerade aktiv), Push-Notifications (Backend fertig).

**Karte:** OpenStreetMap/Leaflet, Standort optional in drei Modi
(automatisch / nur Check-in / aus, Standard **aus**), sichtbar nur für
Freunde + Gruppenmitglieder.

**Spiele (8):** 1v1-Duell, Höher/Tiefer, Skull, Wahrheit/Pflicht,
Ich hab noch nie, Wer würde eher, Wortbombe, Busfahrer.

---

## 5. Was offen ist

### Klein (je ~15–30 Min)
1. **Check-in-Button fehlt.** Der Standort-Modus „Nur bei Check-in" existiert,
   hat aber keinen Auslöser und verhält sich dadurch wie „Aus".
2. **Alte Stockfoto-Avatare in der DB.** Bestehende Accounts haben noch die
   alte Unsplash-URL. Ein kleines Skript, das diese auf leer setzt, würde
   überall die neuen Initialen-Avatare aktivieren.

### Mittel
3. **EAS-Build.** Push-Notifications und GPS sind gebaut und backend-seitig
   geprüft, aber **nie auf einem echten Gerät gelaufen**. Größte offene
   Unsicherheit.
4. **Datenschutz/AGB finalisieren.** Platzhalter (`[Name/Adresse]` etc.)
   ausfüllen, öffentlich hosten (Store-Pflicht, in-app reicht nicht) und
   anwaltlich prüfen lassen. Beides sind ausdrücklich **Entwürfe**.

### Groß
5. **Barcode-Scanner** (bewusst zurückgestellt). Achtung: Open Food Facts
   pflegt den **Alkoholgehalt** nur lückenhaft — genau das Feld, das
   TrinkDuell braucht. Vorher recherchieren.
6. **Keine Tests, keine CI.** Alles wird manuell verifiziert.

### Kleinkram
- `/opt/trinkduell_old_2026-08-05` auf dem Server kann weg
- `PayloadTooLargeError` tauchte mal in alten Logs auf, nie untersucht
  (vermutlich große Avatar-Uploads)

---

## 6. Arbeitsweise, die sich bewährt hat

- **Verifizieren statt behaupten.** Fast jeder Bug dieser Session wurde erst
  beim tatsächlichen Ausprobieren sichtbar — nicht beim Lesen des Codes.
  Backend mit `curl` gegen einen lokal gestarteten Server, Frontend im
  Browser mit Screenshots.
- **Ursache suchen, nicht Symptom.** „Feed zeigt Fremde" war nicht der
  Feed-Filter, sondern der Offline-Fallback. „Suche geht nicht" war die
  Routen-Reihenfolge.
- **Nach jeder Änderung:** `npm test`, `npx tsc --noEmit` und
  `npx eslint src/ server/ tests/`. Ziel ist 0 Fehler (Warnungen aus
  Altbestand sind bekannt und ok).
- **Deutsche UI-Texte**, englische Code-Kommentare.
- **Bei Sicherheits-/Datenschutzentscheidungen nachfragen** statt annehmen.

### Tests

```bash
npm test          # 75 Tests, ca. 25 Sekunden
```

`node --test` startet für jede Testdatei den **echten** Server in einem
eigenen Prozess — gegen eine Wegwerf-Datenbank in `os.tmpdir()`, die danach
gelöscht wird. `server/db.json` wird dabei nie angefasst (siehe
`TRINKDUELL_DB_FILE` in `server/db.js`). Keine zusätzliche Abhängigkeit,
alles über Node's eingebauten Test-Runner.

| Datei | Inhalt |
|---|---|
| `tests/auth.test.js` | Passwort-Reset, Rate-Limiting, Session-Invalidierung |
| `tests/authorization.test.js` | Wer darf was sehen und ändern |
| `tests/validation.test.js` | Eingabegrenzen, Body-Größe, CORS, Fehlerform |

**Warum die Tests so aussehen, wie sie aussehen:**

- Jeder Test prüft **beide Richtungen**. „Der Fremde wird abgewiesen" allein
  würde auch dann bestehen, wenn die Funktion für alle kaputt wäre.
- Der Testhelfer registriert jeden Nutzer von einer **eigenen simulierten IP**
  (`X-Forwarded-For`). Ohne das blockt das Anmelde-Limit die Suite selbst —
  der Limit für Tests zu lockern hieße, ein anderes Limit zu testen als das,
  das produktiv läuft.
- Die Suite wurde gegen absichtlich wieder eingebaute Lücken geprüft
  (E-Mail-Leak, `/friends/accept` ohne Empfängerprüfung, GPS in `/api/logs`).
  Alle drei wurden gefangen. Wer hier etwas ändert, sollte das wiederholen:
  ein Test, der nicht fehlschlagen kann, schützt nichts.

### Web-Bundle: gemessene Zahlen

Bevor jemand hier optimiert — die Ausgangslage, gemessen am 10.08.2026:

| | |
|---|---|
| Entry-Bundle roh | 2,64 MB (minifiziert, `__DEV__=false`) |
| **gzip** | **694 KB** |
| **brotli** | **540 KB** ← das geht tatsächlich über die Leitung, Netlify komprimiert automatisch |

**Das Gewicht liegt im Framework, nicht in den Screens.** Eine Analyse des
Bundles zeigt `react-native-reanimated`/`worklets` als mit Abstand größten
Posten (allein 30 KB an Fehlertexten), gefolgt von react-navigation und
expo-router. Reanimated ist auch nicht entbehrlich — Scoreboard,
`AchievementModal` und `FloatingPoints` benutzen es direkt.

Konsequenz: **Code-Splitting einzelner Komponenten bringt hier fast nichts.**
`InteractiveMap` wurde per `React.lazy` in einen eigenen Chunk gelegt (korrekt
und behalten), das Hauptbundle schrumpfte dadurch um 3,7 KB von 2704 KB.
`experiments.asyncRoutes` bewirkt im statischen Export gar nichts — getestet,
Bundle unverändert.

Der wirksame Hebel für „lädt beim zweiten Mal sofort" ist **Caching per
Service Worker**, nicht Splitting — und der ist inzwischen umgesetzt (siehe
unten).

### Web-Hosting (Netlify und Cloudflare Pages)

Beide Hosts lesen dasselbe Konfigurationsformat, deshalb liegt es **einmal** in
`public/` und wird von `expo export` nach `dist/` kopiert:

| Datei | Zweck |
|---|---|
| `public/_headers` | `sw.js` nie cachen, gehashte Assets ewig, Basis-Header |
| `public/_redirects` | Fallback auf `index.html` für unbekannte Pfade |

`expo export --platform web` erzeugt **echte HTML-Dateien pro Route**
(`feed.html`, `login.html`, …), Deep Links funktionieren also ohne
Zusatzregel. Der Fallback greift nur für Pfade, zu denen keine Datei gehört.

**Neue Domain → CORS anpassen.** Das ist der Schritt, der beim Umzug vergessen
wird: eine neue Hosting-Domain wird von der API abgewiesen, bis ihre Origin in
der Allow-List steht. Zwei Stellen:

1. `DEFAULT_ALLOWED_ORIGINS` in `server/index.js` (für frische Klone)
2. `ALLOWED_ORIGINS` in `server/.env` auf dem Server — **ersetzt** die
   Standardliste, ergänzt sie nicht. Alle Domains müssen also aufgezählt
   werden.

Aktuell live: `webapp.trinkduell.com` (Netlify) und `cloud.trinkduell.com`
(Cloudflare Pages).

Ohne `Content-Security-Policy` in `_headers`, bewusst: react-native-web
erzeugt Inline-Styles, die Karte läuft in einem srcDoc-iframe und lädt Leaflet
von einem CDN. Eine CSP müsste all das erfassen und würde bei einem Fehler die
App lahmlegen — das gehört einzeln gemessen, nicht blind gesetzt. Ebenso keine
`Permissions-Policy`: Kamera und Standort brauchen die Erlaubnis.

### PWA / Service Worker

`public/` wird von Expo unverändert nach `dist/` kopiert. Dort liegen:

| Datei | Zweck |
|---|---|
| `public/sw.js` | Service Worker mit drei Cache-Strategien |
| `public/manifest.json` | Installierbarkeit, Name, Farben |
| `public/icon-192.png`, `icon-512.png` | Aus `assets/images/icon.png` erzeugt |
| `src/services/pwa.ts` | Registrierung + Manifest-Link zur Laufzeit |

Die drei Strategien sind bewusst verschieden, weil die Inhalte
unterschiedlich altern:

1. **Gehashte Build-Assets** (`/_expo/static/...`) — cache-first, für immer.
   Der Dateiname enthält den Inhalts-Hash, die Datei kann nie veralten.
2. **Navigationen (HTML)** — network-first mit Cache-Fallback. Andersherum
   käme ein Deploy erst nach einem Neustart an, und niemand würde es merken.
3. **Sonstiges gleicher Herkunft** — stale-while-revalidate.

**Die API wird nie gecacht.** Ein zwischengespeicherter Punktestand wäre
schlimmer als gar keiner, und die App hat mit `executeApiCall` bereits eine
eigene Offline-Logik, die nicht durch heimlich alte Antworten unterlaufen
werden darf.

Nachgemessen mit abgeschaltetem Webserver: die App startet vollständig,
**0 Bytes übertragen** bei 2737 KB Assets, 0 API-Antworten im Cache.

> **Falle:** Die Registrierung darf sich nicht nur an `window.onload`
> hängen. `setupPwa()` läuft aus einem `useEffect` und damit fast immer
> *nach* `load` — das Event feuert dann nie wieder und der Service Worker
> wäre nie registriert. Deshalb der `document.readyState`-Zweig.

> **Beim Ändern von `sw.js`** die `VERSION`-Konstante hochzählen. Alte Caches
> werden nur bei einer neuen Version aufgeräumt.

### Bild-Uploads (Cloudflare R2)

Bilder gehen nicht mehr durch den Node-Server. Der signiert nur eine
kurzlebige URL, der Client lädt direkt zu R2 (`cdn.trinkduell.com`).
Zugangsdaten in `server/.env` (siehe `.env.example`); **ohne** sie läuft alles
weiter wie vorher, nur ohne Uploads — `GET /api/uploads/config` sagt dem
Client, ob er den Button anbieten soll.

| Datei | Inhalt |
|---|---|
| `server/storage.js` | Signieren, Besitzprüfung, Löschen |
| `src/services/upload.ts` | Verkleinern, neu kodieren, direkt hochladen |

**Drei Dinge, die nicht wegoptimiert werden dürfen:**

1. **`content-type` UND `content-length` müssen signiert sein**
   (`signableHeaders`). Ohne `content-type` signiert das SDK nur
   `content-length;host` — dann lässt sich über eine für JPEG ausgestellte URL
   `text/html` hochladen, und man liefert HTML von `cdn.trinkduell.com` aus.
   Das ist ein Stored-XSS auf der eigenen Domain.
2. **`requestChecksumCalculation: "WHEN_REQUIRED"`.** Neuere AWS-SDKs hängen
   automatisch eine CRC32-Summe an. Beim Signieren kennt das SDK die Bytes
   nicht und berechnet die Summe des *leeren* Payloads
   (`x-amz-checksum-crc32=AAAAAA==`); der echte Upload passt dann nicht dazu
   und R2 lehnt ab. Dieser Fehler wäre nur gegen echtes R2 aufgefallen.
3. **Besitzprüfung beim Eintragen der URL** (`isOwnStorageUrl`). Signieren und
   Eintragen sind zwei Requests — ohne die Prüfung könnte man im zweiten eine
   fremde oder beliebige externe URL unterschieben und hätte ein fremdes Bild
   im Profil oder einen Tracking-Pixel im Feed aller Freunde. Der Schlüssel
   trägt deshalb die Nutzer-ID: `proof/<userId>/<32 Hex>.jpg`.

**Bestandsavatare migrieren.** Profilbilder aus der Zeit vor R2 liegen als
Base64 in der Nutzertabelle und werden dadurch in **jeder** Antwort
mitgeschleppt, die Nutzer enthält — Nutzerliste, Suche, Freundesliste,
Rangliste. Einmalig verschieben:

```bash
docker compose -f server/docker-compose.yml exec backend node server/migrate-avatars.js --dry-run
docker compose -f server/docker-compose.yml exec backend node server/migrate-avatars.js
```

Wiederholbar: bereits migrierte Nutzer werden übersprungen, ein Abbruch
mitten drin ist unproblematisch. Das Skript verkleinert die Bilder nicht — das
passiert im Client, und eine Bildbibliothek auf dem Server gibt es bewusst
nicht.

**Beim Bildwechsel wird das alte Objekt gelöscht** (`releaseReplacedAvatar`),
sonst bleibt bei jedem Wechsel eine Datei im Bucket liegen, auf die nichts
mehr zeigt. Ohne `await` und mit verschlucktem Fehler: ein misslungenes
Aufräumen darf den Bildwechsel nicht scheitern lassen.

**EXIF/GPS werden clientseitig entfernt, nicht serverseitig.** Bei einem
Direkt-Upload sieht der Server die Bytes nie. Das Neukodieren in
`src/services/upload.ts` (Canvas im Web, ImageManipulator nativ) schreibt ein
frisches Bild ohne Metadaten — die Koordinaten verlassen das Gerät also gar
nicht, was besser ist als serverseitiges Nachbessern. Der Preis: es ist nicht
erzwingbar. Wer den Client manipuliert, gibt seinen eigenen Standort preis.

### EAS-Build und Hardware-Test

```bash
npx eas-cli build --platform android --profile preview
```

Das `preview`-Profil erzeugt ein **APK zur Direktinstallation** — kein Play
Store, kein Apple-Account nötig. Genau das Richtige, um Push und GPS erstmals
auf echter Hardware zu prüfen.

> **EAS baut den committeten Stand.** Uncommittete Änderungen landen nicht im
> Build. Ein Build, der „die letzte Änderung nicht enthält", ist fast immer
> das — der Commit-Hash steht in `eas build:view <id>`.

Vor jedem Build lohnt sich `npx expo-doctor` (Ziel: 19/19). Und
`npx expo export --platform android` kompiliert lokal dasselbe
Hermes-Bundle, das EAS baut — schlägt das fehl, schlägt auch der Build fehl,
nur 15 Minuten früher sichtbar.

**Barcode-Scanner und Autofokus.** Zwei Fallen stecken in `expo-camera`:

- Die Prop `autofocus` ist **iOS-only** und heißt das Gegenteil von dem, was
  man erwartet: `"on"` fokussiert **einmal und sperrt dann**, `"off"`
  fokussiert laufend nach. Für einen Scanner braucht man `"off"` — die Prop
  also bitte nicht „reparieren".
- Auf Android startet die Kamera erst, wenn das Modal-Fenster steht
  (`onShow`). Ein RN-Modal ist dort ein eigenes Fenster; startet die
  CameraX-Vorschau vor dessen Layout, bekommt sie keine brauchbaren Maße und
  fokussiert nicht mehr richtig.

Dazu Licht- und Zoom-Schalter im Sucher: zu dunkel und „Code zu klein im
Bild" sind die häufigsten Gründe, warum der Fokus nicht greift.

**Falle: Versionen dürfen nicht „neuer als das SDK" sein.** `npm install
babel-preset-expo` holt die neueste Version (57.x), SDK 55 braucht ~55.0.24 —
mit der falschen bricht Hermes mit „private properties are not supported" ab.
Immer `npx expo install <paket>` benutzen, nie `npm install`.

#### Was auf dem Gerät zu prüfen ist

Beides ist im Browser prinzipiell nicht testbar und daher noch nie gelaufen:

> **Push ist inzwischen testbar.** `EXPO_PUSH_URL` lässt sich überschreiben,
> `tests/push.test.js` fängt den Versand mit einem lokalen Server ab und prüft,
> **wer** benachrichtigt wird. Was Tests nicht abdecken können, ist die
> Zustellung auf ein echtes Gerät — dafür braucht es FCM und Hardware.

1. **Push.** Nach dem Login mit einem zweiten Account eine
   Freundschaftsanfrage schicken. Kommt keine Benachrichtigung an, im
   Backend-Log nachsehen: `[Push] Delivery error` deutet auf fehlende
   **FCM-Credentials** im Expo-Projekt hin (Android-Push braucht einen
   FCM-V1-Service-Account-Key, hochzuladen über `eas credentials`). Der Code
   fängt den Fehler bewusst ab, damit ein fehlgeschlagener Push nie die
   auslösende Aktion kaputtmacht — er ist deshalb in der App **unsichtbar**
   und nur im Log zu sehen.
2. **GPS.** Standort in den Einstellungen auf „automatisch" stellen, Getränk
   loggen, Karte öffnen. Der Pin darf nur für Freunde und Gruppenmitglieder
   sichtbar sein — mit einem zweiten Account gegenprüfen.
3. **Profilbild.** Nativ wird das Bild unskaliert als Base64 hochgeladen. Bei
   einem großen Foto ist `413` die erwartete Antwort — das ist der Grund, das
   Bild clientseitig zu verkleinern (offener Punkt).

### Lokal testen

```bash
node server/index.js          # Backend auf :5000 (nutzt db.json)
npx expo start --web          # App auf :8081
```

Dabei `ACTIVE_ENV` in `src/services/config.ts` auf `"local"` stellen — und
**vor dem Commit zurück auf `"production"`**.

---

## 7. Nützliche Dateien

| Datei | Inhalt |
|---|---|
| `server/index.js` | Alle API-Routen |
| `server/db.js` | Datenzugriff, **beide** DB-Modi |
| `tests/helpers/server.js` | Startet den echten Server für die Tests |
| `src/services/api.ts` | API-Client, Circuit Breaker, Offline-Fallbacks |
| `src/services/mockData.ts` | Lokale DB + Typen (`User`, `FeedItem`, …) |
| `src/services/config.ts` | `ACTIVE_ENV`, API-URLs |
| `src/services/location.ts` | Standort-Modi |
| `src/games/content.ts` | Alle Spieltexte (Fragen/Kategorien) |
| `src/app/(tabs)/games.tsx` | Spiele-Übersicht + `GAME_CATALOG` |
| `docs/PROXMOX_DEPLOYMENT.md` | Server-Setup |
| `docs/EMAIL_SETUP.md` | Resend-Konfiguration |

**Neues Spiel hinzufügen:** Eintrag in `GAME_CATALOG` (`games.tsx`),
Komponente unter `src/components/games/` mit `GameShell`, Texte in
`games/content.ts`, ID in `LobbyGameId` ergänzen, Modal unten in `games.tsx`
einhängen.

---

## 8. Sicherheitshistorie (Kontext)

Das Repo ist **öffentlich**. Anfangs lagen darin `server/db.json` (echte
E-Mail + Passwort-Hash) und ein Klartext-Postgres-Passwort. Die Git-Historie
wurde bereinigt und force-gepusht, das DB-Passwort rotiert. Secrets liegen
jetzt ausschließlich in `server/.env` (gitignored).

Weitere in dieser Session gefundene und behobene Probleme: Passwort-Hash in
API-Antworten, Standorte aller Nutzer über `/api/map` einsehbar, jeder konnte
fremde Getränke-Logs löschen, XSS über Nutzernamen in Karten-Popups.

**Merke:** Bei neuen Endpunkten immer prüfen — *wer darf das sehen* und
*wer darf das ändern*. Beides wurde mehrfach vergessen.

### Runde 2 (10.08.2026) — behoben

Auffällig ist das Muster: **jeder dieser Punkte saß direkt neben einer schon
reparierten Stelle.** Die Regel oben wurde also pro Endpunkt angewendet statt
pro Datenart.

- **Account-Übernahme über den Reset-Flow.** Der Code stand in der HTTP-Antwort,
  war 4-stellig, kam aus `Math.random` und hatte weder Versuchszähler noch
  Rate-Limit. Jetzt: 6-stellig aus `crypto.randomInt`, nie in der Antwort
  (ohne E-Mail-Versand landet er im Server-Log), nach 5 Fehlversuchen gesperrt.
- **`GET /api/logs` lieferte die GPS-Koordinaten aller Nutzer** — der Fix an
  `/api/map` war dadurch wirkungslos. Koordinaten werden dort jetzt entfernt;
  die Logs selbst bleiben (das Scoreboard rechnet damit).
- **`POST /api/friends/accept` prüfte den Empfänger nicht.** Man konnte sich
  selbst eine Anfrage schicken und im Namen des Opfers annehmen — und hatte
  damit Feed, Radar und Karte. Absender und Empfänger kommen jetzt aus dem
  Token, nie aus dem Body.
- **Gruppen-Chats waren ohne Mitgliedschaft lesbar.** Lesen und Schreiben
  prüfen jetzt Mitgliedschaft, Direktnachrichten setzen Freundschaft voraus.
- **Kein Rate-Limiting.** Jetzt zweidimensional: locker pro IP (eine WG oder
  Bar teilt sich eine IP — ein strenges IP-Limit hätte die ganze Party
  ausgesperrt), streng pro Account.
- **Passwortänderung beendete alte Sessions nicht.** Neu: `session_valid_after`
  auf dem Nutzer, ältere JWTs werden abgelehnt.
- **Client-Fallback hebelte Serverregeln aus.** `executeApiCall` fiel bei
  *jedem* Fehler auf die lokale Mock-DB zurück, auch bei 401/403/429 — ein
  falsches Passwort wurde so zum stillen Offline-Login. Es wird jetzt nur noch
  bei echten Netzwerkfehlern zurückgefallen; bei 401 wird die Session
  verworfen und zum Login geleitet.

### Runde 2b — Autorisierungsschicht

Statt weiter Endpunkt für Endpunkt zu flicken, gehen die Entscheidungen jetzt
durch gemeinsame Helfer in `server/index.js`: `enrichUserProgress` (die
**einzige** Stelle, an der ein Nutzerdatensatz zur API-Antwort wird),
`areFriends` und `getGroupIfMember`. Danach wurden alle Routen einmal
durchgegangen.

- **`enrichUserProgress` ist secure by default:** `email` kommt nur raus, wenn
  der Aufrufer sie explizit anfordert, und das darf nur beim eigenen Profil
  passieren (`enrichOwnProfile`). Vorher lieferte `/api/users` die
  E-Mail-Adressen der gesamten Beta an jeden Account.
- Die Nutzersuche matcht nur noch **Usernames**. Über E-Mail zu suchen machte
  sie zum Auskunftsdienst („hat diese Adresse ein Konto, und wie heißt sie?").
- **Gefiltert statt global:** `/api/groups` (nur meine), `/api/events` (nur
  meine — jedes Event enthält seinen Invite-Code), `/api/duels` (nur meine —
  behebt nebenbei fremde Duelle in der Spieleliste), `/api/posts` und
  `/api/quests` (nur meine Kontexte), `/api/friends/:username` (nur die eigene
  Liste).
- **Schreibrechte:** Posts und Quests nur im eigenen Kontext.
- **`DELETE /api/drinks/:id`** war die zerstörerischste offene Route: Löschen
  kaskadiert auf *alle* Logs mit diesem Getränk. Getränke haben jetzt
  `created_by` (Standard-Katalog = NULL = unlöschbar), nur der Ersteller darf
  löschen, und bei fremden Logs wird mit 409 abgelehnt.

### Runde 2c — Härtung

- **CORS** ist jetzt eine Allow-List (`ALLOWED_ORIGINS` per Env, sonst
  `webapp.trinkduell.com` + localhost). Requests **ohne** Origin bleiben
  erlaubt — die native App sendet keinen, und CORS bindet Nicht-Browser
  ohnehin nicht.
- **JWT_SECRET:** Der Server **startet nicht mehr**, wenn `DATABASE_URL`
  gesetzt ist und der eingebaute Entwicklungs-Schlüssel greifen würde oder das
  Secret unter 32 Zeichen hat. Der Fallback steht im öffentlichen Repo.
- **Body-Limits:** 256 kB global statt 10 MB überall. Die 8 MB gelten nur noch
  für `POST /users/:id/avatar` und `PUT /users/:id` — die einzigen Routen, die
  ein Bild tragen. Das Rate-Limit läuft **vor** dem Body-Parsing.
- **Validierung** für Username (3–24, Zeichensatz), E-Mail, Passwort (min. 8,
  auch im Client), Nachrichten, Beiträge, Gruppen-/Event-/Quest-Namen,
  Getränkewerte, Quest-Typen und Event-Dauer. Zahlenprüfungen waren vorher
  nur nach oben begrenzt — negative Werte und `NaN` gingen durch.
- **Avatare** müssen ein `data:image/...`-Base64-URL sein; Multipart-Uploads
  werden auf Bild-MIME-Typen gefiltert. Vorher wurde jeder String gespeichert
  und später als Bildquelle wieder ausgegeben.
- **Zeitstempel und Koordinaten** beim Loggen werden auf plausible Bereiche
  geprüft (vorher konnte ein Log auf das Jahr 2099 datiert werden).
- **Fehlermeldungen:** kein `err.message` mehr nach außen (24 Stellen). Ein
  zentraler Error-Handler liefert sauberes JSON für kaputtes JSON (400), zu
  große Bodies (413 — das ist der alte `PayloadTooLargeError`) und abgelehnte
  Origins (403) statt Express' HTML-Seite mit Stacktrace.
- **Invite-Codes** kommen aus `crypto` statt `Math.random`.

Dabei aufgefallen und mitbehoben:

- **Umbenennen zerstörte Freundschaften.** Friendships referenzieren Nutzer
  über den Namen, ohne FK — nach einem Rename passten die Zeilen zu niemandem
  mehr. Neu: `db.renameUserInFriendships` (beide DB-Modi). Ein fehlgeschlagenes
  Umbenennen wird jetzt auch angezeigt statt nur in die Konsole geloggt.
- **Status-Posts** liefen gegen die feste Gruppen-ID `"group-1"`, in der
  niemand Mitglied ist. Es gibt jetzt `contextType: "friends"` (contextId =
  eigene User-ID). Sichtbarkeit bleibt exakt wie vorher.

**Noch offen:** Avatare werden nativ ungefähr in Originalgröße hochgeladen
(`quality: 0.8`, keine Skalierung) und als Base64 in der DB abgelegt — dadurch
hängen sie in jeder Nutzerliste mit drin. Eine clientseitige Skalierung wie im
Web-Pfad (dort 120×120) würde Traffic und DB-Größe deutlich senken.
