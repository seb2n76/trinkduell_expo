// Ungelesen-Markierung im Chat.
//
// Push gibt es seit `7841c4d`, aber in der App war nirgends zu sehen, WO etwas
// Neues liegt. Grundlage ist ein Lesestand pro Nutzer und Unterhaltung;
// ungelesen ist alles, was danach kam.
//
// Die Zählregeln sind der schwierige Teil, nicht das Speichern:
//   - eigene Nachrichten zählen nie
//   - in Gruppen zählen fremde Nachrichten, aber nicht die von Blockierten
//     (die bekommt man beim Öffnen gar nicht zu sehen — der Zähler wäre nicht
//     zu leeren)
//   - ohne Lesestand ist alles ungelesen
const test = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer } = require("./helpers/server");

/** Macht aus zwei Konten Freunde, damit sie sich schreiben dürfen. */
async function befreunden(call, a, b) {
  const anfrage = await call("POST", "/friends/request", { receiver_username: b.name }, a.token);
  assert.ok(anfrage.status < 300, `Anfrage: ${anfrage.status} ${JSON.stringify(anfrage.json)}`);
  const annahme = await call("POST", "/friends/accept", { sender_username: a.name }, b.token);
  assert.ok(annahme.status < 300, `Annahme: ${annahme.status} ${JSON.stringify(annahme.json)}`);
}

async function schreiben(call, von, anUserId, text) {
  const res = await call("POST", "/messages", { receiverId: anUserId, content: text }, von.token);
  assert.equal(res.status, 201, `Senden: ${JSON.stringify(res.json)}`);
}

async function inGruppeSchreiben(call, von, groupId, text) {
  const res = await call("POST", "/messages", { groupId, content: text }, von.token);
  assert.equal(res.status, 201, `Gruppennachricht: ${JSON.stringify(res.json)}`);
}

async function ungelesen(call, user) {
  const res = await call("GET", "/messages/unread", undefined, user.token);
  assert.equal(res.status, 200, `Abruf: ${JSON.stringify(res.json)}`);
  return res.json;
}

