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

### ~~1.1b Persönliche Schnellwahl + Dashboard-Redesign~~ — **erledigt**

Der Katalog ist geteilt, die Kachelauswahl nicht: `user_drinks`,
`GET/PUT /api/users/me/drinks`, Auswahl-Ansicht mit Suche, Bearbeiten-Modus.
Frei angelegte Getränke sieht nur ihr Urheber, gescannte bleiben geteilt.

Darauf aufgesetzt das Dashboard-Redesign: kompakte Stats-Leiste mit
Hydrations-Abzeichen, prominenter Scan-Knopf, **drei** Favoriten-Slots statt
einer Kachelwand, darunter vier Kategorie-Reiter mit je drei Karten (nach
eigener Trinkhistorie sortiert) und dahinter die Suche über den ganzen
Katalog. Ab 1024 px zentrierte 896-px-Spalte mit waagerechten Karten.

**Auf dem Server einmalig `node server/migrate-quickpicks.js` laufen lassen**
— siehe Abschnitt 2. Das Skript setzt drei Favoriten, passend zu den drei
Slots.

### ~~1.2 Passwort ändern im eingeloggten Zustand~~ — **erledigt** (Commit nach `32a5cf6`)

`POST /api/auth/change-password` mit dem alten Passwort als Nachweis. Die
Änderung beendet alle anderen Sitzungen und gibt einen frischen Token zurück,
damit die eigene weiterläuft; ein offener Reset-Code verfällt mit. Eintrag im
Drawer über „Abmelden“. 13 Tests in `tests/changepassword.test.js`.

### ~~1.2b Async-Routen ohne try/catch~~ — **erledigt**

Express 4 leitet eine abgelehnte Promise aus einem `async`-Handler nicht an
die Fehler-Middleware weiter; sie wird zur `unhandledRejection` und beendet
den Prozess.

**Korrektur zur ersten Notiz:** es waren **19** ungesicherte Routen, nicht 23.
Die 23 stammten aus einer groben `grep`-Zählung, die auch nicht-`async`-Routen
mitzählte. Genaue Lage jetzt: 58 Routen, davon 55 `async`, davon hatten 36 ein
`try/catch`.

Gelöst nach Weg 2 der ursprünglichen Liste: `wrapAsync` biegt in
`server/index.js` **einmal** die Registrierungsfunktionen um, statt 19-mal
einen Rumpf zu ergänzen. Jeder Handler, der eine Promise zurückgibt, hängt
danach automatisch am `catch(next)`. Dazu `process.on("unhandledRejection")`
(protokollieren, weiterlaufen) und `process.on("uncaughtException")`
(protokollieren, beenden — der Zustand kann beschädigt sein, und der
Container startet ohnehin neu).

Die beiden Netze tun **Verschiedenes**, im Mutationstest getrennt belegt:

| ausgebaut | Ergebnis |
|---|---|
| nur `wrapAsync` | Server lebt, aber der Request bekommt **nie** eine Antwort — der Aufrufer hängt bis ins Timeout |
| beide | Prozess tot, keine Antwort (Zustand vom 18.08.2026) |

Die bestehenden 36 `try/catch`-Blöcke bleiben: sie fangen weiterhin zuerst,
und ihre Log-Zeile nennt die Route direkt. Der Wrapper ist das Netz darunter.

9 Tests in `tests/asyncerrors.test.js`, gegen den echten Server über HTTP.
Dafür gibt es drei Fehlerinjektions-Routen in `server/index.js`, die nur bei
gesetztem `TRINKDUELL_ENABLE_FAULT_ROUTE=1` existieren; ein eigener Test
prüft, dass sie ohne die Variable 404 liefern.

### ~~1.3 Gruppenmitglieder verwalten~~ — **erledigt**

`POST /api/groups/:id/members` (Admin), `DELETE /api/groups/:id/members/:userId`
(Admin entfernt; die eigene ID einzusetzen heißt verlassen) und
`GET /api/groups/:id/members` (Mitgliederliste ohne E-Mails, mit Admin-Markierung).

