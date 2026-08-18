// Moderations-Ansicht für Meldungen.
//
// Vorher gab es KEINE Leseroute: Meldungen landeten in der Tabelle und im
// Server-Log, und `docker compose logs backend | grep MELDUNG` war der
// Posteingang. Die Stores erwarten Reaktion binnen 24 Stunden — das skaliert
// nicht und übersteht keinen Log-Rotationslauf.
//
// Der wichtigste Test hier ist der Zugriffsschutz: eine Moderationsansicht,
// die jeder öffnen kann, wäre schlimmer als gar keine — sie legt offen, wer
// wen gemeldet hat.
const test = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer } = require("./helpers/server");

/** Legt eine Meldung an; `von` meldet `ueber`. */
async function melden(call, von, ueber, grund = "spam") {
  const res = await call(
    "POST",
    "/reports",
    { reportedUserId: ueber.id, contentType: "user", reason: grund, details: "Testmeldung" },
    von.token
  );
  assert.ok(res.status < 300, `Melden: ${res.status} ${JSON.stringify(res.json)}`);
  return res.json;
}

test("Moderations-Ansicht", async (t) => {
  await t.test("Ohne ADMIN_USER_IDS ist niemand Moderator", async (t) => {
    const server = await startTestServer();
    t.after(() => server.stop());
    const { call, register } = server;

    await t.test("die Liste ist für alle unsichtbar", async () => {
      const user = await register("mv-a1");
      const res = await call("GET", "/reports", undefined, user.token);
      assert.equal(
        res.status,
        404,
        "404 statt 403: dass es die Ansicht gibt, muss ein normaler Nutzer nicht erfahren"
      );
    });

    await t.test("Status setzen ebenfalls nicht", async () => {
      const user = await register("mv-a2");
      const res = await call("PATCH", "/reports/irgendwas", { status: "resolved" }, user.token);
      assert.equal(res.status, 404);
    });

    await t.test("das eigene Profil sagt isModerator false", async () => {
      const user = await register("mv-a3");
      const res = await call("GET", "/users/me", undefined, user.token);
      assert.equal(res.json.isModerator, false);
    });
  });

  await t.test("Mit gesetzter Variable", async (t) => {
    // Die ID muss beim Serverstart feststehen, das Konto entsteht aber erst
    // danach. Deshalb eine feste ID vorgeben und den Nutzer passend anlegen —
    // dafür registriert der Helfer erst, dann wird die ID in die Umgebung
    // eines ZWEITEN Servers gehängt.
    const vorlauf = await startTestServer();
    const moderator = await vorlauf.register("mv-mod");
    const boesewicht = await vorlauf.register("mv-boese");
    const unbeteiligt = await vorlauf.register("mv-normal");
    const dbFile = vorlauf.dbFile;
    // Datenbank behalten, Server neu starten mit der Moderator-ID.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const server = await startTestServer({
      env: { ADMIN_USER_IDS: moderator.id, TRINKDUELL_DB_FILE: dbFile },
    });
    t.after(() => server.stop());
    t.after(() => vorlauf.stop());
    const { call } = server;

    await t.test("das eigene Profil sagt isModerator true", async () => {
      const res = await call("GET", "/users/me", undefined, moderator.token);
      assert.equal(res.json.isModerator, true);

      const andere = await call("GET", "/users/me", undefined, unbeteiligt.token);
      assert.equal(andere.json.isModerator, false, "Nur die genannte ID, nicht alle");
    });

    await t.test("der Moderator sieht Meldungen samt Namen", async () => {
      await melden(call, unbeteiligt, boesewicht, "belaestigung");

      const res = await call("GET", "/reports", undefined, moderator.token);
      assert.equal(res.status, 200);
      assert.equal(res.json.counts.open, 1);

      const meldung = res.json.reports[0];
      assert.equal(meldung.reason, "belaestigung");
      assert.equal(meldung.status, "open");
      assert.equal(meldung.reporterName, unbeteiligt.name, "Der Melder wird aufgelöst");
      assert.equal(meldung.reportedName, boesewicht.name);
    });

    await t.test("alle anderen bekommen weiterhin 404", async () => {
      const res = await call("GET", "/reports", undefined, unbeteiligt.token);
      assert.equal(res.status, 404);

      // Auch der Gemeldete darf nicht sehen, dass er gemeldet wurde.
      const beimGemeldeten = await call("GET", "/reports", undefined, boesewicht.token);
      assert.equal(beimGemeldeten.status, 404);
    });

    await t.test("ohne Token 401", async () => {
      assert.equal((await call("GET", "/reports")).status, 401);
    });

    await t.test("Status setzen ändert die Zählung", async () => {
      const liste = await call("GET", "/reports", undefined, moderator.token);
      const id = liste.json.reports[0].id;

      const res = await call("PATCH", `/reports/${id}`, { status: "resolved" }, moderator.token);
      assert.equal(res.status, 200);
      assert.equal(res.json.status, "resolved");

      const danach = await call("GET", "/reports", undefined, moderator.token);
      assert.equal(danach.json.counts.open, 0);
      assert.equal(danach.json.counts.resolved, 1);
    });

    await t.test("der Filter zeigt nur den gewählten Status", async () => {
      await melden(call, unbeteiligt, boesewicht, "spam");

      const offen = await call("GET", "/reports?status=open", undefined, moderator.token);
      assert.equal(offen.json.reports.length, 1, "Nur die neue, offene Meldung");
      assert.ok(offen.json.reports.every((r) => r.status === "open"));

      // Die Zahlen gelten trotzdem für ALLE Meldungen — sonst würde der
      // Zähler in der Oberfläche vom Filter abhängen.
      assert.equal(offen.json.counts.resolved, 1, "Die erledigte zählt weiter mit");
    });

    await t.test("unbekannte Status werden abgewiesen", async () => {
      const liste = await call("GET", "/reports", undefined, moderator.token);
      const id = liste.json.reports[0].id;

      assert.equal(
        (await call("PATCH", `/reports/${id}`, { status: "irgendwas" }, moderator.token)).status,
        400
      );
      assert.equal(
        (await call("GET", "/reports?status=irgendwas", undefined, moderator.token)).status,
        400
      );
    });

    await t.test("eine unbekannte Meldung ergibt 404", async () => {
      const res = await call("PATCH", "/reports/gibtsnicht", { status: "resolved" }, moderator.token);
      assert.equal(res.status, 404);
    });

    await t.test("der Meldeinhalt bleibt beim Statuswechsel erhalten", async () => {
      // setReportStatus schreibt bewusst nur die Statusspalte: der Eintrag ist
      // ein Beleg, und Grund, Auszug und Melder dürfen dabei nicht verloren
      // gehen.
      const vorher = (await call("GET", "/reports?status=open", undefined, moderator.token)).json
        .reports[0];
      await call("PATCH", `/reports/${vorher.id}`, { status: "dismissed" }, moderator.token);

      const nachher = (await call("GET", "/reports", undefined, moderator.token)).json.reports.find(
        (r) => r.id === vorher.id
      );
      assert.equal(nachher.status, "dismissed");
      assert.equal(nachher.reason, vorher.reason);
      assert.equal(nachher.details, vorher.details);
      assert.equal(nachher.reporterName, vorher.reporterName);
    });
  });
});
