const express = require("express");
const cors = require("cors");
const db = require("./db");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const { sendPushNotification } = require("./push");
const { sendPasswordResetEmail } = require("./email");

// Multipart avatar upload fallback (used when the client can't produce a
// Base64 payload). Memory storage since avatars are small and get converted
// straight to a Base64 data URL below, same as the JSON upload path.
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// ─── JWT Secret ───────────────────────────────────────────────────────────────
// In production this MUST come from an environment variable.
// Set JWT_SECRET on your Proxmox LXC, e.g. via systemd EnvironmentFile.
const JWT_SECRET = process.env.JWT_SECRET || "trinkduell-dev-secret-change-in-prod";
const JWT_EXPIRES_IN = "30d"; // Long-lived sessions for mobile apps

// Helper: sign a fresh token for a userId
function signToken(userId) {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

// ─── One-time migration: hash any plaintext passwords in the db ───────────────
async function migratePlaintextPasswords() {
  try {
    const users = await db.getUsers();
    let changed = false;
    for (const user of users) {
      // bcrypt hashes always start with "$2" — skip already-hashed passwords
      if (user.password && !user.password.startsWith("$2")) {
        console.log(`[Migration] Hashing password for user: ${user.name}`);
        user.password = await bcrypt.hash(user.password, 12);
        await db.saveUser(user);
        changed = true;
      }
    }
    if (changed) console.log("[Migration] All plaintext passwords have been hashed.");
    else console.log("[Migration] No plaintext passwords found — db is up-to-date.");
  } catch (err) {
    console.error("[Migration] Password migration failed:", err.message);
  }
}

const app = express();
const PORT = process.env.PORT || 5000;

function enrichUserProgress(user) {
  if (!user) return user;
  const { password, ...sanitizedUser } = user;
  const progress = db.getUserProgress(user.points, user.level);
  return {
    ...sanitizedUser,
    currentLevel: progress.currentLevel,
    xpForNextLevel: progress.xpForNextLevel,
    xpProgressInCurrentLevel: progress.xpProgressInCurrentLevel,
    isLevelLocked: progress.isLocked
  };
}

// Enable CORS and JSON body parser
app.use(cors());
app.use(express.json({ limit: "10mb" })); // Raise limit for Base64 avatars

// Helper to generate unique IDs
const generateUniqueId = (prefix) => {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 1000000);
  return `${prefix}-${timestamp}-${random}`;
};

// Authentication Middleware — verifies real JWT signature
async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Nicht autorisiert. Token fehlt." });
  }

  const token = authHeader.substring(7);

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: "Ungültiges oder abgelaufenes Token." });
  }

  const userId = payload.sub;
  const users = await db.getUsers();
  const user = users.find((u) => u.id === userId);

  if (!user) {
    return res.status(401).json({ error: "Benutzer nicht gefunden." });
  }

  req.user = user;
  req.userId = userId;
  req.token = token;
  next();
}

// ==========================================
// Auth Endpoints
// ==========================================

// Login
app.post("/api/auth/login", async (req, res) => {
  const { emailOrUsername, password } = req.body;
  if (!emailOrUsername || !password) {
    return res.status(400).json({ error: "E-Mail/Username und Passwort werden benötigt." });
  }

  const users = await db.getUsers();
  const lowercaseInput = emailOrUsername.toLowerCase();
  const matchedUser = users.find(
    (u) =>
      u.email?.toLowerCase() === lowercaseInput ||
      u.name.toLowerCase() === lowercaseInput
  );

  if (!matchedUser) {
    return res.status(401).json({ error: "Ungültige Anmeldedaten!" });
  }

  // Compare password with bcrypt hash
  const isPasswordValid = await bcrypt.compare(password, matchedUser.password);
  if (!isPasswordValid) {
    return res.status(401).json({ error: "Ungültige Anmeldedaten!" });
  }

  const token = signToken(matchedUser.id);
  res.json({ user: enrichUserProgress(matchedUser), token });
});

// Register
app.post("/api/auth/register", async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ error: "Alle Felder müssen ausgefüllt sein." });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: "Passwort muss mindestens 6 Zeichen lang sein." });
  }

  const users = await db.getUsers();
  if (users.some((u) => u.email?.toLowerCase() === email.toLowerCase())) {
    return res.status(400).json({ error: "Ein Account mit dieser E-Mail existiert bereits!" });
  }
  if (users.some((u) => u.name.toLowerCase() === username.toLowerCase())) {
    return res.status(400).json({ error: "Dieser Username ist bereits vergeben!" });
  }

  const hashedPassword = await bcrypt.hash(password, 12);
  const newUserId = generateUniqueId("user");
  const newUser = {
    id: newUserId,
    name: username,
    email: email,
    password: hashedPassword,
    avatar: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&q=80",
    title: "Neuling",
    selected_title: "Neuling",
    rank: "Unranked",
    points: 0,
    alcoholGrams: 0,
    achievements: [],
    level: 1,
    active_quest: null,
  };

  await db.saveUser(newUser);
  const token = signToken(newUser.id);

  res.status(201).json({ user: enrichUserProgress(newUser), token });
});

