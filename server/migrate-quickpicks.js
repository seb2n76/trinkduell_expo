#!/usr/bin/env node
/**
 * Legt für Bestandskonten eine Schnellwahl an — abgeleitet aus dem, was sie
 * tatsächlich trinken.
 *
 * Vorher gab es keine persönliche Auswahl: das Dashboard zeigte den gesamten
 * Katalog, also auch jedes Getränk, das irgendwer angelegt hatte. Ohne diesen
 * Lauf bekämen Bestandsnutzer die generische Startauswahl statt ihrer eigenen
 * Gewohnheiten.
 *
 * Drei Plätze, passend zu den drei Slots im Dashboard. Wer mehr geloggt hat,
 * bekommt seine drei häufigsten.
 *
 * Aufruf auf dem Server:
 *
 *     docker compose -f server/docker-compose.yml exec backend \
 *       node server/migrate-quickpicks.js --dry-run
 *     docker compose -f server/docker-compose.yml exec backend \
 *       node server/migrate-quickpicks.js
 *
 * Wiederholbar: Konten, die ihre Schnellwahl bereits gesetzt haben, werden
 * übersprungen — ein zweiter Lauf überschreibt also keine Handauswahl.
 */
const db = require("./db");

const DRY_RUN = process.argv.includes("--dry-run");
const PICK_COUNT = 3;

/** Fallback, wenn jemand noch nie etwas geloggt hat. */
const FALLBACK = [
  "drink-beer-helles",
  "drink-wine-white",
  "drink-water-glass",
];

async function main() {
  const [users, logs, drinks] = await Promise.all([
    db.getUsers(),
    db.getLogs(),
    db.getDrinks(),
  ]);

  const known = new Set(drinks.map((d) => d.id));
  const available = FALLBACK.filter((id) => known.has(id));

  console.log(`${users.length} Konten, ${logs.length} Getränke-Einträge im Bestand.`);
  if (DRY_RUN) console.log("(Probelauf — es wird nichts geschrieben)\n");

  let migrated = 0;
  let skipped = 0;

  for (const user of users) {
    if (await db.hasOwnQuickPicks(user.id)) {
      console.log(`  ÜBERSPRUNGEN ${user.name}: hat bereits eine eigene Schnellwahl`);
      skipped++;
      continue;
    }

    // Häufigkeit pro Getränk zählen. Getränke, die es nicht mehr gibt
    // (gelöscht), fallen dabei automatisch heraus.
    const counts = new Map();
    for (const log of logs) {
      if (log.userId !== user.id || !known.has(log.drinkId)) continue;
      counts.set(log.drinkId, (counts.get(log.drinkId) || 0) + 1);
    }

    const favourites = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, PICK_COUNT)
      .map(([id]) => id);

    // Mit der Standardauswahl auffüllen, damit auch Gelegenheitsnutzer eine
    // brauchbare Startbelegung bekommen statt zwei einsamer Kacheln.
    const picks = [...favourites];
    for (const id of available) {
      if (picks.length >= PICK_COUNT) break;
      if (!picks.includes(id)) picks.push(id);
    }

    const names = picks
      .map((id) => drinks.find((d) => d.id === id)?.name || id)
      .join(", ");
    const source = favourites.length > 0 ? `${favourites.length} aus Historie` : "nur Standard";

    if (DRY_RUN) {
      console.log(`  WÜRDE ${user.name} setzen (${source}): ${names}`);
      migrated++;
      continue;
    }

    try {
      await db.setUserDrinkIds(user.id, picks);
      console.log(`  OK ${user.name} (${source}): ${names}`);
      migrated++;
    } catch (err) {
      console.error(`  FEHLER bei ${user.name}: ${err.message}`);
      skipped++;
    }
  }

  console.log(`\nFertig: ${migrated} gesetzt, ${skipped} übersprungen.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration fehlgeschlagen:", err);
    process.exit(1);
  });