test("Ungelesene Nachrichten", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());
  const { call, register } = server;

  await t.test("Direktnachrichten", async (t) => {
    await t.test("ohne Nachrichten ist alles leer", async () => {
      const user = await register("ur-a1");
      const res = await ungelesen(call, user);
      assert.equal(res.total, 0);
      assert.deepEqual(res.conversations, {});
    });

    await t.test("zählt empfangene Nachrichten", async () => {
      const anna = await register("ur-a2");
      const bert = await register("ur-b2");
      await befreunden(call, anna, bert);

      await schreiben(call, bert, anna.id, "Hallo");
      await schreiben(call, bert, anna.id, "Bist du da?");

      const res = await ungelesen(call, anna);
      assert.equal(res.total, 2);
      assert.equal(res.conversations[`dm:${bert.id}`], 2);
    });

    await t.test("eigene Nachrichten zählen nicht", async () => {
      const anna = await register("ur-a3");
      const bert = await register("ur-b3");
      await befreunden(call, anna, bert);

      await schreiben(call, anna, bert.id, "Ich schreibe");
      await schreiben(call, anna, bert.id, "und nochmal");

      const res = await ungelesen(call, anna);
      assert.equal(res.total, 0, "Was ich selbst schicke, ist für mich nicht neu");

      // Beim Empfänger dagegen schon.
      const beiBert = await ungelesen(call, bert);
      assert.equal(beiBert.total, 2);
    });

    await t.test("Als-gelesen-Markieren leert den Zähler", async () => {
      const anna = await register("ur-a4");
      const bert = await register("ur-b4");
      await befreunden(call, anna, bert);
      await schreiben(call, bert, anna.id, "Neu");

      assert.equal((await ungelesen(call, anna)).total, 1);

      const markiert = await call("POST", "/messages/read", { receiverId: bert.id }, anna.token);
      assert.equal(markiert.status, 200);
      assert.equal(markiert.json.conversationKey, `dm:${bert.id}`);

      assert.equal((await ungelesen(call, anna)).total, 0);
    });

    await t.test("eine Nachricht NACH dem Lesen zählt wieder", async () => {
      const anna = await register("ur-a5");
      const bert = await register("ur-b5");
      await befreunden(call, anna, bert);

      await schreiben(call, bert, anna.id, "Erste");
      await call("POST", "/messages/read", { receiverId: bert.id }, anna.token);

      // Der Lesestand hat Sekundenauflösung im Vergleich nicht, aber die
      // Zeitstempel sind ISO-Strings mit Millisekunden — kurz warten reicht.
      await new Promise((resolve) => setTimeout(resolve, 50));
      await schreiben(call, bert, anna.id, "Zweite");

      const res = await ungelesen(call, anna);
      assert.equal(res.total, 1, "Nur die neue Nachricht");
    });

    await t.test("trennt die Unterhaltungen", async () => {
      const anna = await register("ur-a6");
      const bert = await register("ur-b6");
      const clara = await register("ur-c6");
      await befreunden(call, anna, bert);
      await befreunden(call, anna, clara);

      await schreiben(call, bert, anna.id, "von bert");
      await schreiben(call, clara, anna.id, "von clara");
      await schreiben(call, clara, anna.id, "und noch was");

      const res = await ungelesen(call, anna);
      assert.equal(res.total, 3);
      assert.equal(res.conversations[`dm:${bert.id}`], 1);
      assert.equal(res.conversations[`dm:${clara.id}`], 2);

      // Eine zu lesen lässt die andere stehen.
      await call("POST", "/messages/read", { receiverId: bert.id }, anna.token);
      const danach = await ungelesen(call, anna);
      assert.equal(danach.total, 2);
      assert.equal(danach.conversations[`dm:${bert.id}`], undefined);
      assert.equal(danach.conversations[`dm:${clara.id}`], 2);
    });

    await t.test("fremde Unterhaltungen bleiben unsichtbar", async () => {
      const anna = await register("ur-a7");
      const bert = await register("ur-b7");
      const fremd = await register("ur-f7");
      await befreunden(call, anna, bert);
      await schreiben(call, bert, anna.id, "privat");

      const res = await ungelesen(call, fremd);
      assert.equal(res.total, 0, "Nachrichten anderer Leute gehören niemandem sonst");
    });
  });

  await t.test("Gruppen", async (t) => {
    await t.test("zählt fremde Gruppennachrichten", async () => {
      const admin = await register("ur-ga1");
      const mitglied = await register("ur-gm1");
      const gruppe = await call(
        "POST",
        "/groups",
        { name: "Chatgruppe", memberIds: [mitglied.id] },
        admin.token
      );
      const groupId = gruppe.json.id;

      await inGruppeSchreiben(call, mitglied, groupId, "Hallo Gruppe");
      await inGruppeSchreiben(call, admin, groupId, "Antwort vom Admin");

      const beimAdmin = await ungelesen(call, admin);
      assert.equal(beimAdmin.total, 1, "Nur die Nachricht des anderen");
      assert.equal(beimAdmin.conversations[`group:${groupId}`], 1);

      const beimMitglied = await ungelesen(call, mitglied);
      assert.equal(beimMitglied.total, 1);
    });

    await t.test("Als-gelesen-Markieren leert die Gruppe", async () => {
      const admin = await register("ur-ga2");
      const mitglied = await register("ur-gm2");
      const gruppe = await call(
        "POST",
        "/groups",
        { name: "Chatgruppe", memberIds: [mitglied.id] },
        admin.token
      );
      const groupId = gruppe.json.id;
      await inGruppeSchreiben(call, mitglied, groupId, "Neu");

      assert.equal((await ungelesen(call, admin)).total, 1);
      const markiert = await call("POST", "/messages/read", { groupId }, admin.token);
      assert.equal(markiert.status, 200);
      assert.equal((await ungelesen(call, admin)).total, 0);
    });

    await t.test("Nichtmitglieder zählen nichts und dürfen nichts markieren", async () => {
      const admin = await register("ur-ga3");
      const fremd = await register("ur-gf3");
      const gruppe = await call("POST", "/groups", { name: "Chatgruppe" }, admin.token);
      const groupId = gruppe.json.id;
      await inGruppeSchreiben(call, admin, groupId, "intern");

      assert.equal((await ungelesen(call, fremd)).total, 0);

      const markiert = await call("POST", "/messages/read", { groupId }, fremd.token);
      assert.equal(markiert.status, 403);
    });

    await t.test("Blockierte zählen nicht mit", async () => {
      // Sonst stünde eine Zahl an einer Gruppe, deren Nachricht man beim
      // Öffnen gar nicht zu sehen bekommt — ein Zähler, der sich nie leeren
      // lässt.
      const admin = await register("ur-ga4");
      const stoerer = await register("ur-gs4");
      const gruppe = await call(
        "POST",
        "/groups",
        { name: "Chatgruppe", memberIds: [stoerer.id] },
        admin.token
      );
      const groupId = gruppe.json.id;

      await inGruppeSchreiben(call, stoerer, groupId, "vor der Blockierung");
      assert.equal((await ungelesen(call, admin)).total, 1);

      await call("POST", "/blocks", { userId: stoerer.id }, admin.token);
      assert.equal(
        (await ungelesen(call, admin)).total,
        0,
        "Nach der Blockierung darf die Nachricht nicht mehr zählen"
      );
    });
  });

  await t.test("Fehlerfälle", async (t) => {
    await t.test("beide Abrufe verlangen ein Token", async () => {
      assert.equal((await call("GET", "/messages/unread")).status, 401);
      assert.equal((await call("POST", "/messages/read", { groupId: "x" })).status, 401);
    });

    await t.test("ohne Ziel wird abgewiesen", async () => {
      const user = await register("ur-e1");
      assert.equal((await call("POST", "/messages/read", {}, user.token)).status, 400);
    });

    await t.test("beide Ziele gleichzeitig werden abgewiesen", async () => {
      const user = await register("ur-e2");
      const res = await call(
        "POST",
        "/messages/read",
        { receiverId: user.id, groupId: "irgendwas" },
        user.token
      );
      assert.equal(res.status, 400);
    });

    await t.test("unbekannter Nutzer wird abgewiesen", async () => {
      const user = await register("ur-e3");
      const res = await call("POST", "/messages/read", { receiverId: "gibtsnicht" }, user.token);
      assert.equal(res.status, 404);
    });

    await t.test("der Lesestand wird nie zurückdatiert", async () => {
      // Zwei Geräte lesen dieselbe Unterhaltung; das langsamere darf den Stand
      // des schnelleren nicht überschreiben.
      const anna = await register("ur-e4");
      const bert = await register("ur-b4b");
      await befreunden(call, anna, bert);

      await schreiben(call, bert, anna.id, "Erste");
      await call("POST", "/messages/read", { receiverId: bert.id }, anna.token);
      await new Promise((resolve) => setTimeout(resolve, 50));
      await schreiben(call, bert, anna.id, "Zweite");
      await call("POST", "/messages/read", { receiverId: bert.id }, anna.token);

      // Ein weiterer Aufruf darf den Stand nicht nach hinten bewegen.
      await call("POST", "/messages/read", { receiverId: bert.id }, anna.token);
      assert.equal((await ungelesen(call, anna)).total, 0);
    });
  });
});
