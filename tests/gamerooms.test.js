const test = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer } = require("./helpers/server");

test("Multi-Device Game Rooms & Story Engine", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());
  const { call } = server;

  let createdCode = "";
  let hostPlayerId = "";
  let hostToken = "";
  let joinedPlayerId = "";
  let joinedToken = "";

  await t.test("erstellt einen Spielraum mit 4-stelligem Code", async () => {
    const res = await call("POST", "/game-rooms", {
      gameId: "court_treason",
      hostName: "König Host",
    });

    assert.equal(res.status, 201);
    assert.equal(res.json.success, true);
    assert.match(res.json.code, /^[A-Z0-9]{4}$/);
    assert.ok(res.json.hostId);
    assert.ok(res.json.playerToken, "Der Host bekommt einen Spieler-Token");
    assert.equal(res.json.room.players.length, 1);
    assert.equal(res.json.room.players[0].name, "König Host");
    assert.equal(res.json.room.players[0].isHost, true);

    createdCode = res.json.code;
    hostPlayerId = res.json.hostId;
    hostToken = res.json.playerToken;
  });

  await t.test("erlaubt Mitspielern das Beitreten mit Raum-Code", async () => {
    const res = await call("POST", `/game-rooms/${createdCode}/join`, {
      playerName: "Ritter Tim",
    });

    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.ok(res.json.playerId);
    assert.ok(res.json.playerToken);
    assert.equal(res.json.room.players.length, 2);
    assert.equal(res.json.room.players[1].name, "Ritter Tim");
    assert.equal(res.json.room.players[1].isHost, false);

    joinedPlayerId = res.json.playerId;
    joinedToken = res.json.playerToken;
  });

  await t.test("weist unbekannte Raum-Codes ab", async () => {
    const res = await call("POST", "/game-rooms/XXXX/join", {
      playerName: "Gast",
    });
    assert.equal(res.status, 404);
  });

  await t.test("gibt niemals einen Spieler-Token in der Raumansicht preis", async () => {
    const res = await call("GET", `/game-rooms/${createdCode}?playerToken=${hostToken}`);
    assert.equal(res.status, 200);
    const roh = JSON.stringify(res.json);
    assert.ok(!roh.includes(hostToken), "Der eigene Token darf nicht im Raumzustand stehen");
    assert.ok(!roh.includes(joinedToken), "Fremde Token erst recht nicht");
    for (const p of res.json.room.players) {
      assert.equal(p.token, undefined);
    }
  });

  // ── Rollen kommen vom Server, nicht vom Host ────────────────────────────
  //
  // Bis August 2026 schickte der Host die Rollenverteilung im Start-Aufruf
  // mit. Er konnte sich damit selbst zum Inquisitor und einen Mitspieler zum
  // Mörder erklären — in einem Spiel, dessen ganzer Witz die geheime
  // Rollenverteilung ist. Jetzt verteilt der Server aus der Story-Definition,
  // und ein mitgeschicktes playerRoles wird für Story-Spiele ignoriert.
  await t.test("verteilt Rollen serverseitig und ignoriert die Wunschliste des Hosts", async () => {
    // court_treason verlangt mindestens 3 Spieler.
    const dritter = await call("POST", `/game-rooms/${createdCode}/join`, {
      playerName: "Hofdame Ada",
    });
    assert.equal(dritter.status, 200);
    const drittesToken = dritter.json.playerToken;

    const startRes = await call("POST", `/game-rooms/${createdCode}/start`, {
      playerToken: hostToken,
      gameSetupData: {
        playerRoles: [
          { playerId: hostPlayerId, role: "Wunschrolle des Hosts", secretPrompt: "Geht nicht." },
        ],
      },
    });

    assert.equal(startRes.status, 200);
    assert.equal(startRes.json.room.status, "story_chapter", "Der Server baut Kapitel 1 direkt mit auf");

    const eigene = startRes.json.room.players.find((p) => p.id === hostPlayerId);
    assert.notEqual(eigene.role, "Wunschrolle des Hosts", "Die Wunschrolle des Hosts darf nicht greifen");
    assert.ok(eigene.role, "Der Server muss eine Rolle vergeben haben");

    // Jeder sieht genau eine Rolle: die eigene.
    const sichten = await Promise.all(
      [hostToken, joinedToken, drittesToken].map((tok) =>
        call("GET", `/game-rooms/${createdCode}?playerToken=${tok}`)
      )
    );
    const sichtbareRollen = sichten.map(
      (s) => s.json.room.players.filter((p) => p.role !== null).length
    );
    assert.deepEqual(sichtbareRollen, [1, 1, 1], "Jeder sieht ausschließlich die eigene Rolle");

    // Zusammen ergeben die drei Sichten die volle Verteilung — und die muss
    // genau einen Verräter enthalten.
    const alleRollen = sichten.map((s, i) => {
      const meineId = s.json.room.myPlayerId;
      return s.json.room.players.find((p) => p.id === meineId);
    });
    const verraeter = alleRollen.filter((p) => p.allegiance === "traitor");
    assert.equal(verraeter.length, 1, "Genau ein Attentäter pro Runde");
    assert.equal(verraeter[0].role, "Attentäter 🗡️");

    const hostSync = sichten[0];
    const hostPlayers = hostSync.json.room.players;
    assert.ok(hostPlayers.find((p) => p.id === hostPlayerId).role, "Die eigene Rolle ist sichtbar");
    assert.equal(
      hostPlayers.find((p) => p.id === joinedPlayerId).role,
      null,
      "Fremde Rolle muss für Host maskiert sein"
    );
    assert.equal(
      hostPlayers.find((p) => p.id === joinedPlayerId).secretPrompt,
      null,
      "Der fremde Geheimauftrag erst recht"
    );

    const clientPlayers = sichten[1].json.room.players;
    assert.ok(clientPlayers.find((p) => p.id === joinedPlayerId).role);
    assert.equal(
      clientPlayers.find((p) => p.id === hostPlayerId).role,
      null,
      "Host-Rolle muss für Mitspieler maskiert sein"
    );
  });

  // ── Die playerId ist öffentlich und darf deshalb kein Ausweis sein ──────
  //
  // Sie steht in jeder Raumantwort. Würde der Server sie als Nachweis
  // akzeptieren, wäre die Rollenmaskierung oben wertlos: jeder Mitspieler
  // könnte einfach mit fremder Id fragen.
  await t.test("die öffentliche playerId taugt nicht als Ausweis", async () => {
    const versuch = await call("GET", `/game-rooms/${createdCode}?playerId=${joinedPlayerId}`);
    assert.equal(versuch.status, 200);
    const spieler = versuch.json.room.players;
    assert.equal(
      spieler.find((p) => p.id === joinedPlayerId).role,
      null,
      "Ohne Token bleibt jede Rolle maskiert"
    );
    assert.equal(
      spieler.find((p) => p.id === joinedPlayerId).secretPrompt,
      null,
      "Der geheime Auftrag erst recht"
    );
  });

  await t.test("ein Mitspieler kann nicht die Rolle eines anderen auslesen", async () => {
    // Angreifer kennt Token UND fremde Id — die Id darf nichts nützen.
    const res = await call(
      "GET",
      `/game-rooms/${createdCode}?playerToken=${joinedToken}&playerId=${hostPlayerId}`
    );
    assert.equal(res.status, 200);
    assert.equal(
      res.json.room.players.find((p) => p.id === hostPlayerId).role,
      null,
      "Die mitgeschickte fremde Id darf die Sicht nicht umschalten"
    );
  });

  await t.test("ein Mitspieler kann sich nicht als Host ausgeben", async () => {
    const alsHost = await call("POST", `/game-rooms/${createdCode}/next`, {
      playerToken: joinedToken,
      nextStatus: "finale",
    });
    assert.equal(alsHost.status, 403, "Nur der echte Host darf weiterschalten");

    const mitFremderId = await call("POST", `/game-rooms/${createdCode}/next`, {
      playerId: hostPlayerId,
      nextStatus: "finale",
    });
    assert.equal(mitFremderId.status, 403, "Eine fremde playerId ist kein Host-Nachweis");
  });

  await t.test("ohne gültigen Token lässt sich keine Aktion einreichen", async () => {
    const res = await call("POST", `/game-rooms/${createdCode}/action`, {
      playerId: hostPlayerId,
      actionType: "drink",
      payload: { count: 99 },
    });
    assert.equal(res.status, 403);

    const sync = await call("GET", `/game-rooms/${createdCode}?playerToken=${hostToken}`);
    const host = sync.json.room.players.find((p) => p.id === hostPlayerId);
    assert.equal(host.sipsTaken, 0, "Der gefälschte Trink-Eintrag darf nicht gezählt haben");
  });

  await t.test("verarbeitet Aktionen, Trink-Events und Voting", async () => {
    const voteRes = await call("POST", `/game-rooms/${createdCode}/action`, {
      playerToken: joinedToken,
      actionType: "vote",
      payload: { targetPlayerId: hostPlayerId },
    });
    assert.equal(voteRes.status, 200);
    assert.equal(voteRes.json.room.gameState.voteCount, 1);

    const drinkRes = await call("POST", `/game-rooms/${createdCode}/action`, {
      playerToken: hostToken,
      actionType: "drink",
      payload: { count: 2 },
    });
    assert.equal(drinkRes.status, 200);
    const updatedHost = drinkRes.json.room.players.find((p) => p.id === hostPlayerId);
    assert.equal(updatedHost.sipsTaken, 2);
  });

  await t.test("nur der Host kann Kapitel vorantreiben", async () => {
    const failRes = await call("POST", `/game-rooms/${createdCode}/next`, {
      playerToken: joinedToken,
      nextStatus: "story_chapter",
    });
    assert.equal(failRes.status, 403);

    const nextRes = await call("POST", `/game-rooms/${createdCode}/next`, {
      playerToken: hostToken,
      nextStatus: "story_chapter",
      nextChapterData: { title: "Kapitel 1", text: "Die Burg erwacht..." },
      outcomeSummary: "Kapitel 1 gestartet",
    });
    assert.equal(nextRes.status, 200);
    assert.equal(nextRes.json.room.status, "story_chapter");
  });

  await t.test("Wiedereintritt gelingt nur mit dem eigenen Token", async () => {
    // Der Anzeigename allein darf keinen fremden Platz öffnen — sonst
    // übernimmt jeder mit Raumcode und Namen die Geheimrolle des Opfers.
    const fremd = await call("POST", `/game-rooms/${createdCode}/join`, {
      playerName: "Ritter Tim",
    });
    assert.equal(fremd.status, 400, "Laufendes Spiel: kein Beitritt über den Namen");

    const eigen = await call("POST", `/game-rooms/${createdCode}/join`, {
      playerName: "Ritter Tim",
      playerToken: joinedToken,
    });
    assert.equal(eigen.status, 200);
    assert.equal(eigen.json.playerId, joinedPlayerId, "Derselbe Platz, nicht ein neuer");
  });

  await t.test("entfernt Spieler beim Verlassen", async () => {
    const leaveRes = await call("POST", `/game-rooms/${createdCode}/leave`, {
      playerToken: joinedToken,
    });
    assert.equal(leaveRes.status, 200);

    const roomSync = await call("GET", `/game-rooms/${createdCode}?playerToken=${hostToken}`);
    // Host und Hofdame Ada bleiben übrig.
    assert.equal(roomSync.json.room.players.length, 2);
  });

  await t.test("ein fremder Token entfernt niemanden", async () => {
    const res = await call("POST", "/game-rooms", { hostName: "Anderer Raum" });
    const fremderToken = res.json.playerToken;

    await call("POST", `/game-rooms/${createdCode}/leave`, { playerToken: fremderToken });

    const sync = await call("GET", `/game-rooms/${createdCode}?playerToken=${hostToken}`);
    assert.equal(sync.json.room.players.length, 2, "Der Host ist noch da");
  });
});

