const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { startTestServer } = require("./helpers/server");

/**
 * Diese Datei prueft die drei Eigenschaften, die der Spielesektion bis
 * August 2026 gefehlt haben:
 *
 *   B1  Entscheidungen haben Folgen — und zwar serverseitig berechnete.
 *   B2  Eine laufende Runde ueberlebt einen Serverneustart.
 *   B3  Spiel-XP ueberleben die Neuberechnung aus den Getraenke-Logs.
 *
 * Alle drei waren vorher gebrochen: die Punkte einer Auswahl kamen nirgends
 * an, ein Neustart loeschte jeden Raum, und `points` wurde bei jedem Abruf
 * komplett aus den Trink-Eintraegen neu gesetzt.
 */

/** Spielt einen Raum bis zum Beginn und liefert die Handles aller Spieler. */
async function raumMitDreiSpielern(call, gameId, hostAuthToken) {
  const created = await call(
    "POST",
    "/game-rooms",
    { gameId, hostName: "Gastgeberin" },
    hostAuthToken
  );
  const code = created.json.code;

  const zwei = await call("POST", `/game-rooms/${code}/join`, { playerName: "Bea" });
  const drei = await call("POST", `/game-rooms/${code}/join`, { playerName: "Cem" });

  return {
    code,
    spieler: [
      { id: created.json.hostId, token: created.json.playerToken, name: "Gastgeberin" },
      { id: zwei.json.playerId, token: zwei.json.playerToken, name: "Bea" },
      { id: drei.json.playerId, token: drei.json.playerToken, name: "Cem" },
    ],
  };
}

/**
 * Ein Kapitel weiter. Seit die Phasen auf Fristen laufen, ist ein /next-Aufruf
 * EIN Phasenwechsel — von der Auswahl in die Auflösung, und von dort ins
 * nächste Kapitel. Der Host benutzt das als Notbremse, die Tests als Abkürzung.
 */
async function naechstesKapitel(call, code, hostToken) {
  await call("POST", `/game-rooms/${code}/next`, { playerToken: hostToken });
  await call("POST", `/game-rooms/${code}/next`, { playerToken: hostToken });
}

/**
 * Schaltet so lange Phasen weiter, bis die gesuchte Phase erreicht ist.
 *
 * Beim Storylet-Format steht die Szenenzahl nicht fest — der Server zieht sie
 * aus einem Pool. Ein Test kann deshalb nicht einfach "viermal weiter" sagen.
 */
async function skipBisPhase(call, code, hostToken, kind, maxSchritte = 60) {
  for (let i = 0; i < maxSchritte; i++) {
    const sicht = await call("GET", `/game-rooms/${code}?playerToken=${hostToken}`);
    const room = sicht.json.room;
    if (room.status === "finale") return room;
    if (room.gameState.phase && room.gameState.phase.kind === kind) return room;
    await call("POST", `/game-rooms/${code}/next`, { playerToken: hostToken });
  }
  throw new Error(`Phase "${kind}" nach ${maxSchritte} Schritten nicht erreicht`);
}

/** Wer ist der Verraeter? Nur aus der jeweils EIGENEN Sicht ablesbar. */
async function findeVerraeter(call, code, spieler) {
  for (const s of spieler) {
    const sicht = await call("GET", `/game-rooms/${code}?playerToken=${s.token}`);
    const ich = sicht.json.room.players.find((p) => p.id === sicht.json.room.myPlayerId);
    if (ich.allegiance === "traitor") return s;
  }
  return null;
}

