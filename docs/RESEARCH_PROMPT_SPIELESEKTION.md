# Research-Prompt: Spielesektion TrinkDuell bindungsstark machen

> Dieser Prompt ist zum **Kopieren in ein Research-fähiges KI-Tool** gedacht
> (Deep Research, Web-Suche aktiviert). Er ist bewusst faktenreich: alle
> Ist-Zustands-Angaben in Abschnitt 2 wurden am Code verifiziert, damit die
> Recherche nicht an Vermutungen vorbeiarbeitet.

---

## ROLLE

Du bist Game-Design-Researcher mit Schwerpunkt auf **Social-/Party-Games,
Session-Retention und Live-Multiplayer auf Mobilgeräten**. Du recherchierst
belegbar (Web-Suche, Fachquellen, Teardowns echter Apps) und lieferst ein
Entscheidungsdokument, kein Brainstorming.

## AUFTRAG IN EINEM SATZ

Finde heraus, **welche Spielmechaniken dafür sorgen, dass eine Gruppe bei einem
Party-/Trinkspiel 30–60 Minuten am Stück dranbleibt statt nach 2–3 Runden
aufzuhören** — und welche davon konkret in die unten beschriebene App passen.

---

## 1. PRODUKTKONTEXT

**TrinkDuell** ist eine App, mit der Freundesgruppen ihren Getränke-Konsum
spielerisch tracken: Rangliste, Level/XP, Erfolge, Feed, Karte, Duelle,
Gruppen-Quests — und eine Spielesektion mit Trinkspielen.

- **Zielgruppe:** private Freundesgruppen, 18+, Party-/Vorglüh-/Abendsituation
- **Nutzungssituation:** laut, Alkohol im Spiel, 2–16 Personen, das Handy wird
  herumgereicht ODER jeder hat sein eigenes Gerät (Beitritt per Raum-Code)
- **Sprache:** Deutsch, Du-Form, hoher Humor- und Frechheits-Anteil
- **Verantwortungsrahmen (nicht verhandelbar):** Alters-Gate 18+, jeder
  Spieltext bietet immer eine Alternative („… oder trinke 1 Schluck"),
  alkoholfreie Getränke zählen gleichwertig, Hydrations-Hinweise, Bonus-XP für
  Wasser. Grund: die App soll in App Store und Play Store, und beide Stores
  kippen Apps, die Trinkzwang oder Exzess bewerben.
- **Technik:** Expo SDK 55 / React Native 0.83 / TypeScript, expo-router,
  NativeWind; Backend Express + PostgreSQL (mit JSON-Fallback). Multiplayer-
  Räume liegen **nur im RAM** (Map mit TTL), der Client pollt alle 2,5 Sekunden.
  Kein WebSocket, keine Persistenz der Räume.

## 2. IST-ZUSTAND DER SPIELESEKTION (am Code verifiziert)

11 Spiele in 4 Kategorien, in zwei Bauarten:

**A) Multi-Device Story-RPGs (3 Stück: Verrat am Königshof, Mord im Mitternachts-
Express, Escape the Haunted Manor)** — vermarktet als 15–20-Minuten-Erlebnis,
real in ~5 Minuten durch:

- Jedes Spiel hat **exakt 3 Kapitel** (Akt I–III). Die Kapitel sind ein
  statisches Array — es gibt **keine Verzweigung**; der Text hängt nie von
  vorherigen Entscheidungen ab, sondern nur von Spielernamen und Zufall.
- Pro Kapitel gibt es **genau eine** interaktive Wahl aus 3 Optionen, danach
  wartet man. Am Ende **eine** Abstimmung → Finale-Screen. Fertig.
- **Entscheidungen haben mechanisch keine Folgen:** die Felder `rewardPoints`
  und `damage` der Auswahloptionen werden serverseitig nie verrechnet. Die
  gemeinsame Team-HP-Leiste des Horror-Spiels bewegt sich faktisch nie.
- **Rollen sind Deko:** jeder bekommt zufällig eine Geheimrolle mit Text, aber
  keine Rolle verleiht eine Fähigkeit, eine Extra-Aktion oder exklusive
  Information. Ein Feld für rollenspezifische Prompts existiert im Datenmodell,
  wird im UI aber nicht ausgewertet.
