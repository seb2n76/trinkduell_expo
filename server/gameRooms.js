const crypto = require("crypto");
const db = require("./db");
const storyEngine = require("./games/storyEngine");

/**
 * Raumverwaltung für die Multi-Device-Party- und Story-Spiele.
 *
 * Der Server ist die Spielinstanz: er verteilt die Rollen, rendert die
 * Kapitel, rechnet Punkte und Story-Variablen und wertet das Finale aus.
 * Der Client schickt nur noch Absichten ("ich wähle Option B") und rendert
 * das Ergebnis.
 *
 * Vor August 2026 lag diese Logik im Client des Hosts. Das hatte drei
 * Folgen: die Punkte und der Schaden einer Auswahl kamen nie an, die
 * Team-HP-Leiste bewegte sich nie, und der Host bestimmte den Ausgang.
 */

// Room expiration timeout (3 hours of inactivity)
const ROOM_TTL_MS = 3 * 60 * 60 * 1000;

// Active rooms storage map: roomCode -> GameRoom
const activeRooms = new Map();

/**
 * Geheimnis, mit dem sich ein Spieler gegenueber dem Raum ausweist.
 *
 * Die playerId steht in jeder Raumantwort und ist damit jedem Mitspieler
 * bekannt — sie taugt nicht als Nachweis. Der Token wird genau einmal an den
 * jeweiligen Client ausgeliefert und taucht in keiner Raumansicht auf.
 */
function generatePlayerToken() {
  return crypto.randomBytes(24).toString("hex");
}

/** Findet den Spieler zu einem Token. Ohne Treffer: null. */
function playerByToken(room, token) {
  if (!token) return null;
  return room.players.find((p) => p.token === token) || null;
}

/**
 * Generate a random, readable 4-letter uppercase code (excluding confusing characters like O, 0, I, 1).
 */
function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) {
    // crypto statt Math.random(): der Code ist der einzige Schutz eines
    // Raums. Ein vorhersagbarer Generator laesst Raeume erraten.
    code += chars[crypto.randomInt(chars.length)];
  }
  // Collision check
  if (activeRooms.has(code)) {
    return generateRoomCode();
  }
  return code;
}

// ─── Persistenz ──────────────────────────────────────────────────────────────
//
// Räume lagen bis August 2026 ausschließlich im RAM. Das reichte für
// Fünf-Minuten-Spiele — aber auto-update.sh baut den Container bei jedem
// Commit auf main neu, und ein Neustart löschte damit JEDE laufende Sitzung.
// Bei einer 45-Minuten-Runde ist das der schlimmste denkbare Abbruch.
//
// Deshalb wandert der Raumzustand bei jedem Phasenwechsel in die Datenbank
// und wird beim Start zurückgeladen. Die Spieler-Tokens stehen mit drin —
// ohne sie könnte nach einem Neustart niemand mehr in seinen eigenen Raum
// zurück. Sie sind Raum-Geheimnisse, keine Account-Zugänge: der schlimmste
// Fall bei einem Datenbankleck ist ein fremder Sitzplatz in einem Spiel, das
// spätestens nach drei Stunden ohnehin verfällt.

let persistFailureLogged = false;

function persist(room) {
  db.saveGameRoom(room.code, room).catch((err) => {
    // Einmal laut, danach still: ein kaputtes Persistenz-Backend darf nicht
    // bei jeder Aktion eine Zeile ins Log schreiben. Das Spiel läuft im RAM
    // weiter — nur ein Neustart würde es dann verlieren.
    if (!persistFailureLogged) {
      persistFailureLogged = true;
      console.error("[GameRooms] Raum konnte nicht gesichert werden:", err.message);
    }
  });
}

function forget(code) {
  db.deleteGameRoom(code).catch(() => {
    /* Der Raum ist aus dem RAM entfernt; ein Waisenkind in der DB verfällt per TTL. */
  });
}

/**
 * Lädt beim Serverstart die Räume zurück, die den Neustart überlebt haben.
 * Wird von index.js aufgerufen.
 */
