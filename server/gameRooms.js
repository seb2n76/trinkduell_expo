const crypto = require("crypto");

/**
 * In-Memory Game Room Manager for Multi-Device Party & Story RPG Games.
 * Manages active party rooms, room codes, live player states, secret roles,
 * and synchronized story phases.
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

/**
 * Clean up expired rooms periodically.
 */
function cleanupExpiredRooms() {
  const now = Date.now();
  for (const [code, room] of activeRooms.entries()) {
    if (now - room.lastActivity > ROOM_TTL_MS) {
      activeRooms.delete(code);
    }
  }
}

// Run cleanup every 15 minutes
setInterval(cleanupExpiredRooms, 15 * 60 * 1000).unref();

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
    status: "lobby", // "lobby" | "role_reveal" | "story_chapter" | "action_phase" | "voting" | "finale"
    createdAt: now,
    lastActivity: now,
    currentChapterIndex: 0,
    players: [
      {
        id: hostPlayerId,
        token: hostToken,
        name: hostName || "Host",
        avatar: hostAvatar || null,
        isHost: true,
        isReady: true,
        role: null,
        secretPrompt: null,
        points: 0,
        sipsTaken: 0,
        joinedAt: now,
        submittedAction: null,
      },
    ],
    gameState: {
      storyLog: [],
      currentChapter: null,
      votes: {}, // playerId -> targetPlayerId
      actions: {}, // playerId -> actionData
      healthPoints: 100, // For co-op games like Haunted Manor
      customVariables: {},
    },
  };

  activeRooms.set(code, room);
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
  const nameExists = room.players.some((p) => p.name.toLowerCase() === finalName.toLowerCase() && p.id !== assignedPlayerId);
  if (nameExists) {
    finalName = `${finalName} #${room.players.length + 1}`;
  }

  const newPlayer = {
    id: assignedPlayerId,
    token: assignedToken,
    name: finalName,
    avatar: playerAvatar || null,
    isHost: false,
    isReady: true,
    role: null,
    secretPrompt: null,
    points: 0,
    sipsTaken: 0,
    joinedAt: Date.now(),
    submittedAction: null,
  };

  room.players.push(newPlayer);
  room.lastActivity = Date.now();

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
  // Ohne gueltigen Token bekommt man die Zuschauersicht: kein "ich", also
  // auch keine Geheimrolle. Vorher reichte die playerId eines Mitspielers,
  // um dessen Rolle auszulesen — und die steht in jeder Raumantwort.
  const player = playerByToken(room, playerToken);
  return sanitizeRoomForPlayer(room, player ? player.id : null);
}

/**
 * Start the game session and assign procedural roles.
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

  room.status = "role_reveal";
  room.currentChapterIndex = 0;
  room.lastActivity = Date.now();
  room.gameState = {
    storyLog: [],
    currentChapter: gameSetupData?.firstChapter || null,
    votes: {},
    actions: {},
    healthPoints: 100,
    customVariables: gameSetupData?.customVariables || {},
  };

  // If roles were generated/provided in gameSetupData, assign them
  if (gameSetupData?.playerRoles && Array.isArray(gameSetupData.playerRoles)) {
    for (const assignment of gameSetupData.playerRoles) {
      const p = room.players.find((pl) => pl.id === assignment.playerId);
      if (p) {
        p.role = assignment.role;
        p.secretPrompt = assignment.secretPrompt;
      }
    }
  }

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

  if (actionType === "vote" && payload?.targetPlayerId) {
    room.gameState.votes[playerId] = payload.targetPlayerId;
  } else if (actionType === "drink") {
    player.sipsTaken = (player.sipsTaken || 0) + (payload?.count || 1);
  } else if (actionType === "coop_damage") {
    room.gameState.healthPoints = Math.max(0, (room.gameState.healthPoints || 100) - (payload?.damage || 10));
  } else {
    room.gameState.actions[playerId] = { actionType, payload, timestamp: Date.now() };
  }

  return sanitizeRoomForPlayer(room, playerId);
}

/**
 * Advance to next chapter / story phase (Host only).
 */
function nextChapter(code, playerToken, { nextStatus, nextChapterData, outcomeSummary }) {
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
  if (nextStatus) {
    room.status = nextStatus;
  }
  if (nextChapterData) {
    room.currentChapterIndex += 1;
    room.gameState.currentChapter = nextChapterData;
  }
  if (outcomeSummary) {
    room.gameState.storyLog.push(outcomeSummary);
  }

  // Clear transient votes and action submissions for the new chapter
  room.gameState.votes = {};
  for (const p of room.players) {
    p.submittedAction = null;
  }

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
      return { success: true, roomClosed: true };
    }
  } else {
    room.players = room.players.filter((p) => p.id !== playerId);
  }

  return { success: true, room: sanitizeRoomForPlayer(room, playerId) };
}

/**
 * Filter secret fields from room state before sending to a specific client.
 */
function sanitizeRoomForPlayer(room, requestingPlayerId) {
  const isHost = room.hostId === requestingPlayerId;

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
      // Reveal role only to the player themself OR if the game has reached the finale
      role: isSelf || room.status === "finale" ? p.role : null,
      secretPrompt: isSelf ? p.secretPrompt : null,
    };
  });

  return {
    code: room.code,
    gameId: room.gameId,
    hostId: room.hostId,
    status: room.status,
    currentChapterIndex: room.currentChapterIndex,
    players: sanitizedPlayers,
    gameState: {
      storyLog: room.gameState.storyLog,
      currentChapter: room.gameState.currentChapter,
      healthPoints: room.gameState.healthPoints,
      customVariables: room.gameState.customVariables,
      // Total vote count only during active voting, detailed votes only in finale
      voteCount: Object.keys(room.gameState.votes || {}).length,
      finalVotes: room.status === "finale" ? room.gameState.votes : undefined,
    },
    isHost,
    myPlayerId: requestingPlayerId,
  };
}

module.exports = {
  createRoom,
  joinRoom,
  getRoom,
  startGame,
  submitAction,
  nextChapter,
  leaveRoom,
  _activeRooms: activeRooms, // for testing inspection
};
