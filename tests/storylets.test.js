const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../server/games/storyEngine");

/**
 * Regeln der Storylet-Engine, direkt am Modul geprüft.
 *
 * Über HTTP wären diese Fälle nicht zuverlässig herstellbar: welche Szene
 * gezogen wird, entscheidet gewichteter Zufall, und eine Rollenszene oder ein
 * Ausscheiden würde mal auftauchen und mal nicht. Der Ablauf als Ganzes wird
 * dafür in gameengine.test.js über echte Requests gespielt.
 */

const story = engine.getStory("murder_express");

function spieler(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: `Spieler${i}`,
    points: 0,
    sipsTaken: 0,
  }));
}

const storyletIds = ["murder_express", "court_treason", "haunted_manor"];

test("Storylet-Format wird erkannt und ist vollständig (alle Storylet-Spiele)", () => {
  for (const storyId of storyletIds) {
    const s = engine.getStory(storyId);
    assert.ok(s, `Story ${storyId} existiert`);
    assert.ok(engine.isStoryletFormat(s), `${storyId} läuft im Storylet-Format`);

    for (const akt of s.structure.acts) {
      const pool = s.storylets.filter((scene) => scene.act === akt.act);
      assert.ok(
        pool.length >= akt.count,
        `${storyId}: Akt ${akt.act} braucht mindestens ${akt.count} Szenen, hat aber ${pool.length}`
      );
      assert.ok(
        pool.some((scene) => scene.opening),
        `${storyId}: Akt ${akt.act} braucht eine Eröffnungsszene`
      );
      assert.ok(
        pool.some((scene) => scene.closing),
        `${storyId}: Akt ${akt.act} braucht eine Abschlussszene`
      );
    }

    // Jede Auswahl braucht einen Ergebnistext — sonst steht der Spieler nach
    // seiner Entscheidung vor einer leeren Karte.
    for (const scene of s.storylets) {
      for (const c of (scene.prompt && scene.prompt.choices) || []) {
        assert.ok(c.outcomeText, `${storyId}/${scene.id}/${c.id} hat keinen outcomeText`);
        assert.ok(c.label, `${storyId}/${scene.id}/${c.id} hat keine Beschriftung`);
      }
    }
  }
});

test("Bedingungen sperren Szenen, bis der Spielstand passt", () => {
  const ctxLeer = {
    act: 2,
    variables: { hinweise: 0, verdacht: 0, panik: 0 },
    used: [],
    playedInAct: 1,
    playerCount: 4,
    aliveRoles: [],
  };

  // a2_brief verlangt hinweise >= 4.
  const ohne = [];
  for (let i = 0; i < 80; i++) ohne.push(engine.pickStorylet(story, ctxLeer).id);
  assert.ok(!ohne.includes("a2_brief"), "Der Brief taucht ohne Hinweise nicht auf");

  const ctxVoll = { ...ctxLeer, variables: { hinweise: 6, verdacht: 0, panik: 0 } };
  const mit = new Set();
  for (let i = 0; i < 200; i++) mit.add(engine.pickStorylet(story, ctxVoll).id);
  assert.ok(mit.has("a2_brief"), "Mit genug Hinweisen ist er erreichbar");
});

test("Rollenszenen erscheinen nur, wenn die Rolle noch lebt", () => {
  const basis = {
    act: 1,
    variables: { hinweise: 0, verdacht: 0, panik: 0 },
    used: [],
    playedInAct: 1,
    playerCount: 6,
    aliveRoles: ["Die Erbin 💎", "Der Schmuggler 💼"],
  };

  const ohneArzt = new Set();
  for (let i = 0; i < 150; i++) ohneArzt.add(engine.pickStorylet(story, basis).id);
  assert.ok(!ohneArzt.has("a1_arzt"), "Ohne lebenden Leibarzt keine Leibarzt-Szene");

  const mitArzt = new Set();
  const ctx = { ...basis, aliveRoles: [...basis.aliveRoles, "Der Leibarzt 🩺"] };
  for (let i = 0; i < 150; i++) mitArzt.add(engine.pickStorylet(story, ctx).id);
  assert.ok(mitArzt.has("a1_arzt"), "Mit lebendem Leibarzt schon");
});

test("Eröffnung kommt zuerst, Abschluss zuletzt", () => {
  const ctx = {
    act: 1,
    variables: { hinweise: 0, verdacht: 0, panik: 0 },
    used: [],
    playedInAct: 0,
    playerCount: 4,
    aliveRoles: [],
  };
  for (let i = 0; i < 20; i++) {
    assert.equal(engine.pickStorylet(story, ctx).id, "a1_leiche", "Akt I beginnt immer am Tatort");
  }

  const cfg = engine.actConfig(story, 1);
  const spaet = { ...ctx, playedInAct: cfg.count - 1, used: ["a1_leiche"] };
  for (let i = 0; i < 20; i++) {
    assert.ok(
      engine.pickStorylet(story, spaet).closing,
      "Die letzte Szene eines Akts ist eine Abschlussszene"
    );
  }
});