async function restoreRooms() {
  try {
    const rows = await db.getGameRooms();
    const now = Date.now();
    let restored = 0;
    for (const room of rows) {
      if (!room || !room.code) continue;
      if (now - (room.lastActivity || 0) > ROOM_TTL_MS) {
        forget(room.code);
        continue;
      }
      activeRooms.set(room.code, room);
      restored += 1;
    }
    if (restored > 0) {
      console.log(`[GameRooms] ${restored} laufende Spielräume nach Neustart wiederhergestellt.`);
    }
  } catch (err) {
    console.error("[GameRooms] Räume konnten nicht wiederhergestellt werden:", err.message);
  }
}

/**
 * Clean up expired rooms periodically.
 */
function cleanupExpiredRooms() {
  const now = Date.now();
  for (const [code, room] of activeRooms.entries()) {
    if (now - room.lastActivity > ROOM_TTL_MS) {
      activeRooms.delete(code);
      forget(code);
    }
  }
}

// Run cleanup every 15 minutes
setInterval(cleanupExpiredRooms, 15 * 60 * 1000).unref();

function newPlayer({ id, token, name, avatar, isHost }) {
  return {
    id,
    token,
    name,
    avatar: avatar || null,
    isHost: !!isHost,
    isReady: true,
    role: null,
    allegiance: null,
    secretPrompt: null,
    points: 0,
    sipsTaken: 0,
    joinedAt: Date.now(),
    submittedAction: null,
  };
}

function freshGameState() {
  return {
    storyLog: [],
    currentChapter: null,
    votes: {}, // playerId -> targetPlayerId
    actions: {}, // playerId -> actionData
    choices: {}, // playerId -> { choiceId, outcomeText } fuer das AKTUELLE Kapitel
    variables: {}, // Story-Variablen, z. B. healthPoints
    // ── Storylet-Format ──────────────────────────────────────────────────
    act: 1,
    playedInAct: 0,
    usedStorylets: [],
    currentStoryletId: null,
    // Was in dieser Runde passiert ist. Spätere Szenen greifen darauf zurück.
    memory: [],
    // Aktuelle Phase mit absoluter Frist. Siehe openPhase().
    phase: null,
    // Wird beim Wechsel in die Auflösungsphase gefüllt: was alle gewählt haben.
    reveals: null,
    finale: null,
  };
}

// ─── Phasen ──────────────────────────────────────────────────────────────────
//
// Eine Runde läuft nicht mehr auf Zuruf des Hosts weiter, sondern in Phasen
// mit einer absoluten Frist: alle entscheiden gleichzeitig, danach löst der
// Server gebündelt auf. Vorher hatte nur der Host einen Weiter-Knopf und alle
// anderen sahen "Warte auf die Entscheidung des Hosts..." — genau das passive
// Warten, an dem Gruppen aussteigen.
//
// Die Frist ist ein absoluter Zeitstempel, kein Countdown im Client. Jede
// Antwort trägt zusätzlich `serverTime`, damit die Geräte ihre Uhr dagegen
// abgleichen können. Acht Handys mit eigenen Timern laufen sonst auseinander.

/**
 * Die Roh-Definition der laufenden Szene — Kapitel oder Storylet.
 *
 * Getrennt von `gameState.currentChapter`: das ist die gerenderte Fassung für
 * die Clients, hier steht die Definition mit Effekten, Bedingungen und
 * Fristen, die den Raum nie verlässt.
 */
function currentSceneDef(room, story) {
  if (!story) return null;
  if (storyEngine.isStoryletFormat(story)) {
    return room.gameState.currentStoryletId
      ? storyEngine.storyletById(story, room.gameState.currentStoryletId)
      : null;
  }
  return storyEngine.chapterAt(story, room.currentChapterIndex);
}

function openPhase(room, kind) {
  const story = storyEngine.getStory(room.gameId);
  const sceneDef = currentSceneDef(room, story);
  const seconds = storyEngine.deadlineSecFor(sceneDef, kind);

  room.gameState.phase = {
    kind,
    startedAt: Date.now(),
    deadlineAt: Date.now() + seconds * 1000,
    seconds,
  };
}

