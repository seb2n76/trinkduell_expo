// Gruppenbeitritt über einen Einladungscode.
//
// Warum Code und keine öffentliche Gruppenliste: seit der Autorisierungsrunde
// liefert `GET /api/groups` nur eigene Gruppen. Eine durchsuchbare Liste aller
// Gruppen wäre genau der Social-Graph-Leak, der damals geschlossen wurde.
//
// Der wichtigste Test hier ist die Rotation. Ohne sie wäre das Entfernen eines
// Mitglieds wirkungslos: wer den alten Code noch hat, tritt einfach wieder bei.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { startTestServer } = require("./helpers/server");

async function gruppeAnlegen(call, admin, name = "Codegruppe") {
  const res = await call("POST", "/groups", { name }, admin.token);
  assert.equal(res.status, 201, `Gruppe anlegen: ${JSON.stringify(res.json)}`);
  return res.json;
}

async function codeHolen(call, admin, groupId) {
  const res = await call("GET", `/groups/${groupId}/invite`, undefined, admin.token);
  assert.equal(res.status, 200, `Code holen: ${JSON.stringify(res.json)}`);
  return res.json.inviteCode;
}

test("Gruppenbeitritt per Einladungscode", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());
  const { call, register } = server;

  await t.test("Der Code", async (t) => {
    await t.test("wird beim Anlegen vergeben", async () => {
      const admin = await register("gi-a1");
      const group = await gruppeAnlegen(call, admin);
      assert.ok(group.inviteCode, "Eine neue Gruppe hat sofort einen Code");
      assert.match(group.inviteCode, /^[0-9A-F]{8}$/, "8 Hex-Zeichen, Großbuchstaben");
    });

    await t.test("ist nur für den Admin sichtbar", async () => {
      const admin = await register("gi-a2");
      const mitglied = await register("gi-m2");
      const group = await gruppeAnlegen(call, admin);
      const code = await codeHolen(call, admin, group.id);

      await call("POST", `/groups/${group.id}/members`, { userId: mitglied.id }, admin.token);

      const abruf = await call("GET", `/groups/${group.id}/invite`, undefined, mitglied.token);
      assert.equal(abruf.status, 403, "Ein einfaches Mitglied sieht den Code nicht");

      // Und er darf auch nicht über die Gruppenliste durchsickern.
      const liste = await call("GET", "/groups", undefined, mitglied.token);
      const seine = liste.json.find((g) => g.id === group.id);
      assert.equal(seine.inviteCode, undefined, "Kein Code in der Liste des Mitglieds");

      const adminListe = await call("GET", "/groups", undefined, admin.token);
      assert.equal(
        adminListe.json.find((g) => g.id === group.id).inviteCode,
        code,
        "Der Admin sieht ihn dagegen schon"
      );
    });

    await t.test("entsteht nachträglich für Gruppen aus der Zeit davor", async () => {
      const admin = await register("gi-a3");
      const group = await gruppeAnlegen(call, admin);

      // Zustand herstellen, den die API nicht mehr erzeugt: eine Gruppe ohne
      // Code. Genau das sind die Bestandsgruppen auf dem Produktionsserver.
      const daten = JSON.parse(fs.readFileSync(server.dbFile, "utf8"));
      daten.groups.find((g) => g.id === group.id).inviteCode = null;
      fs.writeFileSync(server.dbFile, JSON.stringify(daten, null, 2), "utf8");

      const code = await codeHolen(call, admin, group.id);
      assert.match(code, /^[0-9A-F]{8}$/, "Der Abruf legt ihn an, statt zu scheitern");
    });
  });

  await t.test("Beitreten", async (t) => {
    await t.test("mit gültigem Code wird man sofort Mitglied", async () => {
      const admin = await register("gi-a4");
      const gast = await register("gi-g4");
      const group = await gruppeAnlegen(call, admin);
      const code = await codeHolen(call, admin, group.id);

      const res = await call("POST", "/groups/join", { code }, gast.token);
      assert.equal(res.status, 200);
      assert.equal(res.json.inviteCode, undefined, "Die Antwort gibt den Code nicht weiter");

      const seine = await call("GET", "/groups", undefined, gast.token);
      assert.ok(seine.json.some((g) => g.id === group.id), "Die Gruppe erscheint bei ihm");

      const mitglieder = await call("GET", `/groups/${group.id}/members`, undefined, admin.token);
      assert.ok(mitglieder.json.members.some((m) => m.id === gast.id));
    });

    await t.test("Groß- und Kleinschreibung ist egal", async () => {
      const admin = await register("gi-a5");
      const gast = await register("gi-g5");
      const group = await gruppeAnlegen(call, admin);
      const code = await codeHolen(call, admin, group.id);

      const res = await call("POST", "/groups/join", { code: code.toLowerCase() }, gast.token);
      assert.equal(res.status, 200, "Ein abgetippter Code darf nicht an der Schreibweise scheitern");
    });

    await t.test("ein falscher Code wird abgewiesen", async () => {
      const gast = await register("gi-g6");
      const res = await call("POST", "/groups/join", { code: "DEADBEEF" }, gast.token);
      assert.equal(res.status, 404);
    });

    await t.test("ein leerer Code wird abgewiesen", async () => {
      const gast = await register("gi-g7");
      assert.equal((await call("POST", "/groups/join", { code: "" }, gast.token)).status, 400);
      assert.equal((await call("POST", "/groups/join", {}, gast.token)).status, 400);
    });

    await t.test("verlangt ein Token", async () => {
      const admin = await register("gi-a8");
      const group = await gruppeAnlegen(call, admin);
      const code = await codeHolen(call, admin, group.id);

      const res = await call("POST", "/groups/join", { code });
      assert.equal(res.status, 401);
    });

    await t.test("zweimal beitreten ändert nichts", async () => {
      const admin = await register("gi-a9");
      const gast = await register("gi-g9");
      const group = await gruppeAnlegen(call, admin);
      const code = await codeHolen(call, admin, group.id);

      await call("POST", "/groups/join", { code }, gast.token);
      const zweitens = await call("POST", "/groups/join", { code }, gast.token);
      assert.equal(zweitens.status, 200);

      const mitglieder = await call("GET", `/groups/${group.id}/members`, undefined, admin.token);
      assert.equal(mitglieder.json.members.filter((m) => m.id === gast.id).length, 1, "Kein Doppeleintrag");
    });

    await t.test("eine Blockierung verhindert den Beitritt", async () => {
      const admin = await register("gi-a10");
      const gast = await register("gi-g10");
      const group = await gruppeAnlegen(call, admin);
      const code = await codeHolen(call, admin, group.id);

      await call("POST", "/blocks", { userId: gast.id }, admin.token);

      const res = await call("POST", "/groups/join", { code }, gast.token);
      assert.equal(res.status, 403, "Ein Code darf keine Blockierung aushebeln");
    });
  });

  await t.test("Rotation", async (t) => {
    await t.test("entwertet den alten Code", async () => {
      const admin = await register("gi-a11");
      const gast = await register("gi-g11");
      const group = await gruppeAnlegen(call, admin);
      const alt = await codeHolen(call, admin, group.id);

      const rot = await call("POST", `/groups/${group.id}/invite/rotate`, {}, admin.token);
      assert.equal(rot.status, 200);
      assert.notEqual(rot.json.inviteCode, alt, "Der neue Code muss ein anderer sein");

      const mitAlt = await call("POST", "/groups/join", { code: alt }, gast.token);
      assert.equal(mitAlt.status, 404, "Der alte Code darf nicht mehr greifen");

      const mitNeu = await call("POST", "/groups/join", { code: rot.json.inviteCode }, gast.token);
      assert.equal(mitNeu.status, 200);
    });

    await t.test("macht das Entfernen eines Mitglieds wirksam", async () => {
      // Der eigentliche Grund für die Rotation: ohne sie käme ein
      // Hinausgeworfener mit dem alten Code sofort zurück.
      const admin = await register("gi-a12");
      const stoerer = await register("gi-s12");
      const group = await gruppeAnlegen(call, admin);
      const alt = await codeHolen(call, admin, group.id);

      await call("POST", "/groups/join", { code: alt }, stoerer.token);
      await call("DELETE", `/groups/${group.id}/members/${stoerer.id}`, undefined, admin.token);

      // Ohne Rotation stünde er sofort wieder drin — das ist die Lücke.
      const zurueck = await call("POST", "/groups/join", { code: alt }, stoerer.token);
      assert.equal(zurueck.status, 200, "Ohne Rotation kommt er zurück (belegt, warum es sie braucht)");

      await call("DELETE", `/groups/${group.id}/members/${stoerer.id}`, undefined, admin.token);
      await call("POST", `/groups/${group.id}/invite/rotate`, {}, admin.token);

      const nachRotation = await call("POST", "/groups/join", { code: alt }, stoerer.token);
      assert.equal(nachRotation.status, 404, "Nach der Rotation bleibt er draußen");
    });

    await t.test("darf nur der Admin", async () => {
      const admin = await register("gi-a13");
      const mitglied = await register("gi-m13");
      const group = await gruppeAnlegen(call, admin);
      const code = await codeHolen(call, admin, group.id);
      await call("POST", "/groups/join", { code }, mitglied.token);

      const res = await call("POST", `/groups/${group.id}/invite/rotate`, {}, mitglied.token);
      assert.equal(res.status, 403);

      // Und der Code steht unverändert.
      assert.equal(await codeHolen(call, admin, group.id), code);
    });
  });
});
