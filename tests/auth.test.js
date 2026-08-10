// Authentication: password reset, rate limiting, session invalidation.
//
// Every test here corresponds to a hole that was actually open in production
// (see docs/PROJEKTUEBERGABE.md, "Sicherheitshistorie").
const test = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer } = require("./helpers/server");

test("Authentifizierung", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());
  const { call, register } = server;

  await t.test("Passwort-Reset", async (t) => {
    await t.test("liefert den Code nicht in der Antwort aus", async () => {
      const user = await register("opfer");
      const res = await call("POST", "/auth/forgot-password", { email: user.email });

      assert.equal(res.status, 200);
      assert.equal(res.json.code, undefined, "Der Reset-Code darf niemals über HTTP zurückkommen");
    });

    await t.test("antwortet bei unbekannter E-Mail identisch (keine Enumeration)", async () => {
      const user = await register("bekannt");
      const known = await call("POST", "/auth/forgot-password", { email: user.email });
      const unknown = await call("POST", "/auth/forgot-password", {
        email: `gibtsnicht${Date.now()}@test.local`,
      });

      assert.equal(unknown.status, known.status);
      assert.deepEqual(unknown.json, known.json);
    });

    await t.test("schreibt den Code ins Server-Log, wenn kein Mailversand konfiguriert ist", async () => {
      const user = await register("logpfad");
      await call("POST", "/auth/forgot-password", { email: user.email });

      const match = server.serverLog().match(new RegExp(`${user.email}: (\\d{6})`));
      assert.ok(match, "Ohne RESEND_API_KEY muss der Code im Server-Log stehen");
      assert.equal(match[1].length, 6, "Der Code ist sechsstellig");
    });

    await t.test("sperrt den Code nach 5 Fehlversuchen", async () => {
      const user = await register("bruteforce");
      await call("POST", "/auth/forgot-password", { email: user.email });

      let blockedAfter = null;
      for (let attempt = 1; attempt <= 6; attempt++) {
        const res = await call("POST", "/auth/reset-password", {
          email: user.email,
          code: String(100000 + attempt),
          newPassword: "uebernommen1",
        });
        if (res.json?.error?.includes("gesperrt")) {
          blockedAfter = attempt;
          break;
        }
      }

      assert.equal(blockedAfter, 6, "Der 6. Versuch muss auf den gesperrten Code laufen");

      // Und das Passwort steht unverändert.
      const login = await call("POST", "/auth/login", {
        emailOrUsername: user.name,
        password: user.password,
      });
      assert.equal(login.status, 200, "Das ursprüngliche Passwort muss weiterhin gelten");
    });

    await t.test("setzt das Passwort mit korrektem Code zurück", async () => {
      const user = await register("resetok");
      await call("POST", "/auth/forgot-password", { email: user.email });
      const code = server.serverLog().match(new RegExp(`${user.email}: (\\d{6})`))[1];

      const reset = await call("POST", "/auth/reset-password", {
        email: user.email,
        code,
        newPassword: "ganzneuespw1",
      });
      assert.equal(reset.status, 200);

      const login = await call("POST", "/auth/login", {
        emailOrUsername: user.name,
        password: "ganzneuespw1",
      });
      assert.equal(login.status, 200);
    });
  });

  await t.test("Session-Invalidierung", async (t) => {
    await t.test("entwertet alte Tokens nach einem Passwort-Reset", async () => {
      const user = await register("session");

      const before = await call("GET", "/users/me", undefined, user.token);
      assert.equal(before.status, 200, "Vor dem Reset gilt das Token");

      // iat hat Sekundenauflösung — ohne Wartezeit läge der neue Cut-off in
      // derselben Sekunde wie die Token-Ausstellung.
      await new Promise((resolve) => setTimeout(resolve, 1500));

      await call("POST", "/auth/forgot-password", { email: user.email });
      const code = server.serverLog().match(new RegExp(`${user.email}: (\\d{6})`))[1];
      await call("POST", "/auth/reset-password", {
        email: user.email,
        code,
        newPassword: "nachdemreset1",
      });

      const after = await call("GET", "/users/me", undefined, user.token);
      assert.equal(after.status, 401, "Das alte Token muss nach dem Reset ungültig sein");

      const fresh = await call("POST", "/auth/login", {
        emailOrUsername: user.name,
        password: "nachdemreset1",
      });
      const withNewToken = await call("GET", "/users/me", undefined, fresh.json.token);
      assert.equal(withNewToken.status, 200, "Ein frisches Token muss sofort funktionieren");
    });

    await t.test("weist ein manipuliertes Token ab", async () => {
      const user = await register("tamper");
      const [header, payload] = user.token.split(".");
      const forged = `${header}.${payload}.ungueltigesignatur`;

      const res = await call("GET", "/users/me", undefined, forged);
      assert.equal(res.status, 401);
    });
  });

  await t.test("Rate-Limiting", async (t) => {
    await t.test("blockt wiederholte Fehlanmeldungen auf einen Account", async () => {
      const user = await register("ratelimit");

      let blockedAfter = null;
      for (let attempt = 1; attempt <= 20; attempt++) {
        const res = await call("POST", "/auth/login", {
          emailOrUsername: user.name,
          password: `falsch${attempt}`,
        });
        if (res.status === 429) {
          blockedAfter = attempt;
          break;
        }
      }

      assert.ok(blockedAfter !== null, "Nach genug Fehlversuchen muss 429 kommen");
      assert.ok(blockedAfter <= 12, `429 kam erst bei Versuch ${blockedAfter}`);
    });

    await t.test("sperrt dabei keine anderen Accounts von derselben IP", async () => {
      // Der Test oben hat das IP-Budget angebrochen. Eine WG oder Bar teilt
      // sich eine IP — ein Tippfehler darf nicht die ganze Party aussperren.
      const other = await register("mitbewohner");
      const res = await call("POST", "/auth/login", {
        emailOrUsername: other.name,
        password: other.password,
      });

      assert.equal(res.status, 200);
    });
  });

  await t.test("Registrierung", async (t) => {
    await t.test("lehnt zu kurze Passwörter ab", async () => {
      const res = await call("POST", "/auth/register", {
        username: `kurz${Date.now()}`,
        email: `kurz${Date.now()}@test.local`,
        password: "1234567",
      });
      assert.equal(res.status, 400);
    });

    await t.test("lehnt ungültige Usernames ab", async () => {
      for (const username of ["ab", "mit leerzeichen", "emoji🍺name", "a".repeat(25)]) {
        const res = await call("POST", "/auth/register", {
          username,
          email: `x${Date.now()}${Math.random()}@test.local`,
          password: "testpasswort1",
        });
        assert.equal(res.status, 400, `"${username}" hätte abgelehnt werden müssen`);
      }
    });

    await t.test("lehnt ungültige E-Mail-Adressen ab", async () => {
      const res = await call("POST", "/auth/register", {
        username: `mailtest${Date.now()}`,
        email: "keine-email",
        password: "testpasswort1",
      });
      assert.equal(res.status, 400);
    });

    await t.test("gibt niemals den Passwort-Hash zurück", async () => {
      const user = await register("hash");
      const me = await call("GET", "/users/me", undefined, user.token);

      assert.equal(me.json.password, undefined);
      assert.equal(me.json.sessionValidAfter, undefined, "Internes Auth-Feld gehört nicht in die Antwort");
    });
  });
});
