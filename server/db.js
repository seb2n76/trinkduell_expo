const fs = require("fs").promises;
const path = require("path");
const { Pool } = require("pg");

// Overridable so the test suite can point at a throwaway database instead of
// the real server/db.json, which holds live user data (emails, password
// hashes) and must never be touched by a test run.
const DB_FILE = process.env.TRINKDUELL_DB_FILE || path.join(__dirname, "db.json");

// Default Drinks Catalog (used as fallback for JSON mode auto-heal)
// Zwei Einträge stehen hier mit `hidden: true`: sie sind Dubletten aus dem
// Zusammenlegen vom 18.08.2026, als die im Client hartkodierten Getränke
// hierher wanderten und zwei davon schon unter anderem Namen existierten.
//
// „Helles Bier“ ist dasselbe wie „Helles“, „Pils 0,33“ dasselbe wie „Pils“.
// Sichtbar bleibt jeweils der Name, der zum Schema der übrigen Biere passt
// (Export, Weizen, Helles — ohne Menge im Namen); „Helles“ steht zudem in
// DEFAULT_QUICK_PICKS und darf schon deshalb nicht verschwinden.
//
// GELÖSCHT werden sie NICHT: drink_logs hängt per ON DELETE CASCADE daran,
// ein DELETE nähme die Trink-Einträge aller Nutzer mit.

const DEFAULT_DRINKS = [
  { id: "drink-beer-500", name: "Helles Bier", category: "Bier", volume: 500, abv: 5.0, calories: 215, hidden: true },
  { id: "drink-beer-330", name: "Pils", category: "Bier", volume: 330, abv: 4.9, calories: 140 },
  { id: "drink-shot", name: "Schnaps-Shot", category: "Schnaps", volume: 20, abv: 40.0, calories: 50 },
  { id: "drink-wine-red", name: "Rotwein", category: "Wein", volume: 150, abv: 12.5, calories: 125 },
  { id: "drink-sekt", name: "Sekt", category: "Sekt", volume: 100, abv: 11.5, calories: 85 },
  { id: "drink-aperol", name: "Aperol Spritz", category: "Mischgetränk", volume: 200, abv: 11.0, calories: 180 },
  { id: "drink-cola", name: "Fritz-Kola", category: "Alkoholfrei", volume: 330, abv: 0.0, calories: 139 },
  { id: "drink-sip-beer", name: "Schluck Bier", category: "Bier", volume: 30, abv: 5.0, calories: 13 },
  { id: "drink-sip-wine", name: "Schluck Wein/Sekt", category: "Wein", volume: 20, abv: 12.0, calories: 16 },
  { id: "drink-sip-mix", name: "Schluck Mischgetränk", category: "Mischgetränk", volume: 30, abv: 10.0, calories: 20 },
  { id: "drink-sip-water", name: "Zwischenwasser", category: "Alkoholfrei", volume: 30, abv: 0.0, calories: 0 },
  // Diese 14 standen bis 17.08.2026 fest verdrahtet im Dashboard
  // (src/app/(tabs)/index.tsx) und wurden dort clientseitig zugemischt — in
  // zwei getrennten Kopien, von denen eine keine Kategorien hatte. Der
  // Katalog gehört an EINE Stelle, sonst weiß niemand, was es wirklich gibt.
  { id: "drink-beer-helles", name: "Helles", category: "Bier", volume: 500, abv: 4.9, calories: 215 },
  { id: "drink-beer-pils", name: "Pils 0,33", category: "Bier", volume: 330, abv: 4.8, calories: 140, hidden: true },
  { id: "drink-beer-export", name: "Export", category: "Bier", volume: 500, abv: 5.2, calories: 225 },
  { id: "drink-beer-weizen", name: "Weizen", category: "Bier", volume: 500, abv: 5.4, calories: 240 },
  { id: "drink-wine-white", name: "Weißwein", category: "Wein", volume: 200, abv: 12.0, calories: 160 },
  { id: "drink-wine-red-200", name: "Rotwein 0,2", category: "Wein", volume: 200, abv: 13.0, calories: 170 },
  { id: "drink-wine-schoerle", name: "Weinschorle", category: "Wein", volume: 250, abv: 6.0, calories: 110 },
  { id: "drink-sekt-prosecco", name: "Prosecco", category: "Sekt", volume: 100, abv: 11.0, calories: 80 },
  { id: "drink-cocktail-aperol", name: "Aperol Spritz 0,3", category: "Mischgetränk", volume: 300, abv: 11.0, calories: 270 },
  { id: "drink-cocktail-gin", name: "Gin Tonic", category: "Mischgetränk", volume: 300, abv: 12.0, calories: 290 },
  { id: "drink-cocktail-wodka", name: "Wodka Energy", category: "Mischgetränk", volume: 300, abv: 10.0, calories: 300 },
  { id: "drink-cocktail-mojito", name: "Mojito", category: "Mischgetränk", volume: 300, abv: 12.0, calories: 320 },
  { id: "drink-water-glass", name: "Wasser", category: "Alkoholfrei", volume: 400, abv: 0.0, calories: 0 },
  { id: "drink-water-soft", name: "Softdrink", category: "Alkoholfrei", volume: 330, abv: 0.0, calories: 140 },
];

// Startbelegung der drei Schnellwahl-Slots. Bewusst je ein Getränk aus drei
// der vier Kategorien: so ist beim ersten Start jeder Reiter schon einmal
// vertreten, und Wasser steht direkt bereit — der Kater-Schutz hängt daran.
// Cocktails fehlen absichtlich, die sind einen Reiter entfernt.
const DEFAULT_QUICK_PICKS = [
  "drink-beer-helles",
  "drink-wine-white",
  "drink-water-glass",
];

const calculateAlcoholGrams = (volumeMl, abv) => {
  return volumeMl * (abv / 100) * 0.789;
};

const getCumulativeXpForLevel = (level) => {
  let total = 0;
  for (let l = 1; l < level; l++) {
    total += Math.floor(Math.pow(l, 1.5) * 100);
  }
  return total;
};

const getUserProgress = (points, level) => {
  const currentLevel = level || 1;
  const startXp = getCumulativeXpForLevel(currentLevel);
  const nextXp = Math.floor(Math.pow(currentLevel, 1.5) * 100);
  const endXp = startXp + nextXp;

  const isLocked = points >= endXp;
  const xpProgressInCurrentLevel = isLocked ? (nextXp - 1) : (points - startXp);

  return {
    currentLevel,
    xpForNextLevel: nextXp,
    xpProgressInCurrentLevel: Math.max(0, xpProgressInCurrentLevel),
    isLocked
  };
};

// Recalculates points, rank, achievements, and title for a user
async function recalculateUserStats(user, logs, drinks, groups) {
  const userLogs = logs.filter((l) => l.userId === user.id);

  let totalAlcohol = 0;
  let beerCount = 0;
  const loggedCategories = new Set();
  const loggedDrinkIds = new Set();
  let hasAlcoholBeforeNoon = false;
  let hasDrinkBetween2and5 = false;

  for (const log of userLogs) {
    const drink = drinks.find((d) => d.id === log.drinkId);
    if (!drink) continue;

    const grams = calculateAlcoholGrams(drink.volume, drink.abv);
    totalAlcohol += grams;
    loggedCategories.add(drink.category);
    loggedDrinkIds.add(drink.id);

    if (drink.category === "Bier") {
      beerCount++;
    }

    const logTime = new Date(log.timestamp);
    const hour = logTime.getHours();

    if (hour >= 2 && hour < 5) {
      hasDrinkBetween2and5 = true;
    }

    if (drink.abv > 0 && hour >= 6 && hour < 12) {
      hasAlcoholBeforeNoon = true;
    }
  }

  const totalDrinksCount = userLogs.length;
  const totalPoints = totalDrinksCount * 10 + Math.round(totalAlcohol * 2);

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const monthlyLogsCount = userLogs.filter((log) => {
    const d = new Date(log.timestamp);
    return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
  }).length;

  let rank = "Unranked";
  if (monthlyLogsCount >= 100) rank = "Diamant";
  else if (monthlyLogsCount >= 75) rank = "Platin";
  else if (monthlyLogsCount >= 50) rank = "Gold";
  else if (monthlyLogsCount >= 25) rank = "Silber";
  else if (monthlyLogsCount >= 10) rank = "Bronze";

  const activeAchievements = [...user.achievements];
  const unlockAchievement = (id) => {
    if (!activeAchievements.some((a) => a.id === id)) {
      activeAchievements.push({
        id,
        unlockedAt: new Date().toISOString(),
      });
    }
  };

  if (totalDrinksCount >= 1) unlockAchievement("FIRST_DRINK");
  if (loggedCategories.size >= 3) unlockAchievement("SOMMELIER");
  if (hasDrinkBetween2and5) unlockAchievement("NACHTEULE");
  if (beerCount >= 5) unlockAchievement("BRAUMEISTER");
  if (beerCount >= 50) unlockAchievement("STAMMGAST");
  if (hasAlcoholBeforeNoon) unlockAchievement("FRUEHSCHOPPEN");
  if (loggedDrinkIds.size >= 10) unlockAchievement("SAMMLER");

  const isAdmin = groups.some((g) => g.adminId === user.id);
  if (isAdmin) unlockAchievement("ANFUEHRER");

  // Getränke-XP plus Spiel-XP. Die beiden Quellen MÜSSEN getrennt bleiben:
  // diese Funktion läuft bei praktisch jedem Nutzer-Abruf und setzt `points`
  // jedes Mal komplett neu. Alles, was direkt nach `points` geschrieben
  // würde, wäre beim nächsten Request spurlos weg — deshalb liegt der
  // Spiel-Anteil in einer eigenen Spalte und wird hier nur addiert.
  user.points = totalPoints + (user.gamePoints || 0);
  user.alcoholGrams = Number(totalAlcohol.toFixed(2));
  user.rank = rank;
  user.achievements = activeAchievements;

  // Level-Up Sperre & Pflichtaufgabe Check
  if (!user.level) user.level = 1;
  const startXp = getCumulativeXpForLevel(user.level);
  const nextXp = Math.floor(Math.pow(user.level, 1.5) * 100);
  const nextLevelThreshold = startXp + nextXp;

  if (user.points >= nextLevelThreshold) {
    user.points = nextLevelThreshold; // XP frieren am Limit des aktuellen Levels ein
    if (!user.active_quest) {
      const quests = [
        "Lade ein Bild mit Freunden hoch",
        "Küsse einen Mitspieler",
        "Trinke ein Zwischenwasser",
        "Finde jemanden, der mit dir anstößt",
        "Trinke ein alkoholfreies Getränk",
        "Mach ein Kompliment an einen Mitspieler"
      ];
      user.active_quest = quests[Math.floor(Math.random() * quests.length)];
    }
  }

  // Automatische Titel nach Level
  const getTitleForLevel = (lvl) => {
    if (lvl >= 100) return "Alki";
    if (lvl >= 10) return "Braumeister";
    if (lvl >= 2) return "Trink-Anfänger";
    return "Neuling";
  };

  user.title = getTitleForLevel(user.level);
  user.selected_title = user.title;

  return user;
}

