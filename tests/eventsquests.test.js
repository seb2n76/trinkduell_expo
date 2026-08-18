// Events und Gruppen-Quests.
//
// Beide Backends waren vollständig, aber von keinem Screen aufgerufen — und
// dadurch auch von keinem Test. Diese Datei holt das nach, bevor die
// Oberfläche sie erreichbar macht: was jetzt bedienbar wird, sollte vorher
// geprüft sein.
//
// Der interessante Teil bei Quests ist, dass der Fortschritt NICHT gespeichert,
// sondern bei jedem Abruf aus den Trink-Logs der Gruppenmitglieder neu
// gerechnet wird. Ein Test muss also Logs anlegen und dann nachsehen.
const test = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer } = require("./helpers/server");

async function gruppeAnlegen(call, admin, mitglieder = []) {
  const res = await call(
    "POST",
    "/groups",
    { name: "Questgruppe", memberIds: mitglieder.map((m) => m.id) },
    admin.token
  );
  assert.equal(res.status, 201, `Gruppe anlegen: ${JSON.stringify(res.json)}`);
  return res.json;
}

async function eventAnlegen(call, user, stunden = 6) {
  const res = await call("POST", "/events", { name: "Testabend", durationHours: stunden }, user.token);
  assert.equal(res.status, 201, `Event anlegen: ${JSON.stringify(res.json)}`);
  return res.json;
}

test("Events", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());
  const { call, register } = server;

  await t.test("anlegen liefert Code und Endzeitpunkt", async () => {
    const user = await register("ev-a1");
    const event = await eventAnlegen(call, user, 6);

    assert.match(event.inviteCode, /^[0-9A-F]{8}$/);
    assert.ok(event.memberIds.includes(user.id), "Der Ersteller ist dabei");

    const rest = new Date(event.endTimestamp).getTime() - Date.now();
    assert.ok(rest > 5.9 * 3600000 && rest < 6.1 * 3600000, "Endzeitpunkt liegt sechs Stunden voraus");
  });

  await t.test("weist unsinnige Dauern ab", async () => {
    const user = await register("ev-a2");
    for (const dauer of [0, -5, 169, 999999999, "viel", null]) {
      const res = await call("POST", "/events", { name: "Testabend", durationHours: dauer }, user.token);
      assert.equal(res.status, 400, `Dauer ${dauer} muss abgewiesen werden`);
    }
  });

  await t.test("weist einen zu kurzen Namen ab", async () => {
    const user = await register("ev-a3");
    const res = await call("POST", "/events", { name: "x", durationHours: 6 }, user.token);
    assert.equal(res.status, 400);
  });

  await t.test("zeigt nur die eigenen Events", async () => {
    const gastgeber = await register("ev-g4");
    const fremd = await register("ev-f4");
    const event = await eventAnlegen(call, gastgeber);

    const meine = await call("GET", "/events", undefined, gastgeber.token);
    assert.ok(meine.json.some((e) => e.id === event.id));

    const fremde = await call("GET", "/events", undefined, fremd.token);
    assert.ok(
      !fremde.json.some((e) => e.id === event.id),
      "Ein fremdes Event darf nicht in der Liste stehen — es trüge seinen Code mit sich"
    );
  });

  await t.test("Beitritt per Code", async (t) => {
    await t.test("macht zum Teilnehmer", async () => {
      const gastgeber = await register("ev-g5");
      const gast = await register("ev-t5");
      const event = await eventAnlegen(call, gastgeber);

      const res = await call("POST", "/events/join", { code: event.inviteCode }, gast.token);
      assert.equal(res.status, 200);

      const seine = await call("GET", "/events", undefined, gast.token);
      assert.ok(seine.json.some((e) => e.id === event.id));
    });

    await t.test("ignoriert Groß- und Kleinschreibung", async () => {
      const gastgeber = await register("ev-g6");
      const gast = await register("ev-t6");
      const event = await eventAnlegen(call, gastgeber);

      const res = await call(
        "POST",
        "/events/join",
        { code: event.inviteCode.toLowerCase() },
        gast.token
      );
      assert.equal(res.status, 200);
    });

    await t.test("weist einen falschen Code ab", async () => {
      const gast = await register("ev-t7");
      const res = await call("POST", "/events/join", { code: "DEADBEEF" }, gast.token);
      assert.equal(res.status, 404);
    });

    await t.test("verlangt ein Token", async () => {
      const gastgeber = await register("ev-g8");
      const event = await eventAnlegen(call, gastgeber);
      const res = await call("POST", "/events/join", { code: event.inviteCode });
      assert.equal(res.status, 401);
    });

    await t.test("doppelter Beitritt legt niemanden zweimal an", async () => {
      const gastgeber = await register("ev-g9");
      const gast = await register("ev-t9");
      const event = await eventAnlegen(call, gastgeber);

      await call("POST", "/events/join", { code: event.inviteCode }, gast.token);
      const zweitens = await call("POST", "/events/join", { code: event.inviteCode }, gast.token);
      assert.equal(zweitens.status, 200);
      assert.equal(
        zweitens.json.memberIds.filter((id) => id === gast.id).length,
        1,
        "Kein Doppeleintrag"
      );
    });

    await t.test("legt das Event nicht doppelt in die Liste", async () => {
      // Genau das ist passiert: der Postgres-Zweig von saveEvent macht ein
      // Upsert, der JSON-Zweig hat blind gepusht. Jeder Beitritt legte damit
      // eine zweite Kopie des Events an — in der App als "Meine Events (2)"
      // mit zweimal demselben Namen sichtbar. Der Test darüber prüfte nur
      // memberIds und hat es deshalb nicht bemerkt.
      const gastgeber = await register("ev-g10");
      const gast = await register("ev-t10");
      const event = await eventAnlegen(call, gastgeber);

      await call("POST", "/events/join", { code: event.inviteCode }, gast.token);

      const seine = await call("GET", "/events", undefined, gast.token);
      assert.equal(
        seine.json.filter((e) => e.id === event.id).length,
        1,
        "Das Event darf nur einmal in der Liste stehen"
      );

      const beimGastgeber = await call("GET", "/events", undefined, gastgeber.token);
      assert.equal(
        beimGastgeber.json.filter((e) => e.id === event.id).length,
        1,
        "Auch beim Gastgeber nur einmal"
      );
    });
  });
});