// Logout (Stateless in simple JWT, just response success)
app.post("/api/auth/logout", (req, res) => {
  res.json({ success: true });
});

// Forgot Password
// If RESEND_API_KEY is set (see docs/EMAIL_SETUP.md), the code is emailed
// and never leaves the server. Without it (friends-only beta default), the
// code is returned directly in the response so the flow still works.
app.post("/api/auth/forgot-password", async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: "E-Mail Adresse wird benötigt." });
  }

  const users = await db.getUsers();
  const user = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());

  if (!user) {
    return res.status(404).json({ error: "Kein Benutzer mit dieser E-Mail gefunden!" });
  }

  const code = Math.floor(1000 + Math.random() * 9000).toString();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 minutes
  await db.setPasswordResetCode(user.id, code, expiresAt);

  const emailSent = await sendPasswordResetEmail(email, code);

  res.json({
    message: `Reset-Code wurde an ${email} gesendet.`,
    code: emailSent ? undefined : code,
  });
});

// Reset Password (using the code issued by /forgot-password)
app.post("/api/auth/reset-password", async (req, res) => {
  const { email, code, newPassword } = req.body;
  if (!email || !code || !newPassword) {
    return res.status(400).json({ error: "E-Mail, Code und neues Passwort werden benötigt." });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: "Passwort muss mindestens 6 Zeichen lang sein." });
  }

  const users = await db.getUsers();
  const user = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) {
    return res.status(404).json({ error: "Kein Benutzer mit dieser E-Mail gefunden!" });
  }

  const isValidCode = await db.verifyPasswordResetCode(user.id, code.trim());
  if (!isValidCode) {
    return res.status(400).json({ error: "Ungültiger oder abgelaufener Code." });
  }

  const hashedPassword = await bcrypt.hash(newPassword, 12);
  await db.setPasswordAndClearResetCode(user.id, hashedPassword);

  res.json({ success: true });
});

// Get Session — verifies real JWT signature
app.get("/api/auth/session", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.json(null);
  }

  const token = authHeader.substring(7);

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return res.json(null); // Expired or invalid — treat as logged out
  }

  const userId = payload.sub;
  const users = await db.getUsers();
  const user = users.find((u) => u.id === userId);

  if (!user) {
    return res.json(null);
  }

  res.json({ user: enrichUserProgress(user), token });
});

// ==========================================
// Users Endpoints
// ==========================================

