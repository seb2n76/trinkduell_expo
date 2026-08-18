// Gruppenmitglieder verwalten.
//
// Der Kern ist nicht das Hinzufügen, sondern das Verlassen: eine Gruppe, aus
// der man nicht herauskommt, ist zusammen mit der Blockierfunktion ein echtes
// Problem — man säße mit jemandem im selben Chat, den man gerade blockiert hat.
// Deshalb prüfen die Tests hier vor allem, dass niemand feststeckt und dass
// nach jedem Austritt ein gültiger Zustand bleibt.
const test = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer } = require("./helpers/server");

/** Legt eine Gruppe an; `admin` ist der Ersteller. */
async function gruppeAnlegen(call, admin, mitglieder = []) {
  const res = await call(
    "POST",
    "/groups",
    { name: "Testgruppe", memberIds: mitglieder.map((m) => m.id) },
    admin.token
  );
  assert.equal(res.status, 201, `Gruppe anlegen: ${JSON.stringify(res.json)}`);
  return res.json;
}

test("Gruppenmitglieder verwalten", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());
  const { call, register } = server;

  await t.test("Hinzufügen", async (t) => {
    await t.test("der Admin darf hinzufügen", async () => {
      const admin = await register("gm-admin");
      const neu = await register("gm-neu");
      const group = await gruppeAnlegen(call, admin);

      const res = await call("POST", `/groups/${group.id}/members`, { userId: neu.id }, admin.token);
      assert.equal(res.status, 200);
      assert.ok(res.json.memberIds.includes(neu.id));

      // Und die Gruppe taucht beim Hinzugefügten auf.
      const seine = await call("GET", "/groups", undefined, neu.token);
      assert.ok(seine.json.some((g) => g.id === group.id), "Die Gruppe muss beim neuen Mitglied erscheinen");
    });

    await t.test("ein einfaches Mitglied darf nicht hinzufügen", async () => {
      const admin = await register("gm-a2");
      const mitglied = await register("gm-m2");
      const fremd = await register("gm-f2");
      const group = await gruppeAnlegen(call, admin, [mitglied]);

      const res = await call("POST", `/groups/${group.id}/members`, { userId: fremd.id }, mitglied.token);
      assert.equal(res.status, 403);
    });

    await t.test("ein Nichtmitglied sieht die Gruppe nicht einmal", async () => {
      const admin = await register("gm-a3");
      const fremd = await register("gm-f3");
      const group = await gruppeAnlegen(call, admin);

      const res = await call("POST", `/groups/${group.id}/members`, { userId: fremd.id }, fremd.token);
      assert.equal(res.status, 403);
    });

    await t.test("doppelt hinzufügen wird abgewiesen", async () => {
      const admin = await register("gm-a4");
      const mitglied = await register("gm-m4");
      const group = await gruppeAnlegen(call, admin, [mitglied]);

      const res = await call("POST", `/groups/${group.id}/members`, { userId: mitglied.id }, admin.token);
      assert.equal(res.status, 409);
    });

    await t.test("unbekannte Nutzer werden abgewiesen", async () => {
      const admin = await register("gm-a5");
      const group = await gruppeAnlegen(call, admin);

      const res = await call("POST", `/groups/${group.id}/members`, { userId: "gibtsnicht" }, admin.token);
      assert.equal(res.status, 404);
    });

    await t.test("eine Blockierung verhindert das Hinzufügen", async () => {
      const admin = await register("gm-a6");
      const geblockt = await register("gm-b6");
      const group = await gruppeAnlegen(call, admin);

      await call("POST", "/blocks", { userId: geblockt.id }, admin.token);

      const res = await call("POST", `/groups/${group.id}/members`, { userId: geblockt.id }, admin.token);
      assert.equal(res.status, 403, "Eine Gruppe darf keine Blockierung aushebeln");
    });

    await t.test("auch die umgekehrte Blockierung zählt", async () => {
      const admin = await register("gm-a7");
      const blocker = await register("gm-b7");
      const group = await gruppeAnlegen(call, admin);

      // Diesmal blockiert der ANDERE den Admin.
      await call("POST", "/blocks", { userId: admin.id }, blocker.token);

      const res = await call("POST", `/groups/${group.id}/members`, { userId: blocker.id }, admin.token);
      assert.equal(res.status, 403);
    });
  });

  await t.test("Entfernen und Verlassen", async (t) => {
    await t.test("ein Mitglied kann die Gruppe verlassen", async () => {
      const admin = await register("gm-a8");
      const mitglied = await register("gm-m8");
      const group = await gruppeAnlegen(call, admin, [mitglied]);

      const res = await call("DELETE", `/groups/${group.id}/members/${mitglied.id}`, undefined, mitglied.token);
      assert.equal(res.status, 200);
      assert.equal(res.json.groupDeleted, false);

      const seine = await call("GET", "/groups", undefined, mitglied.token);
      assert.ok(!seine.json.some((g) => g.id === group.id), "Die Gruppe darf nicht mehr auftauchen");
    });

    await t.test("der Admin kann ein Mitglied entfernen", async () => {
      const admin = await register("gm-a9");
      const mitglied = await register("gm-m9");
      const group = await gruppeAnlegen(call, admin, [mitglied]);

      const res = await call("DELETE", `/groups/${group.id}/members/${mitglied.id}`, undefined, admin.token);
      assert.equal(res.status, 200);

      const seine = await call("GET", "/groups", undefined, mitglied.token);
      assert.ok(!seine.json.some((g) => g.id === group.id));
    });

    await t.test("ein Mitglied darf niemand anderen entfernen", async () => {
      const admin = await register("gm-a10");
      const einer = await register("gm-m10a");
      const anderer = await register("gm-m10b");
      const group = await gruppeAnlegen(call, admin, [einer, anderer]);

      const res = await call("DELETE", `/groups/${group.id}/members/${anderer.id}`, undefined, einer.token);
      assert.equal(res.status, 403);

      // Und der andere ist wirklich noch drin.
      const seine = await call("GET", "/groups", undefined, anderer.token);
      assert.ok(seine.json.some((g) => g.id === group.id), "Der Entfernungsversuch darf nichts bewirkt haben");
    });

    await t.test("ein Fremder kann niemanden entfernen", async () => {
      const admin = await register("gm-a11");
      const mitglied = await register("gm-m11");
      const fremd = await register("gm-f11");
      const group = await gruppeAnlegen(call, admin, [mitglied]);

      const res = await call("DELETE", `/groups/${group.id}/members/${mitglied.id}`, undefined, fremd.token);
      assert.equal(res.status, 403);
    });

    await t.test("wer kein Mitglied ist, kann nicht entfernt werden", async () => {
      const admin = await register("gm-a12");
      const fremd = await register("gm-f12");
      const group = await gruppeAnlegen(call, admin);

      const res = await call("DELETE", `/groups/${group.id}/members/${fremd.id}`, undefined, admin.token);
      assert.equal(res.status, 404);
    });

    await t.test("verlangt ein Token", async () => {
      const admin = await register("gm-a13");
      const group = await gruppeAnlegen(call, admin);

      const res = await call("DELETE", `/groups/${group.id}/members/${admin.id}`);
      assert.equal(res.status, 401);
    });
  });

  await t.test("Der Admin verlässt die Gruppe", async (t) => {
    await t.test("die Adminrolle geht an das dienstälteste Mitglied", async () => {
      const admin = await register("gm-a14");
      const ersterMit = await register("gm-m14a");
      const zweiterMit = await register("gm-m14b");
      const group = await gruppeAnlegen(call, admin, [ersterMit, zweiterMit]);

      const res = await call("DELETE", `/groups/${group.id}/members/${admin.id}`, undefined, admin.token);
      assert.equal(res.status, 200);
      assert.equal(res.json.groupDeleted, false);
      assert.equal(res.json.adminId, ersterMit.id, "Der Erste in der Liste übernimmt");

      // Der neue Admin kann seine Rolle auch wirklich ausüben.
      const neu = await register("gm-n14");
      const add = await call("POST", `/groups/${group.id}/members`, { userId: neu.id }, ersterMit.token);
      assert.equal(add.status, 200, "Der neue Admin muss hinzufügen dürfen");
    });

    await t.test("der Admin steckt nie fest", async () => {
      const admin = await register("gm-a15");
      const mitglied = await register("gm-m15");
      const group = await gruppeAnlegen(call, admin, [mitglied]);

      // Das ist der eigentliche Punkt: kein 403, keine Vorbedingung.
      const res = await call("DELETE", `/groups/${group.id}/members/${admin.id}`, undefined, admin.token);
      assert.equal(res.status, 200);

      const seine = await call("GET", "/groups", undefined, admin.token);
      assert.ok(!seine.json.some((g) => g.id === group.id));
    });

    await t.test("das letzte Mitglied löst die Gruppe auf", async () => {
      const admin = await register("gm-a16");
      const group = await gruppeAnlegen(call, admin);

      const res = await call("DELETE", `/groups/${group.id}/members/${admin.id}`, undefined, admin.token);
      assert.equal(res.status, 200);
      assert.equal(res.json.groupDeleted, true);

      // Und sie ist wirklich weg, nicht nur unsichtbar: ein Beitritt scheitert.
      const join = await call("POST", `/groups/${group.id}/join`, {}, admin.token);
      assert.equal(join.status, 404, "Die Gruppe darf nicht mehr existieren");
    });
  });

  await t.test("Mitgliederliste", async (t) => {
    await t.test("nennt Mitglieder und markiert den Admin", async () => {
      const admin = await register("gm-a17");
      const mitglied = await register("gm-m17");
      const group = await gruppeAnlegen(call, admin, [mitglied]);

      const res = await call("GET", `/groups/${group.id}/members`, undefined, mitglied.token);
      assert.equal(res.status, 200);
      assert.equal(res.json.members.length, 2);
      assert.equal(res.json.adminId, admin.id);
      assert.equal(res.json.isAdmin, false, "Für das Mitglied ist isAdmin false");

      const adminEintrag = res.json.members.find((m) => m.id === admin.id);
      assert.equal(adminEintrag.isAdmin, true);
    });

    await t.test("gibt keine Interna preis", async () => {
      const admin = await register("gm-a18");
      const group = await gruppeAnlegen(call, admin);

      const res = await call("GET", `/groups/${group.id}/members`, undefined, admin.token);
      const roh = JSON.stringify(res.json);
      assert.ok(!roh.includes("@test.local"), "Keine E-Mail-Adressen");
      assert.ok(!roh.includes("password"), "Kein Passwort-Feld");
    });

    await t.test("ist für Fremde nicht lesbar", async () => {
      const admin = await register("gm-a19");
      const fremd = await register("gm-f19");
      const group = await gruppeAnlegen(call, admin);

      const res = await call("GET", `/groups/${group.id}/members`, undefined, fremd.token);
      assert.equal(res.status, 404, "Ein Fremder darf nicht einmal erfahren, dass es die Gruppe gibt");
    });
  });
});