// Master Database Object (for Local Fallback)
let db = null;

// PostgreSQL Pool (for Production/Proxmox)
let pool = null;
let pgInitialized = false;

if (process.env.DATABASE_URL) {
  console.log("[TrinkDuell DB] PostgreSQL connection URL detected. Initializing database pool...");
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: (process.env.DATABASE_URL.includes("localhost") || process.env.DATABASE_URL.includes("127.0.0.1") || process.env.DATABASE_URL.includes("@db:")) ? false : { rejectUnauthorized: false }
  });
}

/**
 * Bringt eine Datenbank auf den aktuellen Stand — frisch oder bestehend.
 *
 * Die Reihenfolge ist zwingend und der Grund, warum das hier so ausführlich
 * kommentiert ist:
 *
 *   1. schema.sql — legt Tabellen an (CREATE TABLE IF NOT EXISTS). Auf einer
 *      bestehenden Tabelle ist das ein No-op und fügt KEINE neuen Spalten
 *      hinzu. Läuft als ein einziger Query: eine fehlschlagende Anweisung
 *      reißt alles danach mit.
 *   2. ALTER TABLE — rüstet Spalten nach, die es in Schritt 1 nur für frische
 *      Datenbanken gibt.
 *   3. Indizes auf genau diesen Spalten — erst jetzt existieren sie sicher.
 *
 * Wer Schritt 3 nach schema.sql verlegt, baut eine Falle: der Index scheitert
 * auf bestehenden Datenbanken, nimmt die ALTER-Zeilen mit in den Abbruch, und
 * damit wird die Spalte, die er braucht, nie angelegt. Genau so ist
 * drinks.ean auf dem Produktionsserver gestrandet.
 */
async function initPgSchema() {
  try {
    // ── 1. Tabellen ─────────────────────────────────────────────────────────
    const sqlPath = path.join(__dirname, "schema.sql");
    const schemaSql = await fs.readFile(sqlPath, "utf8");
    await pool.query(schemaSql);

    // ── 2. Spalten nachrüsten ───────────────────────────────────────────────
    // Alter table to add level and active_quest dynamically if they don't exist
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS level INTEGER DEFAULT 1");
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS active_quest TEXT");
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_code TEXT");
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_code_expires_at TIMESTAMP WITH TIME ZONE");
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS push_token TEXT");
    // Number of wrong guesses against the current reset code. Without this a
    // short numeric code can simply be brute-forced.
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_code_attempts INTEGER DEFAULT 0");
    // Cut-off for still-valid JWTs. Tokens issued before this point are
    // rejected, so a password reset actually ends every other session
    // instead of leaving a 30-day token alive for whoever stole the account.
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS session_valid_after TIMESTAMP WITH TIME ZONE");
    // Owner of a user-created drink. NULL means "built-in catalog", which
    // nobody may delete. Existing rows become NULL, which is the safe default.
    await pool.query("ALTER TABLE drinks ADD COLUMN IF NOT EXISTS created_by TEXT");
    // Barcode (EAN-8/EAN-13) für den Community-Katalog.
    await pool.query("ALTER TABLE drinks ADD COLUMN IF NOT EXISTS ean TEXT");
    // Beweisfoto zu einem Beitrag. Fehlte im Postgres-Zweig komplett: der
    // JSON-Zweig speichert das ganze Objekt und behielt das Feld deshalb,
    // Postgres listet die Spalten einzeln auf und verwarf es stillschweigend.
    await pool.query("ALTER TABLE posts ADD COLUMN IF NOT EXISTS image TEXT");
    // Unterscheidet "noch nie eine Schnellwahl gesetzt" von "bewusst geleert".
    await pool.query(
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS quick_picks_set BOOLEAN NOT NULL DEFAULT FALSE"
    );
    // Einladungscode für den Gruppenbeitritt. Bestehende Gruppen bekommen ihn
    // erst, wenn ihr Admin ihn das erste Mal abruft (siehe
    // ensureGroupInviteCode in index.js) — deshalb NULL als Ausgangswert und
    // ein partieller Index weiter unten.
    await pool.query("ALTER TABLE groups ADD COLUMN IF NOT EXISTS invite_code TEXT");
    // Ausgeblendete Getränke. Kein Index: die Tabelle ist klein, und ein
    // Index auf einem Boolean mit fast nur FALSE bringt nichts.
    await pool.query("ALTER TABLE drinks ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT FALSE");
    // Gesperrte Accounts (Moderation)
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS banned BOOLEAN NOT NULL DEFAULT FALSE");
    // XP aus Trinkspielen — getrennt von `points`, weil recalculateUserStats()
    // `points` bei jedem Aufruf komplett aus den Getränke-Logs neu berechnet.
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS game_points INTEGER NOT NULL DEFAULT 0");

    // ── 3. Indizes auf nachgerüsteten Spalten ───────────────────────────────
    // Partiell, weil die meisten Getränke keinen Barcode haben — und unique,
    // weil zwei Produkte sich niemals einen teilen dürfen.
    await pool.query(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_drinks_ean ON drinks(ean) WHERE ean IS NOT NULL"
    );

    // Ebenfalls partiell und unique: zwei Gruppen dürfen sich keinen Code
    // teilen, aber Gruppen ohne Code (noch nie abgerufen) sind normal.
    await pool.query(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_groups_invite_code ON groups(invite_code) WHERE invite_code IS NOT NULL"
    );

    // blocks/reports are created by schema.sql above on a fresh database; the
    // CREATE TABLE IF NOT EXISTS there also covers an existing one.

    // ── 4. Standard-Katalog nachtragen ──────────────────────────────────────
    // Postgres hat kein Gegenstück zum Auto-Heal des JSON-Modus: Getränke
    // entstehen dort nur über saveDrink(). Ohne diesen Schritt fehlen einer
    // bestehenden Datenbank alle Einträge, die nach ihrer Erstellung zum
    // Standard dazugekommen sind — inklusive derer, auf die die
    // Standard-Schnellwahl zeigt.
    //
    // ON CONFLICT DO NOTHING: vorhandene Einträge bleiben unangetastet, auch
    // wenn jemand Namen oder Menge angepasst hat.
    for (const drink of DEFAULT_DRINKS) {
      await pool.query(
        `INSERT INTO drinks (id, name, category, volume, abv, calories)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO NOTHING`,
        [drink.id, drink.name, drink.category, drink.volume, drink.abv, drink.calories]
      );
    }

    console.log("[TrinkDuell DB] PostgreSQL schema initialized successfully.");
    return true;
  } catch (err) {
    // Bewusst laut: ein halb initialisiertes Schema ist der unangenehmste
    // Zustand überhaupt — der Server läuft, antwortet, und fällt erst bei der
    // ersten Abfrage der fehlenden Spalte um. Der Hinweis nennt deshalb
    // gleich die Handlungsanweisung.
    console.error(
      "[TrinkDuell DB] ============================================================\n" +
        "[TrinkDuell DB] SCHEMA-INITIALISIERUNG FEHLGESCHLAGEN — der Server läuft mit\n" +
        "[TrinkDuell DB] einem möglicherweise unvollständigen Schema weiter.\n" +
        "[TrinkDuell DB] Ursache:",
      err.message
    );
    console.error(
      "[TrinkDuell DB] Häufigster Grund: ein Index in schema.sql zeigt auf eine Spalte,\n" +
        "[TrinkDuell DB] die erst per ALTER TABLE entsteht. Siehe Kommentar über initPgSchema().\n" +
        "[TrinkDuell DB] ============================================================"
    );
    return false;
  }
}

async function loadDb() {
  if (pool) {
    if (!pgInitialized) {
      // Erst bei Erfolg merken. Vorher wurde das Flag VOR dem await gesetzt —
      // ein einmaliger Fehlschlag (auch ein kurzer Verbindungsabbruch beim
      // Start) bedeutete damit, dass die Initialisierung nie wieder versucht
      // wurde und der Server dauerhaft mit kaputtem Schema weiterlief.
      pgInitialized = await initPgSchema();
    }
    return null;
  }

  if (db) return db;
  try {
    const data = await fs.readFile(DB_FILE, "utf-8");
    db = JSON.parse(data);
    // Auto-heal collections added after a database file was first written.
    let healed = false;
  for (const key of ["friendships", "blocks", "reports", "userDrinks", "conversationReads", "gameRooms", "gameSettlements"]) {
      if (!db[key]) {
        db[key] = [];
        healed = true;
      }
    }
    if (healed) await saveDb();
  } catch (err) {
    // If db.json does not exist yet, start with an empty but valid structure
    db = {
      users: [],
      drinks: DEFAULT_DRINKS,
      logs: [],
      groups: [],
      events: [],
      posts: [],
      duels: [],
      groupQuests: [],
      friendships: [],
      messages: [],
      userDrinks: [],
      conversationReads: [],
      blocks: [],
      reports: [],
      gameRooms: [],
      gameSettlements: []
    };
    await saveDb();
  }
  return db;
}

async function saveDb() {
  if (pool || !db) return;
  await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2), "utf-8");
}