test("Zwei Durchläufe verlaufen unterschiedlich", () => {
  function durchlauf() {
    const gs = { act: 1, playedInAct: 0, used: [], variables: { hinweise: 3, verdacht: 3, panik: 3 } };
    const folge = [];
    for (const akt of story.structure.acts) {
      gs.act = akt.act;
      gs.playedInAct = 0;
      for (let i = 0; i < akt.count; i++) {
        const s = engine.pickStorylet(story, {
          act: gs.act,
          variables: gs.variables,
          used: gs.used,
          playedInAct: gs.playedInAct,
          playerCount: 6,
          aliveRoles: ["Der Leibarzt 🩺", "Meisterdetektiv 🕵️‍♂️", "Der Schaffner 🎫"],
        });
        if (!s) break;
        folge.push(s.id);
        gs.used.push(s.id);
        gs.playedInAct += 1;
      }
    }
    return folge.join(">");
  }

  const laeufe = new Set();
  for (let i = 0; i < 12; i++) laeufe.add(durchlauf());
  assert.ok(
    laeufe.size > 1,
    "Derselbe Krimi darf sich beim zweiten Mal nicht identisch anfühlen"
  );
});

test("Eine Rollenszene weist fremde Rollen ab", () => {
  const arzt = story.storylets.find((s) => s.id === "a1_arzt");
  const players = spieler(3);
  players[0].role = "Der Leibarzt 🩺";
  players[1].role = "Die Erbin 💎";
  const state = { players, variables: {}, memory: [] };

  assert.throws(
    () => engine.applyChoice(story, arzt, state, "p1", "truth"),
    /NOT_YOUR_SCENE/,
    "Wer nicht die Rolle hat, handelt hier nicht"
  );

  const ergebnis = engine.applyChoice(story, arzt, state, "p0", "truth");
  assert.ok(ergebnis.outcomeText.length > 0);
  assert.equal(players[0].points, 25);
  assert.equal(state.variables.hinweise, 3);
});

test("Das Sitzungsgedächtnis merkt sich, wer was getan hat", () => {
  const szene = story.storylets.find((s) => s.id === "a1_leiche");
  const players = spieler(3);
  const state = { players, variables: {}, memory: [] };

  engine.applyChoice(story, szene, state, "p1", "fake_alibi");

  assert.equal(state.memory.length, 1);
  assert.equal(state.memory[0].kind, "beteuert");
  assert.equal(state.memory[0].playerName, "Spieler1");

  // Und eine spätere Szene kann darauf zurückgreifen.
  const text = engine._renderTemplate("Und was ist mit {{memory:beteuert|niemandem}}?", {
    players,
    memory: state.memory,
  });
  assert.equal(text, "Und was ist mit Spieler1?");
});

test("Ausscheiden macht zum Geist, nicht zum Zuschauer", () => {
  const szene = story.storylets.find((s) => s.id === "a2_zweiter_toter");
  const players = spieler(5);
  const state = { players, variables: {}, memory: [] };

  engine.applyChoice(story, szene, state, "p0", "point_at", "p3");
  assert.equal(players[3].eliminated, true, "Das Ziel scheidet aus");
  assert.equal(players[0].eliminated, undefined, "Wer zeigt, bleibt");

  engine.applyChoice(story, szene, state, "p1", "sacrifice_self");
  assert.equal(players[1].eliminated, true, "Wer sich anbietet, scheidet aus");
});

test("Geisterstimmen zählen halb", () => {
  const players = spieler(6);
  players[0].eliminated = true;
  players[1].eliminated = true;
  players[2].eliminated = true;

  // Drei Geister für p5 (3 x 0,5 = 1,5) gegen zwei Lebende für p3 (2,0).
  // Nach Köpfen läge p5 vorn, nach Gewicht gewinnt p3.
  const votes = { p0: "p5", p1: "p5", p2: "p5", p3: "p3", p4: "p3" };
  const ergebnis = engine.evaluateFinale(
    { ...story, finale: { ...story.finale, traitorRole: "Der Mörder 🪓" } },
    players,
    votes,
    {}
  );
  // Kein Verräter unter den Spielern -> "escaped"; entscheidend ist hier, wen
  // die Auswertung als verurteilt ansieht.
  assert.ok(
    ergebnis.summary.includes("Spieler3"),
    "Die Stimme der Lebenden wiegt schwerer als zwei Geisterstimmen"
  );
});

