# Arbeitsauftrag: TrinkDuell — Ausbau vor dem Betatest

**Für den bearbeitenden Agenten. Lies dieses Dokument vollständig, bevor du die
erste Zeile änderst.**

Dieser Auftrag ist bewusst kleinschrittig. Jede Aufgabe hat ein *Ziel*, eine
*Schrittfolge*, eine *Abnahme* und eine Liste *Nicht akzeptabel*. Du arbeitest
die Aufgaben **in der angegebenen Reihenfolge** ab und beginnst eine neue erst,
wenn die Abnahme der vorherigen nachweislich erfüllt ist.

---

## 0. Rahmen — gilt für ALLES, was folgt

### 0.1 Arbeitsweise

1. **Ein Commit pro Aufgabe.** Nicht mehrere Aufgaben in einem Commit
   zusammenfassen. Die Commit-Nachricht nennt die Aufgabennummer.
2. **Nach jeder Aufgabe** laufen diese drei Befehle, und **alle drei müssen
   sauber durchlaufen**, bevor du weitermachst:

```bash
npm test
```

```bash
npx tsc --noEmit
```

```bash
npx eslint src/ server/ tests/
```

   Erwartung: Tests **alle grün** (aktuell 412), `tsc` gibt **keine Ausgabe**,
   `eslint` meldet **0 errors** (Warnungen sind Altbestand und dürfen bleiben,
   aber du darfst **keine neuen** hinzufügen).

3. **Schlägt etwas fehl, ist das deine Aufgabe.** Nicht „ist wohl vorher schon
   kaputt gewesen" annehmen — der Zustand beim Schreiben dieses Dokuments war
   nachweislich sauber (412 Tests grün, `expo-doctor` 20/20).

4. **Arbeite auf einem eigenen Branch**, abgezweigt vom aktuellen Stand:

```bash
git checkout feature/spielesektion-p0 && git pull && git checkout -b feature/ausbau-beta
```

5. **Nicht nach `main` mergen, nicht auf den Server deployen.** Der Betreiber
   macht das selbst, nachdem ein Sicherheitsreview gelaufen ist.

### 0.2 Regeln, die nicht verhandelbar sind

Diese stammen aus `docs/PROJEKTUEBERGABE.md` und haben in diesem Projekt schon
mehrfach Fehler verursacht. Verstöße sind der häufigste Grund für kaputte
Produktionsstände:

1. **`server/db.json` niemals anfassen.** Enthält echte Nutzerdaten. Tests
   benutzen `TRINKDUELL_DB_FILE` mit einer Wegwerf-Datenbank.
2. **`ACTIVE_ENV` in `src/services/config.ts` steht auf `"production"`.** Zum
   lokalen Testen darfst du auf `"local"` stellen, **musst es aber vor jedem
   Commit zurücksetzen**. Prüfe das mit `git diff src/services/config.ts` —
   die Ausgabe muss leer sein.
3. **Jede Datenänderung in BEIDE Datenbank-Zweige** in `server/db.js`:
   `if (pool) { ... }` für Postgres, darunter der JSON-Zweig. Wer nur einen
   Zweig anfasst, baut einen Fehler, der lokal nie auftritt und produktiv
   Daten verliert.
4. **Neue Spalte = `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` in
   `initPgSchema()`** (in `server/db.js`), zusätzlich in `server/schema.sql`
   für frische Datenbanken. Indizes auf nachgerüsteten Spalten gehören
   **ausschließlich** nach `db.js`, nie in `schema.sql`. `tests/schema.test.js`
   prüft diese Regel.
5. **Neue Umgebungsvariable = zwei Einträge:** `server/docker-compose.yml`
   unter `environment:` **und** `server/.env.example`. Fehlt einer, kommt die
   Variable im Container nie an.
6. **`app.json` und `eas.json` NICHT anfassen.** Der Betreiber bearbeitet sie
   gerade für einen iOS-Build. Wenn eine Aufgabe eine Änderung dort nahelegt,
   löse sie anders oder melde es — aber ändere die Dateien nicht.
7. **Deutsche Oberflächentexte.** Code-Kommentare deutsch, im Stil der Datei,
   in der du arbeitest.