test("Gruppen-Quests", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());
  const { call, register } = server;

  await t.test("Anlegen", async (t) => {
    await t.test("gelingt einem Mitglied", async () => {
      const admin = await register("q-a1");
      const group = await gruppeAnlegen(call, admin);

      const res = await call(
        "POST",
        "/quests",
        { groupId: group.id, title: "50 Drinks", type: "drinks", targetValue: 50, durationHours: 6 },
        admin.token
      );
      assert.equal(res.status, 201, JSON.stringify(res.json));
      assert.equal(res.json.status, "active");
      assert.equal(res.json.currentValue, 0);
    });

    await t.test("scheitert für Nichtmitglieder", async () => {
      const admin = await register("q-a2");
      const fremd = await register("q-f2");
      const group = await gruppeAnlegen(call, admin);

      const res = await call(
        "POST",
        "/quests",
        { groupId: group.id, title: "Fremdziel", type: "drinks", targetValue: 5, durationHours: 6 },
        fremd.token
      );
      assert.equal(res.status, 403);
    });

    await t.test("weist einen unbekannten Typ ab", async () => {
      const admin = await register("q-a3");
      const group = await gruppeAnlegen(call, admin);

      const res = await call(
        "POST",
        "/quests",
        { groupId: group.id, title: "Unsinn", type: "kaese", targetValue: 5, durationHours: 6 },
        admin.token
      );
      assert.equal(res.status, 400, "Ein unbekannter Typ könnte nie Fortschritt machen");
    });

    await t.test("verlangt ein Token", async () => {
      const admin = await register("q-a4");
      const group = await gruppeAnlegen(call, admin);
      const res = await call("POST", "/quests", {
        groupId: group.id,
        title: "Ohne Token",
        type: "drinks",
        targetValue: 5,
        durationHours: 6,
      });
      assert.equal(res.status, 401);
    });
  });

  await t.test("Fortschritt", async (t) => {
    await t.test("zählt die Logs ALLER Mitglieder, nicht nur die eigenen", async () => {
      const admin = await register("q-a5");
      const mitglied = await register("q-m5");
      const group = await gruppeAnlegen(call, admin, [mitglied]);

      await call(
        "POST",
        "/quests",
        { groupId: group.id, title: "Gemeinsam 3", type: "drinks", targetValue: 3, durationHours: 6 },
        admin.token
      );

      await call("POST", "/logs", { drinkId: "drink-beer-helles" }, admin.token);
      await call("POST", "/logs", { drinkId: "drink-beer-pils" }, mitglied.token);

      const res = await call("GET", "/quests", undefined, admin.token);
      const quest = res.json.find((q) => q.groupId === group.id);
      assert.equal(quest.currentValue, 2, "Beide Logs zählen");
      assert.equal(quest.status, "active", "Das Ziel ist noch nicht erreicht");
    });

    await t.test("springt bei Zielerreichung auf completed", async () => {
      const admin = await register("q-a6");
      const group = await gruppeAnlegen(call, admin);

      await call(
        "POST",
        "/quests",
        { groupId: group.id, title: "Zwei reichen", type: "drinks", targetValue: 2, durationHours: 6 },
        admin.token
      );

      await call("POST", "/logs", { drinkId: "drink-beer-helles" }, admin.token);
      await call("POST", "/logs", { drinkId: "drink-beer-pils" }, admin.token);

      const res = await call("GET", "/quests", undefined, admin.token);
      const quest = res.json.find((q) => q.groupId === group.id);
      assert.equal(quest.status, "completed");
    });

    await t.test("zählt beim Typ water nur Alkoholfreies", async () => {
      const admin = await register("q-a7");
      const group = await gruppeAnlegen(call, admin);

      await call(
        "POST",
        "/quests",
        { groupId: group.id, title: "Trink Wasser", type: "water", targetValue: 5, durationHours: 6 },
        admin.token
      );

      await call("POST", "/logs", { drinkId: "drink-water-glass" }, admin.token);
      await call("POST", "/logs", { drinkId: "drink-beer-helles" }, admin.token);

      const res = await call("GET", "/quests", undefined, admin.token);
      const quest = res.json.find((q) => q.groupId === group.id);
      assert.equal(quest.currentValue, 1, "Das Bier darf nicht mitzählen");
    });

    await t.test("rechnet beim Typ volume in Litern", async () => {
      const admin = await register("q-a8");
      const group = await gruppeAnlegen(call, admin);

      await call(
        "POST",
        "/quests",
        { groupId: group.id, title: "Zehn Liter", type: "volume", targetValue: 10, durationHours: 6 },
        admin.token
      );

      // Helles hat 500 ml.
      await call("POST", "/logs", { drinkId: "drink-beer-helles" }, admin.token);

      const res = await call("GET", "/quests", undefined, admin.token);
      const quest = res.json.find((q) => q.groupId === group.id);
      assert.equal(quest.currentValue, 0.5, "500 ml sind 0,5 Liter, nicht 500");
    });
  });

  await t.test("Sichtbarkeit", async (t) => {
    await t.test("fremde Quests bleiben unsichtbar", async () => {
      const admin = await register("q-a9");
      const fremd = await register("q-f9");
      const group = await gruppeAnlegen(call, admin);

      await call(
        "POST",
        "/quests",
        { groupId: group.id, title: "Geheim", type: "drinks", targetValue: 5, durationHours: 6 },
        admin.token
      );

      const res = await call("GET", "/quests", undefined, fremd.token);
      assert.ok(
        !res.json.some((q) => q.groupId === group.id),
        "Quests einer fremden Gruppe gehören nicht in die Antwort"
      );
    });

    await t.test("verlangt ein Token", async () => {
      const res = await call("GET", "/quests");
      assert.equal(res.status, 401);
    });
  });
});
