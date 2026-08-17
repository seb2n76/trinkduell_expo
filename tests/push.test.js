// Push-Benachrichtigungen für Chat-Nachrichten.
//
// Der Versand geht gegen einen lokalen Auffangserver statt gegen Expo
// (EXPO_PUSH_URL ist überschreibbar). Damit ist prüfbar, WER benachrichtigt
// wird — die eigentliche Logik. Was hier nicht geprüft wird, ist die
// Zustellung auf ein echtes Gerät; die braucht FCM-Zugangsdaten und Hardware.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { startTestServer } = require("./helpers/server");

/** Nimmt Push-Requests an und protokolliert sie. */
async function startPushCatcher() {
  const received = [];

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        received.push(JSON.parse(body));
      } catch {
        // Ein unlesbarer Body ist für den Test uninteressant.
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: { status: "ok" } }));
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}/send`,
    received,
    /** Wartet kurz: der Versand läuft absichtlich ohne await. */
    async settle() {
      await new Promise((r) => setTimeout(r, 400));
    },
    /**
     * Abwarten UND leeren. Das Abwarten ist nötig, weil auch das Herstellen
     * einer Freundschaft Benachrichtigungen auslöst — die würden sonst
     * verzögert im nächsten Messfenster landen und dort als Chat-Push
     * gezählt.
     */
    async reset() {
      await new Promise((r) => setTimeout(r, 400));
      received.length = 0;
    },
    stop: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("Push bei Chat-Nachrichten", async (t) => {
  const catcher = await startPushCatcher();
  const server = await startTestServer({ env: { EXPO_PUSH_URL: catcher.url } });

  t.after(async () => {
    await server.stop();
    await catcher.stop();
  });

  const { call, register } = server;

  /** Registriert ein Gerät, sonst hat der Nutzer kein Ziel für einen Push. */
  const withDevice = async (prefix) => {
    const user = await register(prefix);
    await call("POST", "/users/push-token", { token: `ExponentPushToken[${prefix}]` }, user.token);
    return user;
  };

  const befriend = async (a, b) => {
    await call("POST", "/friends/request", { receiver_username: b.name }, a.token);
    await call("POST", "/friends/accept", { sender_username: a.name }, b.token);
  };

  await t.test("Direktnachricht", async (t) => {
    await t.test("benachrichtigt den Empfänger mit Name und Textauszug", async () => {
      const sender = await withDevice("dm-sender");
      const receiver = await withDevice("dm-receiver");
      await befriend(sender, receiver);

      await catcher.reset();
      await call("POST", "/messages", { receiverId: receiver.id, content: "Bist du noch da?" }, sender.token);
      await catcher.settle();

      assert.equal(catcher.received.length, 1, "Genau eine Benachrichtigung");
      const push = catcher.received[0];
      assert.equal(push.to, `ExponentPushToken[dm-receiver]`);
      assert.equal(push.title, sender.name, "Der Titel ist der Absendername");
      assert.equal(push.body, "Bist du noch da?");
      assert.equal(push.data.type, "direct_message");
      assert.equal(push.data.senderId, sender.id);
    });

    await t.test("benachrichtigt den Absender nicht", async () => {
      const sender = await withDevice("dm-self-a");
      const receiver = await withDevice("dm-self-b");
      await befriend(sender, receiver);

      await catcher.reset();
      await call("POST", "/messages", { receiverId: receiver.id, content: "Hallo" }, sender.token);
      await catcher.settle();

      const toSender = catcher.received.filter((p) => p.to.includes("dm-self-a"));
      assert.equal(toSender.length, 0, "Man benachrichtigt sich nicht selbst");
    });

    await t.test("kürzt einen langen Text", async () => {
      const sender = await withDevice("dm-long-a");
      const receiver = await withDevice("dm-long-b");
      await befriend(sender, receiver);

      await catcher.reset();
      await call("POST", "/messages", { receiverId: receiver.id, content: "x".repeat(500) }, sender.token);
      await catcher.settle();

      const body = catcher.received[0].body;
      assert.ok(body.length < 200, `Auszug zu lang: ${body.length}`);
      assert.ok(body.endsWith("…"), "Gekürzter Text wird als solcher markiert");
    });
  });

  await t.test("Gruppennachricht", async (t) => {
    await t.test("benachrichtigt alle Mitglieder außer dem Absender", async () => {
      const sender = await withDevice("g-sender");
      const memberA = await withDevice("g-member-a");
      const memberB = await withDevice("g-member-b");

      const group = await call(
        "POST",
        "/groups",
        { name: "Crew", memberIds: [memberA.id, memberB.id] },
        sender.token
      );

      await catcher.reset();
      await call("POST", "/messages", { groupId: group.json.id, content: "Wer kommt mit?" }, sender.token);
      await catcher.settle();

      const targets = catcher.received.map((p) => p.to).sort();
      assert.deepEqual(targets, [
        "ExponentPushToken[g-member-a]",
        "ExponentPushToken[g-member-b]",
      ]);

      const push = catcher.received[0];
      assert.equal(push.title, "Crew", "Der Titel ist der Gruppenname");
      assert.ok(push.body.startsWith(`${sender.name}: `), "Der Absender steht im Text");
      assert.equal(push.data.type, "group_message");
      assert.equal(push.data.groupId, group.json.id);
    });

    await t.test("benachrichtigt nicht, wer den Absender blockiert hat", async () => {
      const sender = await withDevice("gb-sender");
      const blocker = await withDevice("gb-blocker");
      const neutral = await withDevice("gb-neutral");

      const group = await call(
        "POST",
        "/groups",
        { name: "Gemischt", memberIds: [blocker.id, neutral.id] },
        sender.token
      );

      // Ein Block hindert niemanden daran, in einer gemeinsamen Gruppe zu
      // schreiben. Er darf aber nicht dazu führen, dass die Nachricht der
      // blockierten Person auf dem Sperrbildschirm auftaucht.
      await call("POST", "/blocks", { userId: sender.id }, blocker.token);

      await catcher.reset();
      await call("POST", "/messages", { groupId: group.json.id, content: "Hallo Gruppe" }, sender.token);
      await catcher.settle();

      const targets = catcher.received.map((p) => p.to);
      assert.deepEqual(targets, ["ExponentPushToken[gb-neutral]"]);
    });
  });

  await t.test("ohne registriertes Gerät passiert nichts", async () => {
    const sender = await withDevice("nodev-a");
    const receiver = await register("nodev-b"); // kein Push-Token
    await befriend(sender, receiver);

    await catcher.reset();
    const res = await call("POST", "/messages", { receiverId: receiver.id, content: "Hallo" }, sender.token);
    await catcher.settle();

    assert.equal(res.status, 201, "Die Nachricht muss trotzdem ankommen");
    assert.equal(catcher.received.length, 0);
  });

  await t.test("ein fehlgeschlagener Push lässt die Nachricht durchgehen", async () => {
    // Auffangserver aus, der Versand scheitert also. Die Nachricht ist zu
    // diesem Zeitpunkt schon gespeichert und darf nicht verloren gehen.
    await catcher.stop();

    const sender = await withDevice("fail-a");
    const receiver = await withDevice("fail-b");
    await befriend(sender, receiver);

    const res = await call("POST", "/messages", { receiverId: receiver.id, content: "Trotzdem" }, sender.token);
    assert.equal(res.status, 201);

    const messages = await call("GET", `/messages/direct/${receiver.id}`, undefined, sender.token);
    assert.ok(
      messages.json.some((m) => m.content === "Trotzdem"),
      "Die Nachricht muss gespeichert sein"
    );
  });
});
