// Reihenfolge der Schema-Migration.
//
// Statische Prüfung, keine echte Datenbank: die Testsuite läuft im
// JSON-Modus, ein Postgres steht hier nicht zur Verfügung. Der Fehler, den
// dieser Test verhindert, ist aber rein struktureller Natur und damit auch
// statisch erkennbar.
//
// Der Fall, der auf dem Produktionsserver zugeschlagen hat:
// `schema.sql` enthielt einen Index auf `drinks(ean)`, während die Spalte
// selbst erst per ALTER TABLE in db.js nachgerüstet wurde. Auf einer
// bestehenden Datenbank existierte die Spalte nicht, der Index schlug fehl —
// und weil schema.sql als EIN Query läuft, riss er alle folgenden Anweisungen
// mit, inklusive der ALTER-Zeile, die die Spalte angelegt hätte. Ergebnis: ein
// Server, der läuft, aber ein unvollständiges Schema hat.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SERVER_DIR = path.join(__dirname, "..", "server");
const schemaSql = fs.readFileSync(path.join(SERVER_DIR, "schema.sql"), "utf8");
const dbJs = fs.readFileSync(path.join(SERVER_DIR, "db.js"), "utf8");

/** Spalten, die nur per ALTER TABLE entstehen — auf alten DBs also fehlen. */
function columnsAddedByAlter() {
  return [...dbJs.matchAll(/ALTER TABLE (\w+) ADD COLUMN IF NOT EXISTS (\w+)/g)].map((m) => ({
    table: m[1],
    column: m[2],
  }));
}

/** Indizes, die schema.sql anlegt. */
function indexesInSchemaSql() {
  return [
    ...schemaSql.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX[^;]*?ON\s+(\w+)\s*\(([^)]*)\)[^;]*;/gi),
  ].map((m) => ({
    table: m[1],
    columns: m[2].split(",").map((c) => c.trim()),
    statement: m[0].replace(/\s+/g, " ").slice(0, 80),
  }));
}

test("Schema-Migration", async (t) => {
  await t.test("kein Index in schema.sql hängt von einer nachgerüsteten Spalte ab", () => {
    const added = columnsAddedByAlter();
    assert.ok(added.length > 0, "Die ALTER-Zeilen sollten gefunden werden");

    const offenders = [];
    for (const index of indexesInSchemaSql()) {
      for (const column of index.columns) {
        if (added.some((a) => a.table === index.table && a.column === column)) {
          offenders.push(`${index.table}(${column}): ${index.statement}`);
        }
      }
    }

    assert.deepEqual(
      offenders,
      [],
      "Solche Indizes gehören in die Migrationsphase von initPgSchema(), nicht in schema.sql —\n" +
        "sonst scheitern sie auf bestehenden Datenbanken und verhindern die ALTER-Zeilen:\n  " +
        offenders.join("\n  ")
    );
  });

  await t.test("Indizes auf nachgerüsteten Spalten stehen nach ihrem ALTER", () => {
    // Jeder Index in db.js muss nach dem ALTER stehen, das seine Spalte anlegt.
    const indexMatches = [
      ...dbJs.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX[^"]*?ON\s+(\w+)\s*\(([^)]*)\)/gi),
    ];
    assert.ok(indexMatches.length > 0, "In db.js sollte mindestens ein Index angelegt werden");

    for (const match of indexMatches) {
      const table = match[1];
      const columns = match[2].split(",").map((c) => c.trim());
      const indexPos = match.index;

      for (const column of columns) {
        const alterPattern = new RegExp(
          `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column}\\b`
        );
        const alterMatch = alterPattern.exec(dbJs);
        if (!alterMatch) continue; // Spalte kommt aus schema.sql, unkritisch

        assert.ok(
          alterMatch.index < indexPos,
          `Index auf ${table}(${column}) wird angelegt, bevor die Spalte existiert`
        );
      }
    }
  });

  await t.test("markiert die Initialisierung erst bei Erfolg als erledigt", () => {
    // Vorher stand `pgInitialized = true` VOR dem await: ein einmaliger
    // Fehlschlag bedeutete, dass nie wieder versucht wurde und der Server
    // dauerhaft mit kaputtem Schema weiterlief.
    assert.ok(
      /pgInitialized = await initPgSchema\(\)/.test(dbJs),
      "initPgSchema() muss den Erfolg zurückgeben und pgInitialized daraus gesetzt werden"
    );
    assert.ok(
      !/pgInitialized = true;\s*\n\s*await initPgSchema/.test(dbJs),
      "pgInitialized darf nicht vor dem await gesetzt werden"
    );
  });

  await t.test("initPgSchema meldet Erfolg und Misserfolg zurück", () => {
    const body = dbJs.slice(dbJs.indexOf("async function initPgSchema"));
    const untilNextFn = body.slice(0, body.indexOf("\nasync function loadDb"));

    assert.ok(/return true;/.test(untilNextFn), "Erfolgsfall muss true liefern");
    assert.ok(/return false;/.test(untilNextFn), "Fehlerfall muss false liefern");
  });
});