test("Story-Engine: Entscheidungen haben Folgen (B1)", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());
  const { call } = server;

  const { code, spieler } = await raumMitDreiSpielern(call, "haunted_manor");
  const [host, bea] = spieler;

  await call("POST", `/game-rooms/${code}/start`, { playerToken: host.token });

  await t.test("startet mit den Story-Variablen der Definition", async () => {
    const sicht = await call("GET", `/game-rooms/${code}?playerToken=${host.token}`);
    assert.equal(sicht.json.room.status, "story_chapter");
    assert.equal(sicht.json.room.gameState.healthPoints, 100);
    assert.equal(sicht.json.room.gameState.currentChapter.act, 1);
  });

  await t.test("der Kapiteltext ist gerendert und fuer alle identisch", async () => {
    const a = await call("GET", `/game-rooms/${code}?playerToken=${host.token}`);
    const b = await call("GET", `/game-rooms/${code}?playerToken=${bea.token}`);
    const text = a.json.room.gameState.currentChapter.text;

    assert.equal(text, b.json.room.gameState.currentChapter.text, "Alle sehen denselben Text");
    assert.ok(!text.includes("{{"), "Keine Platzhalter mehr im Text");
    assert.ok(text.includes("Gastgeberin"), "Die Spielernamen stehen wirklich drin");
  });

  await t.test("der Client bekommt die Effekte einer Auswahl nicht zu sehen", async () => {
    const sicht = await call("GET", `/game-rooms/${code}?playerToken=${host.token}`);
    const auswahl = sicht.json.room.gameState.currentChapter.prompt.choices;
    for (const c of auswahl) {
      assert.equal(c.effects, undefined, "Effekte bleiben auf dem Server");
      assert.equal(c.sips, undefined);
    }
  });

  await t.test("eine Auswahl bewegt Team-HP und Punkte", async () => {
    const res = await call("POST", `/game-rooms/${code}/action`, {
      playerToken: host.token,
      actionType: "choice",
      payload: { choiceId: "panic_run" },
    });

    assert.equal(res.status, 200);
    // panic_run: -15 Team-HP, +5 Punkte. Genau das kam frueher nie an.
    assert.equal(res.json.room.gameState.healthPoints, 85, "Die HP-Leiste bewegt sich");
    const ich = res.json.room.players.find((p) => p.id === host.id);
    assert.equal(ich.points, 5);
    assert.equal(res.json.room.gameState.myChoice.choiceId, "panic_run");
  });

  await t.test("die eigene Entscheidung bleibt vor den anderen geheim", async () => {
    const fremd = await call("GET", `/game-rooms/${code}?playerToken=${bea.token}`);
    assert.equal(fremd.json.room.gameState.myChoice, null, "Bea sieht ihre eigene, nicht fremde");
    assert.equal(fremd.json.room.gameState.choiceCount, 1, "Dass jemand gewaehlt hat, ist oeffentlich");
    const host_ = fremd.json.room.players.find((p) => p.id === host.id);
    assert.equal(host_.hasChosen, true);
  });

  await t.test("zweimal waehlen geht nicht", async () => {
    const res = await call("POST", `/game-rooms/${code}/action`, {
      playerToken: host.token,
      actionType: "choice",
      payload: { choiceId: "panic_run" },
    });
    assert.equal(res.status, 409, "Sonst liesse sich der Punktestand hochspammen");

    const sicht = await call("GET", `/game-rooms/${code}?playerToken=${host.token}`);
    assert.equal(sicht.json.room.gameState.healthPoints, 85, "Und die HP bleiben, wo sie waren");
  });

  await t.test("eine erfundene Auswahl wird abgewiesen", async () => {
    const res = await call("POST", `/game-rooms/${code}/action`, {
      playerToken: bea.token,
      actionType: "choice",
      payload: { choiceId: "ich_gewinne_einfach" },
    });
    assert.equal(res.status, 400);
  });

  await t.test("der Host ueberspringt Phasen, diktiert aber keinen Text", async () => {
    const aufloesung = await call("POST", `/game-rooms/${code}/next`, {
      playerToken: host.token,
      nextChapterData: { title: "Akt der Willkuer", text: "Der Host gewinnt." },
    });
    assert.equal(aufloesung.status, 200);
    assert.equal(
      aufloesung.json.room.gameState.phase.kind,
      "reveal",
      "Erst die Auflösung, dann das nächste Kapitel"
    );

    const res = await call("POST", `/game-rooms/${code}/next`, { playerToken: host.token });
    const kapitel = res.json.room.gameState.currentChapter;
    assert.notEqual(kapitel.title, "Akt der Willkuer");
    assert.equal(kapitel.act, 2, "Der Server nimmt das naechste Kapitel der Definition");
  });

  await t.test("Entscheidungen gelten nur fuer ihr Kapitel", async () => {
    const sicht = await call("GET", `/game-rooms/${code}?playerToken=${host.token}`);
    assert.equal(sicht.json.room.gameState.choiceCount, 0, "Im neuen Kapitel darf jeder wieder");

    const res = await call("POST", `/game-rooms/${code}/action`, {
      playerToken: host.token,
      actionType: "choice",
      payload: { choiceId: "sabotage_team" },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.room.gameState.healthPoints, 65, "85 - 20");
  });
});