module.exports = {
  getUsers: async () => {
    await loadDb();
    if (pool) {
      const res = await pool.query("SELECT * FROM users");
      return res.rows.map(row => ({
        id: row.id,
        name: row.name,
        avatar: row.avatar,
        title: row.title,
        rank: row.rank,
        points: row.points,
        alcoholGrams: Number(row.alcohol_grams),
        achievements: Array.isArray(row.achievements) ? row.achievements : (typeof row.achievements === 'string' ? JSON.parse(row.achievements) : []),
        email: row.email,
        password: row.password,
        selected_title: row.selected_title,
        level: row.level !== undefined && row.level !== null ? row.level : 1,
        active_quest: row.active_quest || null,
        banned: Boolean(row.banned),
        gamePoints: row.game_points || 0,
        // Needed by authenticate() to reject tokens from before a password
        // reset. Stripped again in enrichUserProgress before any response.
        sessionValidAfter: row.session_valid_after
          ? new Date(row.session_valid_after).toISOString()
          : null
      }));
    }
    // Mirror the Postgres branch above: only return the intentional public
    // shape, never resetCode/resetCodeExpiresAt (those live only behind the
    // dedicated setPasswordResetCode/verifyPasswordResetCode functions).
    return db.users.map((u) => ({
      id: u.id,
      name: u.name,
      avatar: u.avatar,
      title: u.title,
      rank: u.rank,
      points: u.points,
      alcoholGrams: u.alcoholGrams,
      achievements: u.achievements,
      email: u.email,
      password: u.password,
      selected_title: u.selected_title,
      level: u.level || 1,
      active_quest: u.active_quest || null,
      banned: Boolean(u.banned),
      gamePoints: u.gamePoints || 0,
      sessionValidAfter: u.sessionValidAfter || null
    }));
  },
  saveUser: async (user) => {
    await loadDb();
    if (pool) {
      await pool.query(
        `INSERT INTO users (id, name, avatar, title, rank, points, alcohol_grams, achievements, email, password, selected_title, level, active_quest, banned)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (id) DO UPDATE SET
           name = $2, avatar = $3, title = $4, rank = $5, points = $6, alcohol_grams = $7, achievements = $8, email = $9, password = $10, selected_title = $11, level = $12, active_quest = $13, banned = $14`,
        [user.id, user.name, user.avatar, user.title, user.rank, user.points, user.alcoholGrams, JSON.stringify(user.achievements), user.email, user.password, user.selected_title, user.level || 1, user.active_quest || null, Boolean(user.banned)]
      );
      return;
    }
    const idx = db.users.findIndex((u) => u.id === user.id);
    if (idx !== -1) {
      // Merge rather than replace: getUsers() deliberately omits
      // resetCode/resetCodeExpiresAt (see setPasswordResetCode etc.), and a
      // plain replace here would silently wipe a pending reset code on any
      // unrelated save — mirrors how the Postgres UPDATE above only ever
      // touches the columns it explicitly lists.
      db.users[idx] = { ...db.users[idx], ...user, banned: Boolean(user.banned) };
    } else {
      db.users.push({ ...user, banned: Boolean(user.banned) });
    }
    await saveDb();
  },
  setUserBanned: async (userId, banned) => {
    await loadDb();
    if (pool) {
      await pool.query("UPDATE users SET banned = $1 WHERE id = $2", [Boolean(banned), userId]);
      return;
    }
    const user = (db.users || []).find((u) => u.id === userId);
    if (user) {
      user.banned = Boolean(banned);
      await saveDb();
    }
  },
  resetUserStats: async (userId) => {
    await loadDb();
    if (pool) {
      await pool.query(
        "UPDATE users SET points = 0, alcohol_grams = 0, level = 1, rank = 'Neuling', title = 'Neuling', selected_title = 'Neuling', achievements = '[]'::jsonb WHERE id = $1",
        [userId]
      );
      await pool.query("DELETE FROM drink_logs WHERE user_id = $1", [userId]);
      return;
    }
    const user = (db.users || []).find((u) => u.id === userId);
    if (user) {
      user.points = 0;
      user.alcoholGrams = 0;
      user.level = 1;
      user.rank = "Neuling";
      user.title = "Neuling";
      user.selected_title = "Neuling";
      user.achievements = [];
      db.logs = (db.logs || []).filter((l) => l.userId !== userId);
      await saveDb();
    }
  },
  cleanUserProfile: async (userId, resetName) => {
    await loadDb();
    if (pool) {
      if (resetName) {
        await pool.query("UPDATE users SET name = $1, avatar = NULL WHERE id = $2", [resetName, userId]);
      } else {
        await pool.query("UPDATE users SET avatar = NULL WHERE id = $1", [userId]);
      }
      return;
    }
    const user = (db.users || []).find((u) => u.id === userId);
    if (user) {
      user.avatar = null;
      if (resetName) user.name = resetName;
      await saveDb();
    }
  },
  adminDeletePost: async (postId) => {
    await loadDb();
    if (pool) {
      const res = await pool.query('SELECT image, user_id AS "userId" FROM posts WHERE id = $1', [postId]);
      const post = res.rows[0];
      await pool.query("DELETE FROM posts WHERE id = $1", [postId]);
      return post || null;
    }
    const idx = (db.posts || []).findIndex((p) => p.id === postId);
    if (idx !== -1) {
      const post = db.posts[idx];
      db.posts.splice(idx, 1);
      await saveDb();
      return post;
    }
    return null;
  },
  adminUpdateDrink: async (drinkId, updates) => {
    await loadDb();
    if (pool) {
      const current = await pool.query("SELECT * FROM drinks WHERE id = $1", [drinkId]);
      if (current.rows.length === 0) return null;
      const row = current.rows[0];
      const name = updates.name !== undefined ? updates.name : row.name;
      const category = updates.category !== undefined ? updates.category : row.category;
      const volume = updates.volume !== undefined ? Number(updates.volume) : row.volume;
      const abv = updates.abv !== undefined ? Number(updates.abv) : row.abv;
      const calories = updates.calories !== undefined ? Number(updates.calories) : row.calories;
      const ean = updates.ean !== undefined ? updates.ean : row.ean;
      const hidden = updates.hidden !== undefined ? Boolean(updates.hidden) : Boolean(row.hidden);

      await pool.query(
        "UPDATE drinks SET name = $1, category = $2, volume = $3, abv = $4, calories = $5, ean = $6, hidden = $7 WHERE id = $8",
        [name, category, volume, abv, calories, ean, hidden, drinkId]
      );
      return { id: drinkId, name, category, volume, abv, calories, ean, hidden };
    }
    const drink = (db.drinks || []).find((d) => d.id === drinkId);
    if (!drink) return null;
    if (updates.name !== undefined) drink.name = updates.name;
    if (updates.category !== undefined) drink.category = updates.category;
    if (updates.volume !== undefined) drink.volume = Number(updates.volume);
    if (updates.abv !== undefined) drink.abv = Number(updates.abv);
    if (updates.calories !== undefined) drink.calories = Number(updates.calories);
    if (updates.ean !== undefined) drink.ean = updates.ean;
    if (updates.hidden !== undefined) drink.hidden = Boolean(updates.hidden);
    await saveDb();
    return drink;
  },
  getSystemStats: async () => {
    await loadDb();
    if (pool) {
      const [uRes, dRes, lRes, pRes, rRes, duelRes] = await Promise.all([
        pool.query("SELECT COUNT(*) AS count, COUNT(*) FILTER (WHERE banned = true) AS banned_count FROM users"),
        pool.query("SELECT COUNT(*) AS count FROM drinks"),
        pool.query("SELECT COUNT(*) AS count, COALESCE(SUM(volume_ml), 0) AS total_volume, COALESCE(SUM(alcohol_grams), 0) AS total_alcohol FROM drink_logs"),
        pool.query("SELECT COUNT(*) AS count FROM posts"),
        pool.query("SELECT COUNT(*) AS count, COUNT(*) FILTER (WHERE status = 'open') AS open_count FROM reports"),
        pool.query("SELECT COUNT(*) AS count, COUNT(*) FILTER (WHERE status = 'active') AS active_count FROM duels")
      ]);
      return {
        usersCount: Number(uRes.rows[0].count),
        bannedUsersCount: Number(uRes.rows[0].banned_count),
        drinksCount: Number(dRes.rows[0].count),
        logsCount: Number(lRes.rows[0].count),
        totalVolumeMl: Number(lRes.rows[0].total_volume),
        totalAlcoholGrams: Number(lRes.rows[0].total_alcohol),
        postsCount: Number(pRes.rows[0].count),
        reportsCount: Number(rRes.rows[0].count),
        openReportsCount: Number(rRes.rows[0].open_count),
        duelsCount: Number(duelRes.rows[0].count),
        activeDuelsCount: Number(duelRes.rows[0].active_count),
      };
    }
    const users = db.users || [];
    const logs = db.logs || [];
    const drinks = db.drinks || [];
    const posts = db.posts || [];
    const reports = db.reports || [];
    const duels = db.duels || [];

    let totalVolumeMl = 0;
    let totalAlcoholGrams = 0;
    const drinksById = new Map(drinks.map((d) => [d.id, d]));

    for (const log of logs) {
      const drink = drinksById.get(log.drinkId);
      if (drink) {
        totalVolumeMl += drink.volume || 0;
        totalAlcoholGrams += calculateAlcoholGrams(drink.volume, drink.abv) || 0;
      }
    }

    return {
      usersCount: users.length,
      bannedUsersCount: users.filter((u) => u.banned).length,
      drinksCount: drinks.length,
      logsCount: logs.length,
      totalVolumeMl: Math.round(totalVolumeMl),
      totalAlcoholGrams: Math.round(totalAlcoholGrams),
      postsCount: posts.length,
      reportsCount: reports.length,
      openReportsCount: reports.filter((r) => r.status === "open").length,
      duelsCount: duels.length,
      activeDuelsCount: duels.filter((d) => d.status === "active").length,
    };
  },
  // Permanently deletes a user and everything only they can see/own.
  // drink_logs, posts, duels, messages and admin'd groups/events cascade away
  // via FK ON DELETE CASCADE in Postgres. friendships (plain username text,
  // no FK) and membership in groups/events the user doesn't own are cleaned
  // up manually here so both DB modes behave the same way.
  deleteUser: async (userId) => {
    await loadDb();
    if (pool) {
      const userRes = await pool.query("SELECT name FROM users WHERE id = $1", [userId]);
      if (userRes.rows.length === 0) return;
      const username = userRes.rows[0].name;

      await pool.query(
        "DELETE FROM friendships WHERE LOWER(sender_username) = LOWER($1) OR LOWER(receiver_username) = LOWER($1)",
        [username]
      );

      const groups = await module.exports.getGroups();
      for (const g of groups) {
        if (g.adminId === userId) continue; // whole group cascades away with its admin
        const memberIds = g.memberIds.filter((id) => id !== userId);
        const pendingUserIds = g.pendingUserIds.filter((id) => id !== userId);
        if (memberIds.length !== g.memberIds.length || pendingUserIds.length !== g.pendingUserIds.length) {
          await pool.query(
            "UPDATE groups SET member_ids = $1, pending_user_ids = $2 WHERE id = $3",
            [JSON.stringify(memberIds), JSON.stringify(pendingUserIds), g.id]
          );
        }
      }

      const events = await module.exports.getEvents();
      for (const e of events) {
        if (e.creatorId === userId) continue; // whole event cascades away with its creator
        const memberIds = e.memberIds.filter((id) => id !== userId);
        if (memberIds.length !== e.memberIds.length) {
          await pool.query("UPDATE events SET member_ids = $1 WHERE id = $2", [JSON.stringify(memberIds), e.id]);
        }
      }

      await pool.query("DELETE FROM users WHERE id = $1", [userId]);
      return;
    }

    const user = db.users.find((u) => u.id === userId);
    if (!user) return;
    const username = user.name;

    db.friendships = (db.friendships || []).filter(
      (f) =>
        f.sender_username.toLowerCase() !== username.toLowerCase() &&
        f.receiver_username.toLowerCase() !== username.toLowerCase()
    );

    db.groups = db.groups.filter((g) => g.adminId !== userId);
    for (const g of db.groups) {
      g.memberIds = g.memberIds.filter((id) => id !== userId);
      g.pendingUserIds = g.pendingUserIds.filter((id) => id !== userId);
    }

    db.events = (db.events || []).filter((e) => e.creatorId !== userId);
    for (const e of db.events) {
      e.memberIds = e.memberIds.filter((id) => id !== userId);
    }

    db.logs = (db.logs || []).filter((l) => l.userId !== userId);
    db.posts = (db.posts || []).filter((p) => p.userId !== userId);
    db.duels = (db.duels || []).filter((d) => d.creatorId !== userId && d.opponentId !== userId);
    db.messages = (db.messages || []).filter((m) => m.sender_id !== userId && m.receiver_id !== userId);
    // Mirrors the FK cascade the Postgres branch gets for free.
    db.blocks = (db.blocks || []).filter((b) => b.blockerId !== userId && b.blockedId !== userId);
    db.userDrinks = (db.userDrinks || []).filter((e) => e.userId !== userId);
    // Reports survive their subject, but must not keep pointing at a gone id.
    for (const r of db.reports || []) {
      if (r.reporterId === userId) r.reporterId = null;
      if (r.reportedUserId === userId) r.reportedUserId = null;
    }

    db.users = db.users.filter((u) => u.id !== userId);

    await saveDb();
  },
  // Password-reset codes are stored directly on the user record and handled
  // through their own dedicated functions (not getUsers()/saveUser()) so a
  // reset code can never accidentally leak through the general user-fetching
  // pipeline into an API response, the way the password hash once did.
  setPasswordResetCode: async (userId, code, expiresAt) => {
    await loadDb();
    if (pool) {
      // Requesting a new code always resets the guess counter — otherwise a
      // user locked out by someone else's guessing could never recover.
      await pool.query(
        "UPDATE users SET reset_code = $1, reset_code_expires_at = $2, reset_code_attempts = 0 WHERE id = $3",
        [code, expiresAt, userId]
      );
      return;
    }
    const user = db.users.find((u) => u.id === userId);
    if (user) {
      user.resetCode = code;
      user.resetCodeExpiresAt = expiresAt;
      user.resetCodeAttempts = 0;
      await saveDb();
    }
  },
  /**
   * Checks a reset code and CONSUMES one attempt on failure. After
   * MAX_RESET_ATTEMPTS wrong guesses the code is discarded, so a short
   * numeric code cannot be enumerated.
   *
   * Returns { valid, reason } — never a bare boolean, because the caller has
   * to distinguish "wrong code" from "code burned" for the log.
   */
  verifyPasswordResetCode: async (userId, code) => {
    await loadDb();
    const MAX_RESET_ATTEMPTS = 5;

    if (pool) {
      const res = await pool.query(
        "SELECT reset_code, reset_code_expires_at, reset_code_attempts FROM users WHERE id = $1",
        [userId]
      );
      if (res.rows.length === 0) return { valid: false, reason: "no_code" };
      const row = res.rows[0];

      if (!row.reset_code) return { valid: false, reason: "no_code" };
      if (!row.reset_code_expires_at || new Date(row.reset_code_expires_at).getTime() < Date.now()) {
        return { valid: false, reason: "expired" };
      }
      if ((row.reset_code_attempts || 0) >= MAX_RESET_ATTEMPTS) {
        await pool.query(
          "UPDATE users SET reset_code = NULL, reset_code_expires_at = NULL WHERE id = $1",
          [userId]
        );
        return { valid: false, reason: "too_many_attempts" };
      }
      if (row.reset_code !== code) {
        await pool.query(
          "UPDATE users SET reset_code_attempts = COALESCE(reset_code_attempts, 0) + 1 WHERE id = $1",
          [userId]
        );
        return { valid: false, reason: "wrong_code" };
      }
      return { valid: true };
    }

    const user = db.users.find((u) => u.id === userId);
    if (!user || !user.resetCode) return { valid: false, reason: "no_code" };
    if (!user.resetCodeExpiresAt || new Date(user.resetCodeExpiresAt).getTime() < Date.now()) {
      return { valid: false, reason: "expired" };
    }
    if ((user.resetCodeAttempts || 0) >= MAX_RESET_ATTEMPTS) {
      user.resetCode = null;
      user.resetCodeExpiresAt = null;
      await saveDb();
      return { valid: false, reason: "too_many_attempts" };
    }
    if (user.resetCode !== code) {
      user.resetCodeAttempts = (user.resetCodeAttempts || 0) + 1;
      await saveDb();
      return { valid: false, reason: "wrong_code" };
    }
    return { valid: true };
  },
  setPasswordAndClearResetCode: async (userId, hashedPassword) => {
    await loadDb();
    // A password reset must also end every session that already exists —
    // otherwise "I got hacked, I changed my password" leaves the attacker's
    // 30-day token working. authenticate() compares the token's issue time
    // against this value.
    const validAfter = new Date().toISOString();

    if (pool) {
      await pool.query(
        `UPDATE users
            SET password = $1,
                reset_code = NULL,
                reset_code_expires_at = NULL,
                reset_code_attempts = 0,
                session_valid_after = $2
          WHERE id = $3`,
        [hashedPassword, validAfter, userId]
      );
      return;
    }
    const user = db.users.find((u) => u.id === userId);
    if (user) {
      user.password = hashedPassword;
      user.resetCode = null;
      user.resetCodeExpiresAt = null;
      user.resetCodeAttempts = 0;
      user.sessionValidAfter = validAfter;
      await saveDb();
    }
  },
  // Push tokens follow the same isolated-field pattern as the reset code:
  // kept out of getUsers()/saveUser() so they're never returned to other
  // users and never at risk of being wiped by an unrelated save.
  setPushToken: async (userId, token) => {
    await loadDb();
    if (pool) {
      await pool.query("UPDATE users SET push_token = $1 WHERE id = $2", [token, userId]);
      return;
    }
    const user = db.users.find((u) => u.id === userId);
    if (user) {
      user.pushToken = token;
      await saveDb();
    }
  },
  getPushToken: async (userId) => {
    await loadDb();
    if (pool) {
      const res = await pool.query("SELECT push_token FROM users WHERE id = $1", [userId]);
      return res.rows[0]?.push_token || null;
    }
    const user = db.users.find((u) => u.id === userId);
    return user?.pushToken || null;
  },
  getDrinks: async () => {
    await loadDb();
    if (pool) {
      const res = await pool.query("SELECT * FROM drinks");
      return res.rows.map(row => ({
        id: row.id,
        name: row.name,
        category: row.category,
        volume: row.volume,
        abv: Number(row.abv),
        calories: row.calories,
        // null for the built-in catalog — see the delete route in index.js
        createdBy: row.created_by || null,
        ean: row.ean || null,
        // Kommt bewusst MIT heraus statt gefiltert zu werden: der Client
        // braucht ausgeblendete Getränke weiterhin, um alte Log-Einträge
        // aufzulösen. Ausgeblendet wird erst in der Auswahl-Ansicht.
        hidden: row.hidden === true
      }));
    }
    
    // Fehlende Standard-Getränke nachtragen. Vorher galt das nur für die vier
    // "Schluck"-Einträge; seit der Katalog aus dem Client hierher gezogen ist,
    // muss die ganze Liste nachwachsen — sonst fehlen einer bestehenden
    // Datenbank genau die Getränke, auf die die Standard-Schnellwahl zeigt.
    let needsSave = false;
    for (const drink of DEFAULT_DRINKS) {
      if (!db.drinks.some((d) => d.id === drink.id)) {
        db.drinks.push({ ...drink });
        needsSave = true;
      }
    }
    if (needsSave) {
      await saveDb();
    }

    return db.drinks;
  },
  saveDrink: async (drink) => {
    await loadDb();
    if (pool) {
      // created_by and ean are set on insert only and deliberately absent from
      // the UPDATE list: ownership decides who may delete a drink, and a
      // barcode must not silently move to another product on a later save.
      await pool.query(
        `INSERT INTO drinks (id, name, category, volume, abv, calories, created_by, ean, hidden)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET
           name = $2, category = $3, volume = $4, abv = $5, calories = $6, hidden = $9`,
        [
          drink.id,
          drink.name,
          drink.category,
          drink.volume,
          drink.abv,
          drink.calories,
          drink.createdBy || null,
          drink.ean || null,
          drink.hidden === true,
        ]
      );
      return;
    }
    // Ersetzen statt anhängen, wie der Postgres-Zweig darueber (ON CONFLICT
    // DO UPDATE). Beide Aufrufstellen legen heute nur neue Getränke an, aber
    // die Zweige duerfen sich nicht unterschiedlich verhalten - genau daran
    // ist saveEvent aufgelaufen (18.08.2026).
    const idx = db.drinks.findIndex((e) => e.id === drink.id);
    if (idx !== -1) db.drinks[idx] = drink;
    else db.drinks.push(drink);
    await saveDb();
  },
  deleteDrink: async (drinkId) => {
    await loadDb();
    if (pool) {
      await pool.query("DELETE FROM drink_logs WHERE drink_id = $1", [drinkId]);
      await pool.query("DELETE FROM drinks WHERE id = $1", [drinkId]);
      await module.exports.recalculateAllUsers();
      return;
    }
    db.drinks = db.drinks.filter((d) => d.id !== drinkId);
    const logsCountBefore = db.logs.length;
    db.logs = db.logs.filter((l) => l.drinkId !== drinkId);
    if (logsCountBefore !== db.logs.length) {
      for (let u of db.users) {
        await recalculateUserStats(u, db.logs, db.drinks, db.groups);
      }
    }
    await saveDb();
  },
  getLogs: async () => {
    await loadDb();
    if (pool) {
      const res = await pool.query("SELECT id, user_id AS \"userId\", drink_id AS \"drinkId\", timestamp, latitude, longitude FROM drink_logs");
      return res.rows.map(row => ({
        id: row.id,
        userId: row.userId,
        drinkId: row.drinkId,
        timestamp: row.timestamp.toISOString ? row.timestamp.toISOString() : new Date(row.timestamp).toISOString(),
        latitude: row.latitude ? Number(row.latitude) : null,
        longitude: row.longitude ? Number(row.longitude) : null
      }));
    }
    return db.logs;
  },
  saveLog: async (log) => {
    await loadDb();
    if (pool) {
      await pool.query(
        `INSERT INTO drink_logs (id, user_id, drink_id, timestamp, latitude, longitude)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [log.id, log.userId, log.drinkId, log.timestamp, log.latitude !== undefined ? log.latitude : null, log.longitude !== undefined ? log.longitude : null]
      );
      
      const userRes = await pool.query("SELECT * FROM users WHERE id = $1", [log.userId]);
      if (userRes.rows.length > 0) {
        const rawUser = userRes.rows[0];
        const user = {
          id: rawUser.id,
          name: rawUser.name,
          avatar: rawUser.avatar,
          title: rawUser.title,
          rank: rawUser.rank,
          points: rawUser.points,
          alcoholGrams: Number(rawUser.alcohol_grams),
          achievements: Array.isArray(rawUser.achievements) ? rawUser.achievements : (typeof rawUser.achievements === 'string' ? JSON.parse(rawUser.achievements) : []),
          email: rawUser.email,
          password: rawUser.password,
          selected_title: rawUser.selected_title,
          level: rawUser.level !== undefined && rawUser.level !== null ? rawUser.level : 1,
          active_quest: rawUser.active_quest || null,
          // MUSS mit: recalculateUserStats() addiert die Spiel-XP auf `points`.
          // Fehlt das Feld, schreibt das anschliessende saveUser() einen um
          // die Spiel-XP verminderten Punktestand zurueck.
          gamePoints: rawUser.game_points || 0
        };
        const allLogs = await module.exports.getLogs();
        const allDrinks = await module.exports.getDrinks();
        const allGroups = await module.exports.getGroups();
        const updatedUser = await recalculateUserStats(user, allLogs, allDrinks, allGroups);
        await module.exports.saveUser(updatedUser);
      }
      return;
    }
    db.logs.push(log);
    const user = db.users.find((u) => u.id === log.userId);
    if (user) {
      await recalculateUserStats(user, db.logs, db.drinks, db.groups);
    }
    await saveDb();
  },
  deleteLog: async (logId) => {
    await loadDb();
    if (pool) {
      const logRes = await pool.query("SELECT user_id AS \"userId\" FROM drink_logs WHERE id = $1", [logId]);
      if (logRes.rows.length === 0) return;
      const userId = logRes.rows[0].userId;

      await pool.query("DELETE FROM drink_logs WHERE id = $1", [logId]);
      
      const userRes = await pool.query("SELECT * FROM users WHERE id = $1", [userId]);
      if (userRes.rows.length > 0) {
        const rawUser = userRes.rows[0];
        const user = {
          id: rawUser.id,
          name: rawUser.name,
          avatar: rawUser.avatar,
          title: rawUser.title,
          rank: rawUser.rank,
          points: rawUser.points,
          alcoholGrams: Number(rawUser.alcohol_grams),
          achievements: Array.isArray(rawUser.achievements) ? rawUser.achievements : (typeof rawUser.achievements === 'string' ? JSON.parse(rawUser.achievements) : []),
          email: rawUser.email,
          password: rawUser.password,
          selected_title: rawUser.selected_title,
          level: rawUser.level !== undefined && rawUser.level !== null ? rawUser.level : 1,
          active_quest: rawUser.active_quest || null,
          // MUSS mit: recalculateUserStats() addiert die Spiel-XP auf `points`.
          // Fehlt das Feld, schreibt das anschliessende saveUser() einen um
          // die Spiel-XP verminderten Punktestand zurueck.
          gamePoints: rawUser.game_points || 0
        };
        const allLogs = await module.exports.getLogs();
        const allDrinks = await module.exports.getDrinks();
        const allGroups = await module.exports.getGroups();
        const updatedUser = await recalculateUserStats(user, allLogs, allDrinks, allGroups);
        await module.exports.saveUser(updatedUser);
      }
      return;
    }
    const logToDelete = db.logs.find((l) => l.id === logId);
    if (!logToDelete) return;
    db.logs = db.logs.filter((l) => l.id !== logId);
    const user = db.users.find((u) => u.id === logToDelete.userId);
    if (user) {
      await recalculateUserStats(user, db.logs, db.drinks, db.groups);
    }
    await saveDb();
  },
  getGroups: async () => {
    await loadDb();
    if (pool) {
      const res = await pool.query("SELECT id, name, admin_id AS \"adminId\", member_ids AS \"memberIds\", pending_user_ids AS \"pendingUserIds\" , invite_code FROM groups");
      return res.rows.map(row => ({
        id: row.id,
        name: row.name,
        adminId: row.adminId,
        memberIds: Array.isArray(row.memberIds) ? row.memberIds : (typeof row.memberIds === 'string' ? JSON.parse(row.memberIds) : []),
        pendingUserIds: Array.isArray(row.pendingUserIds) ? row.pendingUserIds : (typeof row.pendingUserIds === 'string' ? JSON.parse(row.pendingUserIds) : []),
        inviteCode: row.invite_code || null
      }));
    }
    return db.groups;
  },
  saveGroup: async (group) => {
    await loadDb();
    if (pool) {
      await pool.query(
        `INSERT INTO groups (id, name, admin_id, member_ids, pending_user_ids, invite_code)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET
           name = $2, admin_id = $3, member_ids = $4, pending_user_ids = $5, invite_code = $6`,
        [group.id, group.name, group.adminId, JSON.stringify(group.memberIds), JSON.stringify(group.pendingUserIds), group.inviteCode || null]
      );
      
      const adminRes = await pool.query("SELECT * FROM users WHERE id = $1", [group.adminId]);
      if (adminRes.rows.length > 0) {
        const rawUser = adminRes.rows[0];
        const admin = {
          id: rawUser.id,
          name: rawUser.name,
          avatar: rawUser.avatar,
          title: rawUser.title,
          rank: rawUser.rank,
          points: rawUser.points,
          alcoholGrams: Number(rawUser.alcohol_grams),
          achievements: Array.isArray(rawUser.achievements) ? rawUser.achievements : (typeof rawUser.achievements === 'string' ? JSON.parse(rawUser.achievements) : []),
          email: rawUser.email,
          password: rawUser.password,
          selected_title: rawUser.selected_title,
          level: rawUser.level !== undefined && rawUser.level !== null ? rawUser.level : 1,
          active_quest: rawUser.active_quest || null,
          // MUSS mit: recalculateUserStats() addiert die Spiel-XP auf `points`.
          // Fehlt das Feld, schreibt das anschliessende saveUser() einen um
          // die Spiel-XP verminderten Punktestand zurueck.
          gamePoints: rawUser.game_points || 0
        };
        const allLogs = await module.exports.getLogs();
        const allDrinks = await module.exports.getDrinks();
        const allGroups = await module.exports.getGroups();
        const updatedAdmin = await recalculateUserStats(admin, allLogs, allDrinks, allGroups);
        await module.exports.saveUser(updatedAdmin);
      }
      return;
    }
    const idx = db.groups.findIndex((g) => g.id === group.id);
    if (idx !== -1) {
      db.groups[idx] = group;
    } else {
      db.groups.push(group);
    }
    const admin = db.users.find((u) => u.id === group.adminId);
    if (admin) {
      await recalculateUserStats(admin, db.logs, db.drinks, db.groups);
    }
    await saveDb();
  },
  /**
   * Löscht eine Gruppe samt allem, was an ihr hängt.
   *
   * Gebraucht für genau einen Fall: das letzte Mitglied verlässt die Gruppe.
   * Ohne das bliebe eine mitgliederlose Gruppe für immer in der Datenbank
   * stehen — unsichtbar (GET /api/groups filtert auf Mitgliedschaft), aber mit
   * ihrem gesamten Chatverlauf.
   *
   * In Postgres erledigen die FK-Kaskaden (`ON DELETE CASCADE` auf
   * `messages.group_id` und `group_quests.group_id`) den Rest. Der JSON-Modus
   * hat keine Fremdschlüssel, dort muss dasselbe von Hand passieren — sonst
   * driften die beiden Modi auseinander, was in diesem Projekt schon mehrfach
   * passiert ist.
   */
  deleteGroup: async (groupId) => {
    await loadDb();
    if (pool) {
      await pool.query("DELETE FROM groups WHERE id = $1", [groupId]);
      return;
    }
    db.groups = db.groups.filter((g) => g.id !== groupId);
    db.messages = (db.messages || []).filter((m) => m.groupId !== groupId);
    db.groupQuests = (db.groupQuests || []).filter((q) => q.groupId !== groupId);
    await saveDb();
  },
  getEvents: async () => {
    await loadDb();
    if (pool) {
      const res = await pool.query("SELECT id, name, creator_id AS \"creatorId\", invite_code AS \"inviteCode\", member_ids AS \"memberIds\", end_timestamp AS \"endTimestamp\" FROM events");
      return res.rows.map(row => ({
        id: row.id,
        name: row.name,
        creatorId: row.creatorId,
        inviteCode: row.inviteCode,
        memberIds: Array.isArray(row.memberIds) ? row.memberIds : (typeof row.memberIds === 'string' ? JSON.parse(row.memberIds) : []),
        endTimestamp: row.endTimestamp ? (row.endTimestamp.toISOString ? row.endTimestamp.toISOString() : new Date(row.endTimestamp).toISOString()) : null
      }));
    }
    return db.events;
  },
  saveEvent: async (event) => {
    await loadDb();
    if (pool) {
      await pool.query(
        `INSERT INTO events (id, name, creator_id, invite_code, member_ids, end_timestamp)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET
           name = $2, creator_id = $3, invite_code = $4, member_ids = $5, end_timestamp = $6`,
        [event.id, event.name, event.creatorId, event.inviteCode, JSON.stringify(event.memberIds), event.endTimestamp]
      );
      return;
    }
    // Ersetzen statt anhängen. Der Postgres-Zweig darueber macht ein Upsert;
    // hier wurde blind gepusht, wodurch jeder Event-Beitritt im JSON-Modus das
    // Event DOPPELT in die Liste legte. Gefunden beim Bauen der Event-Ansicht
    // (18.08.2026), sichtbar als "Meine Events (2)" mit zweimal demselben Namen.
    const idx = db.events.findIndex((e) => e.id === event.id);
    if (idx !== -1) db.events[idx] = event;
    else db.events.push(event);
    await saveDb();
  },
  getPosts: async () => {
    await loadDb();
    if (pool) {
      const res = await pool.query(
        'SELECT id, user_id AS "userId", text, context_type AS "contextType", context_id AS "contextId", timestamp, image FROM posts'
      );
      return res.rows.map(row => ({
        id: row.id,
        userId: row.userId,
        text: row.text,
        contextType: row.contextType,
        contextId: row.contextId,
        timestamp: row.timestamp.toISOString ? row.timestamp.toISOString() : new Date(row.timestamp).toISOString(),
        image: row.image || null
      }));
    }
    return db.posts;
  },
  savePost: async (post) => {
    await loadDb();
    if (pool) {
      await pool.query(
        `INSERT INTO posts (id, user_id, text, context_type, context_id, timestamp, image)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [post.id, post.userId, post.text, post.contextType, post.contextId, post.timestamp, post.image || null]
      );
      return;
    }
    db.posts.push(post);
    await saveDb();
  },
  getFeedReactions: async () => {
    await loadDb();
    if (pool) {
      const res = await pool.query(
        'SELECT target_id AS "targetId", user_id AS "userId", emoji FROM feed_reactions'
      );
      const reactions = {};
      for (const row of res.rows) {
        if (!reactions[row.targetId]) {
          reactions[row.targetId] = { cheers: [], fire: [], water: [] };
        }
        if (reactions[row.targetId][row.emoji]) {
          reactions[row.targetId][row.emoji].push(row.userId);
        }
      }
      return reactions;
    }
    return db.reactions || {};
  },
  toggleFeedReaction: async (targetId, userId, emoji) => {
    await loadDb();
    if (pool) {
      const existing = await pool.query(
        'SELECT id FROM feed_reactions WHERE target_id = $1 AND user_id = $2 AND emoji = $3',
        [targetId, userId, emoji]
      );
      if (existing.rows.length > 0) {
        await pool.query(
          'DELETE FROM feed_reactions WHERE target_id = $1 AND user_id = $2 AND emoji = $3',
          [targetId, userId, emoji]
        );
      } else {
        const id = `react-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        await pool.query(
          'INSERT INTO feed_reactions (id, target_id, user_id, emoji, timestamp) VALUES ($1, $2, $3, $4, $5)',
          [id, targetId, userId, emoji, new Date().toISOString()]
        );
      }
      const all = await pool.query(
        'SELECT emoji, user_id AS "userId" FROM feed_reactions WHERE target_id = $1',
        [targetId]
      );
      const result = { cheers: [], fire: [], water: [] };
      for (const row of all.rows) {
        if (result[row.emoji]) result[row.emoji].push(row.userId);
      }
      return result;
    }
    if (!db.reactions) db.reactions = {};
    if (!db.reactions[targetId]) {
      db.reactions[targetId] = { cheers: [], fire: [], water: [] };
    }
    const target = db.reactions[targetId];
    if (!target[emoji]) target[emoji] = [];
    const idx = target[emoji].indexOf(userId);
    if (idx !== -1) {
      target[emoji].splice(idx, 1);
    } else {
      target[emoji].push(userId);
    }
    await saveDb();
    return target;
  },
  /**
   * Persönliche Schnellwahl eines Nutzers, in seiner Reihenfolge.
   *
   * Wer noch keine hat (jedes Bestandskonto), bekommt die Standardauswahl
   * zurück — aber sie wird NICHT gespeichert. Sonst könnte man sie nie leeren:
   * jeder Abruf würde sie wieder anlegen.
   */
  getUserDrinkIds: async (userId) => {
    await loadDb();
    if (pool) {
      const flag = await pool.query("SELECT quick_picks_set FROM users WHERE id = $1", [userId]);
      if (!flag.rows[0]?.quick_picks_set) return [...DEFAULT_QUICK_PICKS];

      const res = await pool.query(
        "SELECT drink_id FROM user_drinks WHERE user_id = $1 ORDER BY position ASC",
        [userId]
      );
      return res.rows.map((r) => r.drink_id);
    }

    const user = db.users.find((u) => u.id === userId);
    if (!user?.quickPicksSet) return [...DEFAULT_QUICK_PICKS];

    return (db.userDrinks || [])
      .filter((e) => e.userId === userId)
      .sort((a, b) => a.position - b.position)
      .map((e) => e.drinkId);
  },
  /** Hat der Nutzer überhaupt schon eine eigene Auswahl getroffen? */
  hasOwnQuickPicks: async (userId) => {
    await loadDb();
    if (pool) {
      const res = await pool.query("SELECT quick_picks_set FROM users WHERE id = $1", [userId]);
      return Boolean(res.rows[0]?.quick_picks_set);
    }
    return Boolean(db.users.find((u) => u.id === userId)?.quickPicksSet);
  },
  /** Ersetzt die Auswahl vollständig; die Reihenfolge des Arrays zählt. */
  setUserDrinkIds: async (userId, drinkIds) => {
    await loadDb();
    if (pool) {
      // Komplett ersetzen statt zu vergleichen: die Liste ist kurz, und ein
      // Differenz-Abgleich wäre mehr Code für dieselbe Wirkung.
      await pool.query("DELETE FROM user_drinks WHERE user_id = $1", [userId]);
      for (let i = 0; i < drinkIds.length; i++) {
        await pool.query(
          `INSERT INTO user_drinks (user_id, drink_id, position)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id, drink_id) DO UPDATE SET position = $3`,
          [userId, drinkIds[i], i]
        );
      }
      // Ab jetzt zählt die gespeicherte Liste, auch wenn sie leer ist.
      await pool.query("UPDATE users SET quick_picks_set = TRUE WHERE id = $1", [userId]);
      return;
    }
    if (!db.userDrinks) db.userDrinks = [];
    db.userDrinks = db.userDrinks.filter((e) => e.userId !== userId);
    drinkIds.forEach((drinkId, position) => {
      db.userDrinks.push({ userId, drinkId, position });
    });
    const user = db.users.find((u) => u.id === userId);
    if (user) user.quickPicksSet = true;
    await saveDb();
  },
  deletePost: async (postId) => {
    await loadDb();
    if (pool) {
      await pool.query("DELETE FROM posts WHERE id = $1", [postId]);
      return;
    }
    db.posts = (db.posts || []).filter((p) => p.id !== postId);
    await saveDb();
  },
  recalculateAllUsers: async () => {
    await loadDb();
    const allLogs = await module.exports.getLogs();
    const allDrinks = await module.exports.getDrinks();
    const allGroups = await module.exports.getGroups();
    const users = await module.exports.getUsers();
    for (let u of users) {
      const updated = await recalculateUserStats(u, allLogs, allDrinks, allGroups);
      await module.exports.saveUser(updated);
    }
  },

  // Game Duels Database Calls
  getDuels: async () => {
    await loadDb();
    if (pool) {
      const res = await pool.query("SELECT id, creator_id AS \"creatorId\", opponent_id AS \"opponentId\", duration, status, start_time AS \"startTime\", end_time AS \"endTime\", creator_points AS \"creatorPoints\", opponent_points AS \"opponentPoints\" FROM duels");
      return res.rows.map(row => ({
        id: row.id,
        creatorId: row.creatorId,
        opponentId: row.opponentId,
        duration: row.duration,
        status: row.status,
        startTime: row.startTime ? (row.startTime.toISOString ? row.startTime.toISOString() : new Date(row.startTime).toISOString()) : null,
        endTime: row.endTime ? (row.endTime.toISOString ? row.endTime.toISOString() : new Date(row.endTime).toISOString()) : null,
        creatorPoints: row.creatorPoints,
        opponentPoints: row.opponentPoints
      }));
    }
    if (!db.duels) db.duels = [];
    return db.duels;
  },
  saveDuel: async (duel) => {
    await loadDb();
    if (pool) {
      await pool.query(
        `INSERT INTO duels (id, creator_id, opponent_id, duration, status, start_time, end_time, creator_points, opponent_points)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET
           creator_id = $2, opponent_id = $3, duration = $4, status = $5, start_time = $6, end_time = $7, creator_points = $8, opponent_points = $9`,
        [duel.id, duel.creatorId, duel.opponentId, duel.duration, duel.status, duel.startTime, duel.endTime, duel.creatorPoints, duel.opponentPoints]
      );
      return;
    }
    if (!db.duels) db.duels = [];
    const idx = db.duels.findIndex((d) => d.id === duel.id);
    if (idx !== -1) {
      db.duels[idx] = duel;
    } else {
      db.duels.push(duel);
    }
    await saveDb();
  },

  // Group Quests Database Calls
  getGroupQuests: async () => {
    await loadDb();
    if (pool) {
      const res = await pool.query("SELECT id, group_id AS \"groupId\", title, type, target_value AS \"targetValue\", current_value AS \"currentValue\", status, start_time AS \"startTime\", end_time AS \"endTime\" FROM group_quests");
      return res.rows.map(row => ({
        id: row.id,
        groupId: row.groupId,
        title: row.title,
        type: row.type,
        targetValue: Number(row.targetValue),
        currentValue: Number(row.currentValue),
        status: row.status,
        startTime: row.startTime ? (row.startTime.toISOString ? row.startTime.toISOString() : new Date(row.startTime).toISOString()) : null,
        endTime: row.endTime ? (row.endTime.toISOString ? row.endTime.toISOString() : new Date(row.endTime).toISOString()) : null
      }));
    }
    if (!db.groupQuests) db.groupQuests = [];
    return db.groupQuests;
  },
  saveGroupQuest: async (quest) => {
    await loadDb();
    if (pool) {
      await pool.query(
        `INSERT INTO group_quests (id, group_id, title, type, target_value, current_value, status, start_time, end_time)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET
           group_id = $2, title = $3, type = $4, target_value = $5, current_value = $6, status = $7, start_time = $8, end_time = $9`,
        [quest.id, quest.groupId, quest.title, quest.type, quest.targetValue, quest.currentValue, quest.status, quest.startTime, quest.endTime]
      );
      return;
    }
    if (!db.groupQuests) db.groupQuests = [];
    const idx = db.groupQuests.findIndex((q) => q.id === quest.id);
    if (idx !== -1) {
      db.groupQuests[idx] = quest;
    } else {
      db.groupQuests.push(quest);
    }
    await saveDb();
  },
  getFriendships: async () => {
    await loadDb();
    if (pool) {
      const res = await pool.query("SELECT id, sender_username AS \"sender_username\", receiver_username AS \"receiver_username\", status FROM friendships");
      return res.rows;
    }
    if (!db.friendships) db.friendships = [];
    return db.friendships;
  },
  saveFriendship: async (friendship) => {
    await loadDb();
    if (pool) {
      await pool.query(
        `INSERT INTO friendships (id, sender_username, receiver_username, status)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET
           sender_username = $2, receiver_username = $3, status = $4`,
        [friendship.id, friendship.sender_username, friendship.receiver_username, friendship.status]
      );
      return;
    }
    if (!db.friendships) db.friendships = [];
    const idx = db.friendships.findIndex((f) => f.id === friendship.id);
    if (idx !== -1) {
      db.friendships[idx] = friendship;
    } else {
      db.friendships.push(friendship);
    }
    await saveDb();
  },
  /**
   * Removes a friendship (or a still-pending request) in either direction.
   * Used both by "Freund entfernen" and by blocking, which must not leave a
   * friendship behind — otherwise the blocked user would keep the feed, radar
   * and map access the friendship granted.
   */
  deleteFriendship: async (usernameA, usernameB) => {
    await loadDb();
    if (pool) {
      await pool.query(
        `DELETE FROM friendships
          WHERE (LOWER(sender_username) = LOWER($1) AND LOWER(receiver_username) = LOWER($2))
             OR (LOWER(sender_username) = LOWER($2) AND LOWER(receiver_username) = LOWER($1))`,
        [usernameA, usernameB]
      );
      return;
    }
    const a = (usernameA || "").toLowerCase();
    const b = (usernameB || "").toLowerCase();
    db.friendships = (db.friendships || []).filter((f) => {
      const sender = (f.sender_username || "").toLowerCase();
      const receiver = (f.receiver_username || "").toLowerCase();
      return !((sender === a && receiver === b) || (sender === b && receiver === a));
    });
    await saveDb();
  },
  getBlocks: async () => {
    await loadDb();
    if (pool) {
      const res = await pool.query(
        'SELECT id, blocker_id AS "blockerId", blocked_id AS "blockedId", timestamp FROM blocks'
      );
      return res.rows.map((r) => ({
        id: r.id,
        blockerId: r.blockerId,
        blockedId: r.blockedId,
        timestamp: r.timestamp?.toISOString ? r.timestamp.toISOString() : new Date(r.timestamp).toISOString(),
      }));
    }
    return db.blocks || [];
  },
  saveBlock: async (block) => {
    await loadDb();
    if (pool) {
      // Blocking twice is a no-op rather than an error — the client may
      // retry, and the unique index would otherwise reject it.
      await pool.query(
        `INSERT INTO blocks (id, blocker_id, blocked_id, timestamp)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (blocker_id, blocked_id) DO NOTHING`,
        [block.id, block.blockerId, block.blockedId, block.timestamp]
      );
      return;
    }
    if (!db.blocks) db.blocks = [];
    const exists = db.blocks.some(
      (b) => b.blockerId === block.blockerId && b.blockedId === block.blockedId
    );
    if (!exists) db.blocks.push(block);
    await saveDb();
  },
  deleteBlock: async (blockerId, blockedId) => {
    await loadDb();
    if (pool) {
      await pool.query("DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2", [
        blockerId,
        blockedId,
      ]);
      return;
    }
    db.blocks = (db.blocks || []).filter(
      (b) => !(b.blockerId === blockerId && b.blockedId === blockedId)
    );
    await saveDb();
  },
  getReports: async () => {
    await loadDb();
    if (pool) {
      const res = await pool.query(
        `SELECT id, reporter_id AS "reporterId", reported_user_id AS "reportedUserId",
                reported_username AS "reportedUsername", content_type AS "contentType",
                content_id AS "contentId", content_excerpt AS "contentExcerpt",
                reason, details, status, timestamp
           FROM reports ORDER BY timestamp DESC`
      );
      return res.rows.map((r) => ({
        ...r,
        timestamp: r.timestamp?.toISOString ? r.timestamp.toISOString() : new Date(r.timestamp).toISOString(),
      }));
    }
    return db.reports || [];
  },
  saveReport: async (report) => {
    await loadDb();
    if (pool) {
      await pool.query(
        `INSERT INTO reports (id, reporter_id, reported_user_id, reported_username,
                              content_type, content_id, content_excerpt, reason, details, status, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          report.id,
          report.reporterId,
          report.reportedUserId,
          report.reportedUsername,
          report.contentType,
          report.contentId,
          report.contentExcerpt,
          report.reason,
          report.details,
          report.status,
          report.timestamp,
        ]
      );
      return;
    }
    if (!db.reports) db.reports = [];
    db.reports.push(report);
    await saveDb();
  },
  /**
   * Setzt den Status einer Meldung (open / resolved / dismissed).
   *
   * Eigene Funktion statt saveReport: der Melde-Eintrag ist ein Beleg und
   * darf nachträglich nicht als Ganzes überschrieben werden — sonst könnte
   * ein Fehler im Client Grund, Auszug oder Melder verlieren.
   */
  setReportStatus: async (reportId, status) => {
    await loadDb();
    if (pool) {
      await pool.query("UPDATE reports SET status = $1 WHERE id = $2", [status, reportId]);
      return;
    }
    const report = (db.reports || []).find((r) => r.id === reportId);
    if (report) {
      report.status = status;
      await saveDb();
    }
  },
  /**
   * Carries a rename over to the friendship table.
   *
   * Friendships have no foreign key — they store usernames (see the friends
   * routes in index.js). Renaming a user therefore orphaned every friendship
   * they had: the rows still existed but matched nobody, so friends silently
   * disappeared from both sides' lists. Called from PUT /api/users/:id.
   */
  renameUserInFriendships: async (oldName, newName) => {
    await loadDb();
    if (!oldName || !newName || oldName.toLowerCase() === newName.toLowerCase()) return;

    if (pool) {
      await pool.query(
        "UPDATE friendships SET sender_username = $1 WHERE LOWER(sender_username) = LOWER($2)",
        [newName, oldName]
      );
      await pool.query(
        "UPDATE friendships SET receiver_username = $1 WHERE LOWER(receiver_username) = LOWER($2)",
        [newName, oldName]
      );
      return;
    }

    if (!db.friendships) db.friendships = [];
    let changed = false;
    for (const f of db.friendships) {
      if ((f.sender_username || "").toLowerCase() === oldName.toLowerCase()) {
        f.sender_username = newName;
        changed = true;
      }
      if ((f.receiver_username || "").toLowerCase() === oldName.toLowerCase()) {
        f.receiver_username = newName;
        changed = true;
      }
    }
    if (changed) await saveDb();
  },
  getMapCoordinates: async () => {
    await loadDb();
    if (pool) {
      const res = await pool.query(`
        SELECT dl.id, dl.user_id AS "userId", u.name AS "username", u.avatar, d.name AS "drinkName", dl.latitude, dl.longitude, dl.timestamp
        FROM drink_logs dl
        JOIN users u ON dl.user_id = u.id
        JOIN drinks d ON dl.drink_id = d.id
        WHERE dl.latitude IS NOT NULL AND dl.longitude IS NOT NULL
        ORDER BY dl.timestamp DESC
        LIMIT 100
      `);
      return res.rows.map(row => ({
        id: row.id,
        userId: row.userId,
        username: row.username,
        avatar: row.avatar,
        drinkName: row.drinkName,
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        timestamp: row.timestamp.toISOString ? row.timestamp.toISOString() : new Date(row.timestamp).toISOString()
      }));
    }

    // JSON Fallback
    const logs = db.logs || [];
    const users = db.users || [];
    const drinks = db.drinks || [];

    const mapped = logs
      .filter((log) => log.latitude !== undefined && log.latitude !== null && log.longitude !== undefined && log.longitude !== null)
      .slice(-100)
      .map((log) => {
        const user = users.find((u) => u.id === log.userId);
        const drink = drinks.find((d) => d.id === log.drinkId);
        return {
          id: log.id,
          userId: log.userId,
          username: user ? user.name : "Unbekannt",
          avatar: user ? user.avatar || null : null,
          drinkName: drink ? drink.name : "Getränk",
          latitude: Number(log.latitude),
          longitude: Number(log.longitude),
          timestamp: log.timestamp,
        };
      });

    return mapped.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  },
  // Username search only. Matching on email as well turned the friend search
  // into a lookup service — enter an address, find out whether that person has
  // an account and what they are called here.
  searchUsers: async (query) => {
    await loadDb();
    const q = (query || "").trim().toLowerCase();
    if (!q) return [];

    if (pool) {
      const res = await pool.query(
        `SELECT * FROM users WHERE LOWER(name) ILIKE $1 LIMIT 20`,
        [`%${q}%`]
      );
      return res.rows.map(row => ({
        id: row.id,
        name: row.name,
        avatar: row.avatar,
        title: row.title,
        rank: row.rank,
        points: row.points,
        alcoholGrams: Number(row.alcohol_grams),
        achievements: Array.isArray(row.achievements) ? row.achievements : (typeof row.achievements === 'string' ? JSON.parse(row.achievements) : []),
        email: row.email,
        password: row.password,
        selected_title: row.selected_title,
        level: row.level !== undefined && row.level !== null ? row.level : 1,
        active_quest: row.active_quest || null
      }));
    }

    const users = db.users || [];
    return users.filter((u) => u.name && u.name.toLowerCase().includes(q)).slice(0, 20);
  },
  getDirectMessages: async (user1Id, user2Id) => {
    await loadDb();
    if (pool) {
      const res = await pool.query(
        `SELECT m.id, m.sender_id, m.receiver_id, m.group_id, m.content, m.timestamp, u.name AS sender_name, u.avatar AS sender_avatar
         FROM messages m
         JOIN users u ON m.sender_id = u.id
         WHERE (m.sender_id = $1 AND m.receiver_id = $2) OR (m.sender_id = $2 AND m.receiver_id = $1)
         ORDER BY m.timestamp ASC`,
        [user1Id, user2Id]
      );
      return res.rows.map(r => ({
        id: r.id,
        sender_id: r.sender_id,
        sender_name: r.sender_name,
        sender_avatar: r.sender_avatar,
        receiver_id: r.receiver_id,
        group_id: r.group_id,
        content: r.content,
        timestamp: r.timestamp.toISOString ? r.timestamp.toISOString() : new Date(r.timestamp).toISOString()
      }));
    }

    const messages = db.messages || [];
    const users = db.users || [];
    return messages
      .filter(m => (m.sender_id === user1Id && m.receiver_id === user2Id) || (m.sender_id === user2Id && m.receiver_id === user1Id))
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .map(m => {
        const u = users.find(usr => usr.id === m.sender_id);
        return {
          ...m,
          sender_name: u ? u.name : "Unbekannt",
          sender_avatar: u ? u.avatar : null
        };
      });
  },
  getGroupMessages: async (groupId) => {
    await loadDb();
    if (pool) {
      const res = await pool.query(
        `SELECT m.id, m.sender_id, m.receiver_id, m.group_id, m.content, m.timestamp, u.name AS sender_name, u.avatar AS sender_avatar
         FROM messages m
         JOIN users u ON m.sender_id = u.id
         WHERE m.group_id = $1
         ORDER BY m.timestamp ASC`,
        [groupId]
      );
      return res.rows.map(r => ({
        id: r.id,
        sender_id: r.sender_id,
        sender_name: r.sender_name,
        sender_avatar: r.sender_avatar,
        receiver_id: r.receiver_id,
        group_id: r.group_id,
        content: r.content,
        timestamp: r.timestamp.toISOString ? r.timestamp.toISOString() : new Date(r.timestamp).toISOString()
      }));
    }

    const messages = db.messages || [];
    const users = db.users || [];
    return messages
      .filter(m => m.group_id === groupId)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .map(m => {
        const u = users.find(usr => usr.id === m.sender_id);
        return {
          ...m,
          sender_name: u ? u.name : "Unbekannt",
          sender_avatar: u ? u.avatar : null
        };
      });
  },
  saveMessage: async (msg) => {
    await loadDb();
    if (pool) {
      await pool.query(
        `INSERT INTO messages (id, sender_id, receiver_id, group_id, content, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [msg.id, msg.sender_id, msg.receiver_id || null, msg.group_id || null, msg.content, msg.timestamp]
      );
      return;
    }
    if (!db.messages) db.messages = [];
    db.messages.push(msg);
    await saveDb();
  },
  /**
   * Lesestände eines Nutzers, als Map `conversationKey -> ISO-Zeitstempel`.
   *
   * Ein fehlender Schlüssel bedeutet „nie gelesen" — die Auswertung in
   * index.js zählt dann alles.
   */
  getConversationReads: async (userId) => {
    await loadDb();
    if (pool) {
      const res = await pool.query(
        "SELECT conversation_key, last_read_at FROM conversation_reads WHERE user_id = $1",
        [userId]
      );
      const map = {};
      for (const row of res.rows) {
        map[row.conversation_key] = row.last_read_at.toISOString
          ? row.last_read_at.toISOString()
          : new Date(row.last_read_at).toISOString();
      }
      return map;
    }
    const map = {};
    for (const r of db.conversationReads || []) {
      if (r.userId === userId) map[r.conversationKey] = r.lastReadAt;
    }
    return map;
  },

  /**
   * Setzt den Lesestand einer Unterhaltung.
   *
   * Nie zurückdatieren: zwei Geräte lesen dieselbe Unterhaltung, und das
   * langsamere darf den Stand des schnelleren nicht überschreiben. Postgres
   * erledigt das über GREATEST im UPDATE, der JSON-Zweig mit einem Vergleich.
   */
  setConversationRead: async (userId, conversationKey, lastReadAt) => {
    await loadDb();
    if (pool) {
      await pool.query(
        `INSERT INTO conversation_reads (user_id, conversation_key, last_read_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, conversation_key) DO UPDATE
           SET last_read_at = GREATEST(conversation_reads.last_read_at, $3)`,
        [userId, conversationKey, lastReadAt]
      );
      return;
    }
    if (!db.conversationReads) db.conversationReads = [];
    const vorhanden = db.conversationReads.find(
      (r) => r.userId === userId && r.conversationKey === conversationKey
    );
    if (vorhanden) {
      if (new Date(lastReadAt).getTime() > new Date(vorhanden.lastReadAt).getTime()) {
        vorhanden.lastReadAt = lastReadAt;
      }
    } else {
      db.conversationReads.push({ userId, conversationKey, lastReadAt });
    }
    await saveDb();
  },

  /**
   * Alle Nachrichten, die diesen Nutzer betreffen — Direktnachrichten an ihn
   * und Nachrichten in seinen Gruppen.
   *
   * Bewusst schmal: nur die Felder, die zum Zählen gebraucht werden. Die
   * Inhalte gehören nicht in eine Ungelesen-Abfrage.
   */
  getMessagesForUnread: async (userId, groupIds) => {
    await loadDb();
    if (pool) {
      const res = await pool.query(
        `SELECT sender_id, receiver_id, group_id, timestamp
           FROM messages
          WHERE receiver_id = $1
             OR (group_id = ANY($2::text[]) AND sender_id <> $1)`,
        [userId, groupIds]
      );
      return res.rows.map((r) => ({
        sender_id: r.sender_id,
        receiver_id: r.receiver_id,
        group_id: r.group_id,
        timestamp: r.timestamp.toISOString
          ? r.timestamp.toISOString()
          : new Date(r.timestamp).toISOString(),
      }));
    }
    const gruppen = new Set(groupIds);
    return (db.messages || []).filter(
      (m) =>
        m.receiver_id === userId ||
        (m.group_id && gruppen.has(m.group_id) && m.sender_id !== userId)
    );
  },
  // ─── Spielräume ────────────────────────────────────────────────────────────
  //
  // Ein Raum wird als ganzer Schnappschuss gespeichert, nicht in Spalten
  // zerlegt: die Spielmechanik ändert sich in den nächsten Ausbaustufen
  // laufend, und ein Schema, das jeder neuen Mechanik hinterherzieht, wäre
  // nur eine Migrationsbremse. Gespeichert wird bei Phasenwechseln, nicht
  // bei jeder Abfrage.

  saveGameRoom: async (code, room) => {
    await loadDb();
    const lastActivity = room.lastActivity || Date.now();
    if (pool) {
      await pool.query(
        `INSERT INTO game_rooms (code, state, last_activity)
         VALUES ($1, $2, $3)
         ON CONFLICT (code) DO UPDATE SET state = EXCLUDED.state, last_activity = EXCLUDED.last_activity`,
        [code, JSON.stringify(room), lastActivity]
      );
      return;
    }
    db.gameRooms = (db.gameRooms || []).filter((r) => r.code !== code);
    db.gameRooms.push(room);
    await saveDb();
  },

  deleteGameRoom: async (code) => {
    await loadDb();
    if (pool) {
      await pool.query("DELETE FROM game_rooms WHERE code = $1", [code]);
      return;
    }
    db.gameRooms = (db.gameRooms || []).filter((r) => r.code !== code);
    await saveDb();
  },

  getGameRooms: async () => {
    await loadDb();
    if (pool) {
      const res = await pool.query("SELECT state FROM game_rooms");
      return res.rows.map((r) => (typeof r.state === "string" ? JSON.parse(r.state) : r.state));
    }
    return db.gameRooms || [];
  },

  // ─── Spiel-Punkte ──────────────────────────────────────────────────────────

  /**
   * Summiert die heute bereits gutgeschriebenen Spiel-Punkte eines Nutzers.
   * Kalendertag nach lokaler ISO-Datumsangabe (YYYY-MM-DD).
   */
  getDailyGamePoints: async (userId) => {
    await loadDb();
    const today = new Date().toISOString().slice(0, 10);

    if (pool) {
      const res = await pool.query(
        `SELECT COALESCE(SUM(points), 0)::int AS total
         FROM game_settlements
         WHERE user_id = $1 AND timestamp::date = $2::date`,
        [userId, today]
      );
      return res.rows[0] ? res.rows[0].total : 0;
    }

    const settlements = db.gameSettlements || [];
    return settlements
      .filter((s) => s.user_id === userId && s.timestamp && s.timestamp.startsWith(today))
      .reduce((sum, s) => sum + (s.points || 0), 0);
  },

  /**
   * Schreibt einem Nutzer die Punkte aus einer Spielrunde gut — genau einmal.
   *
   * Der Schlüssel ist "raum:nutzer". Ein zweiter Aufruf für dieselbe Runde
   * (Reconnect, doppelter Tap, wiederholter Poll) prallt am Primärschlüssel
   * ab und ändert nichts.
   *
   * Es gilt eine Obergrenze von 300 Punkten pro Kalendertag. Ist das Limit
   * erreicht oder teilweise erreicht, wird gekappt und der Grund zurückgegeben.
   */
  awardGamePoints: async (roomCode, userId, points) => {
    await loadDb();
    const id = `${roomCode}:${userId}`;
    const amount = Math.max(0, Math.round(points || 0));
    const timestamp = new Date().toISOString();

    // 1. Idempotenz-Vorprüfung: Bereits abgerechnet?
    if (pool) {
      const existing = await pool.query(
        "SELECT points FROM game_settlements WHERE id = $1",
        [id]
      );
      if (existing.rowCount > 0) {
        return { awarded: false, points: 0, reason: "already_claimed" };
      }
    } else {
      db.gameSettlements = db.gameSettlements || [];
      if (db.gameSettlements.some((s) => s.id === id)) {
        return { awarded: false, points: 0, reason: "already_claimed" };
      }
    }

    // 2. Tageslimit prüfen (300 XP pro Kalendertag)
    const todayPoints = await module.exports.getDailyGamePoints(userId);
    const DAILY_CAP = 300;
    const remainingCap = Math.max(0, DAILY_CAP - todayPoints);

    if (remainingCap <= 0) {
      if (pool) {
        await pool.query(
          `INSERT INTO game_settlements (id, user_id, room_code, points, timestamp)
           VALUES ($1, $2, $3, 0, $4)
           ON CONFLICT (id) DO NOTHING`,
          [id, userId, roomCode, timestamp]
        );
      } else {
        db.gameSettlements.push({ id, user_id: userId, room_code: roomCode, points: 0, timestamp });
        await saveDb();
      }
      return { awarded: false, points: 0, reason: "daily_cap" };
    }

    const effectiveAmount = Math.min(amount, remainingCap);
    const isPartial = effectiveAmount < amount;

    if (pool) {
      const inserted = await pool.query(
        `INSERT INTO game_settlements (id, user_id, room_code, points, timestamp)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        [id, userId, roomCode, effectiveAmount, timestamp]
      );
      if (inserted.rowCount === 0) {
        return { awarded: false, points: 0, reason: "already_claimed" };
      }
      await pool.query(
        "UPDATE users SET game_points = COALESCE(game_points, 0) + $1 WHERE id = $2",
        [effectiveAmount, userId]
      );
    } else {
      db.gameSettlements.push({ id, user_id: userId, room_code: roomCode, points: effectiveAmount, timestamp });
      const stored = db.users.find((u) => u.id === userId);
      if (stored) {
        stored.gamePoints = (stored.gamePoints || 0) + effectiveAmount;
      }
      await saveDb();
    }

    // Den Punktestand direkt nachziehen
    const users = await module.exports.getUsers();
    const user = users.find((u) => u.id === userId);
    if (user) {
      const [allLogs, allDrinks, allGroups] = await Promise.all([
        module.exports.getLogs(),
        module.exports.getDrinks(),
        module.exports.getGroups(),
      ]);
      const updated = await recalculateUserStats(user, allLogs, allDrinks, allGroups);
      await module.exports.saveUser(updated);
    }

    return {
      awarded: true,
      points: effectiveAmount,
      reason: isPartial ? "daily_cap_partial" : undefined,
    };
  },

  getCumulativeXpForLevel,
  getUserProgress
};
