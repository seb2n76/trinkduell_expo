// Barcode lookup and the community drinks catalogue.
//
// The catalogue is shared by every user, so a wrong or duplicated barcode is
// not a private mistake — the next person to scan that bottle inherits it.
const test = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer } = require("./helpers/server");

// Valid EAN-13 codes (check digit included and verified — a made-up code with
// a wrong check digit is exactly what this feature is supposed to reject).
const KNOWN_EAN = "4001724819400";
const OTHER_EAN = "5000112637922";
const SHORT_EAN = "96385074"; // valid EAN-8

test("Barcode & EAN-Katalog", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());
  const { call, register } = server;

  await t.test("Prüfziffer", async (t) => {
    await t.test("weist Codes mit falscher Prüfziffer ab", async () => {
      const user = await register("ean-pruef");
      // Letzte Ziffer verfälscht — genau der Fall, den ein verrutschter Scan
      // oder ein Tippfehler erzeugt.
      const broken = KNOWN_EAN.slice(0, 12) + "3";

      const res = await call("GET", `/drinks/ean/${broken}`, undefined, user.token);
      assert.equal(res.status, 400);
      assert.match(res.json.error, /Prüfziffer/);
    });

    await t.test("weist Codes mit falscher Länge ab", async () => {
      const user = await register("ean-laenge");
      for (const code of ["123", "12345678901", "12345678901234"]) {
        const res = await call("GET", `/drinks/ean/${code}`, undefined, user.token);
        assert.equal(res.status, 400, `"${code}" hätte abgelehnt werden müssen`);
      }
    });

    await t.test("akzeptiert EAN-8 und EAN-13", async () => {
      const user = await register("ean-ok");
      for (const code of [SHORT_EAN, KNOWN_EAN]) {
        const res = await call("GET", `/drinks/ean/${code}`, undefined, user.token);
        // 404 heißt "gültig, aber unbekannt" — genau der Einstiegspfad.
        assert.equal(res.status, 404, `"${code}" ist ein gültiger Code`);
      }
    });
  });

  await t.test("Community-Katalog", async (t) => {
    await t.test("meldet einen unbekannten Code als 404 mit dem Code zurück", async () => {
      const user = await register("ean-neu");
      const res = await call("GET", `/drinks/ean/${KNOWN_EAN}`, undefined, user.token);

      assert.equal(res.status, 404);
      assert.equal(res.json.ean, KNOWN_EAN, "Der Client braucht den Code für den Benenn-Dialog");
    });

    await t.test("findet das Getränk, nachdem es jemand benannt hat", async () => {
      const contributor = await register("ean-beitrag");
      const other = await register("ean-andere");

      const created = await call(
        "POST",
        "/drinks",
        { name: "Testbier Hell", category: "Bier", volume: 500, abv: 4.9, ean: OTHER_EAN },
        contributor.token
      );
      assert.equal(created.status, 201);
      assert.equal(created.json.ean, OTHER_EAN);

      // Der eigentliche Nutzen: ein ANDERER Nutzer scannt und bekommt es sofort.
      const found = await call("GET", `/drinks/ean/${OTHER_EAN}`, undefined, other.token);
      assert.equal(found.status, 200);
      assert.equal(found.json.name, "Testbier Hell");
      assert.equal(found.json.volume, 500);
    });

    await t.test("legt bei einem doppelten Scan keinen zweiten Eintrag an", async () => {
      const first = await register("ean-dup1");
      const second = await register("ean-dup2");
      const ean = "4006381333931";

      const a = await call(
        "POST",
        "/drinks",
        { name: "Erstes Getränk", category: "Bier", volume: 330, abv: 5, ean },
        first.token
      );
      assert.equal(a.status, 201);

      // Zwei Leute können denselben unbekannten Code gleichzeitig scannen.
      const b = await call(
        "POST",
        "/drinks",
        { name: "Zweites Getränk", category: "Wein", volume: 750, abv: 12, ean },
        second.token
      );
      assert.equal(b.status, 200, "Der Zweite bekommt den vorhandenen Eintrag, keinen Fehler");
      assert.equal(b.json.id, a.json.id);
      assert.equal(b.json.name, "Erstes Getränk", "Der erste Name bleibt stehen");

      const all = await call("GET", "/drinks", undefined, first.token);
      const withEan = all.json.filter((d) => d.ean === ean);
      assert.equal(withEan.length, 1, "Es darf nur einen Eintrag pro Barcode geben");
    });

    await t.test("lehnt einen ungültigen Code beim Anlegen ab", async () => {
      const user = await register("ean-anlegen");
      const res = await call(
        "POST",
        "/drinks",
        { name: "Krummes Getränk", category: "Bier", volume: 500, abv: 5, ean: "1234567890123" },
        user.token
      );
      assert.equal(res.status, 400);
    });

    await t.test("legt Getränke ohne Barcode weiterhin normal an", async () => {
      const user = await register("ean-ohne");
      const res = await call(
        "POST",
        "/drinks",
        { name: "Ohne Barcode", category: "Bier", volume: 500, abv: 5 },
        user.token
      );
      assert.equal(res.status, 201);
      assert.equal(res.json.ean, null);
    });
  });

  await t.test("verlangt ein Token", async () => {
    const res = await call("GET", `/drinks/ean/${KNOWN_EAN}`);
    assert.equal(res.status, 401);
  });
});
