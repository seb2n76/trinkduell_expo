// Presigned Uploads (Cloudflare R2).
//
// Der Testserver läuft mit erfundenen R2-Zugangsdaten. Das genügt, weil die
// Signatur lokal berechnet wird — es geht kein Request zu Cloudflare. Was
// dieser Test NICHT abdeckt, ist der echte Upload gegen R2; der braucht die
// produktiven Zugänge und ist nur auf dem Server prüfbar.
const test = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer } = require("./helpers/server");

const R2_ENV = {
  R2_ACCOUNT_ID: "testaccount",
  R2_BUCKET: "trinkduell-test",
  R2_ACCESS_KEY_ID: "testkeyid",
  R2_SECRET_ACCESS_KEY: "testsecretkey",
  R2_PUBLIC_URL: "https://cdn.example.test",
};

const JPEG = "image/jpeg";

test("Uploads", async (t) => {
  const server = await startTestServer({ env: R2_ENV });
  t.after(() => server.stop());
  const { call, register } = server;

  await t.test("meldet Upload als verfügbar", async () => {
    const user = await register("upl-cfg");
    const res = await call("GET", "/uploads/config", undefined, user.token);

    assert.equal(res.status, 200);
    assert.equal(res.json.enabled, true);
    assert.ok(res.json.maxBytes > 0);
  });

  await t.test("signiert eine Upload-URL", async () => {
    const user = await register("upl-ok");
    const res = await call(
      "POST",
      "/uploads/presign",
      { kind: "avatar", contentType: JPEG, contentLength: 50_000 },
      user.token
    );

    assert.equal(res.status, 200);
    // R2 wird im Virtual-Hosted-Style adressiert: <bucket>.<account>.r2...
    assert.match(
      res.json.uploadUrl,
      /^https:\/\/trinkduell-test\.testaccount\.r2\.cloudflarestorage\.com\//
    );
    assert.match(res.json.publicUrl, /^https:\/\/cdn\.example\.test\/avatar\//);
    // Der Schlüssel trägt die Nutzer-ID, damit Besitz aus dem Pfad folgt.
    assert.ok(res.json.key.startsWith(`avatar/${user.id}/`), res.json.key);
    assert.match(res.json.key, /\/[a-f0-9]{32}\.jpg$/, "Zufälliger, nicht erratbarer Name");
  });

  await t.test("schreibt Typ und Größe in die Signatur", async () => {
    const user = await register("upl-sig");
    const res = await call(
      "POST",
      "/uploads/presign",
      { kind: "proof", contentType: JPEG, contentLength: 123_456 },
      user.token
    );

    assert.equal(res.status, 200);
    const url = new URL(res.json.uploadUrl);
    const signedHeaders = url.searchParams.get("X-Amz-SignedHeaders") || "";

    // Das ist der Kern: ohne diese beiden Festschreibungen wäre eine
    // signierte PUT-URL ein Freibrief, beliebig große Dateien beliebigen
    // Typs in den Bucket zu schreiben.
    assert.match(signedHeaders, /content-length/, "Content-Length muss signiert sein");
    assert.match(signedHeaders, /content-type/, "Content-Type muss signiert sein");
    assert.ok(url.searchParams.get("X-Amz-Signature"), "Signatur fehlt");

    // Das SDK würde sonst die CRC32-Summe des LEEREN Payloads mitsignieren
    // (AAAAAA==) — echte Bytes passen dann nicht dazu und R2 lehnt den Upload
    // ab. Ein Fehler, der ausschließlich gegen echtes R2 aufgefallen wäre.
    assert.equal(
      url.searchParams.get("x-amz-checksum-crc32"),
      null,
      "Es darf keine vorab berechnete Prüfsumme in der URL stehen"
    );
    assert.equal(url.searchParams.get("x-amz-sdk-checksum-algorithm"), null);
  });

  await t.test("lässt die URL bald verfallen", async () => {
    const user = await register("upl-ttl");
    const res = await call(
      "POST",
      "/uploads/presign",
      { kind: "avatar", contentType: JPEG, contentLength: 1000 },
      user.token
    );

    const expires = Number(new URL(res.json.uploadUrl).searchParams.get("X-Amz-Expires"));
    assert.ok(expires > 0 && expires <= 900, `Ablauf zu lang: ${expires}s`);
  });

  await t.test("lehnt ungültige Anfragen ab", async () => {
    const user = await register("upl-bad");

    const cases = [
      [{ kind: "beliebig", contentType: JPEG, contentLength: 1000 }, "unbekannter Typ"],
      [{ kind: "avatar", contentType: "application/pdf", contentLength: 1000 }, "kein Bild"],
      [{ kind: "avatar", contentType: "text/html", contentLength: 1000 }, "HTML"],
      [{ kind: "avatar", contentType: JPEG, contentLength: 0 }, "leer"],
      [{ kind: "avatar", contentType: JPEG, contentLength: -5 }, "negativ"],
      [{ kind: "avatar", contentType: JPEG, contentLength: 99_000_000 }, "zu groß"],
      [{ kind: "avatar", contentType: JPEG, contentLength: "viel" }, "keine Zahl"],
      [{ kind: "avatar", contentType: JPEG }, "Größe fehlt"],
    ];

    for (const [body, label] of cases) {
      const res = await call("POST", "/uploads/presign", body, user.token);
      assert.equal(res.status, 400, `${label} hätte abgelehnt werden müssen`);
    }
  });

  await t.test("verlangt ein Token", async () => {
    const res = await call("POST", "/uploads/presign", {
      kind: "avatar",
      contentType: JPEG,
      contentLength: 1000,
    });
    assert.equal(res.status, 401);
  });

  await t.test("nimmt die eigene Speicher-URL als Avatar an", async () => {
    const user = await register("upl-avatar");
    const presign = await call(
      "POST",
      "/uploads/presign",
      { kind: "avatar", contentType: JPEG, contentLength: 5000 },
      user.token
    );

    const res = await call(
      "POST",
      `/users/${user.id}/avatar`,
      { image: presign.json.publicUrl },
      user.token
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.avatarUrl, presign.json.publicUrl);
  });

  await t.test("lehnt fremde und beliebige Bild-URLs ab", async () => {
    const owner = await register("upl-eigner");
    const attacker = await register("upl-fremd");

    const presign = await call(
      "POST",
      "/uploads/presign",
      { kind: "avatar", contentType: JPEG, contentLength: 5000 },
      owner.token
    );

    // Fremde URL aus demselben Speicher: der Pfad trägt eine andere ID.
    const stolen = await call(
      "POST",
      `/users/${attacker.id}/avatar`,
      { image: presign.json.publicUrl },
      attacker.token
    );
    assert.equal(stolen.status, 400, "Ein fremdes Bild darf nicht übernehmbar sein");

    // Beliebige externe URLs — sonst hätte man einen Tracking-Pixel im Feed
    // aller Freunde.
    for (const image of [
      "https://boese-seite.example/tracker.png",
      "https://cdn.example.test/../etc/passwd",
      `https://cdn.example.test/avatar/${attacker.id}/nichtgueltig.jpg`,
      "javascript:alert(1)",
    ]) {
      const res = await call("POST", `/users/${attacker.id}/avatar`, { image }, attacker.token);
      assert.equal(res.status, 400, `"${image.slice(0, 40)}" hätte abgelehnt werden müssen`);
    }
  });

  await t.test("nimmt weiterhin Base64-Bilder an (Bestandsdaten)", async () => {
    const user = await register("upl-base64");
    const gif = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

    const res = await call("POST", `/users/${user.id}/avatar`, { image: gif }, user.token);
    assert.equal(res.status, 200, "Der alte Weg muss weiter funktionieren");
  });

  await t.test("Beweisfoto im Feed", async (t) => {
    await t.test("speichert das Bild am Beitrag und spielt es im Feed aus", async () => {
      const author = await register("proof-a");
      const friend = await register("proof-b");
      await call("POST", "/friends/request", { receiver_username: friend.name }, author.token);
      await call("POST", "/friends/accept", { sender_username: author.name }, friend.token);

      const presign = await call(
        "POST",
        "/uploads/presign",
        { kind: "proof", contentType: JPEG, contentLength: 80_000 },
        author.token
      );

      const post = await call(
        "POST",
        "/posts",
        {
          text: "📸 Beweisfoto aus „Wortbombe“",
          contextType: "friends",
          contextId: author.id,
          image: presign.json.publicUrl,
        },
        author.token
      );
      assert.equal(post.status, 201);

      // Der eigentliche Punkt: das Bild muss den ganzen Weg bis in den Feed
      // eines Freundes überleben. Es fiel vorher an zwei Stellen heraus — die
      // posts-Tabelle hatte keine image-Spalte, und /api/feed gab das Feld
      // nicht durch.
      const feed = await call("GET", "/feed", undefined, friend.token);
      const entry = feed.json.find((e) => e.id === post.json.id);

      assert.ok(entry, "Der Beitrag muss im Freundes-Feed auftauchen");
      assert.equal(entry.image, presign.json.publicUrl, "Das Bild muss mitkommen");
    });

    await t.test("lehnt ein fremdes Bild am Beitrag ab", async () => {
      const owner = await register("proof-eigner");
      const attacker = await register("proof-fremd");

      const presign = await call(
        "POST",
        "/uploads/presign",
        { kind: "proof", contentType: JPEG, contentLength: 5000 },
        owner.token
      );

      const res = await call(
        "POST",
        "/posts",
        {
          text: "Nicht mein Bild",
          contextType: "friends",
          contextId: attacker.id,
          image: presign.json.publicUrl,
        },
        attacker.token
      );
      assert.equal(res.status, 400);
    });

    await t.test("lehnt eine beliebige externe Bild-URL ab", async () => {
      const user = await register("proof-extern");

      const res = await call(
        "POST",
        "/posts",
        {
          text: "Tracking-Pixel",
          contextType: "friends",
          contextId: user.id,
          image: "https://boese-seite.example/pixel.png",
        },
        user.token
      );
      assert.equal(res.status, 400);
    });

    await t.test("Beiträge ohne Bild funktionieren unverändert", async () => {
      const user = await register("proof-ohne");

      const res = await call(
        "POST",
        "/posts",
        { text: "Nur Text", contextType: "friends", contextId: user.id },
        user.token
      );
      assert.equal(res.status, 201);

      const feed = await call("GET", "/feed", undefined, user.token);
      const entry = feed.json.find((e) => e.id === res.json.id);
      assert.equal(entry.image, null);
    });
  });
});

test("Uploads ohne konfigurierten Speicher", async (t) => {
  // Der Normalfall bei lokaler Entwicklung: kein R2, aber die App darf
  // deswegen nicht kaputt sein.
  const server = await startTestServer();
  t.after(() => server.stop());
  const { call, register } = server;

  await t.test("meldet Upload als nicht verfügbar", async () => {
    const user = await register("noupl-cfg");
    const res = await call("GET", "/uploads/config", undefined, user.token);

    assert.equal(res.status, 200);
    assert.equal(res.json.enabled, false);
  });

  await t.test("antwortet mit 503 statt zu scheitern", async () => {
    const user = await register("noupl");
    const res = await call(
      "POST",
      "/uploads/presign",
      { kind: "avatar", contentType: JPEG, contentLength: 1000 },
      user.token
    );

    assert.equal(res.status, 503);
    assert.ok(res.json.error);
  });

  await t.test("Base64-Avatare funktionieren unverändert", async () => {
    const user = await register("noupl-b64");
    const gif = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

    const res = await call("POST", `/users/${user.id}/avatar`, { image: gif }, user.token);
    assert.equal(res.status, 200);
  });
});
