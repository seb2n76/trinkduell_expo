const test = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer } = require("./helpers/server");

test("Admin-Konsole", async (t) => {
  await t.test("Zugriffsschutz (Ohne Moderator-Rechte)", async (t) => {
    const server = await startTestServer();
    t.after(() => server.stop());
    const { call, register } = server;

    const normalUser = await register("admin-normalo");

    const endpoints = [
      ["GET", "/admin/stats"],
      ["GET", "/admin/users"],
      ["POST", "/admin/users/any-id/ban", { banned: true }],
      ["POST", "/admin/users/any-id/reset-stats", {}],
      ["POST", "/admin/users/any-id/clean-profile", {}],
      ["DELETE", "/admin/posts/any-post"],
      ["GET", "/admin/drinks"],
      ["PATCH", "/admin/drinks/d-1", { name: "Test" }],
      ["GET", "/admin/rooms"],
      ["DELETE", "/admin/rooms/ABCD"],
      ["POST", "/admin/broadcast", { message: "Test" }],
    ];

    for (const [method, path, body] of endpoints) {
      await t.test(`weist ${method} ${path} mit 404 ab`, async () => {
        const res = await call(method, path, body, normalUser.token);
        assert.equal(res.status, 404, "Normale Nutzer dürfen nicht erfahren, dass es die Admin-Route gibt");
      });
    }
  });

  await t.test("Mit gesetzter Moderator-ID", async (t) => {
    const vorlauf = await startTestServer();
    const admin = await vorlauf.register("admin-chef");
    const cheater = await vorlauf.register("cheat");
    const innocent = await vorlauf.register("user");
    const dbFile = vorlauf.dbFile;
    await new Promise((resolve) => setTimeout(resolve, 50));

    const server = await startTestServer({
      env: { ADMIN_USER_IDS: admin.id, TRINKDUELL_DB_FILE: dbFile },
    });
    t.after(() => server.stop());
    t.after(() => vorlauf.stop());
    const { call } = server;

    await t.test("GET /admin/stats liefert aggregierte KPIs und Server-Info", async () => {
      const res = await call("GET", "/admin/stats", undefined, admin.token);
      assert.equal(res.status, 200);
      assert.ok(res.json.stats);
      assert.ok(typeof res.json.stats.usersCount === "number");
      assert.ok(res.json.server);
      assert.ok(typeof res.json.server.uptimeSeconds === "number");
    });

    await t.test("GET /admin/users listet Nutzer und unterstützt Filter", async () => {
      const allRes = await call("GET", "/admin/users", undefined, admin.token);
      assert.equal(allRes.status, 200);
      assert.ok(allRes.json.length >= 3);

      const searchRes = await call("GET", `/admin/users?q=${cheater.name}`, undefined, admin.token);
      assert.equal(searchRes.status, 200);
      assert.equal(searchRes.json.length, 1);
      assert.equal(searchRes.json[0].name, cheater.name);
    });

    await t.test("POST /admin/users/:id/ban sperrt Account und blockt Login", async () => {
      // Selbstbann verhindern
      const selfBan = await call("POST", `/admin/users/${admin.id}/ban`, { banned: true }, admin.token);
      assert.equal(selfBan.status, 400, "Selbstbann muss abgewiesen werden");

      // Cheater bannen
      const banRes = await call("POST", `/admin/users/${cheater.id}/ban`, { banned: true }, admin.token);
      assert.equal(banRes.status, 200);
      assert.equal(banRes.json.banned, true);

      // Cheater darf sich nicht mehr einloggen
      const loginAttempt = await call("POST", "/auth/login", {
        emailOrUsername: cheater.name,
        password: "testpasswort1",
      });
      assert.equal(loginAttempt.status, 403, "Gesperrte Accounts dürfen sich nicht einloggen");

      // Cheater mit altem Token wird in Middleware abgewiesen
      const authAttempt = await call("GET", "/users/me", undefined, cheater.token);
      assert.equal(authAttempt.status, 403, "Bestehende Tokens gebannter Accounts werden abgewiesen");

      // Filter nach gebannten Nutzern
      const bannedList = await call("GET", "/admin/users?filter=banned", undefined, admin.token);
      assert.equal(bannedList.status, 200);
      assert.ok(bannedList.json.some((u) => u.id === cheater.id));

      // Wieder entsperren
      const unbanRes = await call("POST", `/admin/users/${cheater.id}/ban`, { banned: false }, admin.token);
      assert.equal(unbanRes.status, 200);
      assert.equal(unbanRes.json.banned, false);
    });

    await t.test("POST /admin/users/:id/reset-stats setzt Punkte und Level zurück", async () => {
      const resetRes = await call("POST", `/admin/users/${cheater.id}/reset-stats`, {}, admin.token);
      assert.equal(resetRes.status, 200);

      const userRes = await call("GET", `/admin/users?q=${cheater.name}`, undefined, admin.token);
      assert.equal(userRes.json[0].points, 0);
      assert.equal(userRes.json[0].level, 1);
    });

    await t.test("POST /admin/users/:id/clean-profile setzt Avatar und Name zurück", async () => {
      const cleanRes = await call(
        "POST",
        `/admin/users/${cheater.id}/clean-profile`,
        { resetName: "GereinigterUser" },
        admin.token
      );
      assert.equal(cleanRes.status, 200);

      const userRes = await call("GET", "/admin/users?q=GereinigterUser", undefined, admin.token);
      assert.equal(userRes.json.length, 1);
      assert.equal(userRes.json[0].avatar, null);
    });

    await t.test("DELETE /admin/posts/:id löscht Beiträge autoritativ", async () => {
      const postRes = await call(
        "POST",
        "/posts",
        { text: "Spam-Post", contextType: "friends", contextId: innocent.id },
        innocent.token
      );
      assert.equal(postRes.status, 201);

      const deleteRes = await call("DELETE", `/admin/posts/${postRes.json.id}`, undefined, admin.token);
      assert.equal(deleteRes.status, 200);
    });

    await t.test("GET und PATCH /admin/drinks verwaltet Getränke", async () => {
      const drinks = await call("GET", "/admin/drinks", undefined, admin.token);
      assert.equal(drinks.status, 200);
      assert.ok(drinks.json.length > 0);

      const targetDrink = drinks.json[0];
      const patchRes = await call(
        "PATCH",
        `/admin/drinks/${targetDrink.id}`,
        { name: "Super Bier Edit" },
        admin.token
      );
      assert.equal(patchRes.status, 200);
      assert.equal(patchRes.json.name, "Super Bier Edit");
    });

    await t.test("POST /admin/broadcast veröffentlicht System-Nachrichten", async () => {
      const broadcastRes = await call(
        "POST",
        "/admin/broadcast",
        { message: "Wartung um 03:00 Uhr" },
        admin.token
      );
      assert.equal(broadcastRes.status, 200);
      assert.ok(broadcastRes.json.post);

      const feedRes = await call("GET", "/feed", undefined, innocent.token);
      assert.ok(feedRes.json.some((item) => item.text && item.text.includes("Wartung um 03:00 Uhr")));
    });

    await t.test("GET und DELETE /admin/rooms überwacht und beendet Party-Lobbies", async () => {
      // Create a game room
      const roomRes = await call("POST", "/game-rooms", {
        gameId: "story-kings-court",
        hostName: "LobbyHost",
      });
      assert.equal(roomRes.status, 201);
      const roomCode = roomRes.json.code;

      // Admin listet Räume
      const roomsList = await call("GET", "/admin/rooms", undefined, admin.token);
      assert.equal(roomsList.status, 200);
      assert.ok(roomsList.json.some((r) => r.code === roomCode));

      // Admin beendet Raum
      const deleteRoomRes = await call("DELETE", `/admin/rooms/${roomCode}`, undefined, admin.token);
      assert.equal(deleteRoomRes.status, 200);

      // Raum ist nicht mehr erreichbar
      const getRoomRes = await call("GET", `/game-rooms/${roomCode}`);
      assert.equal(getRoomRes.status, 404);
    });
  });
});