/** Lebende Spieler. Geister reden und stimmen mit, handeln aber nicht mehr. */
function livingPlayers(room) {
  return room.players.filter((p) => !p.eliminated);
}

/** Haben alle, die dran sind, ihre Eingabe gemacht? */
function everyoneSubmitted(room, kind) {
  if (kind === "choice") {
    const story = storyEngine.getStory(room.gameId);
    const scene = currentSceneDef(room, story);
    const forRole = scene && scene.prompt && scene.prompt.forRole;
    // Rollenszene: es haengt an genau einer Person. Auf alle anderen zu
    // warten hiesse, auf eine Eingabe zu warten, die nie kommt.
    const dran = forRole
      ? livingPlayers(room).filter((p) => p.role === forRole)
      : livingPlayers(room);
    if (dran.length === 0) return true;
    return dran.every((p) => room.gameState.choices[p.id]);
  }
  if (kind === "vote") {
    // Geister stimmen mit — sie sollen einen Grund haben, dranzubleiben.
    if (room.players.length === 0) return false;
    return room.players.every((p) => room.gameState.votes[p.id]);
  }
  // Auflösung und Diskussion laufen auf Zeit — sie warten auf niemanden.
  return false;
}

/** Was hat wer gewählt? Erst in der Auflösungsphase öffentlich. */
function buildReveals(room) {
  const story = storyEngine.getStory(room.gameId);
  const sceneDef = currentSceneDef(room, story);
  const choiceDefs = (sceneDef && sceneDef.prompt && sceneDef.prompt.choices) || [];

  return room.players.map((p) => {
    const choice = room.gameState.choices[p.id];
    const def = choice ? choiceDefs.find((c) => c.id === choice.choiceId) : null;
    const target = choice && choice.targetPlayerId
      ? room.players.find((t) => t.id === choice.targetPlayerId)
      : null;
    return {
      playerId: p.id,
      playerName: p.name,
      // null heißt: hat die Frist verstreichen lassen.
      choiceId: choice ? choice.choiceId : null,
      label: def ? def.label : null,
      outcomeText: choice ? choice.outcomeText : null,
      targetName: target ? target.name : null,
    };
  });
}

function enterFinale(room, story) {
  room.gameState.finale = storyEngine.evaluateFinale(
    story,
    room.players,
    room.gameState.votes,
    room.gameState.variables
  );
  room.status = "finale";
  room.gameState.phase = null;
  room.gameState.storyLog.push(room.gameState.finale.title);
}

/** Räumt die Eingaben der abgeschlossenen Szene ab. */
function clearSceneInput(room) {
  room.gameState.choices = {};
  room.gameState.votes = {};
  room.gameState.reveals = null;
  for (const p of room.players) p.submittedAction = null;
}

/**
 * Zieht die nächste Szene aus dem Pool und schaltet bei Bedarf den Akt weiter.
 * Gibt false zurück, wenn die Story zu Ende ist.
 */
function advanceStorylet(room, story) {
  const gs = room.gameState;

  if (storyEngine.actExhausted(story, gs.act, gs.playedInAct)) {
    if (gs.act >= storyEngine.lastAct(story)) return false;
    gs.act += 1;
    gs.playedInAct = 0;
  }

  const ctx = {
    act: gs.act,
    variables: gs.variables,
    used: gs.usedStorylets,
    playedInAct: gs.playedInAct,
    playerCount: room.players.length,
    aliveRoles: livingPlayers(room).map((p) => p.role),
  };

  const storylet = storyEngine.pickStorylet(story, ctx);
  // Kein passendes Storylet mehr: lieber sauber ins Finale als in einer
  // Schleife haengen bleiben.
  if (!storylet) return false;

  gs.currentStoryletId = storylet.id;
  gs.usedStorylets.push(storylet.id);
  gs.playedInAct += 1;
  gs.currentChapter = storyEngine.buildStorylet(story, storylet, room.players, gs.act, {
    variables: gs.variables,
    memory: gs.memory,
  });
  room.status = "story_chapter";
  gs.storyLog.push(gs.currentChapter.title);
  clearSceneInput(room);
  openPhase(room, storyEngine.openingPhaseKind(storylet));
  return true;
}

