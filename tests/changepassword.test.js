// Passwort ändern im eingeloggten Zustand.
//
// Der interessante Teil ist nicht das Ändern selbst, sondern die Asymmetrie
// danach: alle FREMDEN Sitzungen müssen sterben (sonst überlebt ein gestohlenes
// 30-Tage-Token die Reaktion auf genau den Diebstahl), die EIGENE aber nicht
// (sonst wirft sich der Nutzer mit der Schutzmaßnahme selbst raus).
const test = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer } = require("./helpers/server");

const NEW_PASSWORD = "meinneuespw99";

test("Passwort ändern", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());
  const { call, register } = server;

  await t.test("Nachweis des alten Passworts", async (t) => {
    await t.test("verlangt ein Token", async () => {
      const res = await call("POST", "/auth/change-password", {
        currentPassword: "testpasswort1",
        newPassword: NEW_PASSWORD,
      });
      assert.equal(res.status, 401);
    });

    await t.test("weist ein falsches altes Passwort ab und lässt das alte gelten", async () => {
      const user = await register("falschesalt");

      const res = await call(
        "POST",
        "/auth/change-password",
        { currentPassword: "voelligfalsch1", newPassword: NEW_PASSWORD },
        user.token
      );
      assert.equal(res.status, 401);
      assert.equal(res.json.token, undefined, "Ein Fehlversuch darf kein Token ausgeben");

      // Der eigentliche Punkt: der Fehlversuch darf nichts verändert haben.
      const login = await call("POST", "/auth/login", {
        emailOrUsername: user.name,
        password: user.password,
      });
      assert.equal(login.status, 200, "Das ursprüngliche Passwort muss weiterhin gelten");
    });

    await t.test("weist ein zu kurzes neues Passwort ab", async () => {
      const user = await register("zukurz");
      const res = await call(
        "POST",
        "/auth/change-password",
        { currentPassword: user.password, newPassword: "kurz" },
        user.token
      );
      assert.equal(res.status, 400);
    });

    await t.test("weist das unveränderte Passwort ab", async () => {
      const user = await register("gleich");
      const res = await call(
        "POST",
        "/auth/change-password",
        { currentPassword: user.password, newPassword: user.password },
        user.token
      );
      assert.equal(res.status, 400);
    });

    await t.test("bricht ein überlanges altes Passwort ab, bevor bcrypt es sieht", async () => {
      const user = await register("langesalt");
      const res = await call(
        "POST",
        "/auth/change-password",
        { currentPassword: "x".repeat(5000), newPassword: NEW_PASSWORD },
        user.token
      );
      assert.equal(res.status, 401);
    });
  });

  await t.test("Wirkung auf Sitzungen", async (t) => {
    await t.test("beendet fremde Sitzungen, erhält die eigene", async () => {
      const user = await register("sitzungen");

      // Zweites Gerät: eigener Login, eigenes Token.
      const second = await call("POST", "/auth/login", {
        emailOrUsername: user.name,
        password: user.password,
      });
      const otherDeviceToken = second.json.token;
      assert.equal(
        (await call("GET", "/users/me", undefined, otherDeviceToken)).status,
        200,
        "Vor der Änderung gilt das Token des zweiten Geräts"
      );

      // iat hat Sekundenauflösung: ohne Wartezeit läge der Stichtag in
      // derselben Sekunde wie die Ausstellung und die alten Tokens kämen
      // durch die Toleranz von isTokenRevoked() durch.
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const res = await call(
        "POST",
        "/auth/change-password",
        { currentPassword: user.password, newPassword: NEW_PASSWORD },
        user.token
      );
      assert.equal(res.status, 200);
      assert.ok(res.json.token, "Die Antwort muss ein frisches Token enthalten");

      assert.equal(
        (await call("GET", "/users/me", undefined, otherDeviceToken)).status,
        401,
        "Das zweite Gerät muss abgemeldet sein"
      );
      assert.equal(
        (await call("GET", "/users/me", undefined, user.token)).status,
        401,
        "Auch das Token, mit dem geändert wurde, ist verbraucht"
      );
      assert.equal(
        (await call("GET", "/users/me", undefined, res.json.token)).status,
        200,
        "Das neue Token muss sofort funktionieren — sonst sperrt sich der Nutzer selbst aus"
      );
    });

    await t.test("das neue Passwort gilt, das alte nicht mehr", async () => {
      const user = await register("neuespw");

      const res = await call(
        "POST",
        "/auth/change-password",
        { currentPassword: user.password, newPassword: NEW_PASSWORD },
        user.token
      );
      assert.equal(res.status, 200);

      const alt = await call("POST", "/auth/login", {
        emailOrUsername: user.name,
        password: user.password,
      });
      assert.equal(alt.status, 401, "Das alte Passwort darf nicht mehr funktionieren");

      const neu = await call("POST", "/auth/login", {
        emailOrUsername: user.name,
        password: NEW_PASSWORD,
      });
      assert.equal(neu.status, 200);
    });

    await t.test("entwertet einen offenen Reset-Code", async () => {
      const user = await register("resetcode");

      // Angreifer-Szenario: jemand fordert einen Code an, das Opfer ändert
      // daraufhin das Passwort. Bliebe der Code gültig, wäre der Weg über
      // „Passwort vergessen" weiter offen.
      await call("POST", "/auth/forgot-password", { email: user.email });
      const code = server.serverLog().match(new RegExp(`${user.email}: (\\d{6})`))[1];

      const res = await call(
        "POST",
        "/auth/change-password",
        { currentPassword: user.password, newPassword: NEW_PASSWORD },
        user.token
      );
      assert.equal(res.status, 200);

      const reset = await call("POST", "/auth/reset-password", {
        email: user.email,
        code,
        newPassword: "uebernommen123",
      });
      assert.equal(reset.status, 400, "Der Code von vor der Änderung darf nicht mehr greifen");

      const login = await call("POST", "/auth/login", {
        emailOrUsername: user.name,
        password: NEW_PASSWORD,
      });
      assert.equal(login.status, 200, "Es gilt weiterhin das selbst gesetzte Passwort");
    });
  });

  await t.test("Rate-Limit", async (t) => {
    await t.test("blockt wiederholtes Raten des alten Passworts", async () => {
      const user = await register("ratenpw");

      let blockedAfter = null;
      for (let attempt = 1; attempt <= 20; attempt++) {
        const res = await call(
          "POST",
          "/auth/change-password",
          { currentPassword: `falsch${attempt}`, newPassword: NEW_PASSWORD },
          user.token
        );
        if (res.status === 429) {
          blockedAfter = attempt;
          break;
        }
      }

      assert.ok(blockedAfter !== null, "Nach genug Fehlversuchen muss 429 kommen");
      assert.ok(blockedAfter <= 12, `429 kam erst bei Versuch ${blockedAfter}`);
    });
  });
});