test("Spielraeume: Bremse gegen das Durchprobieren von Codes", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());
  const { call } = server;

  await t.test("blockt das Raten falscher Raum-Codes", async () => {
    let letzterStatus = 0;
    let versuche = 0;

    // Ein Angreifer probiert Codes durch. Alle sind falsch, der Zaehler
    // laeuft deshalb voll und wird nie zurueckgesetzt.
    for (let i = 0; i < 40; i++) {
      const code = `Z${String(i).padStart(3, "0")}`.slice(0, 4).toUpperCase();
      const res = await call("POST", `/game-rooms/${code}/join`, { playerName: "Angreifer" });
      letzterStatus = res.status;
      versuche++;
      if (res.status === 429) break;
    }

    assert.equal(letzterStatus, 429, "Nach genug Fehlgriffen muss 429 kommen");
    assert.ok(versuche <= 35, `Sollte frueh greifen, brauchte aber ${versuche} Versuche`);
  });
});

test("Spielraeume: die Bremse trifft eine echte Party nicht", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());
  const { call } = server;

  const erstellt = await call("POST", "/game-rooms", { hostName: "Gastgeber" });
  const code = erstellt.json.code;
  const hostToken = erstellt.json.playerToken;

  await t.test("viele Beitritte mit dem RICHTIGEN Code bleiben erlaubt", async () => {
    // 15 Gaeste treten demselben Raum bei — alle vom selben Anschluss.
    // Jeder Erfolg gibt das Budget zurueck, deshalb greift nichts.
    for (let i = 0; i < 15; i++) {
      const res = await call("POST", `/game-rooms/${code}/join`, { playerName: `Gast ${i}` });
      assert.equal(res.status, 200, `Gast ${i} wurde abgewiesen (${res.status})`);
    }
  });

  await t.test("dauerndes Abfragen des Raumzustands bleibt erlaubt", async () => {
    // Die Clients fragen alle 2,5 s nach. 60 Abrufe entsprechen gut zwei
    // Minuten einer einzigen Sitzung — das darf nie ins Limit laufen.
    for (let i = 0; i < 60; i++) {
      const res = await call("GET", `/game-rooms/${code}?playerToken=${hostToken}`);
      assert.equal(res.status, 200, `Abruf ${i} wurde abgewiesen (${res.status})`);
    }
  });

  await t.test("Abfragen auf einen unbekannten Raum werden dagegen gebremst", async () => {
    let letzterStatus = 0;
    for (let i = 0; i < 60; i++) {
      const res = await call("GET", `/game-rooms/QQ${String(i).padStart(2, "0")}`);
      letzterStatus = res.status;
      if (res.status === 429) break;
    }
    assert.equal(letzterStatus, 429, "Blindes Abfragen muss auf 429 laufen");
  });
});
