// Input validation, body limits, CORS and error shapes.
const test = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer } = require("./helpers/server");

test("Validierung und Härtung", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());
  const { base, call, register } = server;

  await t.test("Zahlen sind nach oben UND unten begrenzt", async (t) => {
    await t.test("lehnt negative und unsinnige Getränkewerte ab", async () => {
      const user = await register("zahlen");

      const invalid = [
        { name: "Negativ", category: "Bier", volume: -500, abv: 5 },
        { name: "Zu groß", category: "Bier", volume: 99999, abv: 5 },
        { name: "Negativer Alk", category: "Bier", volume: 500, abv: -10 },
        { name: "Unmöglicher Alk", category: "Bier", volume: 500, abv: 150 },
        { name: "Keine Zahl", category: "Bier", volume: "abc", abv: 5 },
      ];

      for (const drink of invalid) {
        const res = await call("POST", "/drinks", drink, user.token);
        assert.equal(res.status, 400, `${drink.name} hätte abgelehnt werden müssen`);
      }

      const valid = await call(
        "POST",
        "/drinks",
        { name: `Gültig${Date.now()}`, category: "Bier", volume: 500, abv: 5 },
        user.token
      );
      assert.equal(valid.status, 201);
    });

    await t.test("lehnt unplausible Zeitstempel ab", async () => {
      const user = await register("zeit");
      const drinks = await call("GET", "/drinks", undefined, user.token);
      const drinkId = drinks.json[0].id;

      const future = await call(
        "POST",
        "/logs",
        { drinkId, timestamp: new Date(Date.now() + 86400000).toISOString() },
        user.token
      );
      assert.equal(future.status, 400, "Ein Eintrag in der Zukunft verfälscht Rangliste und Duelle");

      const ancient = await call("POST", "/logs", { drinkId, timestamp: "1999-01-01T00:00:00Z" }, user.token);
      assert.equal(ancient.status, 400);

      const garbage = await call("POST", "/logs", { drinkId, timestamp: "übermorgen" }, user.token);
      assert.equal(garbage.status, 400);

      const recent = await call(
        "POST",
        "/logs",
        { drinkId, timestamp: new Date(Date.now() - 3600000).toISOString() },
        user.token
      );
      assert.equal(recent.status, 201, "Die Offline-Warteschlange muss nachtragen dürfen");
    });

    await t.test("lehnt unmögliche Koordinaten ab", async () => {
      const user = await register("koord");
      const drinks = await call("GET", "/drinks", undefined, user.token);

      const res = await call(
        "POST",
        "/logs",
        { drinkId: drinks.json[0].id, latitude: 999, longitude: 13 },
        user.token
      );
      assert.equal(res.status, 400);
    });

    await t.test("begrenzt die Event- und Quest-Dauer", async () => {
      const user = await register("dauer");

      const tooLong = await call("POST", "/events", { name: "Endlos", durationHours: 999999 }, user.token);
      assert.equal(tooLong.status, 400);

      const notANumber = await call("POST", "/events", { name: "Kaputt", durationHours: "bald" }, user.token);
      assert.equal(notANumber.status, 400);

      const fine = await call("POST", "/events", { name: "Normal", durationHours: 5 }, user.token);
      assert.equal(fine.status, 201);
    });
  });

  await t.test("Texte sind begrenzt", async (t) => {
    await t.test("lehnt leere und überlange Nachrichten ab", async () => {
      const a = await register("texta");
      const b = await register("textb");
      await call("POST", "/friends/request", { receiver_username: b.name }, a.token);
      await call("POST", "/friends/accept", { sender_username: a.name }, b.token);

      const empty = await call("POST", "/messages", { receiverId: b.id, content: "   " }, a.token);
      assert.equal(empty.status, 400);

      const huge = await call("POST", "/messages", { receiverId: b.id, content: "x".repeat(5000) }, a.token);
      assert.equal(huge.status, 400);

      const ok = await call("POST", "/messages", { receiverId: b.id, content: "Passt" }, a.token);
      assert.equal(ok.status, 201);
    });

    await t.test("lehnt Steuerzeichen in Namen ab", async () => {
      const user = await register("steuer");
      const res = await call("PUT", `/users/${user.id}`, { name: "name\u0000mit" }, user.token);
      assert.equal(res.status, 400);
    });

    await t.test("verhindert doppelte Usernames beim Umbenennen", async () => {
      const a = await register("dupa");
      const b = await register("dupb");

      const res = await call("PUT", `/users/${a.id}`, { name: b.name }, a.token);
      assert.equal(res.status, 400);
    });
  });

  await t.test("Avatare", async (t) => {
    await t.test("akzeptiert nur Base64-Bilddaten", async () => {
      const user = await register("avatar");

      const invalid = [
        "https://example.com/bild.jpg",
        "javascript:alert(1)",
        "data:text/html;base64,PHNjcmlwdD4=",
        "einfach nur text",
      ];

      for (const image of invalid) {
        const res = await call("POST", `/users/${user.id}/avatar`, { image }, user.token);
        assert.equal(res.status, 400, `"${image.slice(0, 30)}" hätte abgelehnt werden müssen`);
      }

      // 1x1 GIF
      const valid = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
      const ok = await call("POST", `/users/${user.id}/avatar`, { image: valid }, user.token);
      assert.equal(ok.status, 200);
    });

    await t.test("lässt kein fremdes Bild setzen", async () => {
      const a = await register("bilda");
      const b = await register("bildb");
      const valid = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

      const res = await call("POST", `/users/${b.id}/avatar`, { image: valid }, a.token);
      assert.equal(res.status, 403);
    });
  });

  await t.test("Request-Größe", async (t) => {
    await t.test("weist einen zu großen Body mit 413 ab", async () => {
      const user = await register("gross");

      const res = await fetch(`${base}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${user.token}` },
        body: JSON.stringify({ receiverId: user.id, content: "x".repeat(400 * 1024) }),
      });

      assert.equal(res.status, 413);
      const json = await res.json();
      assert.ok(json.error, "Auch der Größenfehler muss sauberes JSON sein, kein HTML-Stacktrace");
    });

    await t.test("beantwortet kaputtes JSON mit 400 statt HTML", async () => {
      const res = await fetch(`${base}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{das ist kein json",
      });

      assert.equal(res.status, 400);
      const json = await res.json();
      assert.ok(json.error);
    });
  });

  await t.test("CORS", async (t) => {
    await t.test("erlaubt Requests ohne Origin (native App)", async () => {
      const res = await fetch(`${base}/users`);
      assert.equal(res.status, 401, "Ohne Origin darf nur die Auth greifen, nicht CORS");
    });

    await t.test("weist eine fremde Origin ab", async () => {
      const res = await fetch(`${base}/users`, { headers: { Origin: "https://boese-seite.example" } });
      assert.equal(res.status, 403);
    });

    await t.test("lässt die konfigurierte Origin durch", async () => {
      const res = await fetch(`${base}/users`, { headers: { Origin: "https://webapp.trinkduell.com" } });
      assert.equal(res.status, 401, "Erlaubte Origin -> normale Auth-Antwort");
    });
  });

  await t.test("Fehlermeldungen verraten keine Interna", async () => {
    const res = await call("POST", "/auth/login", { emailOrUsername: "gibtsnicht", password: "falsch" });

    assert.equal(res.status, 401);
    assert.ok(
      !/at \/|node_modules|SELECT |Error:/i.test(JSON.stringify(res.json)),
      "Keine Pfade, SQL-Fragmente oder Stacktraces in der Antwort"
    );
  });
});
