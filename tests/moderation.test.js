// Blocking, reporting and leaving a friendship.
//
// Store requirement for user-generated content: users must be able to block
// others and report content. The tests below pin the behaviour that makes a
// block actually mean something — it has to cut every visibility channel, not
// just the obvious one.
const test = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer } = require("./helpers/server");

async function befriend(call, a, b) {
  await call("POST", "/friends/request", { receiver_username: b.name }, a.token);
  const res = await call("POST", "/friends/accept", { sender_username: a.name }, b.token);
  assert.equal(res.status, 200, "Freundschaft konnte nicht hergestellt werden");
}

test("Moderation", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());
  const { call, register } = server;

  await t.test("Freund entfernen", async (t) => {
    await t.test("entfernt die Freundschaft auf beiden Seiten", async () => {
      const a = await register("weg-a");
      const b = await register("weg-b");
      await befriend(call, a, b);

      const res = await call("DELETE", `/friends/${b.name}`, undefined, a.token);
      assert.equal(res.status, 200);

      const listA = await call("GET", `/friends/${a.name}`, undefined, a.token);
      assert.equal(listA.json.friends.length, 0);

      const listB = await call("GET", `/friends/${b.name}`, undefined, b.token);
      assert.equal(listB.json.friends.length, 0, "Auch die Gegenseite verliert die Freundschaft");
    });

    await t.test("entzieht damit den Zugriff auf den Feed", async () => {
      const a = await register("feed-a");
      const b = await register("feed-b");
      await befriend(call, a, b);

      const drinks = await call("GET", "/drinks", undefined, b.token);
      await call("POST", "/logs", { drinkId: drinks.json[0].id }, b.token);

      const before = await call("GET", "/feed", undefined, a.token);
      assert.ok(before.json.some((e) => e.userId === b.id), "Als Freund sichtbar");

      await call("DELETE", `/friends/${b.name}`, undefined, a.token);

      const after = await call("GET", "/feed", undefined, a.token);
      assert.ok(!after.json.some((e) => e.userId === b.id), "Nach dem Entfernen nicht mehr");
    });

    await t.test("zieht eine noch offene Anfrage zurück", async () => {
      const a = await register("offen-a");
      const b = await register("offen-b");
      await call("POST", "/friends/request", { receiver_username: b.name }, a.token);

      const res = await call("DELETE", `/friends/${b.name}`, undefined, a.token);
      assert.equal(res.status, 200);

      const pending = await call("GET", `/friends/${b.name}`, undefined, b.token);
      assert.equal(pending.json.pending.length, 0);
    });

    await t.test("meldet 404, wenn es nichts zu entfernen gibt", async () => {
      const a = await register("nix-a");
      const b = await register("nix-b");

      const res = await call("DELETE", `/friends/${b.name}`, undefined, a.token);
      assert.equal(res.status, 404);
    });
  });

  await t.test("Blockieren", async (t) => {
    await t.test("löst eine bestehende Freundschaft auf", async () => {
      const a = await register("block-a");
      const b = await register("block-b");
      await befriend(call, a, b);

      const res = await call("POST", "/blocks", { userId: b.id }, a.token);
      assert.equal(res.status, 201);

      const list = await call("GET", `/friends/${a.name}`, undefined, a.token);
      assert.equal(list.json.friends.length, 0, "Eine bleibende Freundschaft würde den Block aushebeln");
    });

    await t.test("wirkt in beide Richtungen", async () => {
      const blocker = await register("bidi-a");
      const blocked = await register("bidi-b");
      await befriend(call, blocker, blocked);
      await call("POST", "/blocks", { userId: blocked.id }, blocker.token);

      const forBlocker = await call("GET", "/users", undefined, blocker.token);
      assert.ok(!forBlocker.json.some((u) => u.id === blocked.id), "Blockierender sieht Blockierten nicht");

      const forBlocked = await call("GET", "/users", undefined, blocked.token);
      assert.ok(
        !forBlocked.json.some((u) => u.id === blocker.id),
        "Der Blockierte darf den Blockierenden ebenfalls nicht mehr sehen"
      );
    });

    await t.test("versteckt den Nutzer in Suche, Profil und Rangliste", async () => {
      const a = await register("versteck-a");
      const b = await register("versteck-b");
      await call("POST", "/blocks", { userId: b.id }, a.token);

      const search = await call("GET", `/users/search?q=${b.name}`, undefined, a.token);
      assert.equal(search.json.length, 0);

      const profile = await call("GET", `/users/${b.id}`, undefined, a.token);
      assert.equal(profile.status, 404, "404 statt 403 — sonst bestätigt die Antwort den Block");

      const board = await call("GET", "/scoreboard", undefined, a.token);
      assert.ok(!board.json.rows.some((r) => r.id === b.id));
    });

    await t.test("verhindert Nachrichten und neue Anfragen", async () => {
      const a = await register("stumm-a");
      const b = await register("stumm-b");
      await befriend(call, a, b);
      await call("POST", "/blocks", { userId: b.id }, a.token);

      const fromBlocked = await call("POST", "/messages", { receiverId: a.id, content: "Hallo?" }, b.token);
      assert.equal(fromBlocked.status, 403);

      const request = await call("POST", "/friends/request", { receiver_username: a.name }, b.token);
      assert.equal(request.status, 404, "Der Blockierte darf keine neue Anfrage stellen können");
    });

    await t.test("nimmt dem Blockierten die Kartenpunkte, auch über eine gemeinsame Gruppe", async () => {
      const a = await register("karte-a");
      const b = await register("karte-b");

      // Gemeinsame Gruppe: die gewährt Kartensicht unabhängig von Freundschaft.
      const group = await call("POST", "/groups", { name: "Kartengruppe", memberIds: [b.id] }, a.token);
      assert.equal(group.status, 201);

      const drinks = await call("GET", "/drinks", undefined, b.token);
      await call("POST", "/logs", { drinkId: drinks.json[0].id, latitude: 52.52, longitude: 13.405 }, b.token);

      const before = await call("GET", "/map", undefined, a.token);
      assert.ok(before.json.some((e) => e.userId === b.id), "Gruppenmitglied ist auf der Karte sichtbar");

      await call("POST", "/blocks", { userId: b.id }, a.token);

      const after = await call("GET", "/map", undefined, a.token);
      assert.ok(!after.json.some((e) => e.userId === b.id), "Der Block muss die Gruppensicht überstimmen");
    });

    await t.test("listet und löst Blocks wieder auf", async () => {
      const a = await register("liste-a");
      const b = await register("liste-b");
      await call("POST", "/blocks", { userId: b.id }, a.token);

      const list = await call("GET", "/blocks", undefined, a.token);
      assert.equal(list.json.length, 1);
      assert.equal(list.json[0].username, b.name);

      const unblocked = await call("DELETE", `/blocks/${b.id}`, undefined, a.token);
      assert.equal(unblocked.status, 200);

      const after = await call("GET", "/users", undefined, a.token);
      assert.ok(after.json.some((u) => u.id === b.id), "Nach dem Aufheben wieder sichtbar");

      const friends = await call("GET", `/friends/${a.name}`, undefined, a.token);
      assert.equal(friends.json.friends.length, 0, "Aufheben stellt die Freundschaft nicht wieder her");
    });

    await t.test("verrät dem Blockierten nicht, dass er blockiert wurde", async () => {
      const a = await register("gehei-a");
      const b = await register("gehei-b");
      await call("POST", "/blocks", { userId: b.id }, a.token);

      const list = await call("GET", "/blocks", undefined, b.token);
      assert.equal(list.json.length, 0, "Die Blockliste zeigt nur eigene Blocks");
    });

    await t.test("lehnt Selbstblockade ab", async () => {
      const a = await register("selbst");
      const res = await call("POST", "/blocks", { userId: a.id }, a.token);
      assert.equal(res.status, 400);
    });
  });

  await t.test("Melden", async (t) => {
    await t.test("nimmt eine Meldung an und schreibt sie ins Log", async () => {
      const reporter = await register("melder");
      const target = await register("gemeldet");

      const res = await call(
        "POST",
        "/reports",
        { reportedUserId: target.id, contentType: "user", reason: "belaestigung", details: "Beleidigt mich im Chat." },
        reporter.token
      );
      assert.equal(res.status, 201);

      const log = server.serverLog();
      assert.ok(log.includes("MELDUNG"), "Meldungen müssen im Log auftauchen — sonst sieht sie niemand");
      assert.ok(log.includes(target.name));
    });

    await t.test("sichert den gemeldeten Inhalt, damit er nicht mit dem Original verschwindet", async () => {
      const reporter = await register("inhalt-a");
      const author = await register("inhalt-b");
      await befriend(call, reporter, author);

      const post = await call(
        "POST",
        "/posts",
        { text: "Ein anstößiger Beitrag", contextType: "friends", contextId: author.id },
        author.token
      );

      const res = await call(
        "POST",
        "/reports",
        { reportedUserId: author.id, contentType: "post", contentId: post.json.id, reason: "unangemessen" },
        reporter.token
      );
      assert.equal(res.status, 201);
      assert.ok(server.serverLog().includes("Ein anstößiger Beitrag"), "Der Auszug muss gesichert werden");
    });

    await t.test("lehnt unbekannte Gründe ab", async () => {
      const reporter = await register("grund-a");
      const target = await register("grund-b");

      const res = await call(
        "POST",
        "/reports",
        { reportedUserId: target.id, contentType: "user", reason: "beliebiger-text" },
        reporter.token
      );
      assert.equal(res.status, 400);
    });

    await t.test("lehnt Selbstmeldung ab", async () => {
      const a = await register("selbstmeld");
      const res = await call(
        "POST",
        "/reports",
        { reportedUserId: a.id, contentType: "user", reason: "spam" },
        a.token
      );
      assert.equal(res.status, 400);
    });

    await t.test("verlangt ein Token", async () => {
      const res = await call("POST", "/reports", { reportedUserId: "x", contentType: "user", reason: "spam" });
      assert.equal(res.status, 401);
    });
  });
});