/** Ein Phasenwechsel. Gibt false zurück, wenn es nichts mehr zu wechseln gibt. */
function advancePhase(room) {
  const story = storyEngine.getStory(room.gameId);
  if (!story || room.status === "finale") return false;

  const kind = room.gameState.phase ? room.gameState.phase.kind : null;

  if (kind === "choice") {
    room.gameState.reveals = buildReveals(room);
    openPhase(room, "reveal");
    return true;
  }

  if (kind === "vote") {
    enterFinale(room, story);
    return true;
  }

  // Auflösung oder Diskussion vorbei: nächste Szene, oder Schluss.
  if (storyEngine.isStoryletFormat(story)) {
    if (!advanceStorylet(room, story)) enterFinale(room, story);
    return true;
  }

  if (storyEngine.isLastChapter(story, room.currentChapterIndex)) {
    enterFinale(room, story);
    return true;
  }

  room.currentChapterIndex += 1;
  room.gameState.currentChapter = storyEngine.buildChapter(
    story,
    room.currentChapterIndex,
    room.players
  );
  room.status = "story_chapter";
  room.gameState.storyLog.push(room.gameState.currentChapter.title);
  clearSceneInput(room);

  const chapterDef = storyEngine.chapterAt(story, room.currentChapterIndex);
  openPhase(room, storyEngine.openingPhaseKind(chapterDef));
  return true;
}

/**
 * Faellige Phasen abarbeiten. Wird auf jedem Lesepfad aufgerufen — es gibt
 * bewusst KEINEN Timer im Prozess: ein Neustart wuerde ihn verlieren, und
 * genau das war der Grund, warum Raeume frueher mitten im Spiel verschwanden.
 * Bei 2,5-Sekunden-Polling faellt der Versatz niemandem auf.
 *
 * Die Schleife faengt den Fall ab, dass laengere Zeit niemand gepollt hat und
 * dadurch mehrere Fristen auf einmal abgelaufen sind.
 */
function resolveDuePhases(room) {
  let changed = false;
  for (let guard = 0; guard < 12; guard++) {
    const phase = room.gameState.phase;
    if (!phase || room.status === "finale") break;

    const fällig = Date.now() >= phase.deadlineAt || everyoneSubmitted(room, phase.kind);
    if (!fällig) break;

    if (!advancePhase(room)) break;
    changed = true;
  }
  if (changed) room.revision += 1;
  return changed;
}

/**
 * Create a new Game Room.
 */
function createRoom({ gameId, hostId, hostName, hostAvatar }) {
  const code = generateRoomCode();
  const hostPlayerId = hostId || `host_${crypto.randomBytes(4).toString("hex")}`;
  const hostToken = generatePlayerToken();
  const now = Date.now();

  const room = {
    code,
    gameId: gameId || "court_treason",
    hostId: hostPlayerId,
    status: "lobby", // "lobby" | "role_reveal" | "story_chapter" | "finale"
    createdAt: now,
    lastActivity: now,
    currentChapterIndex: 0,
    // Zaehler fuer den Client: aendert sich bei jedem echten Zustandswechsel,
    // damit ein Poll ohne Neuigkeit nicht die ganze Ansicht neu aufbaut.
    revision: 0,
    players: [
      newPlayer({
        id: hostPlayerId,
        token: hostToken,
        name: hostName || "Host",
        avatar: hostAvatar,
        isHost: true,
      }),
    ],
    gameState: freshGameState(),
  };

  activeRooms.set(code, room);
  persist(room);

  return {
    code,
    hostId: hostPlayerId,
    playerToken: hostToken,
    room: sanitizeRoomForPlayer(room, hostPlayerId),
  };
}

/**
 * Join an existing Game Room.
 */
