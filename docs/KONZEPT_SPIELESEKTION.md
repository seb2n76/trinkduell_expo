# Konzept: Spielesektion — von der Fassade zum Abend

**Stand:** 20.08.2026 · Grundlage: Code-Analyse + Research-Report
(→ [`RESEARCH_PROMPT_SPIELESEKTION.md`](./RESEARCH_PROMPT_SPIELESEKTION.md))

Dieses Dokument ist der Bauplan für den Umbau der Spielesektion. Es sagt, was
gebaut wird, in welcher Reihenfolge, und **warum drei technische Blocker vor
jedem Game-Design-Feature gelöst werden müssen** — sonst verpufft die Arbeit
wirkungslos, so wie die bereits gebauten Mechaniken heute verpuffen.

---

## 0. Kurzfassung

Das Problem ist nicht fehlender Content. Es sind ~124 „Ich hab noch nie"-Karten
vorhanden, drei Story-Settings, 84 Wortbomben-Kategorien. Das Problem ist, dass
**nichts davon Folgen hat**: keine Entscheidung verändert etwas, kein Ergebnis
überlebt die Runde, kein Spiel weiß, dass es gerade ein Spiel ist.

Der Umbau erfolgt in vier Phasen:

| Phase | Inhalt | Ergebnis |
|---|---|---|
| **P0 — Fundament** | 3 technische Blocker | Entscheidungen können überhaupt Folgen haben |
| **P1 — Spürbarkeit** | Simultane Auflösung, Session-Layer, aktive Regeln, Joker | Kein Leerlauf mehr, sichtbarer Einsatz |
| **P2 — Tiefe** | Storylet-Engine · Statuseffekte, Dossier, Busfahrer fertig | Beide Spielfamilien tragen 30–45 Minuten |
| **P3 — Bindung** | Meta-Brücke, Session-Report, Spiel-Erfolge | Gründe, am nächsten Abend wiederzukommen |

**Zwei getrennte Baustellen mit gemeinsamem Fundament.** Die Story-RPGs
(§5) und die acht lokalen Spiele (§6) haben dasselbe Grundproblem, brauchen aber
verschiedene Lösungen: Die einen gewinnen durch geheime Information und
Deduktion, die anderen durch Zustand, der sich über den Abend anhäuft. Beide
laufen ab P1 parallel.

**Wichtigste Scoping-Entscheidung: Tiefe vor Breite — bei den Story-Settings.**
In P2 wird *ein* Story-RPG vollständig neu gebaut, nicht alle drei. Drei
halbtiefe Spiele scheitern genauso wie heute, nur teurer. Für die lokalen Spiele
gilt das *nicht*: Sie teilen sich einen Session-Layer und werden deshalb
gemeinsam tief.

---

## 1. Leitidee

> Ein Trinkspiel-Abend ist kein Kartenstapel. Er ist eine **Dramaturgie**:
> Aufwärmen, Eskalation, Entscheidung, Nachspiel.

Die App liefert heute nur den Kartenstapel. Alle Mechaniken dieses Konzepts
dienen einem der drei Prinzipien:

**P1 — Nichts ist folgenlos.** Jede Entscheidung verändert einen sichtbaren
Zustand: Punkte, Rollen, Story-Variablen, wer als Nächstes drankommt. Der
aktuelle Zustand — Entscheidungen, deren Werte serverseitig verworfen werden —
ist der Kern des Problems.

**P2 — Niemand wartet.** Passives Warten ist laut Research die Hauptabbruch-
ursache, und sie ist in der aktuellen Architektur *eingebaut*: nur der Host hat
einen Weiter-Button. Der Standardfall wird umgedreht — **alle antworten
gleichzeitig, das System löst gebündelt auf**.

**P3 — Der Abend erinnert sich.** Antworten aus Minute 5 kommen in Minute 30
zurück. Punkte kumulieren über Spielwechsel hinweg. Am Ende steht ein Ergebnis,
das die Gruppe behält.

**Nicht verhandelbar bei allem:** Schlucke sind *eine* Währung, nie die einzige;
jede Aufgabe hat einen Ausweg ohne Gesichtsverlust; Wasser ist mechanisch
belohnt, nicht nur geduldet.

---

## 2. Was ich aus dem Research übernehme — und was nicht

Der Report ist in der Diagnose und im Mechanik-Katalog belastbar. Vier
Empfehlungen setze ich bewusst **nicht** um:

| Vorschlag | Warum nicht | Stattdessen |
|---|---|---|
| **XP-Wetten:** Spieler setzen gesammelte XP, Verlierer verlieren Bestand | Verlustaversion treibt genau das Verhalten, das wir bekämpfen — wer 200 XP verliert, hört auf. Zusätzlich Store-Risiko „simulated gambling". | **Bonus-Topf:** Jede Session hat einen eigenen Punktetopf. Man kann *gewinnen*, aber nie unter den Vor-Session-Stand fallen. Einsatz bleibt, Verlustangst entfällt. |
| **„Wer das beste Beweisfoto lädt, stiehlt 10 XP vom Letztplatzierten"** | Fotos angetrunkener Leute per Spielmechanik in einen Feed zu drücken ist ein Moderations- und Persönlichkeitsrechts-Problem. XP-Klau unter Freunden ist sozial ätzend. | Beweisfoto bleibt **freiwillig** und unbewertet (wie heute). Der Session-Report geht opt-in in den *Gruppen*-Feed, nicht öffentlich. |
| **Blaupause B: „der Host-Client berechnet die Mehrheit"** | Das ist exakt der bestehende Fehler. Host-Client-Logik ist der Grund, warum `rewardPoints`/`damage` heute nirgends ankommen. | Auflösung **serverseitig**, ausnahmslos (→ Blocker B1). |
| **Kahoot-artiger Millisekunden-Wettbewerb** | Bei 2,5-s-Polling nicht fair abbildbar; Client-Timestamps sind manipulierbar. | Geschwindigkeit nur als **Reihenfolge-Bonus innerhalb eines Zeitfensters**, nie als Ranking auf Millisekunden. |

Der Rest des Katalogs — simultane Auflösung, Geister-Mechanik, Storylets,
asymmetrische Information, Callbacks, Eskalation, Joker, Wasser-Bonus,
Catch-Up — geht so in dieses Konzept ein.

---

## 3. Die drei Blocker (Phase 0)

Diese drei Punkte sind der Grund, warum bereits gebaute Mechaniken heute
wirkungslos sind. Jedes Feature aus P1–P3 wäre ohne sie ebenfalls wirkungslos.

### B1 — Spiellogik liegt im Client des Hosts

**Ist:** `StoryGameShell` berechnet Kapitelwechsel und Finale lokal und schickt
fertigen Text an den Server. Der Server (`server/gameRooms.js`) speichert nur.
`submitAction` verrechnet `damage` **ausschließlich** beim actionType
`coop_damage` — den der Client nie sendet. Er sendet `player_choice`, was im
generischen `actions`-Bucket landet. `rewardPoints` wird nirgends gelesen.

**Folge:** Die Team-HP-Leiste im Haunted Manor bewegt sich nie. Punkte aus
Entscheidungen existieren nicht. Der Host könnte den Spielausgang beliebig
fälschen.

**Soll:** Eine Zustandsmaschine in `server/gameRooms.js`. Der Server kennt die
Spieldefinition, wendet Effekte an, entscheidet über Phasenwechsel. Der Client
rendert nur noch und schickt Absichten (`{ storyletId, choiceId }`).

> Die Story-Definitionen unter `src/games/stories/` sind heute TypeScript mit
> Funktionen (`generateText`, `assignRoles`, `evaluateFinale`) und damit für den
> Node-Server nicht direkt nutzbar. Sie werden zu **deklarativen Daten** (JSON-
> nahe Strukturen mit Bedingungen und Effekten, siehe §5), die Client und Server
> gemeinsam lesen. Das ist der eigentliche Aufwandstreiber von P0.

### B2 — Räume sterben beim stündlichen Auto-Update

**Ist:** Räume liegen in einer RAM-`Map` (`activeRooms`). TTL 3 Stunden, das
reicht. Aber: [`auto-update.sh`](../auto-update.sh) läuft stündlich per Cron,
und bei jedem neuen Commit auf `main` folgt `docker compose up -d --build`.

**Folge:** Ein Backend-Neustart **löscht jede laufende Session**. Bei
5-Minuten-Spielen fällt das kaum auf. Eine 45-Minuten-Session hat bei stündlichem
Deploy-Fenster eine reale Chance, mittendrin ersatzlos zu verschwinden — der
schlimmstmögliche Abbruch, weil er die Gruppe für den Abend verbrennt.