### 0.3 Was „fertig" bedeutet

Eine Aufgabe ist fertig, wenn **alle** Punkte ihrer Abnahme erfüllt sind und du
das **nachgewiesen** hast — durch einen Testlauf, eine Ausgabe im Terminal oder
einen Blick in die laufende App. „Sieht richtig aus" ist kein Nachweis.

**Wenn du eine Aufgabe nicht vollständig schaffst: brich sie nicht ab und
liefere keine halbe Lösung. Schreibe stattdessen in den Abschlussbericht, wie
weit du gekommen bist und was fehlt.** Eine ehrlich gemeldete Teilstrecke ist
brauchbar, eine als fertig ausgegebene halbe Lösung nicht.

---

## Aufgabe 1 — Startbildschirm zeigt das Expo-Logo

**Dringlichkeit: höchste. Blockiert den iOS-Build.**

### Ziel

`assets/images/splash-icon.png` ist **byte-identisch** mit
`assets/images/expo-logo.png`. Der Startbildschirm der App zeigt damit das Logo
des Entwicklungswerkzeugs. So geht die App in TestFlight und in den Store.

### Schritte

1. Belege den Ist-Zustand:

```bash
md5sum assets/images/splash-icon.png assets/images/expo-logo.png assets/images/icon.png
```

   Die ersten beiden Prüfsummen sind gleich, die dritte ist anders.

2. Ersetze die Startgrafik durch das echte App-Icon:

```bash
cp assets/images/icon.png assets/images/splash-icon.png
```

3. Belege den Soll-Zustand mit demselben `md5sum`-Befehl: `splash-icon.png` und
   `icon.png` müssen jetzt übereinstimmen, `expo-logo.png` abweichen.

### Abnahme

- [ ] `md5sum` zeigt: `splash-icon.png` == `icon.png`, != `expo-logo.png`
- [ ] `app.json` ist **unverändert** (`git diff app.json` ist leer)
- [ ] Die drei Prüfbefehle aus 0.1 laufen sauber durch

### Nicht akzeptabel

- `app.json` anfassen, um auf eine andere Datei zu zeigen (siehe Regel 0.2.6)
- Eine selbst erzeugte Grafik einsetzen — das App-Icon existiert bereits und
  ist die richtige Wahl
- Die Aufgabe überspringen, weil sie „nur ein Bild" ist. Sie ist der einzige
  Punkt hier, der einen Store-Build unbrauchbar macht.

---

## Aufgabe 2 — Tagesobergrenze für Spiel-XP

### Ziel

Seit dem Umbau der Spielesektion schreibt `POST /api/game-rooms/:code/claim`
Punkte aus beendeten Spielrunden gut. Pro Runde wird nur einmal ausgezahlt
(Tabelle `game_settlements`), **aber es gibt keine Obergrenze pro Tag**. Wer
viele kurze Runden startet und beendet, sammelt unbegrenzt XP und verfälscht
damit die Rangliste.

### Schritte

1. Lies `server/index.js`, Route `POST /api/game-rooms/:code/claim`, und
   `server/db.js`, Funktion `awardGamePoints`. Verstehe, wie die Idempotenz
   über den Schlüssel `raum:nutzer` funktioniert — dieselbe Mechanik nutzt du
   für die Obergrenze.

2. Ergänze in `server/db.js` eine Funktion, die die heute bereits
   gutgeschriebenen Spiel-Punkte eines Nutzers summiert. Sie liest aus
   `game_settlements` alle Einträge des Nutzers mit `timestamp` vom heutigen
   Tag und summiert `points`.
   **Beide Datenbank-Zweige** (Regel 0.2.3).

3. Setze die Obergrenze auf **300 Punkte pro Kalendertag**. Ist das Tageslimit
   erreicht, schreibt `awardGamePoints` nichts mehr gut und meldet das zurück
   (z. B. `{ awarded: false, points: 0, reason: "daily_cap" }`). Ist es
   teilweise erreicht, wird nur der Rest gutgeschrieben.

4. Die Route gibt den Grund an den Client weiter. In
   `src/components/games/StoryGameShell.tsx` wird die Gutschrift nach dem
   Finale angezeigt (`claimedPoints`) — zeige dort einen kurzen Hinweis, wenn
   wegen der Obergrenze nichts oder weniger gutgeschrieben wurde. Text auf
   Deutsch, freundlich, kein Vorwurf.