function joinRoom(code, { playerToken, playerName, playerAvatar }) {
  const normalizedCode = (code || "").trim().toUpperCase();
  const room = activeRooms.get(normalizedCode);
  if (!room) {
    throw new Error("ROOM_NOT_FOUND");
  }

  // Wiedereintritt in ein laufendes Spiel nur mit dem eigenen Token.
  // Vorher genuegte der ANZEIGENAME: wer den Raumcode und den Namen eines
  // Mitspielers kannte, uebernahm dessen Platz samt Geheimrolle.
  const rejoining = playerByToken(room, playerToken);
  if (rejoining) {
    room.lastActivity = Date.now();
    return {
      code: room.code,
      playerId: rejoining.id,
      playerToken: rejoining.token,
      room: sanitizeRoomForPlayer(room, rejoining.id),
    };
  }

  if (room.status !== "lobby") {
    throw new Error("GAME_ALREADY_STARTED");
  }

  if (room.players.length >= 16) {
    throw new Error("ROOM_FULL");
  }

  const assignedPlayerId = `p_${crypto.randomBytes(4).toString("hex")}`;
  const assignedToken = generatePlayerToken();

  // Check if player name already taken in room, append number if so
  let finalName = (playerName || `Gast ${room.players.length + 1}`).trim();
  const nameExists = room.players.some(
    (p) => p.name.toLowerCase() === finalName.toLowerCase() && p.id !== assignedPlayerId
  );
  if (nameExists) {
    finalName = `${finalName} #${room.players.length + 1}`;
  }

  room.players.push(
    newPlayer({
      id: assignedPlayerId,
      token: assignedToken,
      name: finalName,
      avatar: playerAvatar,
      isHost: false,
    })
  );
  room.lastActivity = Date.now();
  room.revision += 1;
  persist(room);

  return {
    code: room.code,
    playerId: assignedPlayerId,
    playerToken: assignedToken,
    room: sanitizeRoomForPlayer(room, assignedPlayerId),
  };
}

/**
 * Get the room state, filtered safely for the specific querying player.
 * Secret roles & hidden actions of OTHER players are masked.
 */
function getRoom(code, playerToken) {
  const normalizedCode = (code || "").trim().toUpperCase();
  const room = activeRooms.get(normalizedCode);
  if (!room) {
    return null;
  }
  room.lastActivity = Date.now();
  // Abgelaufene Fristen hier abarbeiten. Der Lesepfad ist der einzige, der
  // zuverlaessig alle 2,5 Sekunden laeuft — ein Timer im Prozess wuerde einen
  // Neustart nicht ueberleben.
  if (resolveDuePhases(room)) persist(room);
  // Ohne gueltigen Token bekommt man die Zuschauersicht: kein "ich", also
  // auch keine Geheimrolle. Vorher reichte die playerId eines Mitspielers,
  // um dessen Rolle auszulesen — und die steht in jeder Raumantwort.
  const player = playerByToken(room, playerToken);
  return sanitizeRoomForPlayer(room, player ? player.id : null);
}

/**
 * Start the game session and assign roles.
 *
 * Die Rollen kommen aus der Story-Definition auf dem Server. Frueher schickte
 * der Host sie mit (`gameSetupData.playerRoles`) — er konnte sich also selbst
 * zum Detektiv und einen Mitspieler zum Moerder erklaeren. Das Feld wird
 * weiterhin akzeptiert, aber nur fuer Spiele OHNE hinterlegte Story
 * (freie Partyspiele ueber einen Raum-Code).
 */
