const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/**
 * Story-Engine für die Multi-Device-RPGs.
 *
 * Die Spieldefinitionen liegen als JSON neben dieser Datei und sind die
 * EINZIGE Quelle der Wahrheit. Bis August 2026 rechnete der Client des Hosts
 * das Spiel aus und schickte fertigen Text an den Server — mit drei Folgen:
 * die Punkte (`rewardPoints`) und der Schaden (`damage`) einer Auswahl kamen
 * nirgends an, die Team-HP-Leiste bewegte sich nie, und der Host konnte den
 * Ausgang beliebig bestimmen. Deshalb rechnet ab jetzt ausschließlich der
 * Server; der Client rendert nur noch, was hier herauskommt.
 *
 * Alles in diesem Modul ist frei von Raum-Verwaltung: rein Definition rein,
 * Ergebnis raus. Der Zustand lebt in gameRooms.js.
 */

const STORY_DIR = path.join(__dirname, "stories");

/** id -> Definition. Einmal beim Start gelesen, danach unveränderlich. */
const stories = new Map();

function loadStories() {
  let files = [];
  try {
    files = fs.readdirSync(STORY_DIR).filter((f) => f.endsWith(".json"));
  } catch (err) {
    console.error("[StoryEngine] Story-Verzeichnis nicht lesbar:", err.message);
    return;
  }

  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(STORY_DIR, file), "utf-8");
      const story = JSON.parse(raw);
      if (!story.id || !Array.isArray(story.chapters) || story.chapters.length === 0) {
        console.error(`[StoryEngine] ${file} hat keine id oder keine Kapitel — übersprungen.`);
        continue;
      }
      stories.set(story.id, Object.freeze(story));
    } catch (err) {
      // Laut, aber nicht tödlich: ein kaputtes Setting darf nicht den ganzen
      // Server am Start hindern. Die übrigen Spiele bleiben spielbar.
      console.error(`[StoryEngine] ${file} ist kein gültiges JSON:`, err.message);
    }
  }
}

loadStories();

function hasStory(id) {
  return stories.has(id);
}

function getStory(id) {
  return stories.get(id) || null;
}

/** Nur die Anzeigefelder — für Katalog-Endpunkte, ohne Kapitel und Rollen. */
function listStories() {
  return [...stories.values()].map((s) => ({
    id: s.id,
    title: s.title,
    subtitle: s.subtitle,
    genre: s.genre,
    durationMinutes: s.durationMinutes,
    minPlayers: s.minPlayers,
    maxPlayers: s.maxPlayers,
    themeColor: s.themeColor,
    accentColor: s.accentColor,
    icon: s.icon,
    tagline: s.tagline,
    description: s.description,
    chapterCount: s.chapters.length,
  }));
}

/**
 * Fisher-Yates mit crypto. Das frühere `sort(() => Math.random() - 0.5)` war
 * kein Mischen: es liefert je nach Sortieralgorithmus messbar ungleiche
 * Verteilungen — und wer welche Rolle bekommt, ist die eine Sache in diesem
 * Spiel, die wirklich zufällig sein muss.
 */
function shuffle(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Ersetzt die Platzhalter einer Vorlage.
 *
 *   {{player:2|Ersatz}}  Name des 2. Spielers der übergebenen Reihenfolge
 *   {{randomPlayer}}     zufälliger Spieler — innerhalb EINES Aufrufs stabil,
 *                        damit „X wirkt seltsam. Ist X besessen?" dieselbe
 *                        Person meint
 *   {{lastPlayer}}       letzter Spieler der Reihenfolge
 *   {{pick:key}}         zufälliger Eintrag aus chapter.picks[key]
 *   {{role}}             Rollenname (nur in Rollen-Prompts)
 *   {{traitor}} {{condemned}}   Namen im Finale
 *   {{var:name}}         Story-Variable im Finale
 */
function renderTemplate(template, ctx) {
  if (typeof template !== "string") return "";

  const players = ctx.players || [];
  // Einmal ziehen, nicht pro Vorkommen.
  const randomName = players.length
    ? players[crypto.randomInt(players.length)].name
    : null;

  return template.replace(/\{\{([^}]+)\}\}/g, (match, body) => {
    const [token, fallback] = body.split("|");
    const [kind, arg] = token.trim().split(":");

    let value = null;
    switch (kind) {
      case "player": {
        const index = Number.parseInt(arg, 10) - 1;
        value = players[index] ? players[index].name : null;
        break;
      }
      case "randomPlayer":
        value = randomName;
        break;
      case "lastPlayer":
        value = players.length ? players[players.length - 1].name : null;
        break;
      case "pick": {
        const options = (ctx.picks && ctx.picks[arg]) || [];
        value = options.length ? options[crypto.randomInt(options.length)] : null;
        break;
      }
      case "role":
        value = ctx.role || null;
        break;
      case "traitor":
        value = ctx.traitor || null;
        break;
      case "condemned":
        value = ctx.condemned || null;
        break;
      case "var":
        value = ctx.variables && ctx.variables[arg] !== undefined
          ? String(ctx.variables[arg])
          : null;
        break;
      default:
        value = null;
    }

    if (value === null || value === undefined || value === "") {
      return fallback !== undefined ? fallback : match;
    }
    return value;
  });
}

