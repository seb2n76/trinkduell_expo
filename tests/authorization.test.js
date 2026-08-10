// Authorization: who may see what, and who may change what.
//
// Each test pairs the two directions on purpose — "the stranger is refused"
// alone would also pass if the feature were simply broken for everyone.
const test = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer } = require("./helpers/server");

// Establishes a confirmed friendship the way the API requires: the sender
// asks, and only the receiver can accept.
async function befriend(call, a, b) {
  await call("POST", "/friends/request", { receiver_username: b.name }, a.token);
  const accepted = await call("POST", "/friends/accept", { sender_username: a.name }, b.token);
  assert.equal(accepted.status, 200, "Freundschaft konnte nicht hergestellt werden");
}

test("Autorisierung", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());
  const { call, register } = server;

  await t.test("E-Mail-Adressen", async (t) => {
    await t.test("gibt die eigene E-Mail im eigenen Profil zurück", async () => {
      const user = await register("eigen");
      const me = await call("GET", "/users/me", undefined, user.token);

      assert.equal(me.json.email, user.email);
    });

    await t.test("gibt in der Nutzerliste keine E-Mails preis", async () => {
      const a = await register("listea");
      await register("listeb");

      const res = await call("GET", "/users", undefined, a.token);
      const leaked = res.json.filter((u) => u.email !== undefined);

      assert.equal(leaked.length, 0, "Kein Nutzer in der Liste darf eine E-Mail enthalten");
    });

    await t.test("gibt im fremden Profil keine E-Mail preis", async () => {
      const a = await register("fremda");
      const b = await register("fremdb");

      const foreign = await call("GET", `/users/${b.id}`, undefined, a.token);
      assert.equal(foreign.json.email, undefined);

      const own = await call("GET", `/users/${a.id}`, undefined, a.token);
      assert.equal(own.json.email, a.email, "Das eigene Profil behält die E-Mail");
    });

    await t.test("findet Nutzer über den Namen, nicht über die E-Mail", async () => {
      const a = await register("suchera");
      const b = await register("gesuchtb");

      const byName = await call("GET", `/users/search?q=${b.name}`, undefined, a.token);
      assert.equal(byName.json.length, 1);
      assert.equal(byName.json[0].email, undefined, "Auch Treffer tragen keine E-Mail");

      const byMail = await call(
        "GET",
        `/users/search?q=${encodeURIComponent(b.email)}`,
        undefined,
        a.token
      );
      assert.equal(byMail.json.length, 0, "Die Suche darf kein E-Mail-Verzeichnis sein");
    });
  });

  await t.test("Freundschaften", async (t) => {
    await t.test("lässt eine Anfrage nicht vom Absender selbst annehmen", async () => {
      const attacker = await register("angreifer");
      const victim = await register("opfer");

      await call("POST", "/friends/request", { receiver_username: victim.name }, attacker.token);
      const selfAccept = await call(
        "POST",
        "/friends/accept",
        { sender_username: attacker.name, receiver_username: victim.name },
        attacker.token
      );

      assert.equal(selfAccept.status, 404, "Nur der Empfänger darf annehmen");

      const friends = await call("GET", `/friends/${victim.name}`, undefined, victim.token);
      assert.equal(friends.json.friends.length, 0, "Es darf keine Freundschaft entstanden sein");
    });

    await t.test("nimmt die Anfrage an, wenn der Empfänger es tut", async () => {
      const a = await register("echta");
      const b = await register("echtb");
      await befriend(call, a, b);

      const friends = await call("GET", `/friends/${a.name}`, undefined, a.token);
      assert.equal(friends.json.friends.length, 1);
      assert.equal(friends.json.friends[0].name, b.name);
    });

    await t.test("wertet eine Anfrage im fremden Namen als eigene", async () => {
      const attacker = await register("spoofer");
      const other = await register("andere");
      const target = await register("ziel");

      await call(
        "POST",
        "/friends/request",
        { sender_username: other.name, receiver_username: target.name },
        attacker.token
      );

      const pending = await call("GET", `/friends/${target.name}`, undefined, target.token);
      const names = pending.json.pending.map((u) => u.name);

      assert.ok(names.includes(attacker.name), "Absender ist, wer das Token hält");
      assert.ok(!names.includes(other.name), "Der Body darf die Identität nicht bestimmen");
    });

    await t.test("gibt keine fremde Freundesliste heraus", async () => {
      const a = await register("neugierig");
      const b = await register("privat");

      const res = await call("GET", `/friends/${b.name}`, undefined, a.token);
      assert.equal(res.status, 403);
    });

    await t.test("überträgt Freundschaften bei einer Umbenennung", async () => {
      const a = await register("umbenenner");
      const b = await register("bleibt");
      await befriend(call, a, b);

      const newName = `neuername${Date.now()}`;
      const renamed = await call("PUT", `/users/${a.id}`, { name: newName }, a.token);
      assert.equal(renamed.status, 200);

      const friends = await call("GET", `/friends/${newName}`, undefined, a.token);
      assert.equal(friends.json.friends.length, 1, "Freundschaften dürfen beim Umbenennen nicht verloren gehen");

      const otherSide = await call("GET", `/friends/${b.name}`, undefined, b.token);
      assert.equal(otherSide.json.friends[0].name, newName, "Auch die Gegenseite sieht den neuen Namen");
    });
  });

  await t.test("Standortdaten", async (t) => {
    await t.test("liefert über /logs keine Koordinaten aus", async () => {
      const a = await register("geoa");
      const b = await register("geob");

      const drinks = await call("GET", "/drinks", undefined, a.token);
      await call(
        "POST",
        "/logs",
        { drinkId: drinks.json[0].id, latitude: 52.5163, longitude: 13.3777 },
        b.token
      );

      const logs = await call("GET", "/logs", undefined, a.token);
      const withCoords = logs.json.filter((l) => l.latitude != null || l.longitude != null);

      assert.equal(withCoords.length, 0, "Koordinaten gehören nicht in die Log-Liste");
      assert.ok(logs.json.length > 0, "Das Scoreboard braucht die Logs weiterhin");
    });

    await t.test("zeigt fremde Kartenpunkte nicht", async () => {
      const a = await register("kartea");
      const b = await register("karteb");

      const drinks = await call("GET", "/drinks", undefined, b.token);
      await call(
        "POST",
        "/logs",
        { drinkId: drinks.json[0].id, latitude: 48.1372, longitude: 11.5756 },
        b.token
      );

      const map = await call("GET", "/map", undefined, a.token);
      assert.ok(
        map.json.every((entry) => entry.userId !== b.id),
        "Ohne Freundschaft darf kein Standort sichtbar sein"
      );
    });
  });

  await t.test("Gruppen und Chats", async (t) => {
    await t.test("zeigt fremde Gruppen nicht in der Liste", async () => {
      const owner = await register("gruppeneigner");
      const outsider = await register("aussen");

      const group = await call("POST", "/groups", { name: "Private Runde" }, owner.token);

      const mine = await call("GET", "/groups", undefined, owner.token);
      assert.ok(mine.json.some((g) => g.id === group.json.id));

      const theirs = await call("GET", "/groups", undefined, outsider.token);
      assert.ok(!theirs.json.some((g) => g.id === group.json.id));
    });

    await t.test("lässt nur Mitglieder den Gruppenchat lesen und schreiben", async () => {
      const member = await register("mitglied");
      const outsider = await register("nichtmitglied");
      const group = await call("POST", "/groups", { name: "Chatgruppe" }, member.token);
      const groupId = group.json.id;

      const write = await call("POST", "/messages", { groupId, content: "Intern" }, member.token);
      assert.equal(write.status, 201);

      const read = await call("GET", `/messages/group/${groupId}`, undefined, member.token);
      assert.equal(read.status, 200);
      assert.equal(read.json.length, 1);

      const foreignRead = await call("GET", `/messages/group/${groupId}`, undefined, outsider.token);
      assert.equal(foreignRead.status, 403);

      const foreignWrite = await call(
        "POST",
        "/messages",
        { groupId, content: "Reingegrätscht" },
        outsider.token
      );
      assert.equal(foreignWrite.status, 403);
    });

    await t.test("erlaubt Direktnachrichten nur an Freunde", async () => {
      const a = await register("dma");
      const friend = await register("dmfreund");
      const stranger = await register("dmfremder");
      await befriend(call, a, friend);

      const toFriend = await call("POST", "/messages", { receiverId: friend.id, content: "Hi!" }, a.token);
      assert.equal(toFriend.status, 201);

      const toStranger = await call("POST", "/messages", { receiverId: stranger.id, content: "Spam" }, a.token);
      assert.equal(toStranger.status, 403);
    });
  });

  await t.test("Getränke-Katalog", async (t) => {
    await t.test("schützt den Standard-Katalog vor dem Löschen", async () => {
      const user = await register("katalog");
      const drinks = await call("GET", "/drinks", undefined, user.token);
      const standard = drinks.json.find((d) => d.id === "drink-beer-500");

      const res = await call("DELETE", `/drinks/${standard.id}`, undefined, user.token);
      assert.equal(res.status, 403);

      const after = await call("GET", "/drinks", undefined, user.token);
      assert.ok(after.json.some((d) => d.id === standard.id), "Das Getränk muss noch da sein");
    });

    await t.test("lässt nur den Ersteller sein eigenes Getränk löschen", async () => {
      const owner = await register("drinkeigner");
      const other = await register("drinkfremd");

      const created = await call(
        "POST",
        "/drinks",
        { name: `Eigenbräu${Date.now()}`, category: "Bier", volume: 400, abv: 5 },
        owner.token
      );

      const foreign = await call("DELETE", `/drinks/${created.json.id}`, undefined, other.token);
      assert.equal(foreign.status, 403);

      const own = await call("DELETE", `/drinks/${created.json.id}`, undefined, owner.token);
      assert.equal(own.status, 200);
    });

    await t.test("verweigert das Löschen, sobald andere das Getränk geloggt haben", async () => {
      const owner = await register("shareda");
      const other = await register("sharedb");

      const created = await call(
        "POST",
        "/drinks",
        { name: `Geteilt${Date.now()}`, category: "Bier", volume: 500, abv: 5 },
        owner.token
      );
      await call("POST", "/logs", { drinkId: created.json.id }, other.token);

      const logsBefore = (await call("GET", "/logs", undefined, other.token)).json.length;
      const res = await call("DELETE", `/drinks/${created.json.id}`, undefined, owner.token);
      assert.equal(res.status, 409);

      const logsAfter = (await call("GET", "/logs", undefined, other.token)).json.length;
      assert.equal(logsAfter, logsBefore, "Fremde Logs dürfen nicht verschwinden");
    });
  });

  await t.test("Duelle, Quests, Events und Posts", async (t) => {
    await t.test("zeigt nur die eigenen Duelle", async () => {
      const a = await register("duella");
      const b = await register("duellb");
      const uninvolved = await register("unbeteiligt");

      const duel = await call("POST", "/duels", { opponentId: b.id, duration: 60 }, a.token);
      assert.equal(duel.status, 201);

      for (const [label, user] of [["Ersteller", a], ["Gegner", b]]) {
        const res = await call("GET", "/duels", undefined, user.token);
        assert.ok(res.json.some((d) => d.id === duel.json.id), `${label} muss das Duell sehen`);
      }

      const outsider = await call("GET", "/duels", undefined, uninvolved.token);
      assert.ok(!outsider.json.some((d) => d.id === duel.json.id));
    });

    await t.test("lehnt ein Duell gegen sich selbst ab", async () => {
      const a = await register("selbstduell");
      const res = await call("POST", "/duels", { opponentId: a.id, duration: 60 }, a.token);
      assert.equal(res.status, 400);
    });

    await t.test("lässt Quests nur in der eigenen Gruppe anlegen und sehen", async () => {
      const member = await register("questmitglied");
      const outsider = await register("questfremd");
      const group = await call("POST", "/groups", { name: "Questgruppe" }, member.token);

      const foreign = await call(
        "POST",
        "/quests",
        { groupId: group.json.id, title: "Fremd-Quest", type: "drinks", targetValue: 5, durationHours: 2 },
        outsider.token
      );
      assert.equal(foreign.status, 403);

      const own = await call(
        "POST",
        "/quests",
        { groupId: group.json.id, title: "Eigene Quest", type: "drinks", targetValue: 5, durationHours: 2 },
        member.token
      );
      assert.equal(own.status, 201);

      const seen = await call("GET", "/quests", undefined, member.token);
      assert.ok(seen.json.some((q) => q.id === own.json.id));

      const notSeen = await call("GET", "/quests", undefined, outsider.token);
      assert.ok(!notSeen.json.some((q) => q.id === own.json.id));
    });

    await t.test("hält Events samt Invite-Code von Fremden fern", async () => {
      const owner = await register("eventeigner");
      const outsider = await register("eventfremd");

      const event = await call("POST", "/events", { name: "Geburtstag", durationHours: 3 }, owner.token);
      assert.equal(event.status, 201);

      const hidden = await call("GET", "/events", undefined, outsider.token);
      assert.ok(
        !hidden.json.some((e) => e.id === event.json.id),
        "Ein Event trägt seinen Invite-Code — es darf nicht in fremden Listen stehen"
      );

      const joined = await call("POST", "/events/join", { code: event.json.inviteCode }, outsider.token);
      assert.equal(joined.status, 200, "Mit bekanntem Code bleibt der Beitritt möglich");

      const visible = await call("GET", "/events", undefined, outsider.token);
      assert.ok(visible.json.some((e) => e.id === event.json.id));
    });

    await t.test("beschränkt Posts auf den eigenen Kontext", async () => {
      const member = await register("posta");
      const outsider = await register("postb");
      const group = await call("POST", "/groups", { name: "Postgruppe" }, member.token);

      const own = await call(
        "POST",
        "/posts",
        { text: "Interner Post", contextType: "group", contextId: group.json.id },
        member.token
      );
      assert.equal(own.status, 201);

      const foreign = await call(
        "POST",
        "/posts",
        { text: "Reingegrätscht", contextType: "group", contextId: group.json.id },
        outsider.token
      );
      assert.equal(foreign.status, 403);

      const visible = await call("GET", "/posts", undefined, member.token);
      assert.ok(visible.json.some((p) => p.id === own.json.id));

      const invisible = await call("GET", "/posts", undefined, outsider.token);
      assert.ok(!invisible.json.some((p) => p.id === own.json.id));
    });

    await t.test("erlaubt Status-Posts an die eigenen Freunde", async () => {
      const author = await register("statusa");
      const friend = await register("statusb");
      const stranger = await register("statusc");
      await befriend(call, author, friend);

      const post = await call(
        "POST",
        "/posts",
        { text: "Bin unterwegs!", contextType: "friends", contextId: author.id },
        author.token
      );
      assert.equal(post.status, 201, "Status-Posts brauchen keine Gruppe");

      const inFeed = await call("GET", "/posts", undefined, friend.token);
      assert.ok(inFeed.json.some((p) => p.id === post.json.id), "Freunde sehen den Status");

      const notInFeed = await call("GET", "/posts", undefined, stranger.token);
      assert.ok(!notInFeed.json.some((p) => p.id === post.json.id), "Fremde sehen ihn nicht");

      const asSomeoneElse = await call(
        "POST",
        "/posts",
        { text: "Nicht meiner", contextType: "friends", contextId: friend.id },
        author.token
      );
      assert.equal(asSomeoneElse.status, 403, "Nur im eigenen Namen");
    });
  });

  await t.test("Eigene Daten", async (t) => {
    await t.test("lässt fremde Profile nicht ändern", async () => {
      const a = await register("profila");
      const b = await register("profilb");

      const res = await call("PUT", `/users/${b.id}`, { name: "gekapert" }, a.token);
      assert.equal(res.status, 403);
    });

    await t.test("ignoriert serverseitige Felder im Profil-Update", async () => {
      const user = await register("cheater");

      await call(
        "PUT",
        `/users/${user.id}`,
        { name: user.name, points: 999999, level: 99, rank: "Legende", achievements: ["alles"] },
        user.token
      );

      const me = await call("GET", "/users/me", undefined, user.token);
      assert.equal(me.json.points, 0, "Punkte gehören dem Server");
      assert.equal(me.json.level, 1, "Level gehört dem Server");
    });

    await t.test("lässt fremde Getränke-Logs nicht löschen", async () => {
      const a = await register("loga");
      const b = await register("logb");

      const drinks = await call("GET", "/drinks", undefined, b.token);
      const log = await call("POST", "/logs", { drinkId: drinks.json[0].id }, b.token);

      const res = await call("DELETE", `/logs/${log.json.log.id}`, undefined, a.token);
      assert.equal(res.status, 403);
    });

    await t.test("lässt fremde Konten nicht löschen", async () => {
      const a = await register("kontoa");
      const b = await register("kontob");

      const res = await call("DELETE", `/users/${b.id}`, undefined, a.token);
      assert.equal(res.status, 403);
    });
  });

  await t.test("Jede API-Route verlangt ein Token", async () => {
    const routes = [
      ["GET", "/users"],
      ["GET", "/users/me"],
      ["GET", "/logs"],
      ["GET", "/feed"],
      ["GET", "/map"],
      ["GET", "/radar"],
      ["GET", "/groups"],
      ["GET", "/events"],
      ["GET", "/posts"],
      ["GET", "/duels"],
      ["GET", "/quests"],
      ["GET", "/drinks"],
      ["GET", "/scoreboard"],
    ];

    for (const [method, route] of routes) {
      const res = await call(method, route);
      assert.equal(res.status, 401, `${method} ${route} muss ohne Token 401 liefern`);
    }
  });
});