5. Schreibe Tests in `tests/gameengine.test.js` (an den bestehenden Block
   „Spiel-XP überleben die Neuberechnung (B3)" anschließen):
   - unterhalb der Grenze wird voll gutgeschrieben
   - an der Grenze wird gekappt, nicht abgelehnt
   - oberhalb der Grenze wird nichts mehr gutgeschrieben
   - die Idempotenz pro Runde bleibt bestehen (zweiter Aufruf zahlt nicht
     nochmal)

### Abnahme

- [ ] Vier neue Tests, alle grün, und sie prüfen wirklich etwas: baue die
      Obergrenze testweise aus und überzeuge dich, dass die Tests **fehlschlagen**.
      Baue sie danach wieder ein. Ohne diesen Gegenprobe-Schritt ist die
      Aufgabe nicht fertig.
- [ ] Die Änderung in `server/db.js` steht in **beiden** Zweigen. Weise das
      nach, indem du beide Codestellen im Bericht zitierst.
- [ ] Die drei Prüfbefehle aus 0.1 laufen sauber durch

### Nicht akzeptabel

- Die Grenze nur im Client prüfen. Der Client ist manipulierbar; die Grenze
  gehört auf den Server.
- Nur den Postgres-Zweig anfassen.
- Tests schreiben, die den Fehlerfall nicht abdecken.

---

## Aufgabe 3 — „Der Verrat am Königshof" auf die Storylet-Engine holen

### Ziel

Von drei Story-Spielen läuft bisher **nur eines** auf der neuen Engine:

| Spiel | Format | Szenen im Pool | pro Runde gespielt |
|---|---|---|---|
| Mord im Mitternachts-Express | `storylets` | 19 | 12 |
| Der Verrat am Königshof | alt (`chapters`) | 3 | 3 |
| Escape the Haunted Manor | alt (`chapters`) | 3 | 3 |

Die beiden alten Spiele sind weiterhin in fünf Minuten durchgespielt — genau
das Problem, das der ganze Umbau beheben sollte. Diese Aufgabe holt den
Königshof nach.

### Schritte

1. **Lies zuerst die Vorlage vollständig:**
   `server/games/stories/murder_express.json`. Sie ist das Muster, an dem du
   dich Feld für Feld orientierst. Lies außerdem
   `server/games/storyEngine.js` — dort steht, welche Felder die Engine
   auswertet (`requires`, `once`, `opening`, `closing`, `weight`, `prompt`,
   `discussion`, `voting`, `effects`, `pinholes`).

2. Baue `server/games/stories/court_treason.json` auf das Format
   `"format": "storylets"` um. Verbindlich:
   - **Drei Akte** mit den Längen **4 / 5 / 3** (wie beim Express)
   - **Mindestens 18 Szenen im Pool**, verteilt: Akt I ≥ 6, Akt II ≥ 8,
     Akt III ≥ 4
   - Je Akt **genau eine** `opening`-Szene und **mindestens eine**
     `closing`-Szene
   - **Mindestens 3 Rollenszenen** (`prompt.forRole`) für unterschiedliche
     Rollen aus der bestehenden Rollenliste des Spiels
   - **Mindestens 3 Diskussionsszenen** (`discussion`) mit einer konkreten
     Frage, nicht „redet miteinander"
   - **Mindestens 4 Szenen mit `requires`**, die an Story-Variablen hängen
   - Ein `pinholes`-Block (Zeuge, Täter, Rauschen) analog zum Express
   - Ein `variableLimits`-Block, falls du eine Variable mit Obergrenze
     einführst — **den Startwert einer Variable NIE als Obergrenze verwenden**,
     das war schon einmal ein Fehler (siehe Kommentar in `storyEngine.js`)

3. Der Ton ist der bestehende: höfisch, intrigant, deutsch, Du-Form. **Jede
   Auswahl braucht `label` und `outcomeText`.** Jede Aufgabe, die Trinken
   nahelegt, braucht eine gleichwertige Alternative — „oder trinke" ist Pflicht,
   nie Trinkzwang.

4. Erweitere `tests/storylets.test.js`: Die dortigen Strukturprüfungen laufen
   bisher nur gegen `murder_express`. Ziehe sie so um, dass sie über **alle**
   Storylet-Spiele laufen (Schleife über die Story-Ids), damit dein neues
   Setting dieselben Prüfungen besteht.

### Abnahme

- [ ] Dieser Befehl zeigt für `court_treason` das Format `NEU` und ≥ 18 Szenen:

```bash
node -e "const s=require('./server/games/stories/court_treason.json');console.log(s.format, s.storylets.length, s.structure.acts.map(a=>a.count).join('/'))"
```

- [ ] Die Strukturtests in `tests/storylets.test.js` laufen über alle
      Storylet-Spiele und sind grün
- [ ] Ein vollständiger Durchlauf funktioniert: Starte den Testserver, spiele
      eine Runde mit 5 Spielern per HTTP bis zum Finale durch, und weise nach,
      dass Akt I → II → III durchlaufen werden und das Finale eine Auflösung
      liefert. Orientiere dich an `tests/gameengine.test.js`, Funktion
      `skipBisPhase`.
- [ ] Die drei Prüfbefehle aus 0.1 laufen sauber durch

### Nicht akzeptabel

- Weniger als 18 Szenen. Bei 12 gespielten Szenen pro Runde wäre der Pool
  sonst faktisch fix und jede Runde gleich.
- Szenen, die sich nur im Wortlaut unterscheiden. Jede Szene braucht eine
  eigene Situation und eigene Auswahlmöglichkeiten.
- Die alten drei Kapitel einfach in das neue Format kopieren und mit
  Füllszenen strecken.
- `outcomeText` weglassen — dann steht der Spieler nach seiner Entscheidung
  vor einer leeren Karte.

---

## Aufgabe 4 — „Escape the Haunted Manor" auf die Storylet-Engine holen

### Ziel

Wie Aufgabe 3, für das dritte Spiel. Besonderheit: Dieses Spiel ist
**kooperativ** und hat eine gemeinsame Lebenspunkte-Leiste (`healthPoints`,
Startwert 100, Obergrenze 100 in `variableLimits`).

### Schritte

Wie Aufgabe 3, mit diesen Zusätzen:

1. `healthPoints` bleibt die tragende Variable. **Mindestens 8 Szenen** müssen
   sie verändern — nach oben und nach unten.
2. **Mindestens 2 Szenen** hängen per `requires` daran, dass die Lebenspunkte
   niedrig sind (z. B. `{ "var": "healthPoints", "atMost": 40 }`). Erst
   dadurch wird die Leiste zu einem Spielelement statt zu einer Anzeige.
3. Der `teamWipe`-Block im `finale` bleibt erhalten: Sinken die Lebenspunkte
   auf 0, gewinnt der Dämon — unabhängig von der Abstimmung.
4. Der Ton ist Horror, aber humorvoll. Kein Splatter, keine Aufgaben, die
   jemandem echte Angst machen sollen.

### Abnahme

- [ ] Prüfbefehl wie in Aufgabe 3, für `haunted_manor`
- [ ] Ein Testdurchlauf weist nach, dass `healthPoints` sich im Spielverlauf
      **verändert** (nicht bei 100 stehen bleibt) und dass eine Szene mit
      `requires` auf niedrige Lebenspunkte erreichbar ist
- [ ] Die drei Prüfbefehle aus 0.1 laufen sauber durch

### Nicht akzeptabel

- Die Lebenspunkte-Leiste als reine Dekoration. Genau das war der Zustand vor
  dem Umbau, und es war der Hauptkritikpunkt.

---

## Aufgabe 5 — Session-Report am Ende einer lokalen Runde

### Ziel

Aus dem Umbaukonzept (`docs/KONZEPT_SPIELESEKTION.md`, Phase P3): Eine Runde
„Die Nacht" endet bisher, indem man das Spiel abbricht. Es gibt keinen
Abschluss, kein Ergebnis, nichts, was die Gruppe behält.

### Schritte

1. Lies `src/games/session.tsx` vollständig. Dort liegen Punkte, Akte, Joker,
   Statuseffekte und das Dossier.

2. Baue einen Abschluss-Bildschirm als neue Komponente
   `src/components/games/SessionReport.tsx`. Er zeigt:
   - Die Endtabelle (Name, Punkte, Titel), absteigend sortiert
   - Den Sieger hervorgehoben
   - Die kuriosesten Dossier-Einträge (mindestens 3, falls vorhanden)
   - Wie viele Runden gespielt wurden und welcher Akt erreicht wurde
   - Wie viele Joker ungenutzt blieben — das ist die Auszeichnung für alle,
     die nicht getrunken haben, und gehört sichtbar dazu

3. Der Bildschirm erscheint, wenn die Session beendet wird. Ergänze in
   `src/games/session.tsx` dafür, was du brauchst (z. B. einen Zustand
   „beendet, Bericht offen"), **ohne** die bestehende `end()`-Funktion in
   ihrer Bedeutung zu verändern.

4. Ein Knopf „Runde beenden" muss von der Spieleübersicht aus erreichbar sein,
   solange eine Session läuft.

### Abnahme

- [ ] Der Bericht erscheint nach dem Beenden einer laufenden Runde
- [ ] Er zeigt alle fünf oben genannten Angaben
- [ ] Läuft keine Session, ist nichts kaputt und nichts sichtbar
- [ ] Du hast es **in der laufenden App angesehen**, nicht nur den Code
      gelesen. Beschreibe im Bericht, was du gesehen hast.
- [ ] Die drei Prüfbefehle aus 0.1 laufen sauber durch

### Nicht akzeptabel

- Nur die Punktetabelle zeigen. Die Dossier-Einträge und die ungenutzten Joker
  sind der Teil, der die Runde zu *dieser* Runde macht.
- Den Bericht nur im Code anlegen, ohne ihn erreichbar zu machen.

---

## Aufgabe 6 — Erfolge für Spiele

### Ziel

Es gibt 11 Erfolge, und **alle** hängen am Getränke-Logging. Kein einziger
hängt an einem Spiel, obwohl die Spielesektion inzwischen der größte Teil der
App ist.

### Schritte

1. **Lies zuerst diese Warnung:** Es gibt **zwei** Erfolgslisten, und sie sind
   schon heute nicht synchron:
   - `src/services/achievements.ts` (Anzeige im Profil)
   - `ACHIEVEMENTS_METADATA` in `src/components/AchievementModal.tsx`
     (Freischalt-Meldung)
   Jeder neue Erfolg muss in **beide** Listen. Prüfe zum Schluss, dass beide
   Listen dieselben Einträge enthalten, und melde im Bericht, ob du dabei
   Altbestand-Abweichungen gefunden hast.

2. Lege **mindestens 6 neue Erfolge** an, die an Spielen hängen. Vorschläge —
   du darfst abweichen, aber jeder Erfolg muss serverseitig prüfbar sein:
   - Erste Story-Runde beendet
   - Als Verräter unentdeckt geblieben
   - Einen Verräter überführt
   - Eine Runde ohne einen einzigen Joker beendet
   - Alle drei Akte einer lokalen Nacht erreicht
   - An einer Wasserrunde teilgenommen

3. Die Auswertung gehört auf den **Server**, in `recalculateUserStats` in
   `server/db.js` oder an die Stelle, an der die Spielrunde abgerechnet wird.
   **Nicht im Client** — dort wäre jeder Erfolg fälschbar.

4. Dafür brauchst du gespeicherte Fakten über beendete Runden. Prüfe, ob die
   Tabelle `game_settlements` dafür reicht, oder ob du sie um Felder erweitern
   musst (dann: Regel 0.2.4 beachten, `ALTER TABLE` **und** `schema.sql`).

### Abnahme

- [ ] Mindestens 6 neue Erfolge, in **beiden** Listen, mit identischen Ids
- [ ] Die Auswertung läuft serverseitig
- [ ] Mindestens 3 Tests, die je einen Erfolg auslösen und prüfen, dass er
      vergeben wird — und einen Fall, in dem er **nicht** vergeben wird
- [ ] Die drei Prüfbefehle aus 0.1 laufen sauber durch

### Nicht akzeptabel

- Erfolge nur in eine der beiden Listen eintragen. Das ist der bekannteste
  Altfehler dieses Projekts.
- Die Prüfung im Client.
- Erfolge, die niemand je erreichen kann, weil die nötigen Daten gar nicht
  gespeichert werden. Prüfe vor dem Anlegen, ob der Fakt überhaupt vorliegt.

---

## Aufgabe 7 — Content-Pool des Mitternachts-Express erweitern

### Ziel

19 Szenen im Pool, 12 werden pro Runde gespielt. Das reicht für einen Abend
mit Varianz, aber wer das Spiel zweimal hintereinander spielt, sieht fast
alles doppelt.

### Schritte

1. Erweitere `server/games/stories/murder_express.json` auf **mindestens 32
   Szenen**, verteilt: Akt I ≥ 10, Akt II ≥ 14, Akt III ≥ 8.
2. Neue Szenen müssen sich in der *Situation* unterscheiden, nicht nur im
   Wortlaut. Nutze die Variablen (`hinweise`, `verdacht`, `panik`), damit
   Szenen erst unter bestimmten Bedingungen auftauchen.
3. Mindestens 4 der neuen Szenen greifen per `{{memory:...}}` auf frühere
   Entscheidungen zurück (siehe `renderTemplate` in `storyEngine.js`).

### Abnahme

- [ ] `node -e "const s=require('./server/games/stories/murder_express.json');console.log(s.storylets.length)"` zeigt ≥ 32
- [ ] Der bestehende Test „Zwei Durchläufe verlaufen unterschiedlich" in
      `tests/storylets.test.js` bleibt grün
- [ ] Die drei Prüfbefehle aus 0.1 laufen sauber durch

### Nicht akzeptabel

- Szenen, die inhaltlich Dubletten sind.
- Platzhalter wie `{{player:1}}` ohne Ersatztext (`{{player:1|Ein Passagier}}`)
  — bei kleinen Gruppen steht sonst der rohe Platzhalter im Text.

---

## Abschluss — was du am Ende lieferst

1. Alle Commits auf dem Branch `feature/ausbau-beta`, gepusht.
2. **Kein Merge nach `main`**, kein Deploy.
3. Ein Abschlussbericht mit:
   - Je Aufgabe: erledigt / teilweise / nicht angefangen
   - Bei „teilweise": **was genau** fehlt
   - Die Ausgabe des letzten Testlaufs (Anzahl Tests, bestanden, fehlgeschlagen)
   - Alles, was dir aufgefallen ist, aber nicht zum Auftrag gehörte
4. **Bestätige ausdrücklich**, dass `git diff src/services/config.ts` leer ist
   und dass `app.json` und `eas.json` unverändert sind.

---

## Was du NICHT tust

- Nichts auf dem Server ändern (keine SSH-Zugriffe, kein `docker compose`).
- `main` nicht anfassen.
- Keine Abhängigkeiten hinzufügen oder aktualisieren, ohne es im Bericht zu
  begründen. Expo SDK 55 ist versionsempfindlich.
- Keine bestehenden Tests löschen oder abschwächen, damit dein Code
  durchläuft. Wenn ein bestehender Test deiner Änderung widerspricht, ist das
  ein Befund — melde ihn, statt den Test anzupassen.
- Keine Umstellung des doppelten Datenbank-Zugriffspfads. Das ist bekannt, ist
  ein eigenes Projekt und gehört nicht in diesen Auftrag.

---

## Nur der Betreiber (nicht du) — zur Information

Damit du diese Punkte nicht versehentlich anfässt:

| Punkt | Warum nicht du |
|---|---|
| `ADMIN_USER_IDS` in `server/.env` setzen | Serverzugang |
| R2-CORS-Regel im Cloudflare-Dashboard | Fremdes Konto |
| Datenschutz-Platzhalter in `src/app/legal/privacy.tsx` (6 Stück) | Rechtliche Angaben, nur der Betreiber kennt sie |
| Migrationsskripte (`migrate-quickpicks.js`, `migrate-hide-duplicates.js`) | Laufen gegen die Produktionsdatenbank |
| Test auf echter Hardware | Gerät nötig |