**Festgelegtes Verhalten beim Admin-Austritt:**

| Lage | Ergebnis |
|---|---|
| Admin geht, weitere Mitglieder da | Adminrolle geht automatisch an das dienstälteste verbliebene Mitglied (erstes in `memberIds`), Push an den neuen Admin |
| Admin ist das letzte Mitglied | Gruppe wird gelöscht, samt Chatverlauf und Quests |

Die Alternative — „Admin darf erst raus, wenn er übergeben hat" — sperrt genau
die Person ein, die vielleicht wegen eines Konflikts gehen will. Zusammen mit
der Blockierfunktion wäre das der schlechtere Fehler.

**Blockierung gilt auch hier:** wer blockiert ist (in beide Richtungen), kann
nicht in eine Gruppe geholt werden. Sonst wäre „in eine Gruppe stecken" der
Weg, eine Blockierung zu umgehen — Gruppenchat und Gruppen-Feed führen die
beiden sonst wieder zusammen.

UI: Zahnrad neben „Chat" in der Gruppenliste — Mitglieder mit Admin-Markierung,
Entfernen-Knopf nur für den Admin, Freunde hinzufügen, offene Beitrittsanfragen
annehmen/ablehnen (die Route dazu gab es längst, aber ohne Bedienelement) und
„Gruppe verlassen" mit einer Rückfrage, die die jeweilige Folge nennt.

24 Tests in `tests/groupmembers.test.js`.

**Noch offen bleibt 1.5:** wie man eine Gruppe überhaupt findet, um beizutreten.
Das Annehmen von Anfragen ist jetzt bedienbar, das Stellen einer Anfrage
braucht weiterhin die Gruppen-ID.

### ~~1.4 Ungelesen-Markierung im Chat~~ — **erledigt**

Push gab es seit `7841c4d`, aber in der App war nirgends zu sehen, **wo**
etwas Neues liegt.

```
GET  /api/messages/unread   alle Zahlen auf einmal
POST /api/messages/read     eine Unterhaltung als gelesen markieren
```

Neue Tabelle `conversation_reads` mit `last_read_at` pro Nutzer und
Unterhaltung. Der Schlüssel ist `dm:<nutzerId>` bzw. `group:<gruppenId>`,
also **ein** Feld statt zweier nullbarer Spalten — das gibt einen sauberen
Primärschlüssel und erspart partielle Unique-Indizes.

**Die Zählregeln sind der eigentliche Inhalt**, nicht das Speichern:

- Eigene Nachrichten zählen nie.
- In Gruppen zählen fremde Nachrichten, aber **nicht die von Blockierten**.
  Der Gruppenchat filtert Blockierte beim Lesen heraus — ein Zähler dafür
  liesse sich nie leeren.
- Ohne Lesestand ist alles ungelesen. Das ist die ehrliche Bedeutung; beim
  ersten Start nach dem Deploy stehen deshalb **einmalig** Zahlen an alten
  Unterhaltungen. Sie verschwinden beim öffnen.
- Der Zeitstempel kommt vom Server, nicht aus dem Body: eine falsch gehende
  Geräteuhr würde sonst künftige Nachrichten stumm als gelesen verbuchen.
- Nie zurückdatieren (Postgres `GREATEST`, JSON ein Vergleich) — zwei Geräte
  lesen dieselbe Unterhaltung, und das langsamere darf den Stand des
  schnelleren nicht überschreiben.

**Die in dieser Aufgabe notierten fehlenden Indizes sind angelegt:**
`idx_messages_receiver_time` auf `(receiver_id, timestamp)` und
`idx_messages_group_time` auf `(group_id, timestamp)`. Der vorhandene
`idx_messages_conversation` liegt auf `(sender_id, receiver_id)` und half
nicht — gezählt wird nach Empfänger UND Zeit.