/**
 * Verteilt die Rollen. Die festen Rollen gehen der Reihe nach an die
 * gemischte Spielerliste, der Rest bekommt Rollen aus dem Pool.
 *
 * Wichtig: Das passiert auf dem Server. Vorher schickte der Host die
 * Rollenverteilung mit — er konnte sich also selbst zum Detektiv und einen
 * Mitspieler zum Mörder erklären.
 */
function assignRoles(story, players) {
  const order = shuffle(players);
  const fixed = (story.roles && story.roles.fixed) || [];
  const pool = (story.roles && story.roles.pool) || [];
  const assignments = [];

  for (let i = 0; i < order.length; i++) {
    const def = i < fixed.length
      ? fixed[i]
      : pool.length
        ? pool[(i - fixed.length) % pool.length]
        : null;
    if (!def) continue;

    assignments.push({
      playerId: order[i].id,
      role: def.name,
      allegiance: def.allegiance || "town",
      secretPrompt: renderTemplate(def.secretPrompt, {
        players: order,
        role: def.name,
      }),
    });
  }

  return assignments;
}

/**
 * Baut ein Kapitel in der Fassung, die alle Clients sehen. Der Text wird
 * hier EINMAL gerendert und dann gespeichert — sonst würfelt jedes Gerät
 * eigene Namen und eine eigene Mordwaffe, und die Gruppe redet aneinander
 * vorbei.
 */
function buildChapter(story, index, players) {
  const chapter = story.chapters[index];
  if (!chapter) return null;

  return {
    id: chapter.id,
    act: chapter.act,
    index,
    title: chapter.title,
    atmosphereHint: chapter.atmosphereHint || null,
    text: renderTemplate(chapter.textTemplate, {
      players,
      picks: chapter.picks,
    }),
    // Der Client braucht Label und Ziel-Pflicht zum Rendern, aber weder
    // Effekte noch Punkte: die rechnet der Server, und was der Client nicht
    // kennt, kann er nicht fälschen.
    prompt: chapter.prompt
      ? {
          title: chapter.prompt.title,
          description: chapter.prompt.description,
          choices: chapter.prompt.choices.map((c) => ({
            id: c.id,
            label: c.label,
            targetRequired: !!c.targetRequired,
          })),
        }
      : null,
    voting: chapter.voting || null,
  };
}

function chapterAt(story, index) {
  return story.chapters[index] || null;
}

function isLastChapter(story, index) {
  return index >= story.chapters.length - 1;
}

/** Startwerte der Story-Variablen (z. B. healthPoints: 100). */
function initialVariables(story) {
  return { ...(story.variables || {}) };
}

/**
 * Wendet eine Auswahl an. Gibt den Ergebnistext zurück oder wirft, wenn die
 * Auswahl nicht zum aktuellen Kapitel gehört.
 *
 * `state` wird direkt verändert: { players, variables }.
 */
