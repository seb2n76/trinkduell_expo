// Ausgeblendete Getränke.
//
// Der Katalog führte zwei Getränke doppelt („Helles Bier" neben „Helles",
// „Pils 0,33" neben „Pils"). Löschen war keine Option: `drink_logs.drink_id`
// hat `ON DELETE CASCADE`, ein DELETE hätte die Trink-Historie aller Nutzer
// mitgenommen.
//
// Ausblenden heißt deshalb genau zwei Dinge — und der Unterschied ist der
// Kern dieser Datei:
//
//   NICHT mehr NEU wählbar (Auswahl-Ansicht, Kategorie-Karten)
//   ABER weiterhin auflösbar (alte Logs, bestehende Schnellwahl)
const test = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer } = require("./helpers/server");
const fs = require("node:fs");

/**
 * Schreibt eine Schnellwahl direkt in die Wegwerf-Datenbank.
 *
 * Nötig, weil die API genau das nicht mehr erlaubt, was hier hergestellt
 * werden soll: ein ausgeblendetes Getränk in der Schnellwahl. Bestandsnutzer
 * haben aber genau diesen Zustand.
 */
function vorbereiten(dbFile, userId, drinkIds) {
  const daten = JSON.parse(fs.readFileSync(dbFile, "utf8"));
  daten.userDrinks = (daten.userDrinks || []).filter((e) => e.userId !== userId);
  drinkIds.forEach((drinkId, position) => daten.userDrinks.push({ userId, drinkId, position }));
  const u = daten.users.find((x) => x.id === userId);
  if (u) u.quickPicksSet = true;
  fs.writeFileSync(dbFile, JSON.stringify(daten, null, 2), "utf8");
}

/** Die beiden Dubletten, die ausgeblendet sein müssen. */
const AUSGEBLENDET = ["drink-beer-500", "drink-beer-pils"];
/** Ihre sichtbaren Gegenstücke. */
const BLEIBT = ["drink-beer-helles", "drink-beer-330"];