// Get All Users
app.get("/api/users", authenticate, async (req, res) => {
  try {
    const users = await db.getUsers();
    // Strip passwords before sending
    const sanitized = users.map(({ password, ...rest }) => rest);
    res.json(sanitized);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get the authenticated user's own profile, identified purely from the JWT.
// Registered before /api/users/:id — a client-tracked "current user id" is
// an offline-only concept and is never set for a normal online session, so
// callers must never have to already know their own id to ask "who am I".
app.get("/api/users/me", authenticate, async (req, res) => {
  const users = await db.getUsers();
  const user = users.find((u) => u.id === req.userId);
  if (!user) {
    return res.status(404).json({ error: "Benutzer nicht gefunden." });
  }
  res.json(enrichUserProgress(user));
});

// Get Specific User
app.get("/api/users/:id", authenticate, async (req, res) => {
  const users = await db.getUsers();
  const user = users.find((u) => u.id === req.params.id);
  if (!user) {
    return res.status(404).json({ error: "Benutzer nicht gefunden." });
  }
  const { password, ...sanitized } = user;
  res.json(enrichUserProgress(sanitized));
});

// Update User
app.put("/api/users/:id", authenticate, async (req, res) => {
  if (req.userId !== req.params.id) {
    return res.status(403).json({ error: "Du kannst nur dein eigenes Profil ändern." });
  }

  const users = await db.getUsers();
  const user = users.find((u) => u.id === req.params.id);
  if (!user) {
    return res.status(404).json({ error: "Benutzer nicht gefunden." });
  }

  // Update properties
  const { name, avatar, title, selected_title } = req.body;
  if (name !== undefined) user.name = name;
  if (avatar !== undefined) user.avatar = avatar;
  if (title !== undefined) user.title = title;
  if (selected_title !== undefined) user.selected_title = selected_title;

  await db.saveUser(user);
  await db.recalculateAllUsers(); // Make sure ranks/achievements recalculate
  
  res.json(enrichUserProgress(user));
});

// Upload User Avatar (Base64 JSON or multipart/form-data)
// avatarUpload.single() only engages for multipart requests — express.json()
// already parsed anything else into req.body, so the two never conflict.
app.post("/api/users/:id/avatar", authenticate, avatarUpload.single("avatar"), async (req, res) => {
  if (req.userId !== req.params.id) {
    return res.status(403).json({ error: "Du kannst nur dein eigenes Bild hochladen." });
  }

  const users = await db.getUsers();
  const user = users.find((u) => u.id === req.params.id);
  if (!user) {
    return res.status(404).json({ error: "Benutzer nicht gefunden." });
  }

  // If it's a Base64 image payload (e.g. from post request)
  if (req.body && req.body.image) {
    user.avatar = req.body.image;
    await db.saveUser(user);
    return res.json({ avatarUrl: req.body.image });
  }

  // Multipart upload: convert the uploaded file into the same Base64 data
  // URL shape the JSON path stores, so both paths behave identically.
  if (req.file) {
    const dataUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
    user.avatar = dataUrl;
    await db.saveUser(user);
    return res.json({ avatarUrl: dataUrl });
  }

  res.status(400).json({ error: "Kein Bild empfangen." });
});

// Delete own account permanently (Apple/Google in-app account deletion requirement)
app.delete("/api/users/:id", authenticate, async (req, res) => {
  if (req.userId !== req.params.id) {
    return res.status(403).json({ error: "Du kannst nur dein eigenes Konto löschen." });
  }

  try {
    await db.deleteUser(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Register/replace this device's Expo push token for the current user
app.post("/api/users/push-token", authenticate, async (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ error: "Push-Token fehlt." });
  }
  try {
    await db.setPushToken(req.userId, token);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Level Up User
app.post("/api/users/level-up", authenticate, async (req, res) => {
  try {
    const users = await db.getUsers();
    const user = users.find((u) => u.id === req.userId);
    if (!user) {
      return res.status(404).json({ error: "Benutzer nicht gefunden." });
    }

    if (!user.level) user.level = 1;
    user.level += 1;
    user.active_quest = null;

    // Recalculate title based on level
    const getTitleForLevel = (lvl) => {
      if (lvl >= 100) return "Alki";
      if (lvl >= 10) return "Braumeister";
      if (lvl >= 2) return "Trink-Anfänger";
      return "Neuling";
    };
    user.title = getTitleForLevel(user.level);
    user.selected_title = user.title;

    await db.saveUser(user);
    await db.recalculateAllUsers();

    // Reload recalculated user
    const refreshedUsers = await db.getUsers();
    const refreshedUser = refreshedUsers.find((u) => u.id === req.userId);

    // Add feed notification
    const postText = `⭐ LEVEL UP! ${user.name} hat Level ${user.level} erreicht! (${user.title})`;
    const newPost = {
      id: generateUniqueId("post"),
      userId: "system",
      text: postText,
      contextType: "group",
      contextId: "group-1",
      timestamp: new Date().toISOString(),
    };
    await db.savePost(newPost);

    res.json(enrichUserProgress(refreshedUser || user));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// Drinks Endpoints
// ==========================================

// Get All Drinks
app.get("/api/drinks", authenticate, async (req, res) => {
  try {
    const drinks = await db.getDrinks();
    res.json(drinks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create Custom Drink
app.post("/api/drinks", authenticate, async (req, res) => {
  const { name, category, volume, abv, calories } = req.body;
  if (!name || !category || !volume || abv === undefined) {
    return res.status(400).json({ error: "Name, Kategorie, Volumen und Alkoholgehalt fehlen." });
  }

  const volNum = parseInt(volume, 10);
  const abvNum = parseFloat(abv);
  if (volNum > 3000 || abvNum > 100) {
    return res.status(400).json({ error: "Anti-Cheat: Ungültiges Volumen oder Alkoholgehalt!" });
  }

  const newDrink = {
    id: generateUniqueId("drink"),
    name,
    category,
    volume: parseInt(volume, 10),
    abv: parseFloat(abv),
    calories: calories ? parseInt(calories, 10) : 0,
  };

  await db.saveDrink(newDrink);
  res.status(201).json(newDrink);
});

// Delete Custom Drink
app.delete("/api/drinks/:id", authenticate, async (req, res) => {
  await db.deleteDrink(req.params.id);
  res.json({ success: true });
});

// ==========================================
// Drink Logs Endpoints
// ==========================================

// Get All Logs
app.get("/api/logs", authenticate, async (req, res) => {
  const logs = await db.getLogs();
  res.json(logs);
});

// Log a Drink
app.post("/api/logs", authenticate, async (req, res) => {
  const { drinkId, eventId, timestamp, latitude, longitude, lat, lng, drink_name, volume_ml, alcohol_grams, is_water } = req.body;

  let resolvedDrinkId = drinkId;
  let resolvedVolume = Number(volume_ml) || 0;
  let resolvedAbv = 0;

  if (resolvedDrinkId) {
    const drinks = await db.getDrinks();
    const drink = drinks.find(d => d.id === resolvedDrinkId);
    if (drink) {
      resolvedVolume = drink.volume;
      resolvedAbv = drink.abv;
    }
  } else if (volume_ml) {
    resolvedAbv = volume_ml > 0 ? (alcohol_grams / 0.789 / volume_ml) * 100 : 0;
  }

  if (resolvedVolume > 3000 || resolvedAbv > 100) {
    return res.status(400).json({ error: "Anti-Cheat: Ungültiges Volumen oder Alkoholgehalt!" });
  }

  if (!resolvedDrinkId && drink_name) {
    const drinks = await db.getDrinks();
    let drink = drinks.find(d => d.name.toLowerCase() === drink_name.toLowerCase() && d.volume === Number(volume_ml));
    if (!drink) {
      const abv = volume_ml > 0 ? (alcohol_grams / 0.789 / volume_ml) * 100 : 0;
      drink = {
        id: generateUniqueId("drink"),
        name: drink_name,
        category: is_water ? "Alkoholfrei" : "Bier",
        volume: Number(volume_ml) || 330,
        abv: Number(abv.toFixed(2)),
        calories: 0
      };
      await db.saveDrink(drink);
    }
    resolvedDrinkId = drink.id;
  }

  if (!resolvedDrinkId) {
    return res.status(400).json({ error: "drinkId oder drink_name wird benötigt." });
  }

  const resolvedLatitude = latitude !== undefined && latitude !== null ? latitude : lat;
  const resolvedLongitude = longitude !== undefined && longitude !== null ? longitude : lng;

  const newLog = {
    id: generateUniqueId("log"),
    drinkId: resolvedDrinkId,
    userId: req.userId,
    eventId,
    timestamp: timestamp || new Date().toISOString(),
    latitude: resolvedLatitude !== undefined && resolvedLatitude !== null ? Number(resolvedLatitude) : null,
    longitude: resolvedLongitude !== undefined && resolvedLongitude !== null ? Number(resolvedLongitude) : null,
  };

  await db.saveLog(newLog);
  res.status(201).json({ success: true, log: newLog });
});

// Delete a Log
app.delete("/api/logs/:id", authenticate, async (req, res) => {
  try {
    await db.deleteLog(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Search Users
app.get("/api/users/search", authenticate, async (req, res) => {
  try {
    const q = req.query.q || "";
    const users = await db.searchUsers(q);
    res.json(users.map(enrichUserProgress));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Resolves the confirmed friends of a user to their user ids. Friendships are
// stored by username (no FK), so they have to be matched back to ids here.
// Shared by /api/feed and /api/radar so both agree on who counts as a friend.
function resolveFriendUserIds(currentUser, users, friendships, { includeSelf = true } = {}) {
  const currentUsername = (currentUser.name || "").toLowerCase();
  const friendUsernames = new Set();

  friendships.forEach((f) => {
    if (f.status !== "accepted") return;
    const sender = (f.sender_username || "").toLowerCase();
    const receiver = (f.receiver_username || "").toLowerCase();
    if (sender === currentUsername) friendUsernames.add(receiver);
    else if (receiver === currentUsername) friendUsernames.add(sender);
  });

  const friendUserIds = new Set();
  if (includeSelf) friendUserIds.add(currentUser.id);

  users.forEach((u) => {
    if (friendUsernames.has((u.name || "").toLowerCase())) {
      friendUserIds.add(u.id);
    }
  });

  return friendUserIds;
}

// Friends radar: who of my friends is currently active, based on their most
// recent drink log. Intentionally exposes no coordinates — the GPS map is a
// separate, later feature with its own privacy considerations.
app.get("/api/radar", authenticate, async (req, res) => {
  try {
    const [logs, users, drinks, friendships] = await Promise.all([
      db.getLogs(),
      db.getUsers(),
      db.getDrinks(),
      db.getFriendships(),
    ]);

    const friendIds = resolveFriendUserIds(req.user, users, friendships, { includeSelf: false });

    const now = Date.now();
    const ACTIVE_MS = 30 * 60 * 1000;
    const RECENT_MS = 3 * 60 * 60 * 1000;

    const radar = users
      .filter((u) => friendIds.has(u.id))
      .map((u) => {
        const userLogs = logs.filter((l) => l.userId === u.id);
        let lastLog = null;
        for (const log of userLogs) {
          if (!lastLog || new Date(log.timestamp).getTime() > new Date(lastLog.timestamp).getTime()) {
            lastLog = log;
          }
        }

        const lastActivityMs = lastLog ? new Date(lastLog.timestamp).getTime() : null;
        const elapsed = lastActivityMs === null ? null : now - lastActivityMs;

        let status = "idle";
        if (elapsed !== null && elapsed <= ACTIVE_MS) status = "active";
        else if (elapsed !== null && elapsed <= RECENT_MS) status = "recent";

        const lastDrink = lastLog ? drinks.find((d) => d.id === lastLog.drinkId) : null;

        return {
          id: u.id,
          username: u.name,
          avatar: u.avatar || null,
          level: u.level || 1,
          status,
          lastDrinkName: lastDrink ? lastDrink.name : null,
          lastActivity: lastLog ? lastLog.timestamp : null,
        };
      });

    // Most recently active first, friends who never logged anything last.
    const statusRank = { active: 0, recent: 1, idle: 2 };
    radar.sort((a, b) => {
      if (statusRank[a.status] !== statusRank[b.status]) {
        return statusRank[a.status] - statusRank[b.status];
      }
      const aTime = a.lastActivity ? new Date(a.lastActivity).getTime() : 0;
      const bTime = b.lastActivity ? new Date(b.lastActivity).getTime() : 0;
      return bTime - aTime;
    });

    res.json(radar);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Live Feed. scope=friends (default) -> confirmed friends + self,
// scope=groups -> members of the groups I'm in, plus that group's posts.
app.get("/api/feed", authenticate, async (req, res) => {
  try {
    const logs = await db.getLogs();
    const users = await db.getUsers();
    const drinks = await db.getDrinks();
    const posts = await db.getPosts();
    const friendships = await db.getFriendships();

    const scope = req.query.scope === "groups" ? "groups" : "friends";

    let visibleUserIds;
    let visiblePostFilter;

    if (scope === "groups") {
      const groups = await db.getGroups();
      const myGroups = groups.filter((g) => (g.memberIds || []).includes(req.user.id));
      const myGroupIds = new Set(myGroups.map((g) => g.id));

      visibleUserIds = new Set();
      myGroups.forEach((g) => (g.memberIds || []).forEach((id) => visibleUserIds.add(id)));

      // Only posts actually belonging to one of my groups.
      visiblePostFilter = (p) => p.contextType === "group" && myGroupIds.has(p.contextId);
    } else {
      visibleUserIds = resolveFriendUserIds(req.user, users, friendships);
      visiblePostFilter = (p) => visibleUserIds.has(p.userId) || p.userId === "system";
    }

    const friendUserIds = visibleUserIds;

    const filteredLogs = logs.filter((l) => friendUserIds.has(l.userId));
    const filteredPosts = posts.filter(visiblePostFilter);

    const feedLogs = filteredLogs.map((log) => {
      const user = users.find((u) => u.id === log.userId);
      const drink = drinks.find((d) => d.id === log.drinkId);
      return {
        id: log.id,
        userId: log.userId,
        username: user ? user.name : "Unbekannt",
        userAvatar: user ? user.avatar : null,
        drink_name: drink ? drink.name : "Unbekanntes Getränk",
        volume_ml: drink ? drink.volume : 0,
        alcohol_grams: drink ? Number((drink.volume * (drink.abv / 100) * 0.789).toFixed(2)) : 0,
        is_water: drink ? drink.abv === 0 : false,
        latitude: log.latitude || null,
        longitude: log.longitude || null,
        timestamp: log.timestamp,
        type: "log",
      };
    });

    const feedPosts = filteredPosts.map((post) => {
      const user = users.find((u) => u.id === post.userId);
      return {
        id: post.id,
        userId: post.userId,
        username: user ? user.name : (post.userId === "system" ? "TrinkDuell" : "System"),
        userAvatar: user ? user.avatar : null,
        text: post.text,
        timestamp: post.timestamp,
        type: "post",
      };
    });

    const combinedFeed = [...feedLogs, ...feedPosts];
    combinedFeed.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    res.json(combinedFeed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Map Coordinates for last 100 drinks with GPS
// Map pins. Location data is the most sensitive thing this app stores, so
// this is strictly limited to people the user actually shares a connection
// with (confirmed friends + members of their groups) plus themselves.
// db.getMapCoordinates() deliberately stays unfiltered/low-level — the
// access decision lives here, next to the authenticated request.
app.get("/api/map", authenticate, async (req, res) => {
  try {
    const [mappedLogs, users, friendships, groups] = await Promise.all([
      db.getMapCoordinates(),
      db.getUsers(),
      db.getFriendships(),
      db.getGroups(),
    ]);

    const visibleUserIds = resolveFriendUserIds(req.user, users, friendships);
    groups
      .filter((g) => (g.memberIds || []).includes(req.user.id))
      .forEach((g) => (g.memberIds || []).forEach((id) => visibleUserIds.add(id)));

    res.json(mappedLogs.filter((entry) => visibleUserIds.has(entry.userId)));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get Scoreboard
app.get("/api/scoreboard", authenticate, async (req, res) => {
  try {
    const users = await db.getUsers();
    // Sort users by points descending
    const sortedUsers = [...users].sort((a, b) => b.points - a.points);
    // Map to the requested fields username and points
    const rows = sortedUsers.map((u) => {
      const progress = db.getUserProgress(u.points, u.level);
      return {
        id: u.id,
        username: u.name,
        points: u.points,
        avatar: u.avatar,
        title: u.title,
        rank: u.rank,
        level: u.level || 1,
        currentLevel: progress.currentLevel,
        xpForNextLevel: progress.xpForNextLevel,
        xpProgressInCurrentLevel: progress.xpProgressInCurrentLevel,
      };
    });
    res.json({ rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// Groups & Messages Endpoints
// ==========================================

// Get Direct Messages
app.get("/api/messages/direct/:otherUserId", authenticate, async (req, res) => {
  try {
    const messages = await db.getDirectMessages(req.userId, req.params.otherUserId);
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Group Messages
app.get("/api/messages/group/:groupId", authenticate, async (req, res) => {
  try {
    const messages = await db.getGroupMessages(req.params.groupId);
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send Message
app.post("/api/messages", authenticate, async (req, res) => {
  try {
    const { receiverId, groupId, content } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: "Nachrichteninhalt darf nicht leer sein." });
    }
    if (!receiverId && !groupId) {
      return res.status(400).json({ error: "Empfänger oder Gruppe muss angegeben werden." });
    }

    const newMessage = {
      id: generateUniqueId("msg"),
      sender_id: req.userId,
      receiver_id: receiverId || null,
      group_id: groupId || null,
      content: content.trim(),
      timestamp: new Date().toISOString(),
    };

    await db.saveMessage(newMessage);

    const users = await db.getUsers();
    const sender = users.find((u) => u.id === req.userId);

    res.status(201).json({
      ...newMessage,
      sender_name: sender ? sender.name : "Unbekannt",
      sender_avatar: sender ? sender.avatar : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Groups
app.get("/api/groups", authenticate, async (req, res) => {
  const groups = await db.getGroups();
  res.json(groups);
});

// Create Group
app.post("/api/groups", authenticate, async (req, res) => {
  const { name, memberIds } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: "Gruppenname fehlt." });
  }

  const initialMembers = Array.isArray(memberIds)
    ? Array.from(new Set([req.userId, ...memberIds]))
    : [req.userId];

  const newGroup = {
    id: generateUniqueId("group"),
    name: name.trim(),
    adminId: req.userId,
    memberIds: initialMembers,
    pendingUserIds: [],
  };

  await db.saveGroup(newGroup);
  res.status(201).json(newGroup);
});

// Join Group Request
app.post("/api/groups/:id/join", authenticate, async (req, res) => {
  const groups = await db.getGroups();
  const group = groups.find((g) => g.id === req.params.id);
  if (!group) {
    return res.status(404).json({ error: "Gruppe nicht gefunden." });
  }

  if (!group.pendingUserIds.includes(req.userId) && !group.memberIds.includes(req.userId)) {
    group.pendingUserIds.push(req.userId);
    await db.saveGroup(group);

    sendPushNotification(
      group.adminId,
      "Neue Beitrittsanfrage",
      `${req.user.name} möchte "${group.name}" beitreten.`,
      { type: "group_join_request", groupId: group.id }
    ).catch(() => {});
  }

  res.json({ success: true });
});

// Handle Join Request (Accept/Reject)
app.post("/api/groups/:id/requests", authenticate, async (req, res) => {
  const { targetUserId, accept } = req.body;
  if (!targetUserId || accept === undefined) {
    return res.status(400).json({ error: "targetUserId und accept-Status fehlen." });
  }

  const groups = await db.getGroups();
  const group = groups.find((g) => g.id === req.params.id);
  if (!group) {
    return res.status(404).json({ error: "Gruppe nicht gefunden." });
  }

  if (group.adminId !== req.userId) {
    return res.status(403).json({ error: "Nur Administratoren können Anfragen bearbeiten." });
  }

  group.pendingUserIds = group.pendingUserIds.filter((id) => id !== targetUserId);
  if (accept && !group.memberIds.includes(targetUserId)) {
    group.memberIds.push(targetUserId);
  }

  await db.saveGroup(group);
  res.json({ success: true });
});

// ==========================================
// Events Endpoints
// ==========================================

// Get All Events
app.get("/api/events", authenticate, async (req, res) => {
  const events = await db.getEvents();
  res.json(events);
});

// Create Event
app.post("/api/events", authenticate, async (req, res) => {
  const { name, durationHours } = req.body;
  if (!name || !durationHours) {
    return res.status(400).json({ error: "Name und Eventdauer fehlen." });
  }

  const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();
  const newEvent = {
    id: generateUniqueId("event"),
    name,
    creatorId: req.userId,
    inviteCode,
    memberIds: [req.userId],
    endTimestamp: new Date(Date.now() + parseInt(durationHours, 10) * 60 * 60 * 1000).toISOString(),
  };

  await db.saveEvent(newEvent);
  res.status(201).json(newEvent);
});

// Join Event
app.post("/api/events/join", authenticate, async (req, res) => {
  const { code } = req.body;
  if (!code) {
    return res.status(400).json({ error: "Einladungscode fehlt." });
  }

  const events = await db.getEvents();
  const event = events.find((e) => e.inviteCode === code.trim().toUpperCase());
  if (!event) {
    return res.status(404).json({ error: "Ungültiger Code. Event nicht gefunden." });
  }

  if (!event.memberIds.includes(req.userId)) {
    event.memberIds.push(req.userId);
    const database = await db.getEvents();
    const idx = database.findIndex((e) => e.id === event.id);
    if (idx !== -1) {
      database[idx] = event;
      await db.saveEvent(event); // Re-saves specific item
    }
  }

  res.json(event);
});

// ==========================================
// Posts Endpoints
// ==========================================

// Get Posts
app.get("/api/posts", authenticate, async (req, res) => {
  const posts = await db.getPosts();
  res.json(posts);
});

// Create Post
app.post("/api/posts", authenticate, async (req, res) => {
  const { text, contextType, contextId, image } = req.body;
  if (!text || !contextType || !contextId) {
    return res.status(400).json({ error: "Text und Kontext fehlen." });
  }

  const newPost = {
    id: generateUniqueId("post"),
    userId: req.userId,
    text,
    contextType,
    contextId,
    image,
    timestamp: new Date().toISOString(),
  };

  await db.savePost(newPost);
  res.status(201).json(newPost);
});

// ==========================================
// Duels & Quests Endpoints
// ==========================================

const calculateDuelPoints = (userId, startTime, endTime, logs, drinks) => {
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();
  let points = 0;
  for (const log of logs) {
    if (log.userId === userId) {
      const logTime = new Date(log.timestamp).getTime();
      if (logTime >= start && logTime <= end) {
        const drink = drinks.find((d) => d.id === log.drinkId);
        if (drink) {
          const grams = drink.volume * (drink.abv / 100) * 0.789;
          points += 10 + Math.round(grams * 2);
        }
      }
    }
  }
  return points;
};

// Get Duels
app.get("/api/duels", authenticate, async (req, res) => {
  try {
    const duels = await db.getDuels();
    const logs = await db.getLogs();
    const drinks = await db.getDrinks();
    const now = Date.now();

    for (let d of duels) {
      let changed = false;
      if (d.status === "active") {
        const end = new Date(d.endTime).getTime();
        if (now > end) {
          d.status = "finished";
          changed = true;
        }
      }
      if (d.status === "active" || d.status === "finished") {
        const p1 = calculateDuelPoints(d.creatorId, d.startTime, d.endTime, logs, drinks);
        const p2 = calculateDuelPoints(d.opponentId, d.startTime, d.endTime, logs, drinks);
        if (d.creatorPoints !== p1 || d.opponentPoints !== p2) {
          d.creatorPoints = p1;
          d.opponentPoints = p2;
          changed = true;
        }
      }
      if (changed) {
        await db.saveDuel(d);
      }
    }
    res.json(duels);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create Duel
app.post("/api/duels", authenticate, async (req, res) => {
  try {
    const { opponentId, duration } = req.body;
    if (!opponentId || !duration) {
      return res.status(400).json({ error: "opponentId und duration fehlen." });
    }

    const newDuel = {
      id: generateUniqueId("duel"),
      creatorId: req.userId,
      opponentId,
      duration: parseInt(duration, 10),
      status: "pending",
      startTime: null,
      endTime: null,
      creatorPoints: 0,
      opponentPoints: 0,
    };

    await db.saveDuel(newDuel);

    sendPushNotification(
      opponentId,
      "Duell-Herausforderung! ⚔️",
      `${req.user.name} hat dich zu einem Duell herausgefordert.`,
      { type: "duel_challenge", duelId: newDuel.id }
    ).catch(() => {});

    res.status(201).json(newDuel);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Accept Duel
app.post("/api/duels/:id/accept", authenticate, async (req, res) => {
  try {
    const duels = await db.getDuels();
    const duel = duels.find((d) => d.id === req.params.id);
    if (!duel) {
      return res.status(404).json({ error: "Duell nicht gefunden." });
    }
    if (duel.opponentId !== req.userId) {
      return res.status(403).json({ error: "Nur der geforderte Gegner kann das Duell annehmen." });
    }
    if (duel.status !== "pending") {
      return res.status(400).json({ error: "Duell ist nicht mehr ausstehend." });
    }

    const start = new Date();
    const end = new Date(start.getTime() + duel.duration * 60 * 1000);

    duel.status = "active";
    duel.startTime = start.toISOString();
    duel.endTime = end.toISOString();

    await db.saveDuel(duel);

    sendPushNotification(
      duel.creatorId,
      "Duell angenommen! 🍻",
      `${req.user.name} hat dein Duell angenommen. Los geht's!`,
      { type: "duel_accepted", duelId: duel.id }
    ).catch(() => {});

    res.json(duel);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get Group Quests
app.get("/api/quests", authenticate, async (req, res) => {
  try {
    const quests = await db.getGroupQuests();
    const groups = await db.getGroups();
    const logs = await db.getLogs();
    const drinks = await db.getDrinks();
    const now = Date.now();

    for (let q of quests) {
      if (q.status === "active") {
        const group = groups.find((g) => g.id === q.groupId);
        if (!group) continue;

        const start = new Date(q.startTime).getTime();
        const end = new Date(q.endTime).getTime();

        // Calculate current value based on group member logs in interval
        let current = 0;
        const memberLogs = logs.filter(l => group.memberIds.includes(l.userId));
        
        for (const log of memberLogs) {
          const logTime = new Date(log.timestamp).getTime();
          if (logTime >= start && logTime <= end) {
            const drink = drinks.find(d => d.id === log.drinkId);
            if (drink) {
              if (q.type === "drinks") {
                current += 1;
              } else if (q.type === "volume") {
                current += drink.volume / 1000; // in Liters
              } else if (q.type === "water") {
                if (drink.category === "Alkoholfrei" || drink.name.toLowerCase().includes("wasser")) {
                  current += 1;
                }
              }
            }
          }
        }

        q.currentValue = Number(current.toFixed(1));

        if (q.currentValue >= q.targetValue) {
          q.status = "completed";
          // Log group quest post to social feed!
          const postText = `🏆 GEMEINSAM GEWONNEN! Die Gruppe "${group.name}" hat das Ziel "${q.title}" erreicht! (+50 Punkte für alle)`;
          const newPost = {
            id: generateUniqueId("post"),
            userId: "system",
            text: postText,
            contextType: "group",
            contextId: q.groupId,
            timestamp: new Date().toISOString(),
          };
          await db.savePost(newPost);
        } else if (now > end) {
          q.status = "failed";
        }
        await db.saveGroupQuest(q);
      }
    }
    res.json(quests);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create Group Quest
app.post("/api/quests", authenticate, async (req, res) => {
  try {
    const { groupId, title, type, targetValue, durationHours } = req.body;
    if (!groupId || !title || !type || !targetValue || !durationHours) {
      return res.status(400).json({ error: "Alle Parameter für Gruppen-Quest fehlen." });
    }

    const start = new Date();
    const end = new Date(start.getTime() + parseInt(durationHours, 10) * 60 * 60 * 1000);

    const newQuest = {
      id: generateUniqueId("quest"),
      groupId,
      title,
      type,
      targetValue: parseFloat(targetValue),
      currentValue: 0.0,
      status: "active",
      startTime: start.toISOString(),
      endTime: end.toISOString(),
    };

    await db.saveGroupQuest(newQuest);
    res.status(201).json(newQuest);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// Friends Endpoints
// ==========================================

// Send a friend request
app.post("/api/friends/request", authenticate, async (req, res) => {
  try {
    const { sender_username, receiver_username } = req.body;
    if (!sender_username || !receiver_username) {
      return res.status(400).json({ error: "Absender und Empfänger werden benötigt." });
    }

    const users = await db.getUsers();
    const sender = users.find(u => u.name.toLowerCase() === sender_username.toLowerCase());
    const receiver = users.find(u => u.name.toLowerCase() === receiver_username.toLowerCase());

    if (!sender || !receiver) {
      return res.status(404).json({ error: "Benutzer existiert nicht." });
    }

    const friendships = await db.getFriendships();
    const exists = friendships.some(f => 
      (f.sender_username.toLowerCase() === sender_username.toLowerCase() && f.receiver_username.toLowerCase() === receiver_username.toLowerCase()) ||
      (f.sender_username.toLowerCase() === receiver_username.toLowerCase() && f.receiver_username.toLowerCase() === sender_username.toLowerCase())
    );

    if (exists) {
      return res.status(400).json({ error: "Freundschaftsanfrage existiert bereits oder ihr seid bereits befreundet." });
    }

    const newRequest = {
      id: generateUniqueId("friendship"),
      sender_username: sender.name,
      receiver_username: receiver.name,
      status: "pending"
    };

    await db.saveFriendship(newRequest);

    sendPushNotification(
      receiver.id,
      "Neue Freundschaftsanfrage",
      `${sender.name} möchte sich mit dir befreunden.`,
      { type: "friend_request" }
    ).catch(() => {});

    res.status(201).json({ success: true, request: newRequest });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Accept a friend request
app.post("/api/friends/accept", authenticate, async (req, res) => {
  try {
    const { sender_username, receiver_username } = req.body;
    if (!sender_username || !receiver_username) {
      return res.status(400).json({ error: "Absender und Empfänger werden benötigt." });
    }

    const friendships = await db.getFriendships();
    const request = friendships.find(f => 
      f.status === "pending" && 
      f.sender_username.toLowerCase() === sender_username.toLowerCase() && 
      f.receiver_username.toLowerCase() === receiver_username.toLowerCase()
    );

    if (!request) {
      return res.status(404).json({ error: "Keine ausstehende Freundschaftsanfrage gefunden." });
    }

    request.status = "accepted";
    await db.saveFriendship(request);

    const users = await db.getUsers();
    const originalSender = users.find((u) => u.name.toLowerCase() === sender_username.toLowerCase());
    if (originalSender) {
      sendPushNotification(
        originalSender.id,
        "Freundschaftsanfrage angenommen! 🎉",
        `${receiver_username} hat deine Freundschaftsanfrage angenommen.`,
        { type: "friend_accepted" }
      ).catch(() => {});
    }

    res.json({ success: true, request });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all friends for a user (accepted and pending)
app.get("/api/friends/:username", authenticate, async (req, res) => {
  try {
    const { username } = req.params;
    const friendships = await db.getFriendships();
    const users = await db.getUsers();

    // Accepted friends
    const acceptedFriendnames = friendships
      .filter(f => f.status === "accepted" && (f.sender_username.toLowerCase() === username.toLowerCase() || f.receiver_username.toLowerCase() === username.toLowerCase()))
      .map(f => f.sender_username.toLowerCase() === username.toLowerCase() ? f.receiver_username : f.sender_username);

    const friendsList = users
      .filter(u => acceptedFriendnames.some(fn => fn.toLowerCase() === u.name.toLowerCase()))
      .map(u => enrichUserProgress(u));

    // Pending requests received (incoming requests that this user can accept)
    const pendingIncomingNames = friendships
      .filter(f => f.status === "pending" && f.receiver_username.toLowerCase() === username.toLowerCase())
      .map(f => f.sender_username);

    const pendingList = users
      .filter(u => pendingIncomingNames.some(pn => pn.toLowerCase() === u.name.toLowerCase()))
      .map(u => enrichUserProgress(u));

    res.json({ friends: friendsList, pending: pendingList });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// Start Server
// ==========================================
app.listen(PORT, "0.0.0.0", async () => {
  console.log(`[TrinkDuell Backend] Server läuft auf http://localhost:${PORT}`);
  // Hash any existing plaintext passwords (safe no-op if already hashed)
  await migratePlaintextPasswords();
});
