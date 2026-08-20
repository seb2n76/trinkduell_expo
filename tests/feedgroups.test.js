const test = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer } = require("./helpers/server");

/**
 * Gruppen-Feed nach einzelner Gruppe filtern.
 *
 * Bis August 2026 kannte der Feed nur „Freunde" oder „Gruppen" — und
 * „Gruppen" warf sämtliche eigenen Gruppen in einen Topf. Bei mehr als einer
 * Gruppe war nicht mehr erkennbar, was wozu gehört.
 */
test("Feed nach einzelner Gruppe", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());
  const { call, register } = server;

  const ich = await register("gruppenchef");
  const fremder = await register("fremder");

  const a = await call("POST", "/groups", { name: "Kegelclub" }, ich.token);
  const b = await call("POST", "/groups", { name: "Bürorunde" }, ich.token);
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);

  await call("POST", "/posts", { text: "Kegeln läuft", contextType: "group", contextId: a.json.id }, ich.token);
  await call("POST", "/posts", { text: "Feierabendbier", contextType: "group", contextId: b.json.id }, ich.token);

  await t.test("ohne Angabe kommen alle eigenen Gruppen", async () => {
    const res = await call("GET", "/feed?scope=groups", undefined, ich.token);
    assert.equal(res.status, 200);
    const texte = res.json.map((i) => i.text);
    assert.ok(texte.includes("Kegeln läuft"));
    assert.ok(texte.includes("Feierabendbier"));
  });

  await t.test("mit groupId nur diese eine", async () => {
    const res = await call("GET", `/feed?scope=groups&groupId=${a.json.id}`, undefined, ich.token);
    assert.equal(res.status, 200);
    const texte = res.json.map((i) => i.text);
    assert.ok(texte.includes("Kegeln läuft"), "Die gewählte Gruppe ist drin");
    assert.ok(!texte.includes("Feierabendbier"), "Die andere Gruppe nicht");
  });

  // ── Die Mitgliedschaft entscheidet, nicht der Client ────────────────────
  //
  // Ohne diese Prüfung liesse sich mit einer geratenen oder abgeschriebenen
  // Gruppen-Id der Feed einer fremden Gruppe auslesen — inklusive der
  // Getränke-Einträge aller ihrer Mitglieder.
  await t.test("eine fremde Gruppe bleibt verschlossen", async () => {
    const res = await call("GET", `/feed?scope=groups&groupId=${a.json.id}`, undefined, fremder.token);
    assert.equal(res.status, 404, "Nicht Mitglied — kein Zugriff");
  });

  await t.test("eine erfundene Gruppen-Id ebenso", async () => {
    const res = await call("GET", "/feed?scope=groups&groupId=gibtsnicht", undefined, ich.token);
    assert.equal(res.status, 404);
  });

  await t.test("der Freunde-Feed bleibt unberührt", async () => {
    const res = await call("GET", "/feed?scope=friends", undefined, ich.token);
    assert.equal(res.status, 200);
    const texte = res.json.map((i) => i.text);
    assert.ok(!texte.includes("Kegeln läuft"), "Gruppenbeiträge gehören nicht in den Freunde-Feed");
  });
});