test("Ausgeblendete Getränke", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());
  const { call, register } = server;

  await t.test("Katalog", async (t) => {
    await t.test("liefert sie weiterhin mit, aber als hidden markiert", async () => {
      const user = await register("hd-a1");
      const res = await call("GET", "/drinks", undefined, user.token);
      assert.equal(res.status, 200);

      for (const id of AUSGEBLENDET) {
        const drink = res.json.find((d) => d.id === id);
        assert.ok(drink, `${id} muss im Katalog bleiben — sonst lösen alte Logs nicht mehr auf`);
        assert.equal(drink.hidden, true, `${id} muss als hidden markiert sein`);
      }
    });

    await t.test("die Gegenstücke bleiben sichtbar", async () => {
      const user = await register("hd-a2");
      const res = await call("GET", "/drinks", undefined, user.token);

      for (const id of BLEIBT) {
        const drink = res.json.find((d) => d.id === id);
        assert.ok(drink, `${id} muss es geben`);
        assert.ok(!drink.hidden, `${id} darf NICHT ausgeblendet sein`);
      }
    });

    await t.test("das Gegenstück zu jedem Ausgeblendeten existiert wirklich", async () => {
      // Ohne diese Prüfung könnte ein Tippfehler in der Migration ein Getränk
      // ausblenden, für das es keinen Ersatz gibt.
      const user = await register("hd-a3");
      const res = await call("GET", "/drinks", undefined, user.token);
      const sichtbar = res.json.filter((d) => !d.hidden);

      assert.ok(
        sichtbar.some((d) => d.name === "Helles"),
        "Für 'Helles Bier' muss 'Helles' übrig bleiben"
      );
      assert.ok(
        sichtbar.some((d) => d.name === "Pils"),
        "Für 'Pils 0,33' muss 'Pils' übrig bleiben"
      );
    });
  });

  await t.test("Schnellwahl", async (t) => {
    await t.test("ein ausgeblendetes Getränk lässt sich nicht NEU wählen", async () => {
      const user = await register("hd-b1");

      const res = await call(
        "PUT",
        "/users/me/drinks",
        { drinkIds: ["drink-beer-500"] },
        user.token
      );
      assert.equal(res.status, 400);
      assert.match(res.json.error, /steht nicht mehr zur Auswahl/);
    });

    await t.test("sein Gegenstück schon", async () => {
      const user = await register("hd-b2");
      const res = await call(
        "PUT",
        "/users/me/drinks",
        { drinkIds: ["drink-beer-helles"] },
        user.token
      );
      assert.equal(res.status, 200);
      assert.equal(res.json[0].id, "drink-beer-helles");
    });

    await t.test("wer es schon hat, kann weiter umsortieren", async () => {
      // Der heikle Fall: würde die Prüfung stur greifen, schlüge JEDES
      // Speichern fehl, bis der Nutzer das ausgeblendete Getränk zufällig
      // herausnimmt — er käme also nicht mehr an seine eigene Schnellwahl.
      const user = await register("hd-b3");

      // Zustand herstellen, den die API nicht mehr erlaubt: das ausgeblendete
      // Getränk liegt schon in der Schnellwahl. Genau so sieht es bei
      // Bestandsnutzern auf dem Produktionsserver aus.
      //
      // Danach ein FRISCHER Server auf derselben Datei: der laufende hält
      // die JSON-Datenbank im Speicher und würde die Änderung nie sehen.
      vorbereiten(server.dbFile, user.id, ["drink-beer-500", "drink-beer-helles"]);
      const zweiter = await startTestServer({ env: { TRINKDUELL_DB_FILE: server.dbFile } });
      t.after(() => zweiter.stop());

      const res = await zweiter.call(
        "PUT",
        "/users/me/drinks",
        { drinkIds: ["drink-beer-helles", "drink-beer-500"] },
        user.token
      );
      assert.equal(res.status, 200, `Umsortieren darf nicht scheitern: ${JSON.stringify(res.json)}`);
      assert.deepEqual(
        res.json.map((d) => d.id),
        ["drink-beer-helles", "drink-beer-500"]
      );
    });

    await t.test("wer es herausnimmt, bekommt es nicht zurück", async () => {
      const user = await register("hd-b4");
      vorbereiten(server.dbFile, user.id, ["drink-beer-500"]);
      const zweiter = await startTestServer({ env: { TRINKDUELL_DB_FILE: server.dbFile } });
      t.after(() => zweiter.stop());

      // Erst herausnehmen ...
      const raus = await zweiter.call("PUT", "/users/me/drinks", { drinkIds: [] }, user.token);
      assert.equal(raus.status, 200);

      // ... dann ist es wie für alle anderen gesperrt.
      const zurueck = await zweiter.call(
        "PUT",
        "/users/me/drinks",
        { drinkIds: ["drink-beer-500"] },
        user.token
      );
      assert.equal(zurueck.status, 400);
    });
  });

  await t.test("Logs", async (t) => {
    await t.test("ein ausgeblendetes Getränk lässt sich weiterhin loggen und auflösen", async () => {
      // Wer es in der Schnellwahl hat, tippt weiter darauf. Das muss gehen —
      // sonst wäre Ausblenden faktisch doch ein Löschen.
      const user = await register("hd-c1");

      const log = await call("POST", "/logs", { drinkId: "drink-beer-500" }, user.token);
      assert.ok(log.status < 300, `Loggen muss gelingen: ${JSON.stringify(log.json)}`);

      const alle = await call("GET", "/logs", undefined, user.token);
      const meiner = alle.json.find((l) => l.drinkId === "drink-beer-500");
      assert.ok(meiner, "Der Eintrag muss existieren");

      // Und der Katalog löst den Namen weiterhin auf.
      const katalog = await call("GET", "/drinks", undefined, user.token);
      const drink = katalog.json.find((d) => d.id === "drink-beer-500");
      assert.equal(drink.name, "Helles Bier");
    });
  });
});
