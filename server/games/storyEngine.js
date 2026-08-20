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
      // Zwei Formate: die festen Drei-Akt-Spiele über `chapters`, und der
      // Storylet-Pool über `storylets` + `structure`.
      const hatKapitel = Array.isArray(story.chapters) && story.chapters.length > 0;
      const hatStorylets =
        story.format === "storylets" &&
        Array.isArray(story.storylets) &&
        story.storylets.length > 0 &&
        story.structure &&
        Array.isArray(story.structure.acts);
      if (!story.id || (!hatKapitel && !hatStorylets)) {
        console.error(`[StoryEngine] ${file} hat keine id oder keine spielbaren Szenen — übersprungen.`);
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
    chapterCount: Array.isArray(s.chapters)
      ? s.chapters.length
      : s.structure && Array.isArray(s.structure.acts)
        ? s.structure.acts.reduce((sum, a) => sum + (a.count || 0), 0)
        : 0,
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
      case "other":
        value = ctx.other || null;
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
      // Rückgriff auf das Sitzungsgedächtnis: der Name der Person, die
      // zuletzt etwas dieser Art getan hat.
      case "memory": {
        const treffer = (ctx.memory || []).filter((m) => m.kind === arg);
        value = treffer.length ? treffer[treffer.length - 1].playerName : null;
        break;
      }
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

  attachObservations(story, assignments, order);
  return assignments;
}

/**
 * Verteilt die Beobachtungen — für jede Person ein anderer Ausschnitt der
 * Wahrheit.
 *
 * Genau EINE Person hat wirklich etwas gesehen und kann es nicht beweisen.
 * Alle anderen haben etwas Belangloses beobachtet, das sich nach einem Hinweis
 * anfühlt. Daraus entsteht die Diskussion: der Zeuge muss überzeugen, der
 * Täter muss ihn unglaubwürdig machen, und der Rest muss entscheiden, wem er
 * glaubt. Ohne diese Asymmetrie ist eine Abstimmung nur Bauchgefühl.
 */