function startGame(code, playerToken, gameSetupData) {
  const normalizedCode = (code || "").trim().toUpperCase();
  const room = activeRooms.get(normalizedCode);
  if (!room) {
    throw new Error("ROOM_NOT_FOUND");
  }
  const requester = playerByToken(room, playerToken);
  if (!requester || room.hostId !== requester.id) {
    throw new Error("NOT_HOST");
  }
  if (room.players.length < 2) {
    throw new Error("NOT_ENOUGH_PLAYERS");
  }

  const story = storyEngine.getStory(room.gameId);

  room.status = "role_reveal";
  room.currentChapterIndex = 0;
  room.lastActivity = Date.now();
  room.revision += 1;
  room.gameState = freshGameState();

  if (story) {
    if (room.players.length < story.minPlayers) {
      throw new Error("NOT_ENOUGH_PLAYERS");
    }
    room.gameState.variables = storyEngine.initialVariables(story);

    for (const assignment of storyEngine.assignRoles(story, room.players)) {
      const p = room.players.find((pl) => pl.id === assignment.playerId);
      if (p) {
        p.role = assignment.role;
        p.allegiance = assignment.allegiance;
        p.secretPrompt = assignment.secretPrompt;
        p.observation = assignment.observation || null;
      }
    }

    if (storyEngine.isStoryletFormat(story)) {
      room.status = "story_chapter";
      advanceStorylet(room, story);
    } else {
      room.gameState.currentChapter = storyEngine.buildChapter(story, 0, room.players);
      room.status = "story_chapter";
      openPhase(room, storyEngine.openingPhaseKind(storyEngine.chapterAt(story, 0)));
    }
  } else if (Array.isArray(gameSetupData?.playerRoles)) {
    for (const assignment of gameSetupData.playerRoles) {
      const p = room.players.find((pl) => pl.id === assignment.playerId);
      if (p) {
        p.role = assignment.role;
        p.secretPrompt = assignment.secretPrompt;
      }
    }
  }

  persist(room);
  return sanitizeRoomForPlayer(room, requester.id);
}

/**
 * Submit an action / vote / decision from a player.
 */
function submitAction(code, playerToken, { actionType, payload }) {
  const normalizedCode = (code || "").trim().toUpperCase();
  const room = activeRooms.get(normalizedCode);
  if (!room) {
    throw new Error("ROOM_NOT_FOUND");
  }

  // Nur mit eigenem Token: sonst koennte jeder im Raum fuer andere abstimmen
  // oder ihnen Schlucke anschreiben.
  const player = playerByToken(room, playerToken);
  if (!player) {
    throw new Error("PLAYER_NOT_IN_ROOM");
  }
  const playerId = player.id;

  room.lastActivity = Date.now();
  player.submittedAction = { actionType, payload, timestamp: Date.now() };

  if (actionType === "choice") {
    const story = storyEngine.getStory(room.gameId);
    if (!story) {
      throw new Error("NO_STORY_FOR_GAME");
    }
    // Nur waehrend der Auswahlphase. Ohne diese Pruefung koennte jemand nach
    // der Auflösung nachtraeglich noch Punkte einsammeln.
    if (!room.gameState.phase || room.gameState.phase.kind !== "choice") {
      throw new Error("PHASE_CLOSED");
    }
    // Genau eine Entscheidung pro Kapitel. Ohne diese Sperre koennte jeder
    // dieselbe Option beliebig oft schicken und sich Punkte anhaeufen.
    if (room.gameState.choices[playerId]) {
      throw new Error("ALREADY_CHOSE");
    }
    // Geister handeln nicht mehr. Sie reden weiter mit und stimmen ab.
    if (player.eliminated) {
      throw new Error("ELIMINATED");
    }

    const result = storyEngine.applyChoice(
      story,
      currentSceneDef(room, story),
      {
        players: room.players,
        variables: room.gameState.variables,
        memory: room.gameState.memory,
      },
      playerId,
      payload?.choiceId,
      payload?.targetPlayerId
    );

    room.gameState.choices[playerId] = {
      choiceId: payload.choiceId,
      outcomeText: result.outcomeText,
      targetPlayerId: result.targetPlayerId,
    };
  } else if (actionType === "vote" && payload?.targetPlayerId) {
    const story = storyEngine.getStory(room.gameId);
    if (story && (!room.gameState.phase || room.gameState.phase.kind !== "vote")) {
      throw new Error("PHASE_CLOSED");
    }
    // Eine Stimme pro Spieler; Umentscheiden ist erlaubt, Stapeln nicht.
    room.gameState.votes[playerId] = payload.targetPlayerId;
  } else if (actionType === "drink") {
    player.sipsTaken = (player.sipsTaken || 0) + (payload?.count || 1);
  } else {
    room.gameState.actions[playerId] = { actionType, payload, timestamp: Date.now() };
  }

  room.revision += 1;
  // Sobald der Letzte abgegeben hat, loest der Server sofort auf — niemand
  // wartet auf eine Frist, die ohnehin niemanden mehr betrifft.
  resolveDuePhases(room);
  persist(room);
  return sanitizeRoomForPlayer(room, playerId);
}