test("Story-Engine: das Finale rechnet der Server (B1)", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());
  const { call } = server;

  const { code, spieler } = await raumMitDreiSpielern(call, "murder_express");
  const host = spieler[0];

  await call("POST", `/game-rooms/${code}/start`, { playerToken: host.token });
  const verraeter = await findeVerraeter(call, code, spieler);

  await t.test("genau ein Moerder sitzt im Zug", () => {
    assert.ok(verraeter, "Ohne Verraeter waere das Spiel sinnlos");
  });

  await t.test("ueberfuehrt der Rat den Moerder, gewinnen die Passagiere", async () => {
    const abstimmung = { json: { room: await skipBisPhase(call, code, host.token, "vote") } };
    assert.ok(abstimmung.json.room.gameState.currentChapter.voting, "Akt III stimmt ab");
    assert.equal(abstimmung.json.room.gameState.phase.kind, "vote");

    let ende = null;
    for (const s of spieler) {
      ende = await call("POST", `/game-rooms/${code}/action`, {
        playerToken: s.token,
        actionType: "vote",
        payload: { targetPlayerId: verraeter.id },
      });
    }

    // Kein Host-Klick mehr: mit der letzten Stimme loest der Server auf.
    assert.equal(ende.json.room.status, "finale");

    const finale = ende.json.room.gameState.finale;
    assert.equal(finale.outcomeKey, "caught");
    assert.equal(finale.winnerTeam, "Die Passagiere & der Detektiv 🕵️‍♂️");
    assert.ok(finale.summary.includes(verraeter.name), "Die Auflösung nennt den Täter");
    assert.ok(!finale.summary.includes("{{"), "Keine Platzhalter in der Auflösung");
    assert.deepEqual(
      finale.drinkPenalties.map((p) => p.playerName),
      [verraeter.name]
    );
  });

  await t.test("im Finale sind alle Rollen offen", async () => {
    const sicht = await call("GET", `/game-rooms/${code}?playerToken=${host.token}`);
    for (const p of sicht.json.room.players) {
      assert.ok(p.role, `${p.name} muss jetzt sichtbar sein`);
    }
  });
});

test("Simultane Auflösung: niemand wartet auf den Host (P1)", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());
  const { call } = server;

  const { code, spieler } = await raumMitDreiSpielern(call, "haunted_manor");
  const [host, bea, cem] = spieler;
  await call("POST", `/game-rooms/${code}/start`, { playerToken: host.token });

  await t.test("jede Phase hat eine absolute Frist und eine Serveruhr dazu", async () => {
    const sicht = await call("GET", `/game-rooms/${code}?playerToken=${host.token}`);
    const { phase, } = sicht.json.room.gameState;

    assert.equal(phase.kind, "choice");
    assert.ok(phase.deadlineAt > sicht.json.room.serverTime, "Die Frist liegt in der Zukunft");
    assert.ok(phase.seconds > 0);
    // Ohne serverTime müsste jedes Gerät gegen seine eigene Uhr rechnen — bei
    // acht Handys laufen die Countdowns dann sichtbar auseinander.
    assert.ok(sicht.json.room.serverTime > 0, "Der Client kann seinen Versatz bestimmen");
  });

  await t.test("fremde Entscheidungen bleiben bis zur Auflösung verdeckt", async () => {
    await call("POST", `/game-rooms/${code}/action`, {
      playerToken: host.token,
      actionType: "choice",
      payload: { choiceId: "read_spell" },
    });

    const sicht = await call("GET", `/game-rooms/${code}?playerToken=${bea.token}`);
    assert.equal(sicht.json.room.gameState.reveals, null, "Noch nichts aufgedeckt");
    assert.equal(sicht.json.room.gameState.choiceCount, 1);
  });

  await t.test("mit der letzten Eingabe loest der Server sofort auf", async () => {
    await call("POST", `/game-rooms/${code}/action`, {
      playerToken: bea.token,
      actionType: "choice",
      payload: { choiceId: "drink_shield" },
    });

    // Cem ist der Letzte — danach darf niemand mehr auf einen Knopf warten.
    const letzte = await call("POST", `/game-rooms/${code}/action`, {
      playerToken: cem.token,
      actionType: "choice",
      payload: { choiceId: "panic_run" },
    });

    assert.equal(letzte.json.room.gameState.phase.kind, "reveal");
  });

  await t.test("die Auflösung zeigt allen, wer was gewaehlt hat", async () => {
    const sicht = await call("GET", `/game-rooms/${code}?playerToken=${bea.token}`);
    const reveals = sicht.json.room.gameState.reveals;

    assert.equal(reveals.length, 3);
    const nachName = Object.fromEntries(reveals.map((r) => [r.playerName, r]));
    assert.equal(nachName["Gastgeberin"].choiceId, "read_spell");
    assert.equal(nachName["Bea"].choiceId, "drink_shield");
    assert.equal(nachName["Cem"].choiceId, "panic_run");
    assert.ok(nachName["Cem"].label, "Mit Beschriftung, sonst steht da nur eine id");
    assert.ok(nachName["Cem"].outcomeText);
  });

  await t.test("nach der Frist laesst sich nicht mehr nachwaehlen", async () => {
    const res = await call("POST", `/game-rooms/${code}/action`, {
      playerToken: host.token,
      actionType: "choice",
      payload: { choiceId: "drink_shield" },
    });
    assert.equal(res.status, 409, "Sonst sammelt man nach der Auflösung noch Punkte ein");
  });
});

