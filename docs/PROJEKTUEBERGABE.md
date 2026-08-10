# TrinkDuell — Projektübergabe

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
- **Das Auto-Update auf dem Server macht keine DB-Migrationen** — Schema-
  Änderungen müssen manuell nachgezogen werden.

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

**Falle: Versionen dürfen nicht „neuer als das SDK" sein.** `npm install
babel-preset-expo` holt die neueste Version (57.x), SDK 55 braucht ~55.0.24 —
mit der falschen bricht Hermes mit „private properties are not supported" ab.
Immer `npx expo install <paket>` benutzen, nie `npm install`.

#### Was auf dem Gerät zu prüfen ist

Beides ist im Browser prinzipiell nicht testbar und daher noch nie gelaufen:

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