**Soll:** Raum-State bei jedem *Phasenwechsel* (nicht bei jedem Poll) als JSON in
eine Tabelle `game_rooms` schreiben, beim Serverstart aktive Räume
zurückladen. **Achtung: beide DB-Zweige** (Postgres *und* JSON-Fallback) —
laut [`PROJEKTUEBERGABE.md`](./PROJEKTUEBERGABE.md) die Falle, die schon
mehrfach zugeschlagen hat.

### B3 — Spiel-Punkte werden vom Getränke-Tracking überschrieben

**Ist:** `recalculateUserStats()` in `server/db.js:169` setzt
`user.points = totalPoints`, wobei `totalPoints` **ausschließlich** aus
Getränke-Logs berechnet wird. Die Funktion läuft bei praktisch jedem Nutzer-
Abruf.

**Folge:** Würde man Spiel-XP nach `users.points` schreiben, wären sie beim
nächsten Request weg. Der „Quick Win: Spiele geben XP" aus dem Research ist in
Wahrheit kein Quick Win — er braucht ein Schema.

**Soll:** Neue Spalte `game_points INTEGER DEFAULT 0`, und in
`recalculateUserStats`: `user.points = totalPoints + (user.game_points || 0)`.
Gutschrift über einen idempotenten Endpunkt, der pro Session-ID nur einmal
zählt (Tabelle `game_settlements`), damit ein wiederholter Poll oder ein
Reconnect nicht doppelt auszahlt.

> Nebeneffekt beachten: XP frieren am Level-Limit ein, bis eine Pflichtaufgabe
> erledigt ist (`db.js:180`). Spiel-XP erben dieses Verhalten — das ist
> konsistent und gewollt, muss aber im UI erklärt werden, sonst wirkt eine
> Session-Belohnung wie ein Bug.

---

## 4. Die vier Kernsysteme (spielübergreifend)

Diese Systeme werden **einmal** gebaut und von allen Spielen genutzt.

### S1 — Der Session-Bogen

Jede Spielrunde bekommt eine Dramaturgie statt einer Endlosschleife:

| Akt | Dauer | Charakter | Punkte |
|---|---|---|---|
| **I — Aufwärmen** | ~10 Min | harmlose Prompts, Regeln etablieren sich | ×1 |
| **II — Eskalation** | ~15 Min | Intensität steigt, erste Callbacks, Catch-Up greift | ×2 |
| **III — Finale** | ~10 Min | Sudden Death, Callbacks aus Akt I, Entscheidung | ×3 |