/**
 * Phase ueberspringen (nur Host).
 *
 * Seit die Phasen auf Fristen laufen, ist das nur noch die Notbremse: die
 * Gruppe ist schneller fertig als die Uhr, oder jemand ist weg und blockiert
 * die Runde. Der Host loest damit lediglich AUS — welches Kapitel folgt, was
 * drinsteht und wie das Finale ausgeht, entscheidet weiterhin der Server.
 *
 * Fuer Spiele ohne hinterlegte Story bleibt es die regulaere Weiterschaltung.
 */
function nextChapter(code, playerToken, { nextStatus, nextChapterData, outcomeSummary } = {}) {
  const normalizedCode = (code || "").trim().toUpperCase();
  const room = activeRooms.get(normalizedCode);
  if (!room) {
    throw new Error("ROOM_NOT_FOUND");
  }
  const requester = playerByToken(room, playerToken);
  if (!requester || room.hostId !== requester.id) {
    throw new Error("NOT_HOST");
  }

  room.lastActivity = Date.now();
  const story = storyEngine.getStory(room.gameId);

  if (story) {
    if (room.status === "finale") {
      return sanitizeRoomForPlayer(room, requester.id);
    }
    advancePhase(room);
  } else {
    // Spiele ohne hinterlegte Story: der Host gibt die Phase weiterhin vor.
    if (nextStatus) room.status = nextStatus;
    if (nextChapterData) {
      room.currentChapterIndex += 1;
      room.gameState.currentChapter = nextChapterData;
    }
    if (outcomeSummary) room.gameState.storyLog.push(outcomeSummary);
    room.gameState.choices = {};
    room.gameState.votes = {};
    for (const p of room.players) p.submittedAction = null;
  }

  room.revision += 1;
  persist(room);
  return sanitizeRoomForPlayer(room, requester.id);
}

/**
 * Leave or end a room.
 */
function leaveRoom(code, playerToken) {
  const normalizedCode = (code || "").trim().toUpperCase();
  const room = activeRooms.get(normalizedCode);
  if (!room) return { success: true };

  const leaver = playerByToken(room, playerToken);
  if (!leaver) return { success: true };
  const playerId = leaver.id;

  room.lastActivity = Date.now();
  if (room.hostId === playerId) {
    // If host leaves during lobby, close room or reassign host
    if (room.status === "lobby" && room.players.length > 1) {
      room.players = room.players.filter((p) => p.id !== playerId);
      room.hostId = room.players[0].id;
      room.players[0].isHost = true;
    } else {
      activeRooms.delete(normalizedCode);
      forget(normalizedCode);
      return { success: true, roomClosed: true };
    }
  } else {
    room.players = room.players.filter((p) => p.id !== playerId);
  }

  room.revision += 1;
  persist(room);
  return { success: true, room: sanitizeRoomForPlayer(room, playerId) };
}

/**
 * Filter secret fields from room state before sending to a specific client.
 */