function attachObservations(story, assignments, order) {
  const pinholes = story.pinholes;
  if (!pinholes) return;

  const traitorRole = story.finale && story.finale.traitorRole;
  const traitor = assignments.find((a) => a.role === traitorRole);
  const unschuldige = assignments.filter((a) => a.playerId !== (traitor && traitor.playerId));
  if (unschuldige.length === 0) return;

  const nameOf = (playerId) => {
    const p = order.find((x) => x.id === playerId);
    return p ? p.name : "jemand";
  };

  // Der Zeuge.
  const zeuge = unschuldige[crypto.randomInt(unschuldige.length)];
  zeuge.observation = renderTemplate(pinholes.witness, {
    players: order,
    traitor: traitor ? nameOf(traitor.playerId) : "die richtige Person",
  });

  // Der Täter weiß, dass jemand etwas gesehen haben könnte.
  if (traitor && pinholes.traitor) {
    traitor.observation = renderTemplate(pinholes.traitor, { players: order });
  }

  // Alle übrigen: harmlose Beobachtungen über eine andere Person.
  const rauschen = pinholes.noise || [];
  for (const a of unschuldige) {
    if (a.observation || rauschen.length === 0) continue;
    const andere = assignments.filter((x) => x.playerId !== a.playerId);
    const ziel = andere[crypto.randomInt(andere.length)];
    a.observation = renderTemplate(rauschen[crypto.randomInt(rauschen.length)], {
      players: order,
      other: nameOf(ziel.playerId),
    });
  }
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

// ─── Phasen und ihre Fristen ────────────────────────────────────────────────
//
// Jedes Kapitel läuft in Phasen mit einer absoluten Frist. Das ist der Ersatz
// für den früheren "Nächstes Kapitel"-Knopf des Hosts, bei dem alle anderen
// nur "Warte auf die Entscheidung des Hosts..." sahen — passives Warten ist
// die Hauptabbruchursache in einer angetrunkenen Runde.
//
// Sekunden, nicht Millisekunden: die Werte stehen so auch in den Story-JSONs.
const DEFAULT_DEADLINE_SEC = {
  choice: 60,
  // Kurz halten. Die Auflösung ist der Moment, auf den alle warten — aber
  // nach 15 Sekunden Vorlesen redet die Gruppe ohnehin weiter.
  reveal: 15,
  vote: 75,
  // Reine Redezeit ohne Eingabe. Lang genug für eine echte Runde
  // Verdächtigungen, kurz genug, dass sie nicht versandet.
  discussion: 90,
};

/** Welche Phase eine Szene eröffnet: Auswahl, Diskussion, Abstimmung, Text. */
function openingPhaseKind(scene) {
  if (!scene) return null;
  if (scene.prompt) return "choice";
  if (scene.discussion) return "discussion";
  if (scene.voting) return "vote";
  return "reveal";
}

// Setzt ALLE Fristen auf diesen Wert. Gedacht für die Testsuite, die sonst
// eine Minute warten müsste, um einen Fristablauf zu prüfen. Im Betrieb nicht
// gesetzt — und wenn doch, ist es ein bewusster Eingriff.
const DEADLINE_OVERRIDE_SEC = Number(process.env.TRINKDUELL_PHASE_SEC) || 0;

function deadlineSecFor(scene, kind) {
  if (DEADLINE_OVERRIDE_SEC > 0) return DEADLINE_OVERRIDE_SEC;
  // Eine Diskussionsszene bringt ihre Redezeit selbst mit.
  if (kind === "discussion" && scene && scene.discussion && scene.discussion.seconds) {
    return scene.discussion.seconds;
  }
  const fromScene = scene && scene.deadlineSec && scene.deadlineSec[kind];
  return fromScene || DEFAULT_DEADLINE_SEC[kind] || 60;
}

function chapterAt(story, index) {
  return story.chapters[index] || null;
}

function isLastChapter(story, index) {
  return index >= story.chapters.length - 1;
}

// ─── Storylets ───────────────────────────────────────────────────────────────
//
// Das zweite Story-Format. Statt einer festen Kapitelfolge liegt ein Pool von
// Szenen bereit, die Bedingungen an den Spielzustand stellen. Der Server zieht
// pro Schritt eine passende — dadurch verläuft dieselbe Story zweimal anders,
// ohne dass ein Erzählbaum geschrieben werden muss, dessen Äste sich mit jeder
// Entscheidung verdoppeln.
//
// Getragen wird das von Variablen (hinweise, verdacht, panik …), die die
// Entscheidungen der Gruppe hochzählen. Eine Szene, die `hinweise >= 4`
// verlangt, taucht nur auf, wenn wirklich ermittelt wurde. Das Muster stammt
// aus Quality-Based-Narrative-Systemen.
//
// Die alten Drei-Akt-Spiele laufen unverändert über `chapters` weiter.

function isStoryletFormat(story) {
  return !!story && story.format === "storylets" && Array.isArray(story.storylets);
}

/** Eine einzelne Bedingung gegen Variablen, Akt oder Spielerzahl. */
function conditionHolds(cond, ctx) {
  if (!cond) return true;
  if (cond.act !== undefined && ctx.act !== cond.act) return false;
  if (cond.minPlayers !== undefined && ctx.playerCount < cond.minPlayers) return false;
  if (cond.var !== undefined) {
    const value = ctx.variables[cond.var] || 0;
    if (cond.atLeast !== undefined && value < cond.atLeast) return false;
    if (cond.atMost !== undefined && value > cond.atMost) return false;
    if (cond.equals !== undefined && value !== cond.equals) return false;
  }
  // Eine Rolle muss noch im Spiel sein, damit ihre Szene erscheint.
  if (cond.roleAlive !== undefined && !ctx.aliveRoles.includes(cond.roleAlive)) return false;
  return true;
}

function conditionsHold(requires, ctx) {
  if (!Array.isArray(requires) || requires.length === 0) return true;
  return requires.every((c) => conditionHolds(c, ctx));
}

function actConfig(story, act) {
  const acts = (story.structure && story.structure.acts) || [];
  return acts.find((a) => a.act === act) || null;
}

function lastAct(story) {
  const acts = (story.structure && story.structure.acts) || [];
  return acts.length ? acts[acts.length - 1].act : 1;
}

/**
 * Wählt die nächste Szene für den aktuellen Akt.
 *
 * Reihenfolge: eine als `opening` markierte Szene kommt immer zuerst, eine
 * `closing` immer zuletzt. Dazwischen entscheidet gewichteter Zufall unter
 * allen Szenen, deren Bedingungen erfüllt sind.
 */
function pickStorylet(story, ctx) {
  const passend = story.storylets.filter((s) => {
    if (s.act !== ctx.act) return false;
    if (s.once && ctx.used.includes(s.id)) return false;
    return conditionsHold(s.requires, ctx);
  });
  if (passend.length === 0) return null;

  const cfg = actConfig(story, ctx.act);
  const gespielt = ctx.playedInAct;
  const gesamt = cfg ? cfg.count : passend.length;

  if (gespielt === 0) {
    const opener = passend.find((s) => s.opening);
    if (opener) return opener;
  }
  if (gespielt >= gesamt - 1) {
    const closer = passend.find((s) => s.closing);
    if (closer) return closer;
  }

  // Opening/Closing sonst nicht mitten im Akt ziehen.
  const mitte = passend.filter((s) => !s.opening && !s.closing);
  const pool = mitte.length > 0 ? mitte : passend;

  const gesamtGewicht = pool.reduce((sum, s) => sum + (s.weight || 1), 0);
  let wurf = crypto.randomInt(Math.max(1, gesamtGewicht));
  for (const s of pool) {
    wurf -= s.weight || 1;
    if (wurf < 0) return s;
  }
  return pool[pool.length - 1];
}

/** Ist der Akt durchgespielt? */
function actExhausted(story, act, playedInAct) {
  const cfg = actConfig(story, act);
  return playedInAct >= (cfg ? cfg.count : 0);
}

/**
 * Baut eine Szene in der Fassung, die alle Clients sehen — dieselbe Form wie
 * buildChapter, damit die Oberfläche beide Formate ohne Unterscheidung
 * darstellen kann.
 */
function buildStorylet(story, storylet, players, act, ctx = {}) {
  if (!storylet) return null;
  const cfg = actConfig(story, act);

  return {
    id: storylet.id,
    act,
    index: 0,
    title: storylet.title || (cfg ? cfg.title : ""),
    atmosphereHint: storylet.atmosphereHint || (cfg ? cfg.atmosphereHint : null) || null,
    text: renderTemplate(storylet.textTemplate, {
      players,
      picks: storylet.picks,
      variables: ctx.variables,
      memory: ctx.memory,
    }),
    prompt: storylet.prompt
      ? {
          title: storylet.prompt.title,
          description: storylet.prompt.description,
          // Rollenszenen: nur diese Rolle darf wählen, alle anderen sehen zu
          // und reden. Das ist die Asymmetrie, die Diskussionen erzeugt.
          forRole: storylet.prompt.forRole || null,
          choices: storylet.prompt.choices.map((c) => ({
            id: c.id,
            label: c.label,
            targetRequired: !!c.targetRequired,
          })),
        }
      : null,
    discussion: storylet.discussion || null,
    voting: storylet.voting || null,
  };
}

function storyletById(story, id) {
  return story.storylets.find((s) => s.id === id) || null;
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
function applyChoice(story, scene, state, actingPlayerId, choiceId, targetPlayerId) {
  if (!scene || !scene.prompt) {
    throw new Error("NO_PROMPT_IN_CHAPTER");
  }

  const choice = scene.prompt.choices.find((c) => c.id === choiceId);
  if (!choice) {
    throw new Error("UNKNOWN_CHOICE");
  }

  const actor = state.players.find((p) => p.id === actingPlayerId);
  if (!actor) {
    throw new Error("PLAYER_NOT_IN_ROOM");
  }

  // Rollenszene: nur die genannte Rolle darf handeln. Ohne diese Pruefung
  // waere die Asymmetrie nur Behauptung.
  if (scene.prompt.forRole && actor.role !== scene.prompt.forRole) {
    throw new Error("NOT_YOUR_SCENE");
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
      // Obergrenze NUR, wenn die Story eine nennt. Sie aus dem Startwert
      // abzuleiten wäre falsch: `healthPoints: 100` ist ein Maximum,
      // `hinweise: 0` ist ein Zähler — der wäre damit für immer bei 0
      // festgenagelt.
      const ceiling = (story.variableLimits || {})[effect.variable];
      let next = current + (effect.delta || 0);
      next = Math.max(0, next);
      if (typeof ceiling === "number") next = Math.min(ceiling, next);
      state.variables[effect.variable] = next;
    }
    // Sitzungsgedaechtnis: was hier landet, kann eine spaetere Szene per
    // {{memory:kind}} wieder aufgreifen. Daraus entstehen die Rueckgriffe,
    // die eine Runde zu IHRER Runde machen.
    if (effect.remember && state.memory) {
      state.memory.push({
        kind: effect.remember,
        playerId: actor.id,
        playerName: actor.name,
        targetName: target ? target.name : null,
        at: Date.now(),
      });
    }
    // Ausscheiden. Der Spieler bleibt im Raum und wird zum Geist — wer das
    // Handy weglegt, zieht die halbe Gruppe mit raus.
    if (effect.eliminate) {
      const opfer = effect.eliminate === "target" ? target : actor;
      if (opfer) opfer.eliminated = true;
    }
  }

  return {
    outcomeText: choice.outcomeText || "",
    sips,
    targetPlayerId: target ? target.id : null,
  };
}

/**
 * Ermittelt den Spieler mit den meisten Stimmen. Gleichstand: der Erste.
 *
 * Geister stimmen mit halbem Gewicht. Sie sollen Einfluss behalten — sonst
 * legen sie das Handy weg und ziehen die Gruppe mit raus —, aber die Runde
 * nicht gegen die Lebenden entscheiden können.
 */
function topVoted(players, votes) {
  const counts = {};
  const gewicht = {};
  for (const p of players) gewicht[p.id] = p.eliminated ? 0.5 : 1;

  for (const [voterId, targetId] of Object.entries(votes || {})) {
    if (targetId) {
      counts[targetId] = (counts[targetId] || 0) + (gewicht[voterId] ?? 1);
    }
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
  openingPhaseKind,
  deadlineSecFor,
  isLastChapter,
  // Storylet-Format
  isStoryletFormat,
  pickStorylet,
  buildStorylet,
  storyletById,
  actExhausted,
  actConfig,
  lastAct,
  initialVariables,
  applyChoice,
  evaluateFinale,
  // Für Tests
  _renderTemplate: renderTemplate,
  _shuffle: shuffle,
};