Der Aktwechsel ist **sichtbar** (Vollbild-Übergang, Punktestand, „Akt II
beginnt"). Das Ende ist definiert — eine Session hat einen Gewinner, keinen
Ausstieg per Zufall. Der Intensitäts-Schalter (harmlos/party/spicy) wird vom
manuellen Filter zur **Obergrenze**: Akt I zieht harmlos, Akt III zieht bis zur
gewählten Grenze.

### S2 — Währung, Einsatz und Ausweg

- **Punkte sind die Leitwährung**, Schlucke eine Option unter mehreren. Jede
  Karte bietet mindestens zwei Wege (z. B. „Aufgabe machen: +30 · Joker:
  0 · Schluck: +10").
- **Joker-Tokens:** 2 pro Spieler pro Session. Überspringen ohne Begründung und
  ohne Gesichtsverlust, weil es eine *Spielressource* ist und keine Kapitulation.
  Wer am Ende ungenutzte Joker hat, bekommt Bonuspunkte — das macht Nicht-Trinken
  strategisch statt peinlich.
- **Wasser-Bonus:** Ein geloggtes alkoholfreies Getränk während der Session gibt
  einen Joker zurück. Verbindet die Spielesektion mit dem Kern der App und ist
  gleichzeitig das stärkste Argument in einem Store-Review.
- **Catch-Up:** Wer im letzten Drittel deutlich zurückliegt, zieht Karten mit
  höherem Punktwert. Verhindert, dass die halbe Gruppe ab Minute 20 innerlich
  aussteigt.

### S3 — Das Sitzungsgedächtnis (Callbacks)

Ein Speicher pro Session: `{ playerId, kind, text, actMs }` — wer wurde
beschuldigt, wer hat was zugegeben, wer hat welche Aufgabe verweigert.

Karten können Slots referenzieren: `„{{callback:gestaendnis}} — und jetzt erklär
das nochmal, aber überzeugend."` Das ist mechanisch billig (String-Interpolation)
und erzeugt genau die Insider-Witze, die eine Gruppe bei der Stange halten.

### S4 — Die Meta-Brücke

- **Spiel-Punkte → `game_points`** (siehe B3), gedeckelt pro Tag gegen
  Farming.
- **Spiel-Erfolge:** ~8 neue Achievements, die an Spielen hängen statt an
  Getränken — z. B. „Verräter entlarvt", „Session ohne Joker beendet",
  „Alle drei Akte durchgespielt".
  > Falle: Es gibt **zwei** Achievement-Listen — `src/services/achievements.ts`
  > und `ACHIEVEMENTS_METADATA` in `src/components/AchievementModal.tsx`. Sie
  > sind schon heute nicht synchron. Beide pflegen.
- **Session-Report:** Am Ende ein teilbarer Ergebnis-Screen (Sieger, kurioseste
  Momente aus S3, Punktetabelle) mit *opt-in*-Post in den Gruppen-Feed.

---

## 5. Story-RPG: Engine v2

Das ist der Teil mit dem größten Hebel — heute 5 Minuten, Ziel 30–45.

### Vom Kapitel-Array zum Storylet-Pool

Statt drei fixer Kapitel ein Pool von ~40 **Storylets**. Jedes hat Bedingungen
und Effekte; der Server wählt aus den erfüllbaren Storylets gewichtet aus. Das
erzeugt Varianz und Wiederspielwert ohne kombinatorische Text-Explosion.

```ts
interface Storylet {
  id: string;
  act: 1 | 2 | 3;
  weight: number;
  /** Bedingungen gegen die Story-Variablen; leer = immer möglich */
  requires?: Condition[];
  /** Einmal pro Session, oder wiederholbar */
  once?: boolean;
  text: TextTemplate;          // Slots: {{player:zufall}}, {{callback:...}}
  phase: StoryletPhase;        // siehe unten
}

type StoryletPhase =
  | { kind: "simultaneous_choice"; choices: Choice[]; deadlineSec: number }
  | { kind: "role_action"; role: RoleId; choices: Choice[]; deadlineSec: number }
  | { kind: "discussion"; seconds: number; prompt: string }
  | { kind: "vote"; prompt: string; candidates: "alive" | "all" };

interface Choice {
  id: string;
  label: string;
  effects: Effect[];           // wird SERVERSEITIG angewendet
}

type Effect =
  | { set: string; delta: number }        // Story-Variable, z.B. panik +15
  | { points: number; scope: "self" | "team" }
  | { sips: number }                       // immer optional für den Spieler
  | { remember: { kind: string } };        // schreibt ins Sitzungsgedächtnis
```

Die Variablen (`panik`, `hinweise`, `verdacht_auf`) sind der Zustand, der die
Story trägt. Ein Endgame-Storylet wird freigeschaltet, sobald `hinweise >= 5`
**oder** `panik >= 80` — daher kommen unterschiedliche Enden, ohne dass ein
Erzählbaum geschrieben werden muss.

### Rollen bekommen Fähigkeiten

Heute ist eine Rolle ein Textfeld. Künftig hat sie **eine Fähigkeit mit
Ladung** und **einen exklusiven Startbaustein**:

- *Das Medium*: darf 2× pro Session die letzte Abstimmung eines Spielers sehen.
- *Der Gelehrte*: kennt einen von drei echten Hinweisen.
- *Der Besessene* (Verräter): jede Aktion, die er wählt, verschiebt `panik`
  heimlich nach oben; er gewinnt bei Team-Niederlage.

Das Feld `interactivePrompt.forRole` existiert im Datenmodell bereits und wird
im UI nicht ausgewertet — hier wird es endlich eingelöst.

### Simultane Auflösung statt Host-Klick

Der zentrale Eingriff gegen Leerlauf:

1. Server setzt `phase.deadlineAt` (absoluter Zeitstempel) und antwortet bei
   jedem Poll zusätzlich mit `serverTime`.
2. Der Client berechnet einmalig seinen Offset und rendert den Countdown
   daraus — **nie** aus einem lokalen Timer, sonst laufen 8 Geräte auseinander.
3. Der Server löst auf, sobald **alle** abgegeben haben oder die Deadline
   überschritten ist (lazy geprüft bei jedem Poll — kein Interval, das einen
   Neustart nicht überlebt).
4. Auflösung = Effekte anwenden, nächstes Storylet wählen, `revision` erhöhen.

Der Host-Button entfällt bis auf eine Notbremse („Phase überspringen").
2,5-Sekunden-Polling genügt dafür vollständig: Die Gruppe erlebt „gleichzeitig",
weil alle dasselbe Deadline-Fenster sehen, nicht weil Pakete schnell sind.

### Ausscheiden ohne Ausstieg (Geister)

Wer stirbt, behält das Handy: halbe Stimme bei Abstimmungen und eine
Geister-Aktion pro Runde (einem Lebenden einen Vor- oder Nachteil zuweisen).
Löst das laut Research schwerwiegendste Abbruchmuster — der Ausgeschiedene
zieht sonst die ganze Gruppe mit raus.

### Ablauf einer Session (Ziel: 35–45 Min)

| Minute | Phase | Was passiert |
|---|---|---|
| 0–5 | Setup | Beitritt per Code, Rollenvergabe, exklusive Startbausteine |
| 5–15 | Akt I | 3–4 Storylets, simultane Entscheidungen, erste Rollenfähigkeit |
| 15–25 | Akt II | Diskussionsphase mit Timer, erste Abstimmung, erstes Ausscheiden |
| 25–35 | Akt III | Endgame-Storylet, Geister mischen mit, finale Anklage |
| 35–40 | Nachspiel | Auflösung, Rollen offen, Session-Report, Punkte-Settlement |

**Content-Budget:** ~40 Storylets à ~80 Wörter + 8 Rollen ≈ 4.000 Wörter für
*ein* Setting. Deshalb: erst **Mord im Mitternachts-Express** vollständig (der
Krimi trägt Deduktion am natürlichsten), die anderen beiden bleiben zunächst auf
der alten Engine.

---

## 6. Lokale Spiele: eigene Tiefe, nicht nur ein Rahmen

Die acht Pass-the-Phone-Spiele leiden am selben Grundproblem wie die Story-RPGs,
brauchen aber eine andere Antwort. Sie bekommen **zwei Ebenen**: einen
Session-Layer, der über allen Spielen liegt, und je Spiel eine echte Mechanik,
die dem Spiel fehlt.

### 6.1 Warum die lokalen Spiele anders funktionieren müssen

Ein Gerät, alle sehen denselben Bildschirm. Das schließt geheime Information
weitgehend aus — der Hebel der Story-RPGs entfällt. Dafür gibt es zwei andere:

**Das Leerlauf-Problem ist hier ein anderes.** Nicht „alle warten auf den Host",
sondern „einer macht, fünf schauen zu". Die Antwort darauf ist nicht simultane
Eingabe, sondern **Vorhersage**: Wer nicht dran ist, tippt auf den Ausgang.
Zuschauen wird zur Handlung. Das ist billig zu bauen und wirkt sofort.

**Kontinuität ersetzt Geheimnis.** Was diese Spiele über 30 Minuten trägt, ist
nicht Deduktion, sondern ein Zustand, der sich anhäuft: Regeln, die gelten,
Titel, die kleben, Fakten, die die Gruppe gegeneinander verwendet.

### 6.2 Der Session-Layer „Die Nacht"

Die Spiele werden zu Runden innerhalb einer durchgehenden Session. Vier Systeme
laufen darüber und über die Spielwechsel hinweg weiter:

**Aktive Regeln.** Gezogene Regelkarten bleiben in einer sichtbaren Leiste
stehen und gelten weiter — auch nach dem Wechsel in ein anderes Spiel. Nach
20 Minuten gelten sechs bis acht Regeln gleichzeitig, jeder verstößt ständig
gegen irgendeine, und genau daraus entsteht die Eskalation. Das ist der Grund,
warum Kings Cup 45 Minuten trägt und die aktuelle Skull-Umsetzung fünf.

**Statuseffekte.** Zeitlich begrenzte persönliche Auflagen („bis zum Ende des
Aktes darfst du niemanden beim Vornamen nennen"), vergeben als Strafe oder
Belohnung. Sie überleben den Spielwechsel und sind das stärkste Bindeglied
zwischen zwei ansonsten unabhängigen Minispielen.

**Dossier und Titel.** Die Session sammelt Fakten pro Spieler (wer hat was
zugegeben, wer wurde wie oft gewählt) und vergibt daraus Titel — *Der
Verdächtige*, *Die Unschuldsvermutung*, *Der Fluchtwagenfahrer*. Titel sind
nicht nur Deko: Karten können sie **adressieren** („Der Verdächtige zieht diese
Karte"). Damit hört das Spiel auf, anonyme Prompts zu werfen, und fängt an, auf
die konkrete Gruppe zu zeigen.

**Vorhersage.** Bei jeder Einzelaktion tippen die Zuschauer vorher auf den
Ausgang. Richtig getippt gibt Punkte. Kein Moment ohne Beteiligung.

Dazu die Rahmen-Mechanik: Beim Start Länge wählen (kurz ~20 / normal ~40 /
lang ~60 Min) und Intensitätsgrenze setzen. Die Session wechselt selbstständig
zwischen den Spielen — vier Karten „Ich hab noch nie", dann eine Runde
Wortbombe, dann Wahrheit/Pflicht. **Der Spielwechsel selbst ist das billigste
wirksame Mittel gegen Ermüdung** und kostet keinen neuen Content. Punkte laufen
durchgehend weiter, die Akt-Multiplikatoren aus S1 greifen. Finale: Sudden Death
zwischen den zwei Führenden, gespeist aus dem Sitzungsgedächtnis.

### 6.3 Je Spiel: die fehlende Mechanik

Kein Spiel wird ersetzt. Jedes bekommt das, was ihm strukturell fehlt.

**Ich hab noch nie** — heute: Karte lesen, Karte wechseln. Künftig tippen alle,
die es getan haben, auf ihren Namen. Drei Dinge entstehen daraus: eine
**Minderheitswertung** (wer als Einziger tippt, erzählt die Geschichte und
bekommt den vollen Punktwert — das Spiel belohnt endlich das, weswegen man es
spielt), ein **Dossier-Eintrag**, und **Nachhak-Karten**, die später gezielt an
die Person gehen, die zugegeben hat.

**Wer würde eher** — heute: abstimmen, auflösen, weiter. Künftig kommt vor der
Auflösung eine **Vorhersage** („wer bekommt die meisten Stimmen?"), danach eine
**Verteidigungsrede** von 30 Sekunden für den Gewählten und eine zweite
Abstimmung. Aus zehn Sekunden Abstimmung werden zwei Minuten Gruppendynamik.
Mehrfach Gewählte sammeln Titel für den Session-Layer.

**Wahrheit / Pflicht** — heute: Flasche drehen, Zufallstext. Künftig eine
**persönliche Eskalationsleiter**: Wer wiederholt Wahrheit wählt, dessen nächste
Pflicht wiegt schwerer und ist nicht mehr jokerbar. Aufgaben bekommen eine
**Laufzeit** („bis zum Ende des Aktes") und werden damit zu Statuseffekten. Ein
zweiter Spieler wird als **Zeuge** bestimmt, der abnimmt, ob die Aufgabe zählt.

**Busfahrer** — heute ist ein Drittel des Spiels implementiert. Die vier Stufen
in [`Busfahrer.tsx`](../src/components/games/Busfahrer.tsx) sind die *Busfahrt*,
also die Schlussphase. Es fehlen die beiden Phasen davor: die **Fragerunde**
(jeder bekommt Karten, Fragen nach Rot/Schwarz, höher/tiefer usw.) und die
**Pyramide**, in der aufgedeckte Karten Schlucke verteilen und sich entscheidet,
wer am Ende fahren muss. Genau diese Phasen erzeugen die Spannung — die Busfahrt
allein ist nur eine Ratefolge. Hier wird kein neues Spiel erfunden, sondern ein
vorhandenes fertiggebaut.

**Höher / Tiefer** — heute: raten, bei Fehler Schluck. Künftig **Push your
luck**: Jede richtige Ansage erhöht den Pot, nach jeder Runde die Wahl zwischen
aussteigen (Punkte sichern) und weitermachen (verdoppeln, bei Fehler alles weg).
Die Zuschauer tippen mit, ob die Person aussteigt oder weitermacht. Sehr wenig
Code, sehr viel Spannung.

**Skull** — heute: 40 Regelkarten, jede wird gezogen, vorgelesen und sofort
vergessen. Künftig wandern gezogene Regeln in die **aktive Regelleiste** des
Session-Layers und gelten bis zum Aktende. Der Content existiert bereits
vollständig; es fehlt ausschließlich die Ablage. Das ist die größte Wirkung pro
Zeile Code im gesamten Konzept.

**Wortbombe** — heute: verdeckter Timer, wer hält, trinkt, neue Runde. Künftig
**Ausscheiden statt Schluck**, mehrere Runden, die letzten zwei duellieren sich.
Dazu ein **Einspruch-Button**: Wer ein Wort für ungültig hält, drückt, die Gruppe
entscheidet per Schnellabstimmung. Das erzeugt die Reibung, die dem Spiel fehlt.
In Akt III kommt ein Buchstaben-Zwang dazu.

**1v1 Duell** — bleibt als Format, wird aber der **Finalmodus von „Die Nacht"**:
Die zwei Führenden treten gegeneinander an, die Fragen kommen aus dem
Sitzungsgedächtnis, der Rest der Gruppe tippt auf den Sieger.

### 6.4 Später: die lokalen Spiele auf mehrere Geräte holen

„Ich hab noch nie" und „Wer würde eher" gewinnen massiv, wenn jeder geheim auf
dem eigenen Gerät antwortet und gleichzeitig aufgedeckt wird — dieselbe Mechanik
wie bei den Story-RPGs. Die Raum-Infrastruktur existiert bereits. Das ist
bewusst P4: erst muss der Session-Layer auf einem Gerät sitzen.

---

## 7. Roadmap

Jede Phase ist für sich auslieferbar und spürbar.

### P0 — Fundament (Voraussetzung für alles) — ✅ erledigt am 20.08.2026

1. ✅ Story-Definitionen → deklarative Daten unter `server/games/stories/*.json`
2. ✅ Zustandsmaschine + Effekt-Anwendung in `server/games/storyEngine.js`
   und `server/gameRooms.js`; der Client rendert nur noch
3. ✅ Raum-Persistenz `game_rooms` (**beide** DB-Zweige) + Reload beim Start
4. ✅ `game_points` + `game_settlements` + Anpassung `recalculateUserStats`

*Fertig, weil:* eine Entscheidung bewegt die HP-Leiste auf allen Geräten
(`tests/gameengine.test.js`), ein Serverneustart mitten in der Runde lässt den
Raum samt Spielstand und Geheimrolle stehen, und gutgeschriebene Spiel-XP
überstehen die Neuberechnung aus den Getränke-Logs.

Drei Dinge kamen beim Bauen dazu, die vorher niemand auf dem Zettel hatte:

- **Rollen kamen bis dahin vom Host-Client.** Er konnte sich selbst zum
  Detektiv und einen Mitspieler zum Mörder erklären — in einem Spiel, dessen
  ganzer Witz die geheime Rollenverteilung ist. Verteilt jetzt der Server.
- **Punkte ließen sich hochspammen.** Dieselbe Auswahl war beliebig oft
  einreichbar. Jetzt gilt: eine Entscheidung pro Kapitel und Spieler.
- **Die Auswahl-Effekte gingen an den Client.** Wer die Werte kennt, kann sie
  fälschen; ausgeliefert werden nur noch Beschriftung und Ziel-Pflicht.

Offen aus P0 heraus: eine **Tagesobergrenze** für Spiel-XP. Die Punkte sind
nicht mehr fälschbar, aber wer viele kurze Runden startet, sammelt weiter.
Gehört zu P3, wenn der Meta-Layer dran ist.

### P1 — Spürbarkeit — ✅ erledigt am 20.08.2026

*Story-RPG:*
5. ✅ Simultane Auflösung mit Server-Deadline; Host-Button ist nur noch
   Notbremse („Phase überspringen")

*Lokale Spiele:*
6. ✅ Session-Layer „Die Nacht" (`src/games/session.tsx`): Akte mit steigendem
   Multiplikator, durchlaufender Punktestand, Spielwechsel
7. ✅ **Aktive Regelleiste** — gezogene Skull-Regeln bleiben in Kraft
8. ✅ Tipprunde für Zuschauer (in Höher/Tiefer, ab drei Personen)
9. ✅ Höher/Tiefer als Push-your-luck mit Topf und Ausstiegswahl

*Beide:*
10. ✅ Joker-Tokens (2 pro Person) und Wasserrunde je Akt

*Fertig, weil:* in der laufenden App stapeln sich vier Skull-Regeln sichtbar und
wandern beim Wechsel nach Höher/Tiefer mit; die Wasserrunde erhöht alle
Jokerstände; in der Tipprunde bekommt genau der Zuschauer Punkte, der richtig
lag. Serverseitig belegen 33 Tests Fristen, Serveruhr, sofortige Auflösung nach
der letzten Eingabe und den Selbstlauf bei abgelaufener Frist.

Aufgefallen beim Bauen: **Skull und Höher/Tiefer rendern als einzige ihre eigene
Hülle statt `GameShell`** — sie hätten die Session-Leiste sonst nie gesehen. Kein
Typecheck fängt das; nur der Blick in die laufende App.

Verschoben: Die Akt-Schwellen (8 und 18 Runden) sind gesetzt, aber nicht an
echten Runden erprobt. Gehört nach der ersten Testrunde mit Menschen justiert.

### P2 — Tiefe

*Story-RPG:*
11. Storylet-Engine + Content-Pack „Mitternachts-Express" (~40 Storylets)
12. Rollen mit Fähigkeiten und exklusiven Informationen
13. Geister-Modus, Diskussionsphasen mit Timer

*Lokale Spiele:*
14. Statuseffekte über Spielwechsel hinweg (§6.2)
15. Dossier + Titel + adressierbare Karten
16. „Ich hab noch nie" mit Minderheitswertung, „Wer würde eher" mit
    Verteidigungsrede
17. **Busfahrer fertigbauen** — Fragerunde und Pyramide ergänzen
18. Wortbombe: Ausscheiden, Einspruch, Duell-Finale

*Beide:*
19. Sitzungsgedächtnis/Callbacks (S3)

*Fertig, wenn:* eine Testgruppe von 5 Leuten den Krimi ohne Aufforderung zu Ende
spielt — und eine zweite Gruppe „Die Nacht" 40 Minuten durchhält, ohne dass
jemand nach einem anderen Spiel fragt.

### P3 — Bindung über den Abend hinaus

20. Session-Report + opt-in Gruppen-Feed-Post
21. Spiel-Erfolge (beide Achievement-Listen)
22. Punkte-Settlement sichtbar im Profil/Scoreboard
23. Wahrheit/Pflicht: Eskalationsleiter, Zeuge, Aufgaben mit Laufzeit
24. 1v1-Duell als Finalmodus von „Die Nacht"

### P4 — Optional

25. Lokale Spiele auf mehrere Geräte (§6.4)
26. Prozedurale Lückentexte aus Spielereingaben
27. Zuschauer-Modus über die Spielerobergrenze hinaus
28. Content-Packs für die beiden übrigen Story-Settings

---

## 8. Messplan

Ohne Zahlen ist „mehr Bindung" eine Behauptung. Vier Ereignisse genügen, alle
serverseitig aus dem Raum-State ableitbar — kein Analytics-SDK nötig:

| Kennzahl | Erhebung | Zielwert |
|---|---|---|
| Session-Dauer | `Raum erstellt` → `Finale erreicht`/`letzte Aktivität` | Median > 25 Min (heute ~5) |
| Abbruchpunkt | letztes Storylet / letzter Akt vor Inaktivität | kein Storylet mit auffälligem Peak |
| Abschlussquote | Sessions mit erreichtem Finale ÷ gestartete | > 60 % |
| Joker-Nutzung | Tokens verbraucht ÷ ausgegeben | 20–50 % (bei >80 % ist der Content zu hart) |

---

## 9. Verantwortung und Store-Freigabe

Der Umbau verbessert die Store-Position, statt sie zu gefährden:

- Punkte als Leitwährung machen aus einer „Trinkspiel-App" eine Party-Spiel-App
  mit Alkohol-Option — genau die Unterscheidung, an der Apple 1.4.3 hängt.
- Joker und Wasser-Bonus sind belegbare Safety-Mechaniken.
- Kein XP-Verlust, kein Wetten auf Bestand, keine erzwungenen Foto-Uploads.
- Die „spicy"-Stufe bleibt hinter dem bestehenden 18+-Gate und wird durch die
  Akt-Struktur erst spät erreicht, statt sofort verfügbar zu sein.

---

## 10. Getroffene Entscheidungen

Entschieden am 20.08.2026:

1. **Tiefe vor Breite.** Ein Story-Setting wird komplett neu gebaut
   (Mitternachts-Express), die anderen beiden bleiben zunächst auf der alten
   Engine. Gilt für die Story-Settings — **nicht** für die lokalen Spiele: die
   bekommen ihre Tiefe über den gemeinsamen Session-Layer (§6.2) und damit alle
   gleichzeitig.
2. **Bonus-Topf statt XP-Verlust.** Man kann in einer Session gewinnen, aber nie
   unter den Vor-Session-Stand fallen.
3. **Polling bleibt.** Synchronisation über absolute Server-Deadlines; WebSockets
   werden frühestens in P4 neu bewertet.
4. **Content-Entwurf von mir**, Redaktion der Tonalität durch den Betreiber.