- **Passiver Ablauf:** nur der Host hat einen „Nächstes Kapitel"-Button, alle
  anderen sehen „Warte auf die Entscheidung des Hosts…". Kein Timer, kein
  Zeitdruck, keine parallelen Aktionen, keine strukturierte Diskussionsphase.
- Räume sind flüchtig: keine Fortsetzung, keine Historie, kein Ergebnis, das
  irgendwo bleibt.

**B) Lokale Pass-the-Phone-Spiele (8 Stück: Ich hab noch nie, Wer würde eher,
Wahrheit/Pflicht, Busfahrer, Höher/Tiefer, Skull-Karten, Wortbombe, 1v1-Duell)**

- Im Kern **Karten-Shuffler**: zufälliger Text aus einer Liste, Button „Nächste
  Karte", wiederholen. Drei Intensitätsstufen (harmlos / party / spicy) als
  reiner Filter über dieselbe Mechanik.
- **Kein Punktestand, keine Rundenstruktur, kein Ende, keine Eskalation.**
  „Ich hab noch nie" zählt nur einen Rundenzähler hoch. Nur „Wer würde eher"
  kennt überhaupt die Spielerliste (Abstimmung) — aber Ergebnisse werden nicht
  kumuliert und sind nach der Frage weg.
- Content-Bestand: ~124 „Ich hab noch nie", ~80 „Wer würde eher", ~60
  Wahrheiten, ~40 Pflichten, 84 Wortbomben-Kategorien.
- Ausnahmen mit echter Mechanik: Busfahrer (4 Stufen richtig raten) und
  Wortbombe (verdeckter 20–45-Sekunden-Timer).

**C) Null Verzahnung mit dem Rest der App.** Level/XP, Punkte, Erfolge,
Scoreboard, Feed, Gruppen-Quests und Duelle existieren — aber **kein einziger
Erfolg und kein einziger XP-Punkt hängt an einem Spiel**. Alle Erfolge hängen am
Getränke-Logging. Die einzige Brücke ist ein „Beweisfoto"-Button.

## 3. DAS ZU LÖSENDE PROBLEM

Die Spiele sind eine **Fassade ohne Tiefe**: mechanisch reizvoll für ~5 Minuten,
danach bricht die Gruppe ab, weil nichts auf dem Spiel steht, sich nichts
verändert, nichts erinnert wird und nichts eskaliert.

**Die Kernfrage:** Was hält eine angeheiterte Gruppe von 4–8 Leuten **30–60
Minuten** an einem Spiel — und was davon lässt sich in dieser Architektur bauen?

---

## 4. FORSCHUNGSFRAGEN

Bearbeite alle sieben Blöcke. Wo es empirische Daten gibt (Retention-Zahlen,
Session-Längen, Studien), nenne sie mit Quelle; wo es nur Designtheorie oder
Praxiswissen gibt, kennzeichne das ausdrücklich als solches.

### A) Warum Gruppen abbrechen

1. Was ist in Forschung und Designpraxis über **Abbruchursachen bei
   Party-Spielen** bekannt (Leerlauf, fehlender Einsatz, Wiederholung,
   Ausschluss einzelner Spieler, kognitive Last unter Alkohol)?
2. Welche Rolle spielt **passives Warten** (einer agiert, der Rest schaut) für
   den Abbruch? Welche Designs vermeiden das (simultane Eingaben, Rollen mit
   Daueraufgabe, Publikumsmechaniken wie die Jackbox-Audience)?
3. Was ist die typische, real gemessene **Session-Länge** vergleichbarer
   Party-Apps — und woran hängt sie?

### B) Mechaniken, die innerhalb einer Sitzung binden

4. **Sitzungs-Fortschritt:** Welche Mechaniken bauen über 30–60 Minuten Spannung
   auf (Eskalationskurven, Phasen/Akte, Deck-Building innerhalb einer Runde,
   Rundenzähler mit Konsequenz, Endgame-Trigger)?