function sanitizeRoomForPlayer(room, requestingPlayerId) {
  const isHost = room.hostId === requestingPlayerId;
  const isFinale = room.status === "finale";

  const sanitizedPlayers = room.players.map((p) => {
    const isSelf = p.id === requestingPlayerId;
    return {
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      isHost: p.isHost,
      isReady: p.isReady,
      points: p.points,
      sipsTaken: p.sipsTaken,
      hasSubmittedAction: !!p.submittedAction,
      // Ausgeschieden, aber weiter im Raum: halbe Stimme, volles Rederecht.
      eliminated: !!p.eliminated,
      // Wer im aktuellen Kapitel schon gewaehlt hat, ist oeffentlich — was
      // er gewaehlt hat, nicht. Das erlaubt eine "3 von 5 haben gewaehlt"-
      // Anzeige, ohne die Entscheidung zu verraten.
      hasChosen: !!room.gameState.choices[p.id],
      // Reveal role only to the player themself OR if the game has reached the finale
      role: isSelf || isFinale ? p.role : null,
      allegiance: isSelf || isFinale ? p.allegiance : null,
      secretPrompt: isSelf ? p.secretPrompt : null,
      // Die eigene Beobachtung — der Teil der Wahrheit, den nur diese Person
      // kennt. Sie geht NIE an jemand anderen: sonst waere die Asymmetrie hin.
      observation: isSelf ? p.observation || null : null,
    };
  });

  const myChoice = requestingPlayerId
    ? room.gameState.choices[requestingPlayerId] || null
    : null;

  return {
    code: room.code,
    gameId: room.gameId,
    hostId: room.hostId,
    status: room.status,
    revision: room.revision,
    currentChapterIndex: room.currentChapterIndex,
    players: sanitizedPlayers,
    gameState: {
      storyLog: room.gameState.storyLog,
      currentChapter: room.gameState.currentChapter,
      variables: room.gameState.variables,
      // Bestandsschutz fuer die bestehende HP-Leiste im Client.
      healthPoints: room.gameState.variables.healthPoints,
      // Aktuelle Phase samt absoluter Frist. Der Client rechnet seinen
      // Countdown daraus und gegen `serverTime` — nie gegen die eigene Uhr.
      phase: room.gameState.phase,
      act: room.gameState.act,
      // Wer was gewaehlt hat, wird erst in der Auflösung oeffentlich.
      reveals: room.gameState.phase && room.gameState.phase.kind === "reveal"
        ? room.gameState.reveals
        : null,
      // Eigene Entscheidung ja, fremde nein.
      myChoice,
      choiceCount: Object.keys(room.gameState.choices).length,
      // Total vote count only during active voting, detailed votes only in finale
      voteCount: Object.keys(room.gameState.votes || {}).length,
      finalVotes: isFinale ? room.gameState.votes : undefined,
      finale: isFinale ? room.gameState.finale : null,
    },
    isHost,
    myPlayerId: requestingPlayerId,
    serverTime: Date.now(),
  };
}

/**
 * Was ein Spieler nach dem Finale gutgeschrieben bekommt.
 *
 * Getrennt von getRoom(), weil hier der Token gegen den ECHTEN Raum geprüft
 * wird und nicht gegen die maskierte Ansicht. Wirft, statt null zu liefern,
 * damit ein Fehlversuch im Endpunkt unterscheidbar bleibt.
 */
function claimablePoints(code, playerToken) {
  const normalizedCode = (code || "").trim().toUpperCase();
  const room = activeRooms.get(normalizedCode);
  if (!room) {
    throw new Error("ROOM_NOT_FOUND");
  }
  const player = playerByToken(room, playerToken);
  if (!player) {
    throw new Error("PLAYER_NOT_IN_ROOM");
  }
  if (room.status !== "finale") {
    throw new Error("GAME_NOT_FINISHED");
  }
  return {
    roomCode: room.code,
    playerId: player.id,
    // Obergrenze als billige Versicherung. Die Punkte rechnet inzwischen der
    // Server, sie sind also nicht mehr fälschbar — aber eine Story mit einem
    // Tippfehler in den Effekten soll auch nicht das Level-System sprengen.
    points: Math.min(player.points || 0, 150),
  };
}

function getActiveRoomsSummary() {
  cleanupExpiredRooms();
  const summary = [];
  for (const room of activeRooms.values()) {
    const host = room.players.find((p) => p.isHost);
    summary.push({
      code: room.code,
      gameId: room.gameId,
      status: room.status,
      playerCount: room.players.length,
      hostName: host ? host.name : "Unbekannt",
      createdAt: room.createdAt,
      lastActivity: room.lastActivity,
      currentChapterIndex: room.currentChapterIndex,
    });
  }
  return summary;
}

function deleteRoom(code) {
  const normalized = code.toUpperCase();
  forget(normalized);
  return activeRooms.delete(normalized);
}

module.exports = {
  createRoom,
  joinRoom,
  getRoom,
  startGame,
  submitAction,
  nextChapter,
  leaveRoom,
  getActiveRoomsSummary,
  claimablePoints,
  deleteRoom,
  restoreRooms,
  _activeRooms: activeRooms, // for testing inspection
};
