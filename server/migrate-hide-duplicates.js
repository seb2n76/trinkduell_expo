#!/usr/bin/env node
/**
 * Blendet die beiden doppelten Katalog-Getränke aus.
 *
 * Am 18.08.2026 wanderten die im Client hartkodierten Getränke nach
 * `DEFAULT_DRINKS`. Zwei davon existierten dort schon unter anderem Namen, und
 * seitdem steht dasselbe Getränk zweimal in der Auswahl:
 *
 *     "Helles Bier"  (drink-beer-500)   ist dasselbe wie  "Helles"  (drink-beer-helles)
 *     "Pils 0,33"    (drink-beer-pils)  ist dasselbe wie  "Pils"    (drink-beer-330)
 *
 * Sichtbar bleibt jeweils der Name, der zum Schema der übrigen Biere passt
 * (Export, Weizen, Helles — ohne Menge im Namen). "Helles" steht zudem in
 * DEFAULT_QUICK_PICKS und darf schon deshalb nicht verschwinden.
 *
 * WARUM NICHT LÖSCHEN: `drink_logs.drink_id` hat `ON DELETE CASCADE`. Ein
 * `DELETE FROM drinks` nähme jeden Trink-Eintrag mit, der darauf zeigt — bei
 * Einträgen aus dem Standardkatalog also die Historie aller Nutzer. Deshalb
 * nur ausblenden: die Getränke lösen weiterhin auf, sind aber nicht mehr neu
 * wählbar.
 *
 * Aufruf auf dem Server:
 *
 *     docker compose -f server/docker-compose.yml exec backend \
 *       node server/migrate-hide-duplicates.js --dry-run
 *     docker compose -f server/docker-compose.yml exec backend \
 *       node server/migrate-hide-duplicates.js
 *
 * Wiederholbar. Rückgängig machen geht ohne Skript:
 *
 *     UPDATE drinks SET hidden = FALSE WHERE id IN ('drink-beer-500', 'drink-beer-pils');
 */
const db = require("./db");

const DRY_RUN = process.argv.includes("--dry-run");

/** Was ausgeblendet wird, und wofür es jeweils steht. */
const AUSBLENDEN = [
  { id: "drink-beer-500", statt: "drink-beer-helles" },
  { id: "drink-beer-pils", statt: "drink-beer-330" },
];

async function main() {
  const drinks = await db.getDrinks();
  const byId = new Map(drinks.map((d) => [d.id, d]));
  const logs = await db.getLogs();

  if (DRY_RUN) console.log("(Probelauf — es wird nichts geschrieben)\n");

  let geaendert = 0;

  for (const { id, statt } of AUSBLENDEN) {
    const drink = byId.get(id);
    const bleibt = byId.get(statt);

    if (!drink) {
      console.log(`  ÜBERSPRUNGEN ${id}: gibt es in dieser Datenbank nicht`);
      continue;
    }
    if (!bleibt) {
      // Ohne das Gegenstück wäre Ausblenden ein echter Verlust: dann gäbe es
      // dieses Getränk gar nicht mehr zur Auswahl.
      console.log(`  ÜBERSPRUNGEN ${id}: das Gegenstück ${statt} fehlt`);
      continue;
    }
    if (drink.hidden) {
      console.log(`  ÜBERSPRUNGEN ${drink.name}: schon ausgeblendet`);
      continue;
    }

    // Nur zur Information — die Zahl erklärt, warum nicht gelöscht wird.
    const betroffen = logs.filter((l) => l.drinkId === id).length;
    const hinweis = `"${drink.name}" → bleibt sichtbar: "${bleibt.name}" (${betroffen} vorhandene Einträge bleiben erhalten)`;

    if (DRY_RUN) {
      console.log(`  WÜRDE AUSBLENDEN ${hinweis}`);
      geaendert++;
      continue;
    }

    try {
      await db.saveDrink({ ...drink, hidden: true });
      console.log(`  OK ${hinweis}`);
      geaendert++;
    } catch (err) {
      console.error(`  FEHLER bei ${id}: ${err.message}`);
    }
  }

  console.log(`\nFertig: ${geaendert} ausgeblendet.`);
  if (geaendert > 0 && !DRY_RUN) {
    console.log(
      "Wer eines davon in seiner Schnellwahl hat, behält es — ausgeblendet\n" +
        "heißt nur, dass es nicht mehr NEU gewählt werden kann."
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration fehlgeschlagen:", err);
    process.exit(1);
  });