test("Eine abgelaufene Frist loest von selbst auf (P1)", async (t) => {
  // Alle Phasen auf eine Sekunde. Sonst müsste dieser Test eine Minute warten.
  const server = await startTestServer({ env: { TRINKDUELL_PHASE_SEC: "1" } });
  t.after(() => server.stop());
  const { call } = server;

  const { code, spieler } = await raumMitDreiSpielern(call, "haunted_manor");
  const host = spieler[0];
  await call("POST", `/game-rooms/${code}/start`, { playerToken: host.token });

  await t.test("ohne jede Eingabe geht es weiter", async () => {
    const vorher = await call("GET", `/game-rooms/${code}?playerToken=${host.token}`);
    assert.equal(vorher.json.room.gameState.phase.kind, "choice");

    // Niemand tut etwas — nur die Zeit vergeht. Der Puffer über der
    // Ein-Sekunden-Frist ist bewusst grosszuegig: unter Last (paralleler
    // Typpruefer, laufender Dev-Server) rutscht ein knapper Wert sonst
    // gelegentlich durch und der Test wirkt kaputt, obwohl er es nicht ist.
    await new Promise((resolve) => setTimeout(resolve, 1800));

    const nachher = await call("GET", `/game-rooms/${code}?playerToken=${host.token}`);
    assert.equal(
      nachher.json.room.gameState.phase.kind,
      "reveal",
      "Die Runde haengt nicht an einem Spieler, der weggegangen ist"
    );
  });

  await t.test("mehrere verpasste Fristen holt der Server auf einmal nach", async () => {
    // Zwei volle Phasen lang pollt niemand — etwa weil alle Displays aus sind.
    await new Promise((resolve) => setTimeout(resolve, 3200));

    const sicht = await call("GET", `/game-rooms/${code}?playerToken=${host.token}`);
    assert.ok(
      sicht.json.room.currentChapterIndex >= 1,
      "Der Server arbeitet alle faelligen Fristen ab, nicht nur die erste"
    );
  });
});

