// Persönliche Schnellwahl und Sichtbarkeit des geteilten Katalogs.
//
// Der Auslöser: vorher war jeder Katalogeintrag automatisch bei allen eine
// Kachel im Dashboard. Legte irgendwer ein Getränk an, stand es bei jedem.
const test = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer } = require("./helpers/server");

// Gültige EAN-13 mit korrekter Prüfziffer.
const EAN = "4006381333931";

test("Schnellwahl & Katalog-Sichtbarkeit", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());
  const { call, register } = server;

  await t.test("Sichtbarkeit im Katalog", async (t) => {
    await t.test("zeigt fremde Frei-Text-Getränke nicht", async () => {
      const owner = await register("kat-eigner");
      const other = await register("kat-fremd");

      const created = await call(
        "POST",
        "/drinks",
        { name: `Hausmarke${Date.now()}`, category: "Bier", volume: 500, abv: 5 },
        owner.token
      );
      assert.equal(created.status, 201);

      const forOwner = await call("GET", "/drinks", undefined, owner.token);
      assert.ok(forOwner.json.some((d) => d.id === created.json.id), "Der Ersteller sieht es");

      const forOther = await call("GET", "/drinks", undefined, other.token);
      assert.ok(
        !forOther.json.some((d) => d.id === created.json.id),
        "Fremde Frei-Text-Einträge gehören nicht in den Katalog aller"
      );
    });

    await t.test("zeigt gescannte Produkte allen — das ist der Sinn der Community-DB", async () => {
      const scanner = await register("kat-scanner");
      const other = await register("kat-anderer");

      const created = await call(
        "POST",
        "/drinks",
        { name: "Echtes Produkt", category: "Bier", volume: 500, abv: 4.9, ean: EAN },
        scanner.token
      );
      assert.equal(created.status, 201);

      const forOther = await call("GET", "/drinks", undefined, other.token);
      assert.ok(
        forOther.json.some((d) => d.id === created.json.id),
        "Ein Produkt mit Barcode ist ein reales Produkt und hilft allen"
      );
    });

    await t.test("zeigt den eingebauten Katalog allen", async () => {
      const user = await register("kat-standard");
      const res = await call("GET", "/drinks", undefined, user.token);

      const builtIn = res.json.filter((d) => !d.createdBy);
      assert.ok(builtIn.length >= 20, `Nur ${builtIn.length} Standardgetränke gefunden`);
      // Die 14 aus dem Client müssen mitgewandert sein.
      assert.ok(builtIn.some((d) => d.id === "drink-cocktail-mojito"), "Mojito fehlt");
      assert.ok(builtIn.some((d) => d.id === "drink-water-glass"), "Wasser fehlt");
    });
  });

  await t.test("Schnellwahl", async (t) => {
    await t.test("gibt neuen Konten eine Startauswahl", async () => {
      const user = await register("qp-neu");
      const res = await call("GET", "/users/me/drinks", undefined, user.token);

      assert.equal(res.status, 200);
      assert.equal(res.json.length, 6, "Sechs Getränke zum Start");
      // Muss echte Katalogeinträge liefern, keine losen IDs.
      assert.ok(res.json.every((d) => d.id && d.name && d.volume > 0));
    });

    await t.test("speichert Auswahl und Reihenfolge", async () => {
      const user = await register("qp-order");

      const saved = await call(
        "PUT",
        "/users/me/drinks",
        { drinkIds: ["drink-water-glass", "drink-beer-helles", "drink-shot"] },
        user.token
      );
      assert.equal(saved.status, 200);
      assert.deepEqual(
        saved.json.map((d) => d.id),
        ["drink-water-glass", "drink-beer-helles", "drink-shot"],
        "Die Reihenfolge IST die Einstellung"
      );

      const reread = await call("GET", "/users/me/drinks", undefined, user.token);
      assert.deepEqual(reread.json.map((d) => d.id), [
        "drink-water-glass",
        "drink-beer-helles",
        "drink-shot",
      ]);
    });

    await t.test("trennt die Auswahl zwischen Nutzern", async () => {
      const a = await register("qp-a");
      const b = await register("qp-b");

      await call("PUT", "/users/me/drinks", { drinkIds: ["drink-shot"] }, a.token);

      const forB = await call("GET", "/users/me/drinks", undefined, b.token);
      assert.equal(forB.json.length, 6, "B behält seine Startauswahl");
      assert.ok(forB.json.some((d) => d.id !== "drink-shot"));
    });

    await t.test("erlaubt eine leere Schnellwahl", async () => {
      const user = await register("qp-leer");

      const cleared = await call("PUT", "/users/me/drinks", { drinkIds: [] }, user.token);
      assert.equal(cleared.status, 200);
      assert.equal(cleared.json.length, 0);

      // Entscheidend: die Startauswahl darf nicht zurückkommen, sonst ließe
      // sich die Schnellwahl nie leeren.
      const reread = await call("GET", "/users/me/drinks", undefined, user.token);
      assert.equal(reread.json.length, 0, "Leer bleibt leer");
    });

    await t.test("entfernt Doppelte", async () => {
      const user = await register("qp-dupe");
      const res = await call(
        "PUT",
        "/users/me/drinks",
        { drinkIds: ["drink-shot", "drink-shot", "drink-beer-helles"] },
        user.token
      );

      assert.deepEqual(res.json.map((d) => d.id), ["drink-shot", "drink-beer-helles"]);
    });

    await t.test("begrenzt die Länge", async () => {
      const user = await register("qp-limit");
      const all = await call("GET", "/drinks", undefined, user.token);
      const tooMany = all.json.slice(0, 13).map((d) => d.id);

      const res = await call("PUT", "/users/me/drinks", { drinkIds: tooMany }, user.token);
      assert.equal(res.status, 400);
    });

    await t.test("lehnt unbekannte Getränke ab", async () => {
      const user = await register("qp-unbekannt");
      const res = await call(
        "PUT",
        "/users/me/drinks",
        { drinkIds: ["drink-gibtsnicht"] },
        user.token
      );
      assert.equal(res.status, 400);
    });

    await t.test("lässt kein fremdes Getränk in die eigene Schnellwahl", async () => {
      const owner = await register("qp-eigner");
      const other = await register("qp-schmuggler");

      const created = await call(
        "POST",
        "/drinks",
        { name: `Privat${Date.now()}`, category: "Bier", volume: 500, abv: 5 },
        owner.token
      );

      // Die ID ist erratbar bzw. könnte durchsickern — die Sichtbarkeitsregel
      // muss deshalb auch hier greifen, nicht nur beim Auflisten.
      const res = await call(
        "PUT",
        "/users/me/drinks",
        { drinkIds: [created.json.id] },
        other.token
      );
      assert.equal(res.status, 400);
    });

    await t.test("verlangt eine Liste", async () => {
      const user = await register("qp-typ");
      const res = await call("PUT", "/users/me/drinks", { drinkIds: "drink-shot" }, user.token);
      assert.equal(res.status, 400);
    });

    await t.test("verlangt ein Token", async () => {
      assert.equal((await call("GET", "/users/me/drinks")).status, 401);
      assert.equal((await call("PUT", "/users/me/drinks", { drinkIds: [] })).status, 401);
    });
  });
});
