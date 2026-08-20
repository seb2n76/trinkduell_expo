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

  await t.test("synchronisiert den Raum-Status und maskiert geheime Rollen", async () => {
    const startRes = await call("POST", `/game-rooms/${createdCode}/start`, {
      playerToken: hostToken,
      gameSetupData: {
        playerRoles: [
          { playerId: hostPlayerId, role: "Inquisitor", secretPrompt: "Finde den Mörder." },
          { playerId: joinedPlayerId, role: "Mörder", secretPrompt: "Vergifte unauffällig." },
        ],
      },
    });

    assert.equal(startRes.status, 200);
    assert.equal(startRes.json.room.status, "role_reveal");

    const hostSync = await call("GET", `/game-rooms/${createdCode}?playerToken=${hostToken}`);
    assert.equal(hostSync.status, 200);
    const hostPlayers = hostSync.json.room.players;
    assert.equal(hostPlayers.find((p) => p.id === hostPlayerId).role, "Inquisitor");
    assert.equal(
      hostPlayers.find((p) => p.id === joinedPlayerId).role,
      null,
      "Fremde Rolle muss für Host maskiert sein"
    );

    const playerSync = await call("GET", `/game-rooms/${createdCode}?playerToken=${joinedToken}`);
    assert.equal(playerSync.status, 200);
    const clientPlayers = playerSync.json.room.players;
    assert.equal(clientPlayers.find((p) => p.id === joinedPlayerId).role, "Mörder");
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
    assert.equal(roomSync.json.room.players.length, 1);
  });

  await t.test("ein fremder Token entfernt niemanden", async () => {
    const res = await call("POST", "/game-rooms", { hostName: "Anderer Raum" });
    const fremderToken = res.json.playerToken;

    await call("POST", `/game-rooms/${createdCode}/leave`, { playerToken: fremderToken });

    const sync = await call("GET", `/game-rooms/${createdCode}?playerToken=${hostToken}`);
    assert.equal(sync.json.room.players.length, 1, "Der Host ist noch da");
  });
});