test("Spielräume überleben einen Serverneustart (B2)", async (t) => {
  // Eigene Datenbankdatei, damit zwei Serverläufe sie sich teilen. Die
  // Wegwerf-Datei des Helfers ist pro Lauf eine andere — genau das, was hier
  // nicht sein darf.
  const dbFile = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "trinkduell-neustart-")),
    "db.json"
  );
  t.after(() => fs.rmSync(path.dirname(dbFile), { recursive: true, force: true }));

  const ersterLauf = await startTestServer({ env: { TRINKDUELL_DB_FILE: dbFile } });
  const { code, spieler } = await raumMitDreiSpielern(ersterLauf.call, "haunted_manor");
  const host = spieler[0];

  await ersterLauf.call("POST", `/game-rooms/${code}/start`, { playerToken: host.token });
  await ersterLauf.call("POST", `/game-rooms/${code}/action`, {
    playerToken: host.token,
    actionType: "choice",
    payload: { choiceId: "panic_run" },
  });

  // Der Raum wird nebenläufig gesichert; kurz warten, sonst prüfen wir das
  // Rennen statt die Persistenz.
  await new Promise((resolve) => setTimeout(resolve, 250));
  await ersterLauf.stop();

  const zweiterLauf = await startTestServer({ env: { TRINKDUELL_DB_FILE: dbFile } });
  t.after(() => zweiterLauf.stop());

  await t.test("der Raum ist nach dem Neustart noch da", async () => {
    const sicht = await zweiterLauf.call("GET", `/game-rooms/${code}?playerToken=${host.token}`);
    assert.equal(sicht.status, 200, "Vorher war die Runde an dieser Stelle einfach weg");
    assert.equal(sicht.json.room.status, "story_chapter");
    assert.equal(sicht.json.room.players.length, 3);
  });

  await t.test("Spielstand und Geheimrolle haben ueberlebt", async () => {
    const sicht = await zweiterLauf.call("GET", `/game-rooms/${code}?playerToken=${host.token}`);
    assert.equal(sicht.json.room.gameState.healthPoints, 85, "Die HP von vor dem Neustart");
    const ich = sicht.json.room.players.find((p) => p.id === host.id);
    assert.equal(ich.points, 5);
    assert.ok(ich.role, "Die eigene Rolle ist weiterhin lesbar");
  });

  await t.test("das Spiel laeuft normal weiter", async () => {
    await naechstesKapitel(zweiterLauf.call, code, host.token);
    const res = await zweiterLauf.call("GET", `/game-rooms/${code}?playerToken=${host.token}`);
    assert.equal(res.status, 200);
    assert.equal(res.json.room.gameState.currentChapter.act, 2);
  });
});

test("Spiel-XP überleben die Neuberechnung (B3)", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());
  const { call, register } = server;

  const konto = await register("spieler");
  const { code, spieler } = await raumMitDreiSpielern(call, "murder_express", konto.token);
  const host = spieler[0];

  await call("POST", `/game-rooms/${code}/start`, { playerToken: host.token });
  await call("POST", `/game-rooms/${code}/action`, {
    playerToken: host.token,
    actionType: "choice",
    payload: { choiceId: "inspect_scene" }, // +15
  });
  await skipBisPhase(call, code, host.token, "vote");
  // Mit der letzten Stimme steht das Finale.
  for (const s of spieler) {
    await call("POST", `/game-rooms/${code}/action`, {
      playerToken: s.token,
      actionType: "vote",
      payload: { targetPlayerId: spieler[1].id },
    });
  }

  await t.test("vor dem Abrechnen steht der Punktestand auf null", async () => {
    const me = await call("GET", "/users/me", undefined, konto.token);
    assert.equal(me.json.points, 0);
  });

  await t.test("schreibt die Punkte der Runde gut", async () => {
    const res = await call(
      "POST",
      `/game-rooms/${code}/claim`,
      { playerToken: host.token },
      konto.token
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.awarded, true);
    assert.equal(res.json.points, 15);
  });

  await t.test("ein zweiter Aufruf schreibt NICHT nochmal gut", async () => {
    const res = await call(
      "POST",
      `/game-rooms/${code}/claim`,
      { playerToken: host.token },
      konto.token
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.awarded, false, "Reconnect und Doppel-Tap duerfen nicht doppelt zahlen");
    assert.equal(res.json.points, 0);
  });

  await t.test("die Punkte ueberstehen die Neuberechnung aus den Trink-Logs", async () => {
    // /users/me laeuft ueber getUsers(), und dort setzt recalculateUserStats
    // `points` komplett neu. Genau hier waeren die Spiel-XP frueher
    // verschwunden.
    const me = await call("GET", "/users/me", undefined, konto.token);
    assert.equal(me.json.points, 15);

    const nochmal = await call("GET", "/users/me", undefined, konto.token);
    assert.equal(nochmal.json.points, 15, "Auch beim zweiten Abruf, und beim dritten");
  });

  await t.test("ohne Raum-Nachweis gibt es nichts", async () => {
    const res = await call(
      "POST",
      `/game-rooms/${code}/claim`,
      { playerToken: "nicht-mein-token" },
      konto.token
    );
    assert.equal(res.status, 403);
  });
});