test("Jeder bekommt eine eigene Beobachtung, genau einer hat wirklich etwas gesehen", () => {
  const players = spieler(6);
  const assignments = engine.assignRoles(story, players);

  assert.equal(assignments.length, 6);
  for (const a of assignments) {
    assert.ok(a.observation, `${a.role} hat keine Beobachtung bekommen`);
    assert.ok(!a.observation.includes("{{"), "Keine Platzhalter in der Beobachtung");
  }

  const traitor = assignments.find((a) => a.role === "Der Mörder 🪓");
  const zeugen = assignments.filter(
    (a) => a.observation.includes("kam kurz vor dem Schrei aus dem Salonwagen")
  );
  assert.equal(zeugen.length, 1, "Genau eine Person hat den Täter gesehen");
  assert.notEqual(zeugen[0].playerId, traitor.playerId, "Der Täter ist nicht sein eigener Zeuge");

  const traitorName = players.find((p) => p.id === traitor.playerId).name;
  assert.ok(
    zeugen[0].observation.includes(traitorName),
    "Die Beobachtung nennt den echten Täter — sonst wäre sie wertlos"
  );
});

const { startTestServer } = require("./helpers/server");

async function raumMitFuenfSpielern(call, gameId) {
  const created = await call("POST", "/game-rooms", { gameId, hostName: "Königin" });
  const code = created.json.code;
  const namen = ["Baron", "Graf", "Herzog", "Fürst"];
  const spieler = [{ id: created.json.hostId, token: created.json.playerToken, name: "Königin" }];
  for (const n of namen) {
    const joined = await call("POST", `/game-rooms/${code}/join`, { playerName: n });
    spieler.push({ id: joined.json.playerId, token: joined.json.playerToken, name: n });
  }
  return { code, spieler };
}

test("Der Verrat am Königshof: Vollständiger Durchlauf mit 5 Spielern", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());
  const { call } = server;

  const { code, spieler } = await raumMitFuenfSpielern(call, "court_treason");
  const host = spieler[0];

  await call("POST", `/game-rooms/${code}/start`, { playerToken: host.token });

  const geseheneAkte = new Set();

  for (let schritt = 0; schritt < 50; schritt++) {
    const sicht = await call("GET", `/game-rooms/${code}?playerToken=${host.token}`);
    const room = sicht.json.room;
    if (room.status === "finale") break;

    if (room.gameState.currentChapter && room.gameState.currentChapter.act) {
      geseheneAkte.add(room.gameState.currentChapter.act);
    }

    if (room.gameState.phase && room.gameState.phase.kind === "choice") {
      const prompt = room.gameState.currentChapter.prompt;
      if (prompt && prompt.choices && prompt.choices.length > 0) {
        const choice = prompt.choices[0];
        for (const s of spieler) {
          await call("POST", `/game-rooms/${code}/action`, {
            playerToken: s.token,
            actionType: "choice",
            payload: {
              choiceId: choice.id,
              targetPlayerId: choice.targetRequired ? spieler[1].id : undefined,
            },
          });
        }
      }
    } else if (room.gameState.phase && room.gameState.phase.kind === "vote") {
      for (const s of spieler) {
        await call("POST", `/game-rooms/${code}/action`, {
          playerToken: s.token,
          actionType: "vote",
          payload: { targetPlayerId: spieler[1].id },
        });
      }
    }

    await call("POST", `/game-rooms/${code}/next`, { playerToken: host.token });
  }

  const finaleSicht = await call("GET", `/game-rooms/${code}?playerToken=${host.token}`);
  assert.equal(finaleSicht.json.room.status, "finale", "Spiel erreicht das Finale");
  assert.ok(finaleSicht.json.room.gameState.finale, "Finale hat ein Ergebnis");
  assert.ok(finaleSicht.json.room.gameState.finale.winnerTeam, "Ein Gewinnerteam steht fest");
  assert.ok(finaleSicht.json.room.gameState.finale.summary, "Eine Zusammenfassung existiert");
  assert.ok(geseheneAkte.has(1), "Akt 1 wurde durchlaufen");
  assert.ok(geseheneAkte.has(2), "Akt 2 wurde durchlaufen");
  assert.ok(geseheneAkte.has(3), "Akt 3 wurde durchlaufen");
});

