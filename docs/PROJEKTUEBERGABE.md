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
- **Nach jeder Änderung:** `npx tsc --noEmit` und `npx eslint src/`.
  Ziel ist 0 Fehler (Warnungen aus Altbestand sind bekannt und ok).
- **Deutsche UI-Texte**, englische Code-Kommentare.
- **Bei Sicherheits-/Datenschutzentscheidungen nachfragen** statt annehmen.

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