UI: Zahl am Menü-Symbol (die Glocke rechts bleibt für Beitrittsanfragen),
Punkte an Freundes- und Gruppenzeilen. Beim öffnen eines Chats wird sofort
lokal abgezogen und der Server nachgezogen — auf die Antwort zu warten,
bevor der Punkt verschwindet, fühlt sich träge an. Schlägt der Aufruf fehl,
wird die Zahl neu geladen statt falsch stehen zu lassen.

20 Tests in `tests/unread.test.js`. Kein neuer Timer: die Zahlen hängen am
bestehenden 15-Sekunden-Takt der Glocke.

### ~~1.5 Gruppenbeitritt~~ — **erledigt**

**Entscheidung: Einladungscode**, nicht öffentliche Gruppenliste — so war es in
dieser Aufgabe auch als Standard vorgemerkt. Eine durchsuchbare Liste aller
Gruppen wäre genau der Social-Graph-Leak, den die Autorisierungsrunde
geschlossen hat. Events benutzen dasselbe Muster.

```
GET  /api/groups/:id/invite          Code ansehen (nur Admin)
POST /api/groups/:id/invite/rotate   Code neu vergeben (nur Admin)
POST /api/groups/join                mit Code beitreten
```

8 Hex-Zeichen aus `crypto.randomBytes`, wie bei Events. Wer den Code eingibt,
wird **sofort** Mitglied — eine zweite Freigabe wäre Reibung, denn den Code
bekommt man ja vom Admin. Der alte Weg über `POST /:id/join` (Anfrage, die
der Admin freigibt) bleibt daneben bestehen.

**Die Rotation ist kein Komfort, sondern nötig.** Ohne sie wäre das Entfernen
eines Mitglieds wirkungslos: wer den alten Code noch hat, träte sofort wieder
bei. Ein Test belegt beide Richtungen — ohne Rotation kommt der Entfernte
zurück, nach der Rotation nicht mehr. Die Oberfläche weist beim Code darauf hin.

Der Code geht **nur** an den Admin: `GET /api/groups` entfernt ihn für alle
anderen aus der Antwort, und die Beitritts-Antwort enthält ihn ebenfalls nicht.

**Schema:** `groups.invite_code` kommt per `ALTER TABLE` in `initPgSchema()`,
der partielle Unique-Index danach — die Reihenfolge aus Falle 3.5. Neue
Gruppen bekommen den Code beim Anlegen, Bestandsgruppen beim ersten Abruf
durch ihren Admin (`ensureGroupInviteCode`). **Kein Migrationsskript nötig.**

UI: Knopf neben „Neue Gruppe erstellen“ öffnet die Code-Eingabe; der Code samt
„Code erneuern“ steht im Verwaltungsdialog.

17 Tests in `tests/groupinvite.test.js`.

> Kein Kopieren in die Zwischenablage: dafür bräuchte es `expo-clipboard`, und
> eine Abhängigkeit für acht Zeichen lohnt nicht. Der Code steht groß und
> markierbar da.

### ~~1.6 Events und Gruppen-Quests erreichbar machen~~ — **erledigt**

Beide Backends waren vollständig, nur rief sie kein Screen auf. Jetzt:

- **Events** als eigener Abschnitt im Freunde-Dialog: Liste mit Restzeit und
  Teilnehmerzahl, „Event starten“ (Name + Dauer 4/6/12/24 Std, danach wird
  der Code angezeigt) und Beitritt per Code. Abgelaufene Events bleiben
  sichtbar, aber ausgegraut — der Server filtert sie nicht heraus, und das
  ist richtig so: man will sehen, woran man teilgenommen hat.
- **Quests** über den Gruppen-Verwaltungsdialog: laufende Quests mit
  Fortschrittsbalken und Status, darunter ein Formular (Titel, Typ
  Getränke/Volumen/Wasser, Ziel, Dauer). Die Einheit im Formular wechselt
  mit dem Typ (Stück / Liter / Gläser).

Der Code-Dialog ist jetzt einer für Gruppen **und** Events (`codeModalMode`)
— die beiden unterscheiden sich nur im Text und in der Route.

