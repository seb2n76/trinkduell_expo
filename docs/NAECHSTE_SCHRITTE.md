# TrinkDuell — Aufgaben für die nächste Session

**Stand:** 17.08.2026 · Commit `8e28451` · alles gepusht · 147 Tests grün

Dieses Dokument ist die Arbeitsliste. Der Projektkontext steht in
[`PROJEKTUEBERGABE.md`](./PROJEKTUEBERGABE.md) — **lies die zuerst**, besonders
Abschnitt 3 („Fallen, die schon zugeschlagen haben") und die Sicherheits-
historie. Mehrere dort beschriebene Fehler sind zweimal passiert.

---

## 0. Vor der ersten Zeile Code

```bash
npm test                              # 147 Tests, ca. 30 s
npx tsc --noEmit                      # muss 0 Fehler zeigen
npx eslint src/ server/ tests/        # muss 0 Fehler zeigen (Warnungen sind Altbestand)
npx expo-doctor                       # muss 20/20 zeigen
```

Läuft davon etwas nicht durch, ist das **vor** jeder neuen Arbeit zu klären.
Der Zustand war beim Schreiben dieses Dokuments sauber.

### Regeln, die nicht verhandelbar sind

1. **`server/db.json` niemals anfassen.** Enthält echte Nutzerdaten
   (E-Mails, Passwort-Hashes), ist gitignored. Tests benutzen
   `TRINKDUELL_DB_FILE` mit einer Wegwerf-Datenbank.
2. **`ACTIVE_ENV` in `src/services/config.ts` steht auf `"production"`.** Zum
   lokalen Testen auf `"local"` stellen und **vor dem Commit zurücksetzen**.
   Ein `git status` vor jedem Commit fängt das.
3. **Jede Datenänderung in BEIDE DB-Modi** (`if (pool) {...}` für Postgres,
   darunter der JSON-Zweig). Zuletzt vergessen bei `posts.image` — der
   JSON-Modus behielt das Feld, Postgres verwarf es stillschweigend.
4. **Neue Spalte = `ALTER TABLE` in `initPgSchema()`**, und Indizes darauf
   **danach**, nie in `schema.sql`. `tests/schema.test.js` prüft die Regel.
5. **Neue Umgebungsvariable = zwei Einträge:** `server/docker-compose.yml`
   (`environment:`) **und** `server/.env.example`.
6. **Nichts auf dem Server editieren, was im Repo liegt.** Bricht den
   stündlichen Auto-Update-Cronjob.
7. **Verifizieren statt behaupten.** Fast jeder Fehler dieser Sessions wurde
   beim Ausprobieren sichtbar, nicht beim Lesen. Backend mit einem isolierten
   Testserver, Frontend im Browser.
8. **Teste deine Tests.** Baue die Lücke absichtlich wieder ein und sieh nach,
   ob der Test fehlschlägt. Mehrfach hat das gezeigt, dass ein Test nichts
   prüfte.
9. **Deutsche UI-Texte, englische oder deutsche Code-Kommentare** (beides
   kommt vor, bleib bei der Datei konsistent).

---

## 1. Aufgaben, die der Agent allein erledigen kann

Nach Priorität. Die ersten drei sind klein und schließen echte Lücken.

### ~~1.1 Beitrag löschen~~ — **erledigt** (Commit nach `152e822`)

`DELETE /api/posts/:id`, Papierkorb-Symbol an eigenen Beiträgen im Feed,
Bild wird aus R2 mitgelöscht. Systembeiträge (Level-Ups) gehören niemandem
und sind nicht löschbar. Eine bestehende Meldung überlebt das Löschen, weil
sie einen eigenen Textauszug speichert.

### ~~1.1b Persönliche Schnellwahl~~ — **erledigt** (Commit nach `152e822`)

Der Katalog ist geteilt, die Kachelauswahl nicht mehr. Neu: `user_drinks`,
`GET/PUT /api/users/me/drinks`, Auswahl-Dialog mit Suche, Bearbeiten-Modus
mit Reihenfolge. Frei angelegte Getränke sieht nur ihr Urheber, gescannte
bleiben geteilt (Community-Datenbank). **Auf dem Server einmalig
`node server/migrate-quickpicks.js` laufen lassen** — siehe Abschnitt 2.

### ~~1.2 Passwort ändern im eingeloggten Zustand~~ — **erledigt** (Commit nach `32a5cf6`)

`POST /api/auth/change-password` mit dem alten Passwort als Nachweis. Die
Änderung beendet alle anderen Sitzungen und gibt einen frischen Token zurück,
damit die eigene weiterläuft; ein offener Reset-Code verfällt mit. Eintrag im
Drawer über „Abmelden“. 13 Tests in `tests/changepassword.test.js`.

### 1.2b Async-Routen ohne try/catch können den Server beenden — **hoch**

Beim Testen der Passwort-Änderung ist der Backend-Prozess an einer ganz
anderen Stelle komplett abgestürzt (`GET /api/logs`, `logs.map` auf
`undefined`). Ursache ist nicht diese eine Zeile, sondern die Bauart:

- Express **4** (4.22.2) leitet eine abgelehnte Promise aus einem
  `async`-Handler **nicht** an die Fehler-Middleware weiter. Sie wird zur
  `unhandledRejection`, und die beendet den Node-Prozess.
- Es gibt kein `process.on("unhandledRejection")`-Auffangnetz.
- Von 58 Routen haben 35 ein `try/catch`. Die übrigen 23 sind jeweils ein
  Weg, das gesamte Backend für alle Nutzer abzuschießen.

Der Absturz oben kam aus einer selbst gebauten Test-Datenbank, war also
nicht produktionsnah — die **Bauart** dahinter schon.

Zu tun (in dieser Reihenfolge, jeder Schritt wirkt für sich):

1. Die 23 Routen ohne `try/catch` nachziehen, Muster wie gehabt:
   `catch (err) { serverError(res, err, `${req.method} ${req.originalUrl}`); }`
2. Besser als 23 Einzelfälle: ein `asyncHandler(fn)`-Wrapper, der
   `Promise.resolve(fn(req,res,next)).catch(next)` macht, und alle Routen
   darauf umstellen. Dann kann die Lücke nicht wiederkommen.
3. Zusätzlich `process.on("unhandledRejection", ...)` mit Logging als
   letztes Netz — protokollieren statt sterben.
4. Alternativ Express 5 (fängt async-Fehler von sich aus). Größerer
   Eingriff, eigene Session wert.

### 1.3 Gruppenmitglieder verwalten — **hoch**

Die Gruppenliste zeigt seit `a7f12b6` die Mitgliederzahl, aber man kann
niemanden hinzufügen, entfernen oder die Gruppe verlassen. Eine Gruppe, die
man nicht verlassen kann, ist ein Problem — besonders zusammen mit der
Blockierfunktion.

- `POST /api/groups/:id/members` (Admin fügt hinzu),
  `DELETE /api/groups/:id/members/:userId` (Admin entfernt; jeder darf sich
  selbst entfernen = verlassen)
- Admin kann die Gruppe nicht verlassen, ohne sie aufzulösen oder die
  Adminrolle zu übergeben — Verhalten bewusst festlegen und dokumentieren
- UI: in der Gruppenliste im Freunde-Modal (`src/app/(tabs)/_layout.tsx`)

### 1.4 Ungelesen-Markierung im Chat — **mittel**

Seit `7841c4d` gibt es Push für Nachrichten. Man wird also benachrichtigt,
sieht in der App aber nirgends, **wo** etwas Neues ist. Das fällt jetzt auf.

- Einfachste tragfähige Lösung: `last_read_at` pro Nutzer und Unterhaltung
- Badge an Freund/Gruppe in der Liste, Zähler im Drawer-Icon
- Achtung: `messages` hat noch keinen Index auf `(receiver_id, timestamp)`

### 1.5 Gruppenbeitritt — **mittel, braucht eine Entscheidung**

`joinGroup` existiert im Client, wird von keinem Screen benutzt. Der Admin
sieht Beitrittsanfragen in `notifications.tsx` — nur kann niemand eine
stellen. Seit der Autorisierungsrunde liefert `/api/groups` außerdem nur noch
eigene Gruppen, fremde sind also auch nicht auffindbar.

**Offene Entscheidung des Betreibers:** Einladungscode (wie bei Events,
privatsphärenfreundlich) oder öffentliche Gruppenliste. Ohne Antwort:
Einladungscode bauen, das passt zum Rest.

### 1.6 Events und Gruppen-Quests erreichbar machen — **mittel**

Beide Backends sind **vollständig** inklusive Invite-Codes, Mitgliedschaft,
Fortschrittsberechnung und Erfolgs-Post im Feed. Kein Screen ruft sie auf:
`getEvents`, `createEvent`, `joinEventWithCode`, `getGroupQuests`,
`createGroupQuest`. Viel fertige Substanz für vergleichsweise wenig
UI-Arbeit — aber für eine Freundes-Beta verzichtbar, deshalb nicht oben.

### 1.7 Moderations-Ansicht für Meldungen — **mittel**

Meldungen landen in der Tabelle `reports` und im Server-Log
(`docker compose logs backend | grep MELDUNG`). Es gibt **keine** Route, sie
auszulesen. Die Stores erwarten Reaktion binnen 24 Stunden; Log-Grepping
skaliert nicht.

- Entweder ein CLI-Skript (Muster: `server/migrate-avatars.js`)
- Oder `GET /api/reports` mit einer Admin-Prüfung — **es gibt bisher kein
  Rollenkonzept**, das müsste erst entstehen (einfachster Weg: eine
  `ADMIN_USER_IDS`-Umgebungsvariable)
- Offene Entscheidung des Betreibers: sollen Meldungen zusätzlich per E-Mail
  kommen? Resend ist eingerichtet, das wären wenige Zeilen in `server/email.js`

### 1.8 Verwaiste R2-Objekte aufräumen — **niedrig**

Wer eine Upload-URL signieren lässt und dann abbricht, hinterlässt ein Objekt,
auf das nichts zeigt. Entweder eine R2-Lebenszyklus-Regel im Cloudflare-
Dashboard (einfachster Weg) oder ein Aufräum-Skript, das `proof/`-Objekte ohne
Beitrag löscht.

### 1.9 Check-in-Auslöser — **niedrig**

Der Standort-Modus „Nur bei Check-in" existiert in
`src/services/location.ts`, hat aber keinen Auslöser und verhält sich dadurch
wie „Aus". Entweder einen Check-in-Knopf bauen oder den Modus entfernen —
aktuell verspricht die Einstellung etwas, das nicht passiert.

### 1.10 `StatsCharts.tsx` — **niedrig, braucht eine Entscheidung**

230 Zeilen, von **keiner** Datei importiert, landen aber im Bundle. Entweder
im Profil einbauen oder löschen. Der Betreiber wurde dreimal gefragt und hat
nicht geantwortet — im Zweifel löschen, `git` erinnert sich.

### 1.11 Content-Security-Policy — **niedrig**

`public/_headers` setzt bewusst **keine** CSP. Wer sie will, muss sie messen:
react-native-web erzeugt Inline-Styles, die Karte läuft in einem
srcDoc-iframe und lädt Leaflet von einem CDN. Blind gesetzt legt sie die App
lahm. Vorgehen: `Content-Security-Policy-Report-Only` deployen, Verstöße
sammeln, dann scharf schalten.

---

## 2. Was nur der Betreiber kann (nicht der Agent)

Diese Punkte **nicht** selbst zu lösen versuchen — sie brauchen Konten,
Zugangsdaten, Hardware oder rechtliche Entscheidungen.

| Punkt | Was fehlt |
|---|---|
| **Push auf Android** | FCM-V1-Service-Account-Key über `eas credentials` hochladen. Der Code steht, nur die Verbindung fehlt |
| **iOS-Build** | Bezahlter Apple-Developer-Account |
| **Hardware-Test** | APK installieren und Push, GPS, Barcode-Scanner, Avatar- und Beweisfoto-Upload prüfen. **Nichts davon lief je auf einem Gerät** |
| **Datenschutz/AGB** | 6 Platzhalter in `src/app/legal/privacy.tsx` ausfüllen (`[Name/Firma des Betreibers]`, `[Anschrift]`, `[Kontakt-E-Mail-Adresse]`, `[E-Mail-Adresse für Datenschutzanfragen]`, `[Proxmox-Server-Standort]`, `[Name/Adresse]`), öffentlich hosten (in-app reicht den Stores nicht), anwaltlich prüfen lassen |
| **Splash-Grafik** | `assets/images/splash-icon.png` ist **byte-identisch mit `expo-logo.png`** — der Startbildschirm zeigt das Expo-Logo und würde so in die Stores gehen |
| **Schnellwahl-Migration** | Einmalig `docker compose -f server/docker-compose.yml exec backend node server/migrate-quickpicks.js --dry-run`, dann ohne `--dry-run`. Ohne diesen Lauf bekommen Bestandskonten die generische Startauswahl statt ihrer eigenen Gewohnheiten. Wiederholbar: wer schon selbst gewählt hat, wird übersprungen |
| **Entscheidungen** | Gruppenbeitritt-Modus (1.5), Meldungen per E-Mail (1.7), `StatsCharts` (1.10), bleibt Netlify neben Cloudflare bestehen |

---

## 3. Der Autofokus-Fall (offen, unverifiziert)

Der Betreiber meldete, dass der Autofokus des Barcode-Scanners nicht
funktioniert. In `a7f12b6` sind zwei plausible Ursachen behoben, **aber nichts
davon ist auf Hardware geprüft** — dem Agenten fehlte das Gerät.

Behoben wurde (Details und Belege in `PROJEKTUEBERGABE.md`):
- `autofocus="off"` explizit — iOS-only und invertiert benannt, nicht
  „reparieren"
- `ratio="16:9"` — schaltet die Android-Vorschau von FILL auf FIT, sonst zeigt
  der Sucher einen anderen Ausschnitt als den analysierten
- Kamera startet erst nach `onShow` des Modals
- `onMountError` wird angezeigt statt eines schwarzen Bildes
- Lampe, Zoom, größerer Rahmen, Abstands-Hinweis

**Wenn es weiter klemmt**, zuerst diese Frage klären, sie trennt zwei völlig
verschiedene Probleme: *Wird das Kamerabild scharf, aber der Code nicht
erkannt — oder bleibt schon die Vorschau unscharf?* Ersteres zeigt auf den
Decoder (Formatliste, Auflösung, Ausschnitt), Letzteres auf die Kamera
(Fokus, Abstand, Licht).

Falls die Vorschau unscharf bleibt, ist der nächste Schritt eine
Tipp-zum-Fokussieren-Geste. `expo-camera` bietet dafür **keine** Prop; das
bräuchte eine eigene native Anbindung oder ein anderes Paket — also erst
angehen, wenn die vier Punkte oben nachweislich nicht reichen.

---

## 4. Architektur-Schuld (kein Feature, aber teuer)

**Der doppelte Datenzugriffspfad** in `server/db.js` (Postgres + JSON) ist laut
Übergabe die häufigste Fehlerquelle des Projekts, und das hat sich in diesen
Sessions bestätigt: `posts.image` fehlte im Postgres-Zweig, während der
JSON-Zweig es stillschweigend behielt. Lokal lief alles, produktiv wären die
Bilder verschwunden.

Der JSON-Modus ist inzwischen fast nur noch für Tests und lokale Entwicklung
da. Ihn abzuschaffen und die Tests gegen ein Postgres im Container laufen zu
lassen, würde eine ganze Fehlerklasse beseitigen — ist aber ein größerer
Umbau und sollte nicht nebenbei passieren.

---

## 5. Wenn du fertig bist

- `npm test`, `npx tsc --noEmit`, `npx eslint src/ server/ tests/`
- `git status` — ist `ACTIVE_ENV` wieder auf `"production"`?
- Committen mit einer Nachricht, die das **Warum** erklärt, nicht das Was
- **Neue Fallen in `PROJEKTUEBERGABE.md` eintragen.** Dieses Dokument und die
  Übergabe sind der einzige Grund, warum die letzten Sessions nicht bei null
  angefangen haben
- Diese Datei aktualisieren: erledigte Punkte raus, neue rein
