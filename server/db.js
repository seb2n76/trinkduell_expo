const fs = require("fs").promises;
const path = require("path");
const { Pool } = require("pg");

const DB_FILE = path.join(__dirname, "db.json");

// Default Drinks Catalog (used as fallback for JSON mode auto-heal)
const DEFAULT_DRINKS = [
  { id: "drink-beer-500", name: "Helles Bier", category: "Bier", volume: 500, abv: 5.0, calories: 215 },
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

  user.points = totalPoints;
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

async function initPgSchema() {
  try {
    const sqlPath = path.join(__dirname, "schema.sql");
    const schemaSql = await fs.readFile(sqlPath, "utf8");
    await pool.query(schemaSql);
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
    console.log("[TrinkDuell DB] PostgreSQL schema initialized successfully.");
  } catch (err) {
    console.error("[TrinkDuell DB] Failed to initialize PostgreSQL schema:", err);
  }
}

async function loadDb() {
  if (pool) {
    if (!pgInitialized) {
      pgInitialized = true;
      await initPgSchema();
    }
    return null;
  }

  if (db) return db;
  try {
    const data = await fs.readFile(DB_FILE, "utf-8");
    db = JSON.parse(data);
    if (!db.friendships) {
      db.friendships = [];
      await saveDb();
    }
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
      messages: []
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
      sessionValidAfter: u.sessionValidAfter || null
    }));
  },
  saveUser: async (user) => {
    await loadDb();
    if (pool) {
      await pool.query(
        `INSERT INTO users (id, name, avatar, title, rank, points, alcohol_grams, achievements, email, password, selected_title, level, active_quest)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (id) DO UPDATE SET
           name = $2, avatar = $3, title = $4, rank = $5, points = $6, alcohol_grams = $7, achievements = $8, email = $9, password = $10, selected_title = $11, level = $12, active_quest = $13`,
        [user.id, user.name, user.avatar, user.title, user.rank, user.points, user.alcoholGrams, JSON.stringify(user.achievements), user.email, user.password, user.selected_title, user.level || 1, user.active_quest || null]
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
      db.users[idx] = { ...db.users[idx], ...user };
    } else {
      db.users.push(user);
    }
    await saveDb();
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
        createdBy: row.created_by || null
      }));
    }
    
    // Auto-heal missing sip drinks in JSON database
    const requiredSips = [
      { id: "drink-sip-beer", name: "Schluck Bier", category: "Bier", volume: 30, abv: 5.0, calories: 13 },
      { id: "drink-sip-wine", name: "Schluck Wein/Sekt", category: "Wein", volume: 20, abv: 12.0, calories: 16 },
      { id: "drink-sip-mix", name: "Schluck Mischgetränk", category: "Mischgetränk", volume: 30, abv: 10.0, calories: 20 },
      { id: "drink-sip-water", name: "Zwischenwasser", category: "Alkoholfrei", volume: 30, abv: 0.0, calories: 0 },
    ];
    let needsSave = false;
    for (const sip of requiredSips) {
      if (!db.drinks.some((d) => d.id === sip.id)) {
        db.drinks.push(sip);
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
      // created_by is set on insert only and deliberately absent from the
      // UPDATE list: ownership decides who may delete a drink, so a later
      // save must not be able to reassign it.
      await pool.query(
        `INSERT INTO drinks (id, name, category, volume, abv, calories, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET
           name = $2, category = $3, volume = $4, abv = $5, calories = $6`,
        [drink.id, drink.name, drink.category, drink.volume, drink.abv, drink.calories, drink.createdBy || null]
      );
      return;
    }
    db.drinks.push(drink);
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
          active_quest: rawUser.active_quest || null
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
          active_quest: rawUser.active_quest || null
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
      const res = await pool.query("SELECT id, name, admin_id AS \"adminId\", member_ids AS \"memberIds\", pending_user_ids AS \"pendingUserIds\" FROM groups");
      return res.rows.map(row => ({
        id: row.id,
        name: row.name,
        adminId: row.adminId,
        memberIds: Array.isArray(row.memberIds) ? row.memberIds : (typeof row.memberIds === 'string' ? JSON.parse(row.memberIds) : []),
        pendingUserIds: Array.isArray(row.pendingUserIds) ? row.pendingUserIds : (typeof row.pendingUserIds === 'string' ? JSON.parse(row.pendingUserIds) : [])
      }));
    }
    return db.groups;
  },
  saveGroup: async (group) => {
    await loadDb();
    if (pool) {
      await pool.query(
        `INSERT INTO groups (id, name, admin_id, member_ids, pending_user_ids)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET
           name = $2, admin_id = $3, member_ids = $4, pending_user_ids = $5`,
        [group.id, group.name, group.adminId, JSON.stringify(group.memberIds), JSON.stringify(group.pendingUserIds)]
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
          active_quest: rawUser.active_quest || null
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
    db.events.push(event);
    await saveDb();
  },
  getPosts: async () => {
    await loadDb();
    if (pool) {
      const res = await pool.query("SELECT id, user_id AS \"userId\", text, context_type AS \"contextType\", context_id AS \"contextId\", timestamp FROM posts");
      return res.rows.map(row => ({
        id: row.id,
        userId: row.userId,
        text: row.text,
        contextType: row.contextType,
        contextId: row.contextId,
        timestamp: row.timestamp.toISOString ? row.timestamp.toISOString() : new Date(row.timestamp).toISOString()
      }));
    }
    return db.posts;
  },
  savePost: async (post) => {
    await loadDb();
    if (pool) {
      await pool.query(
        `INSERT INTO posts (id, user_id, text, context_type, context_id, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [post.id, post.userId, post.text, post.contextType, post.contextId, post.timestamp]
      );
      return;
    }
    db.posts.push(post);
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
  getCumulativeXpForLevel,
  getUserProgress
};