**Dabei einen echten Fehler gefunden:** `saveEvent` machte im Postgres-Zweig
ein Upsert, im JSON-Zweig ein blindes `push`. Jeder Event-Beitritt legte damit
im JSON-Modus eine **zweite Kopie** des Events an — in der App als
„Meine Events (2)“ mit zweimal demselben Namen sichtbar. Produktion läuft auf
Postgres und war nicht betroffen, der JSON-Fallback schon. `saveDrink` hatte
dieselbe Abweichung (heute folgenlos, weil beide Aufrufstellen neu anlegen).
Beide angeglichen.

26 Tests in `tests/eventsquests.test.js` — beide Backends waren bis dahin
völlig ungetestet.

### ~~1.7 Moderations-Ansicht für Meldungen~~ — **erledigt (Code), Betreiber muss noch etwas setzen**

```
GET   /api/reports[?status=open]   Meldungen ansehen (nur Moderator)
PATCH /api/reports/:id             Status setzen (open/resolved/dismissed)
```

**Rollenkonzept: eine Umgebungsvariable, keine Spalte.** `ADMIN_USER_IDS`
(kommagetrennte Nutzer-IDs). Für einen Betreiber und eine Freundes-Beta wäre
eine `role`-Spalte samt Verwaltung mehr Apparat als Nutzen — und eine Rolle,
die man in der App vergeben kann, ist auch eine, die man sich über eine
Lücke selbst geben kann. Wer die Variable setzen kann, hat ohnehin
Server-Zugriff.

**Leer bedeutet: niemand ist Moderator.** Eine vergessene Variable sperrt zu,
statt aufzumachen. Die Routen antworten dann mit **404** statt 403 — dass es
die Ansicht überhaupt gibt, muss ein normaler Nutzer nicht erfahren.

`isModerator` kommt im eigenen Profil mit (Login, Registrierung, `/users/me`),
damit der Client den Zugang einblenden kann. Reine Anzeigehilfe: die Routen
prüfen unabhängig davon.

UI: Eintrag „Meldungen" im Drawer bei den Kontoeinstellungen, Dialog mit
Filter (Offen/Erledigt/Verworfen samt Zahlen), Melder, Grund, Zeitpunkt,
Beschreibung und dem gespeicherten Textauszug — Letzterer ist eine Kopie aus
dem Meldezeitpunkt, das Original kann längst gelöscht sein.

15 Tests in `tests/moderationview.test.js`.

> **Offen bleibt die Entscheidung des Betreibers:** sollen Meldungen
> zusätzlich per E-Mail kommen? Resend ist eingerichtet, das wären wenige
> Zeilen in `server/email.js`. Bis dahin ist der Weg: Variable setzen, in der
> App nachsehen. Der Log-Eintrag (`grep MELDUNG`) bleibt zusätzlich bestehen.

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
| **Schnellwahl-Migration** | Einmalig `docker compose -f server/docker-compose.yml exec backend node server/migrate-quickpicks.js --dry-run`, dann ohne `--dry-run`. Ohne diesen Lauf bekommen Bestandskonten die generische Startauswahl statt ihrer eigenen Gewohnheiten. Setzt drei Favoriten, passend zu den drei Dashboard-Slots. Wiederholbar: wer schon selbst gewählt hat, wird übersprungen |
| **Moderation freischalten** | `ADMIN_USER_IDS` in `server/.env` auf die eigene Nutzer-ID setzen und den Container neu starten. Ohne diese Variable ist **niemand** Moderator und `/api/reports` antwortet für alle mit 404. ID herausfinden: `docker compose -f server/docker-compose.yml exec db psql -U trinkduell_user -d trinkduell -c "SELECT id, name FROM users ORDER BY name"` |
| **Entscheidungen** | Meldungen zusätzlich per E-Mail (1.7)? `StatsCharts` (1.10)? Bleibt Netlify neben Cloudflare bestehen? |

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