function applyChoice(story, chapterIndex, state, actingPlayerId, choiceId, targetPlayerId) {
  const chapter = chapterAt(story, chapterIndex);
  if (!chapter || !chapter.prompt) {
    throw new Error("NO_PROMPT_IN_CHAPTER");
  }

  const choice = chapter.prompt.choices.find((c) => c.id === choiceId);
  if (!choice) {
    throw new Error("UNKNOWN_CHOICE");
  }

  const actor = state.players.find((p) => p.id === actingPlayerId);
  if (!actor) {
    throw new Error("PLAYER_NOT_IN_ROOM");
  }

  const target = targetPlayerId
    ? state.players.find((p) => p.id === targetPlayerId)
    : null;
  if (choice.targetRequired && !target) {
    throw new Error("TARGET_REQUIRED");
  }

  // ── Schlucke ────────────────────────────────────────────────────────────
  // `sipsTaken` zählt, was das SPIEL verlangt hat — nicht, was jemand
  // wirklich getrunken hat. Es fließt bewusst in keinen Trink-Eintrag: die
  // Getränke-Historie entsteht nur, wenn ein Mensch selbst etwas einträgt.
  const sips = choice.sips || {};
  if (sips.self) actor.sipsTaken = (actor.sipsTaken || 0) + sips.self;
  if (sips.target && target) target.sipsTaken = (target.sipsTaken || 0) + sips.target;
  if (sips.all) {
    for (const p of state.players) p.sipsTaken = (p.sipsTaken || 0) + sips.all;
  }

  // ── Effekte ─────────────────────────────────────────────────────────────
  for (const effect of choice.effects || []) {
    if (typeof effect.points === "number") {
      actor.points = (actor.points || 0) + effect.points;
    }
    if (effect.variable) {
      const current = state.variables[effect.variable] || 0;
      const ceiling = (story.variables || {})[effect.variable];
      let next = current + (effect.delta || 0);
      next = Math.max(0, next);
      if (typeof ceiling === "number") next = Math.min(ceiling, next);
      state.variables[effect.variable] = next;
    }
  }

  return {
    outcomeText: choice.outcomeText || "",
    sips,
    targetPlayerId: target ? target.id : null,
  };
}

/** Ermittelt den Spieler mit den meisten Stimmen. Gleichstand: der Erste. */
function topVoted(players, votes) {
  const counts = {};
  for (const targetId of Object.values(votes || {})) {
    if (targetId) counts[targetId] = (counts[targetId] || 0) + 1;
  }
  let bestId = "";
  let best = 0;
  for (const [id, count] of Object.entries(counts)) {
    if (count > best) {
      best = count;
      bestId = id;
    }
  }
  return players.find((p) => p.id === bestId) || null;
}

/**
 * Wertet das Finale aus: Wurde der Verräter gewählt, hat das Team gewonnen.
 * Bei Co-Op-Settings kann eine Variable (Team-HP auf 0) vorher alles kippen.
 */
function evaluateFinale(story, players, votes, variables) {
  const finale = story.finale || {};
  const traitor = players.find((p) => p.role === finale.traitorRole) || null;
  const condemned = topVoted(players, votes);

  let key = "escaped";
  const wipe = finale.teamWipe;
  if (wipe && (variables[wipe.variable] || 0) <= wipe.atMost) {
    key = "wipe";
  } else if (traitor && condemned && traitor.id === condemned.id) {
    key = "caught";
  }

  const outcome = (finale.outcomes || {})[key];
  if (!outcome) {
    return {
      outcomeKey: key,
      winnerTeam: "Unentschieden",
      title: "Das Spiel endet",
      summary: "Für diesen Ausgang ist keine Auflösung hinterlegt.",
      drinkPenalties: [],
    };
  }

  const ctx = {
    players,
    traitor: traitor ? traitor.name : "Der Verräter",
    condemned: condemned ? condemned.name : "Niemand",
    variables,
  };

  const drinkPenalties = [];
  for (const penalty of outcome.penalties || []) {
    let targets = [];
    switch (penalty.who) {
      case "traitor":
        targets = traitor ? [traitor] : [];
        break;
      case "condemned":
        targets = condemned ? [condemned] : [];
        break;
      case "all":
        targets = players;
        break;
      case "others":
        targets = players.filter(
          (p) => p.id !== (traitor && traitor.id) && p.id !== (condemned && condemned.id)
        );
        break;
      default:
        targets = [];
    }
    for (const t of targets) {
      drinkPenalties.push({
        playerName: t.name,
        sips: penalty.sips,
        reason: penalty.reason,
      });
    }
  }

  return {
    outcomeKey: key,
    winnerTeam: outcome.winnerTeam,
    title: outcome.title,
    summary: renderTemplate(outcome.summary, ctx),
    drinkPenalties,
  };
}

module.exports = {
  hasStory,
  getStory,
  listStories,
  assignRoles,
  buildChapter,
  chapterAt,
  isLastChapter,
  initialVariables,
  applyChoice,
  evaluateFinale,
  // Für Tests
  _renderTemplate: renderTemplate,
  _shuffle: shuffle,
};