5. **Einsatz & Konsequenz:** Wie erzeugen Spiele echte Stakes ohne Trinkzwang
   (Punkte, Handicaps, Immunitäten, Verpflichtungen für spätere Runden, knappe
   Ressourcen, „Schulden", die später eingelöst werden)?
6. **Persistenter Zustand innerhalb der Sitzung:** Wie wirken Mechaniken, die
   frühere Runden zurückholen (Callbacks auf gegebene Antworten, personalisierte
   Karten aus früheren Eingaben, laufende Fehden zwischen zwei Spielern,
   Legacy-Effekte)?
7. **Asymmetrie:** Wie viel trägt es, wenn Spieler unterschiedliche Rollen mit
   *echten Fähigkeiten* und exklusiver Information haben statt Flavour-Text?
8. **Spannungsregelung:** Timer, verdeckte Information, Zufallsereignisse,
   Sudden-Death — was funktioniert nachweislich, was nervt?

### C) Story- und Social-Deduction-Design im Speziellen

9. Wie strukturieren gute Social-Deduction-Spiele (Werwolf, Secret Hitler, Blood
   on the Clocktower, Among Us, Fibbage/Jackbox-Story-Formate, Krimidinner-Boxen)
   eine **30–90-Minuten-Session**? Welche Phasen, welche Taktung, wie viele
   Entscheidungspunkte pro Spieler?
10. Wie sieht eine **verzweigte Narration** aus, die mit vertretbarem
    Content-Aufwand auskommt (Zustandsvariablen plus Textbausteine statt echter
    Baum-Explosion; Storylet-/Quality-Based-Narrative-Muster wie in Fallen
    London)? Was sind die bewährten Muster und ihre Grenzen?
11. Wie gestaltet man **Diskussionsphasen**, damit sie nicht versanden
    (Redezeit-Token, gerichtete Fragen, Anklage-/Verteidigungsstruktur,
    erzwungene öffentliche Festlegung)?
12. Wie geht man mit **ausgeschiedenen Spielern** um, ohne dass sie das Handy
    weglegen (Geister-Rollen, Zuschauer-Abstimmung, Sabotage-Rollen)?

### D) Konkurrenz-Teardown

13. Analysiere **mindestens 8 reale Produkte** aus mindestens drei dieser
    Gruppen und leite jeweils die bindungsstärkste Mechanik ab:
    - Trinkspiel-Apps (z. B. Picolo, Drinkopoly, Truth or Drink, Buzzed,
      King's-Cup-Apps)
    - Party-Apps mit Zweitgerät/Raum-Code (Jackbox-Reihe, Kahoot-artige, Bunch)
    - Social-Deduction-Apps und -Brettspiele
    - Story-/Choice-Games (Episode, Choices, verzweigte Narrative-Spiele,
      Krimidinner-Boxen)

    Nenne pro Produkt: Kernschleife, typische Session-Länge, was die Leute hält,
    was auf unsere Architektur übertragbar ist und was nicht.
14. Welche **App-Store-Reviews** dieser Apps nennen konkret „zu kurz", „schnell
    langweilig", „Wiederholungen"? Was fordern Nutzer dort ein?

### E) Content-Ökonomie & Wiederspielwert

15. Wie viel Content braucht man realistisch, damit sich in einer 60-Minuten-
    Session nichts wiederholt — und ab wann merken Stammnutzer Wiederholung?
16. **Prozedural vs. handgeschrieben:** Welche Kombinationsverfahren (Templates
    mit Slots, Mad-Libs, Spielernamen-Einsetzung, kontextsensitive Auswahl)
    erzeugen glaubwürdig neuen Content ohne in Beliebigkeit zu kippen?
17. **LLM-generierte Inhalte zur Laufzeit** für Story-Kapitel und Karten:
    Erfahrungsberichte, Latenzerwartungen in Live-Sessions, Kosten pro Session,
    Moderations- und Jugendschutzrisiko, Offline-Fallback-Strategien. Wo ist
    Build-Zeit-Generierung (vorab erzeugter Content-Pool) die bessere Wahl?
18. **Nutzergenerierte Inhalte** (eigene Fragen, Gruppen-Decks): Wie stark
    treibt das Bindung, welche Moderationslast entsteht?

### F) Verantwortung, Recht, Store-Freigabe

19. Wo verläuft die Grenze zwischen „spannendem Einsatz" und „Trinkdruck"?
    Welche Formulierungs- und Mechanikmuster halten das Spiel spannend, ohne den
    Konsum zu steigern (Punkte statt Schlucke als Standardwährung,
    Wasser-Optionen mit Spielvorteil, Deeskalationskarten)?
20. Was sagen **Apple App Store Review Guidelines (u. a. 1.1.7, 1.4.3) und
    Google Play (Restricted Content / Alkohol)** konkret zu Trinkspiel-Apps?
    Welche Apps sind daran gescheitert und warum?
21. Welche Muster gibt es für **Safety-Mechaniken im Spiel** (Aufgaben
    überspringen ohne Gesichtsverlust, Konsens-Check bei „spicy"-Inhalten,
    Ausstieg für Einzelne ohne Spielabbruch)? Welche davon verbessern die
    Gruppenerfahrung sogar?

### G) Technische Muster für Live-Multiplayer

22. **Polling (2,5 s) vs. WebSocket/SSE** für rundenbasierte Party-Spiele mit bis
    zu 16 Geräten: Ab welcher Interaktivität (simultane Aktionen, Timer,
    Live-Abstimmungen) reicht Polling nicht mehr? Welche Latenz empfinden Nutzer
    in einer lauten Gruppensituation noch als „gleichzeitig"?
23. **Host-Autorität vs. serverautoritative Spiel-Logik:** Aktuell liegt die
    Spiellogik im Client des Hosts (er berechnet Kapitelwechsel und Finale).
    Welche Aufteilung ist Standard, und wie migriert man dorthin?
24. Wie löst man **Reconnect, Spieler-Drop und Host-Wechsel** mitten in einer
    45-Minuten-Session, wenn Räume flüchtig im RAM liegen? Was muss minimal
    persistiert werden?
25. Welche Muster gibt es für **simultane Eingaben mit Deadline** (alle antworten
    gleichzeitig, Auflösung nach Timer oder sobald alle fertig sind)?

---

## 5. METHODIK

- Suche in **Deutsch und Englisch**. Beispiel-Queries: „party game session length
  retention", „social deduction game design phases", „quality-based narrative
  storylets", „drinking game app reviews repetitive", „Jackbox game design
  audience participation", „App Store guidelines alcohol games rejection",
  „simultaneous turn resolution multiplayer mobile".
- Nutze **Primärquellen, wo möglich**: GDC-Talks, Designer-Postmortems,
  Regelwerke echter Spiele, Store-Guidelines im Originaltext, App-Reviews.
  Sekundäre Listicles („Top 10 Drinking Games") sind als Beleg wertlos —
  höchstens als Fundstelle für Produktnamen.
- **Keine erfundenen Zahlen.** Jede Zahl bekommt eine Quelle. Wo du schätzt,
  schreibe „Schätzung" und begründe sie.
- Spiele echte Produkte gedanklich durch: beschreibe die Kernschleife Schritt für
  Schritt, nicht die Marketingbeschreibung.

## 6. BEWERTUNGSRASTER (auf jede vorgeschlagene Mechanik anwenden)

| Kriterium | Skala |
|---|---|
| Wirkung auf Sitzungsdauer | hoch / mittel / niedrig — mit Begründung |
| Aufwand in dieser Architektur | S (Client-only) / M (Server-State nötig) / L (Echtzeit-Infrastruktur oder viel Content) |
| Content-Abhängigkeit | keine / moderat / hoch (Anzahl neuer Texte grob beziffern) |
| Risiko | Store-Freigabe, Jugendschutz, Trinkdruck, Gruppendynamik |
| Passt zu | lokale Pass-the-Phone-Spiele / Story-RPGs / Meta-Layer / alle |

## 7. GEFORDERTES ERGEBNIS

Ein deutschsprachiges Dokument mit **genau dieser Gliederung**:

1. **Kernbefunde** — max. 1 Seite, 5–7 Aussagen, jede mit Beleg.
2. **Diagnose** — warum die in Abschnitt 2 beschriebenen Spiele nach 5 Minuten
   enden. Ordne jede Abbruchursache einem konkreten Ist-Zustands-Punkt zu und
   benenne klar, welche Ursachen die größten Hebel sind.
3. **Mechanik-Katalog** — 15–25 Mechaniken als Steckbriefe: Name, was es ist,
   *warum es bindet* (mit Quelle/Vorbild), konkretes Anwendungsbeispiel auf eines
   unserer Spiele, plus Bewertungsraster aus Abschnitt 6.
4. **Konkurrenz-Teardown** — Tabelle über die untersuchten Produkte
   (Kernschleife, Session-Länge, bindungsstärkste Mechanik, Übertragbarkeit).
5. **Drei Blaupausen** — je 1–2 Seiten, konkret genug zum Weiterdesignen:
   - (a) ein **lokales Pass-the-Phone-Spiel** mit echtem Sitzungsbogen
     (Anfang / Steigerung / Finale) über 30+ Minuten
   - (b) ein **Story-RPG** mit 30–45 Minuten: Aktstruktur, Entscheidungspunkte
     pro Spieler, Zustandsvariablen, Rollenfähigkeiten, Verzweigungsmodell,
     Diskussions- und Abstimmungsphasen
   - (c) die **Verzahnung mit dem Meta-Layer** (XP, Erfolge, Scoreboard, Feed,
     Duelle, Gruppen-Quests), die zum Wiederkommen an einem anderen Abend führt

   Für jede Blaupause: eine **Minutenkurve** (was passiert in Minute 0–5, 5–15,
   15–30, 30–45) und die Antwort auf die Frage „warum hört hier niemand auf?".
6. **Priorisierte Roadmap** — Impact/Aufwand-Matrix, getrennt in „Quick Wins
   (< 1 Woche)", „Substanz (2–4 Wochen)", „Umbau (> 1 Monat)". Nenne bei jedem
   Punkt, was dadurch messbar besser werden soll.
7. **Messplan** — welche Kennzahlen wir erheben müssten, um „Bindung" zu belegen
   (z. B. Runden pro Sitzung, Sitzungsdauer, Abbruchzeitpunkt, Wiederholrate pro
   Gruppe), und wie man sie in dieser App erhebt.
8. **Offene Fragen & Annahmen** — was du nicht klären konntest, was wir
   entscheiden müssen.
9. **Quellenverzeichnis** — mit Links, nach Themenblock sortiert.

## 8. HARTE RANDBEDINGUNGEN (jeder Vorschlag muss sie erfüllen)

- Funktioniert für **2–16 Spieler**; sag explizit dazu, ab welcher Gruppengröße
  eine Mechanik kippt.
- Funktioniert in einer **lauten, angeheiterten Umgebung**: kurze Texte, große
  Tap-Ziele, keine Regeln, die man zweimal erklären muss, kein Vorlesen von
  Textwänden.
- Bedient beide Bauarten: **ein Handy, das herumgeht** UND **jeder sein eigenes
  Gerät per Raum-Code**. Wenn eine Mechanik nur für eine Bauart taugt, sag es.
- **Kein Trinkzwang.** Schlucke sind eine von mehreren Währungen, nie die
  einzige. Es gibt immer einen Ausweg ohne Gesichtsverlust.
- Deutschsprachiger Content, Du-Form, frech aber nicht herabwürdigend; keine
  Aufgaben, die Dritte außerhalb der Gruppe belästigen oder gefährden.
- Realistisch für ein **kleines Team ohne Live-Ops-Budget**: Content muss
  entweder einmalig produzierbar oder generierbar sein, nicht wöchentlich
  kuratiert.

## 9. WAS DU NICHT LIEFERN SOLLST

- Generische Gamification-Listen („füg Achievements und Streaks hinzu") ohne
  Bezug zur konkreten Spielsituation.
- Vorschläge, die eine Neuentwicklung der App voraussetzen.
- Monetarisierungs-, Marketing- oder Growth-Strategien. Es geht ausschließlich um
  **Spielbindung innerhalb und zwischen Sitzungen**.
- Fertigen Code. Designbeschreibungen und Datenmodell-Skizzen ja, Implementierung
  nein.
- Unbelegte Behauptungen über Nutzerverhalten.