test("Escape the Haunted Manor: Vollständiger Durchlauf mit 5 Spielern", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());
  const { call } = server;

  const { code, spieler } = await raumMitFuenfSpielern(call, "haunted_manor");
  const host = spieler[0];

  await call("POST", `/game-rooms/${code}/start`, { playerToken: host.token });

  const geseheneAkte = new Set();

  for (let schritt = 0; schritt < 50; schritt++) {
    const sicht = await call("GET", `/game-rooms/${code}?playerToken=${host.token}`);
    const room = sicht.json.room;
    if (room.status === "finale") break;

    if (room.gameState.currentChapter && room.gameState.currentChapter.act) {
      geseheneAkte.add(room.gameState.currentChapter.act);
    }

    if (room.gameState.phase && room.gameState.phase.kind === "choice") {
      const prompt = room.gameState.currentChapter.prompt;
      if (prompt && prompt.choices && prompt.choices.length > 0) {
        const choice = prompt.choices[0];
        for (const s of spieler) {
          await call("POST", `/game-rooms/${code}/action`, {
            playerToken: s.token,
            actionType: "choice",
            payload: {
              choiceId: choice.id,
              targetPlayerId: choice.targetRequired ? spieler[1].id : undefined,
            },
          });
        }
      }
    } else if (room.gameState.phase && room.gameState.phase.kind === "vote") {
      for (const s of spieler) {
        await call("POST", `/game-rooms/${code}/action`, {
          playerToken: s.token,
          actionType: "vote",
          payload: { targetPlayerId: spieler[1].id },
        });
      }
    }

    await call("POST", `/game-rooms/${code}/next`, { playerToken: host.token });
  }

  const finaleSicht = await call("GET", `/game-rooms/${code}?playerToken=${host.token}`);
  assert.equal(finaleSicht.json.room.status, "finale", "Spiel erreicht das Finale");
  assert.ok(finaleSicht.json.room.gameState.finale, "Finale hat ein Ergebnis");
  assert.ok(finaleSicht.json.room.gameState.finale.winnerTeam, "Ein Gewinnerteam steht fest");
  assert.ok(finaleSicht.json.room.gameState.finale.summary, "Eine Zusammenfassung existiert");
  assert.ok(geseheneAkte.has(1), "Akt 1 wurde durchlaufen");
  assert.ok(geseheneAkte.has(2), "Akt 2 wurde durchlaufen");
  assert.ok(geseheneAkte.has(3), "Akt 3 wurde durchlaufen");
});

test("Mord im Mitternachts-Express: Vollständiger Durchlauf mit 5 Spielern", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());
  const { call } = server;

  const { code, spieler } = await raumMitFuenfSpielern(call, "murder_express");
  const host = spieler[0];

  await call("POST", `/game-rooms/${code}/start`, { playerToken: host.token });

  const geseheneAkte = new Set();

  for (let schritt = 0; schritt < 50; schritt++) {
    const sicht = await call("GET", `/game-rooms/${code}?playerToken=${host.token}`);
    const room = sicht.json.room;
    if (room.status === "finale") break;

    if (room.gameState.currentChapter && room.gameState.currentChapter.act) {
      geseheneAkte.add(room.gameState.currentChapter.act);
    }

    if (room.gameState.phase && room.gameState.phase.kind === "choice") {
      const prompt = room.gameState.currentChapter.prompt;
      if (prompt && prompt.choices && prompt.choices.length > 0) {
        const choice = prompt.choices[0];
        for (const s of spieler) {
          await call("POST", `/game-rooms/${code}/action`, {
            playerToken: s.token,
            actionType: "choice",
            payload: {
              choiceId: choice.id,
              targetPlayerId: choice.targetRequired ? spieler[1].id : undefined,
            },
          });
        }
      }
    } else if (room.gameState.phase && room.gameState.phase.kind === "vote") {
      for (const s of spieler) {
        await call("POST", `/game-rooms/${code}/action`, {
          playerToken: s.token,
          actionType: "vote",
          payload: { targetPlayerId: spieler[1].id },
        });
      }
    }

    await call("POST", `/game-rooms/${code}/next`, { playerToken: host.token });
  }

  const finaleSicht = await call("GET", `/game-rooms/${code}?playerToken=${host.token}`);
  assert.equal(finaleSicht.json.room.status, "finale", "Spiel erreicht das Finale");
  assert.ok(finaleSicht.json.room.gameState.finale, "Finale hat ein Ergebnis");
  assert.ok(finaleSicht.json.room.gameState.finale.winnerTeam, "Ein Gewinnerteam steht fest");
  assert.ok(finaleSicht.json.room.gameState.finale.summary, "Eine Zusammenfassung existiert");
  assert.ok(geseheneAkte.has(1), "Akt 1 wurde durchlaufen");
  assert.ok(geseheneAkte.has(2), "Akt 2 wurde durchlaufen");
  assert.ok(geseheneAkte.has(3), "Akt 3 wurde durchlaufen");
});



