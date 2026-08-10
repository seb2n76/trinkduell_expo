const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const db = require("./db");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const { sendPushNotification } = require("./push");
const { sendPasswordResetEmail } = require("./email");

// Largest request body accepted anywhere. Avatars arrive as Base64 from the
// image picker, which hands over the photo at quality 0.8 without resizing —
// a few megabytes is normal. Only the two avatar routes get this limit; see
// AVATAR_JSON / the global express.json below.
const AVATAR_MAX_BYTES = 8 * 1024 * 1024;

// Multipart avatar upload fallback (used when the client can't produce a
// Base64 payload). Memory storage since avatars are small and get converted
// straight to a Base64 data URL below, same as the JSON upload path.
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AVATAR_MAX_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    // Whatever arrives here is turned into a data: URL and stored as the
    // avatar, so refuse anything that isn't an image outright.
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) {
      return cb(new Error("UNSUPPORTED_IMAGE_TYPE"));
    }
    cb(null, true);
  },
});

// ─── JWT Secret ───────────────────────────────────────────────────────────────
// The fallback exists so a fresh clone runs without setup. It must never reach
// a real deployment: the repo is public, so a known signing key means anyone
// can mint a valid token for any account. DATABASE_URL is the marker for "this
// is a real deployment" — JSON mode is the local dev path.
const JWT_SECRET_FALLBACK = "trinkduell-dev-secret-change-in-prod";
const JWT_SECRET = process.env.JWT_SECRET || JWT_SECRET_FALLBACK;
const MIN_JWT_SECRET_LENGTH = 32;

if (process.env.DATABASE_URL) {
  if (JWT_SECRET === JWT_SECRET_FALLBACK) {
    console.error(
      "[TrinkDuell] FATAL: JWT_SECRET ist nicht gesetzt, aber eine echte Datenbank ist konfiguriert.\n" +
        "  Der eingebaute Entwicklungs-Schlüssel steht im öffentlichen Repo — damit könnte jeder\n" +
        "  gültige Tokens für beliebige Konten ausstellen. Setze JWT_SECRET in server/.env:\n" +
        "      openssl rand -hex 32"
    );
    process.exit(1);
  }
  if (JWT_SECRET.length < MIN_JWT_SECRET_LENGTH) {
    console.error(
      `[TrinkDuell] FATAL: JWT_SECRET ist zu kurz (${JWT_SECRET.length} Zeichen, mindestens ${MIN_JWT_SECRET_LENGTH}).`
    );
    process.exit(1);
  }
} else if (JWT_SECRET === JWT_SECRET_FALLBACK) {
  console.warn(
    "[TrinkDuell] WARNUNG: Entwicklungs-JWT-Schlüssel aktiv. Nur für lokales Testen geeignet."
  );
}

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

/**
 * The single place a user record becomes an API response.
 *
 * Secure by default: `email` is only included when the caller explicitly asks
 * for it, which may only happen when the record IS the requester's own
 * profile. Every other route — the user list, search, a foreign profile, a
 * friends list — gets a record without it. Handing out the email addresses of
 * an entire user base to anyone holding any account is exactly the kind of
 * leak the password hash once was.
 *
 * sessionValidAfter is internal auth state (see authenticate) and never goes
 * out at all.
 */
function enrichUserProgress(user, { includeEmail = false } = {}) {
  if (!user) return user;
  const { password, sessionValidAfter, email, ...sanitizedUser } = user;
  const progress = db.getUserProgress(user.points, user.level);
  return {
    ...sanitizedUser,
    ...(includeEmail ? { email } : {}),
    currentLevel: progress.currentLevel,
    xpForNextLevel: progress.xpForNextLevel,
    xpProgressInCurrentLevel: progress.xpProgressInCurrentLevel,
    isLevelLocked: progress.isLocked
  };
}

// Shorthand for "this record is the requester's own profile".
const enrichOwnProfile = (user) => enrichUserProgress(user, { includeEmail: true });

// ─── CORS ─────────────────────────────────────────────────────────────────────
// An allow-list instead of the previous wide-open cors(), which let any web
// page on the internet call this API from a visitor's browser.
//
// Requests WITHOUT an Origin header are allowed through: CORS is a browser
// mechanism, and the native app (and curl, and health checks) simply don't
// send one. Rejecting those would break the mobile app without protecting
// anything — a non-browser client isn't bound by CORS in the first place.
const DEFAULT_ALLOWED_ORIGINS = [
  "https://webapp.trinkduell.com",
  "http://localhost:8081",
  "http://localhost:19006",
];
const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",")
    : DEFAULT_ALLOWED_ORIGINS
  )
    .map((o) => o.trim())
    .filter(Boolean)
);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || ALLOWED_ORIGINS.has(origin)) return callback(null, true);
      callback(new Error("CORS_NOT_ALLOWED"));
    },
  })
);

// ─── Body limits ──────────────────────────────────────────────────────────────
// 10 MB used to apply to every route, which made a memory-exhaustion attempt a
// single curl away. Normal API payloads are tiny; only avatars are big, so the
// large limit is scoped to exactly the two routes that carry one:
//   POST /api/users/:id/avatar  — the upload itself
//   PUT  /api/users/:id         — the client sends the whole user object back,
//                                 avatar included, e.g. on a rename
// Registered further down, AFTER the rate limiter — a flood must be rejected
// before an 8 MB body gets parsed into memory, not after.
const avatarJson = express.json({ limit: AVATAR_MAX_BYTES });

// Helper to generate unique IDs
const generateUniqueId = (prefix) => {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 1000000);
  return `${prefix}-${timestamp}-${random}`;
};

// ─── Rate limiting ────────────────────────────────────────────────────────────
// Deliberately dependency-free and in-memory: the backend runs as a single
// container, so an external store would add moving parts without adding
// safety. Two dimensions are limited on purpose:
//   - per IP      → stops one machine hammering the API
//   - per account → stops a *distributed* guess against ONE account, which an
//                   IP limit alone does not catch
const rateBuckets = new Map();

function rateLimitHit(key, max, windowMs) {
  const now = Date.now();
  const hits = (rateBuckets.get(key) || []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    rateBuckets.set(key, hits);
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((windowMs - (now - hits[0])) / 1000)) };
  }
  hits.push(now);
  rateBuckets.set(key, hits);
  return { allowed: true };
}

function clearRateLimit(key) {
  rateBuckets.delete(key);
}

// Drop empty buckets so a long-running server doesn't grow a bucket per IP
// that ever touched it.
setInterval(() => {
  const now = Date.now();
  for (const [key, hits] of rateBuckets) {
    if (hits.every((t) => now - t > 60 * 60 * 1000)) rateBuckets.delete(key);
  }
}, 10 * 60 * 1000).unref();

// Behind the Cloudflare Tunnel the socket address is always the tunnel's, so
// the forwarded headers are the only way to tell clients apart. They are
// forgeable by anyone who can reach the container directly — which is exactly
// why every sensitive limiter below is ALSO keyed by account, and that key
// cannot be forged.
function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  return (
    req.headers["cf-connecting-ip"] ||
    (typeof forwarded === "string" ? forwarded.split(",")[0].trim() : "") ||
    req.socket.remoteAddress ||
    "unknown"
  );
}

/**
 * ipMax and accountMax are separate on purpose, and ipMax is always the
 * looser of the two.
 *
 * A whole flat, bar or festival shares one public IP — which is the normal
 * case for this app, not the exception. A strict IP limit would mean one
 * person mistyping their password locks out everybody at the party. So the
 * IP limit is only a flood backstop, while the tight limit sits on the
 * account key, where it hits an attacker and nobody else.
 */
function rateLimit({ scope, ipMax, accountMax, windowMs, accountKey }) {
  return (req, res, next) => {
    const checks = [{ key: `${scope}:ip:${clientIp(req)}`, max: ipMax }];
    if (accountKey && accountMax) {
      const value = accountKey(req);
      if (value) {
        checks.push({ key: `${scope}:acct:${String(value).trim().toLowerCase()}`, max: accountMax });
      }
    }
    for (const { key, max } of checks) {
      const result = rateLimitHit(key, max, windowMs);
      if (!result.allowed) {
        res.set("Retry-After", String(result.retryAfterSec));
        return res.status(429).json({
          error: "Zu viele Versuche. Bitte warte einen Moment und probiere es dann erneut.",
        });
      }
    }
    next();
  };
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

// Backstop against a client (or a script) flooding the API. Generous enough
// that normal use — including the app's polling — never comes close.
app.use("/api", rateLimit({ scope: "global", ipMax: 1200, windowMs: MINUTE }));

// Body parsing happens here, after the limiter above: the big avatar limit is
// scoped to exactly the two routes that carry an image, everything else gets
// 256 kB. Previously 10 MB applied to all 47 routes.
app.use("/api/users/:id/avatar", avatarJson);
app.put("/api/users/:id", avatarJson);
app.use(express.json({ limit: "256kb" }));

// ─── Input validation ─────────────────────────────────────────────────────────
// Small and explicit rather than a schema library: every rule here exists
// because the field ends up in the database, in a push notification, or on
// another user's screen, and none of them was bounded before.

const LIMITS = {
  username: { min: 3, max: 24 },
  email: { max: 254 },
  password: { min: 8, max: 200 },
  messageContent: { max: 2000 },
  postText: { max: 1000 },
  groupName: { min: 2, max: 40 },
  eventName: { min: 2, max: 60 },
  drinkName: { min: 1, max: 60 },
  questTitle: { min: 2, max: 80 },
};

// Letters (incl. umlauts), digits, and a few separators. Deliberately no
// whitespace and no control characters: usernames are the join key for
// friendships and appear verbatim in push notifications.
const USERNAME_PATTERN = /^[A-Za-z0-9ÄÖÜäöüß._-]+$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Validates and normalises a free-text field.
 * Returns { ok: true, value } or { ok: false, error } with a German message.
 */
function validateText(raw, label, { min = 1, max, pattern, patternHint } = {}) {
  if (typeof raw !== "string") {
    return { ok: false, error: `${label} fehlt oder hat ein ungültiges Format.` };
  }
  const value = raw.trim();
  if (value.length < min) {
    return {
      ok: false,
      error: min === 1
        ? `${label} darf nicht leer sein.`
        : `${label} muss mindestens ${min} Zeichen lang sein.`,
    };
  }
  if (max && value.length > max) {
    return { ok: false, error: `${label} darf höchstens ${max} Zeichen lang sein.` };
  }
  // Control characters would break rendering and log output wherever the value
  // is echoed back.
  if (/[\x00-\x1f\x7f]/.test(value)) {
    return { ok: false, error: `${label} enthält ungültige Zeichen.` };
  }
  if (pattern && !pattern.test(value)) {
    return { ok: false, error: patternHint || `${label} enthält ungültige Zeichen.` };
  }
  return { ok: true, value };
}

// Avatars are stored verbatim and later used as an image source, so only a
// Base64 image data URL is accepted — not an arbitrary string, and not a
// remote or javascript: URL.
function validateAvatarDataUrl(raw) {
  if (typeof raw !== "string") {
    return { ok: false, error: "Bilddaten fehlen." };
  }
  if (!/^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(raw)) {
    return { ok: false, error: "Ungültiges Bildformat. Erlaubt sind JPEG, PNG, WebP und GIF." };
  }
  if (raw.length > AVATAR_MAX_BYTES) {
    return { ok: false, error: "Das Bild ist zu groß." };
  }
  return { ok: true, value: raw };
}

// ─── Error responses ──────────────────────────────────────────────────────────
// Routes used to answer with `err.message`, which leaks internals (SQL text,
// file paths, driver errors) to any caller. The detail belongs in the server
// log; the client gets a stable German sentence.
function serverError(res, err, context) {
  console.error(`[TrinkDuell] ${context}:`, err);
  res.status(500).json({ error: "Auf dem Server ist ein Fehler aufgetreten. Bitte versuche es später erneut." });
}

// True when the token was issued before the user's last password reset, i.e.
// it belongs to a session that reset is supposed to have ended.
function isTokenRevoked(payload, user) {
  if (!user.sessionValidAfter) return false;
  if (!payload.iat) return true; // no issue time -> can't prove it's recent
  // iat has second precision; allow a second of slack so the token minted by
  // the reset itself is never rejected by its own cut-off.
  return payload.iat * 1000 < new Date(user.sessionValidAfter).getTime() - 1000;
}

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

  if (isTokenRevoked(payload, user)) {
    return res.status(401).json({ error: "Sitzung abgelaufen. Bitte melde dich neu an." });
  }

  req.user = user;
  req.userId = userId;
  req.token = token;
  next();
}

// ─── Authorization helpers ────────────────────────────────────────────────────
// Every "who may see / change this" decision goes through one of these, so the
// rule lives in exactly one place instead of being re-implemented (or
// forgotten) per route.

// Confirmed friendship in either direction. Friendships are stored by
// username, so the comparison is on names, case-insensitively.
async function areFriends(usernameA, usernameB) {
  const a = (usernameA || "").toLowerCase();
  const b = (usernameB || "").toLowerCase();
  if (!a || !b) return false;

  const friendships = await db.getFriendships();
  return friendships.some((f) => {
    if (f.status !== "accepted") return false;
    const sender = (f.sender_username || "").toLowerCase();
    const receiver = (f.receiver_username || "").toLowerCase();
    return (sender === a && receiver === b) || (sender === b && receiver === a);
  });
}

// Returns the group if the user is a member, otherwise null.
async function getGroupIfMember(groupId, userId) {
  const groups = await db.getGroups();
  const group = groups.find((g) => g.id === groupId);
  if (!group) return null;
  return (group.memberIds || []).includes(userId) ? group : null;
}

// ==========================================
// Auth Endpoints
// ==========================================

// Login
app.post(
  "/api/auth/login",
  rateLimit({
    scope: "login",
    ipMax: 100,
    accountMax: 10,
    windowMs: 15 * MINUTE,
    accountKey: (req) => req.body?.emailOrUsername,
  }),
  async (req, res) => {
  const { emailOrUsername, password } = req.body;
  if (typeof emailOrUsername !== "string" || typeof password !== "string" || !emailOrUsername || !password) {
    return res.status(400).json({ error: "E-Mail/Username und Passwort werden benötigt." });
  }
  // Bound the inputs before they reach bcrypt.compare — an unbounded password
  // is CPU the caller gets to spend on the server for free.
  if (emailOrUsername.length > LIMITS.email.max || password.length > LIMITS.password.max) {
    return res.status(400).json({ error: "Ungültige Anmeldedaten!" });
  }

  const users = await db.getUsers();
  const lowercaseInput = emailOrUsername.trim().toLowerCase();
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

  // A successful login clears this account's failure budget, so someone who
  // simply mistyped a few times isn't locked out for the rest of the window.
  clearRateLimit(`login:acct:${String(emailOrUsername).trim().toLowerCase()}`);

  const token = signToken(matchedUser.id);
  res.json({ user: enrichOwnProfile(matchedUser), token });
  }
);

// Register
app.post(
  "/api/auth/register",
  // No account key exists yet at registration, so the IP limit is the only
  // one available — kept high enough that a group signing up together at the
  // same party isn't blocked.
  rateLimit({ scope: "register", ipMax: 20, windowMs: HOUR }),
  async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ error: "Alle Felder müssen ausgefüllt sein." });
  }

  const nameCheck = validateText(username, "Username", {
    ...LIMITS.username,
    pattern: USERNAME_PATTERN,
    patternHint: "Username darf nur Buchstaben, Zahlen, Punkt, Bindestrich und Unterstrich enthalten.",
  });
  if (!nameCheck.ok) return res.status(400).json({ error: nameCheck.error });

  const emailCheck = validateText(email, "E-Mail Adresse", {
    max: LIMITS.email.max,
    pattern: EMAIL_PATTERN,
    patternHint: "Bitte gib eine gültige E-Mail Adresse ein.",
  });
  if (!emailCheck.ok) return res.status(400).json({ error: emailCheck.error });

  if (typeof password !== "string" || password.length < LIMITS.password.min) {
    return res.status(400).json({
      error: `Passwort muss mindestens ${LIMITS.password.min} Zeichen lang sein.`,
    });
  }
  // bcrypt only reads the first 72 bytes anyway; the cap keeps an oversized
  // password from becoming free server CPU.
  if (password.length > LIMITS.password.max) {
    return res.status(400).json({ error: "Passwort ist zu lang." });
  }

  const cleanUsername = nameCheck.value;
  const cleanEmail = emailCheck.value.toLowerCase();

  const users = await db.getUsers();
  if (users.some((u) => u.email?.toLowerCase() === cleanEmail)) {
    return res.status(400).json({ error: "Ein Account mit dieser E-Mail existiert bereits!" });
  }
  if (users.some((u) => u.name.toLowerCase() === cleanUsername.toLowerCase())) {
    return res.status(400).json({ error: "Dieser Username ist bereits vergeben!" });
  }

  const hashedPassword = await bcrypt.hash(password, 12);
  const newUserId = generateUniqueId("user");
  const newUser = {
    id: newUserId,
    name: cleanUsername,
    email: cleanEmail,
    password: hashedPassword,
    // No default photo: the client renders initials when this is empty.
    // Previously every new account got the same stock photo of a stranger,
    // which read as a real profile picture and was confusing.
    avatar: null,
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

  res.status(201).json({ user: enrichOwnProfile(newUser), token });
  }
);

// Logout (Stateless in simple JWT, just response success)
app.post("/api/auth/logout", (req, res) => {
  res.json({ success: true });
});

// Forgot Password
//
// The code is NEVER returned in the response. It used to be, whenever the
// email couldn't be sent — and since sendEmail() reports failure for any
// Resend outage or quota error, not just a missing API key, that turned
// "forgot password" into a two-request account takeover for anybody who knew
// a beta tester's email address.
//
// If email delivery is unavailable the code is written to the server log
// instead (`docker compose logs backend`), so the friends-only beta still has
// a working path without exposing anything over HTTP.
//
// The response is identical whether or not the address exists — otherwise
// this endpoint doubles as a "does this person have an account" oracle.
const GENERIC_RESET_RESPONSE = {
  message:
    "Falls ein Konto mit dieser E-Mail existiert, haben wir einen Reset-Code verschickt. Schau auch im Spam-Ordner nach.",
};

app.post(
  "/api/auth/forgot-password",
  rateLimit({
    scope: "forgot",
    ipMax: 40,
    accountMax: 5,
    windowMs: HOUR,
    accountKey: (req) => req.body?.email,
  }),
  async (req, res) => {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: "E-Mail Adresse wird benötigt." });
    }

    const users = await db.getUsers();
    const user = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());

    if (!user) {
      return res.json(GENERIC_RESET_RESPONSE);
    }

    // crypto.randomInt, not Math.random: Math.random is predictable from
    // observed output and must never generate a security token. Six digits
    // (not four) to widen the space the attempt limit has to protect.
    const code = String(crypto.randomInt(100000, 1000000));
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 minutes
    await db.setPasswordResetCode(user.id, code, expiresAt);

    const emailSent = await sendPasswordResetEmail(user.email, code);
    if (!emailSent) {
      console.warn(
        `[Auth] E-Mail-Versand nicht verfügbar. Reset-Code für ${user.email}: ${code} ` +
          `(gültig 15 Minuten — wird bewusst NICHT an den Client ausgeliefert)`
      );
    }

    res.json(GENERIC_RESET_RESPONSE);
  }
);

// Reset Password (using the code issued by /forgot-password)
//
// Three layers guard the code, because any one of them alone is not enough:
// the rate limit slows an attacker down, the per-code attempt counter in
// db.verifyPasswordResetCode burns the code after 5 wrong guesses, and the
// 15-minute expiry caps how long either matters.
app.post(
  "/api/auth/reset-password",
  rateLimit({
    scope: "reset",
    ipMax: 60,
    accountMax: 10,
    windowMs: HOUR,
    accountKey: (req) => req.body?.email,
  }),
  async (req, res) => {
    const { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword) {
      return res.status(400).json({ error: "E-Mail, Code und neues Passwort werden benötigt." });
    }
    if (typeof newPassword !== "string" || newPassword.length < LIMITS.password.min) {
      return res.status(400).json({
        error: `Passwort muss mindestens ${LIMITS.password.min} Zeichen lang sein.`,
      });
    }
    if (newPassword.length > LIMITS.password.max) {
      return res.status(400).json({ error: "Passwort ist zu lang." });
    }

    const users = await db.getUsers();
    const user = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());

    // Same wording as a wrong code on purpose — an "unknown email" answer here
    // would undo the enumeration protection of /forgot-password.
    const INVALID = { error: "Ungültiger oder abgelaufener Code." };
    if (!user) {
      return res.status(400).json(INVALID);
    }

    const result = await db.verifyPasswordResetCode(user.id, String(code).trim());
    if (!result.valid) {
      if (result.reason === "too_many_attempts") {
        return res.status(400).json({
          error: "Zu viele Fehlversuche. Der Code wurde gesperrt — fordere einen neuen an.",
        });
      }
      return res.status(400).json(INVALID);
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    // Also invalidates every existing session for this account.
    await db.setPasswordAndClearResetCode(user.id, hashedPassword);

    // Someone who just proved control of the mailbox must not stay locked out
    // by a login limit that failed attempts (their own or an attacker's) ran
    // up. Both keys, because login accepts either identifier.
    clearRateLimit(`login:acct:${user.email.toLowerCase()}`);
    clearRateLimit(`login:acct:${user.name.toLowerCase()}`);

    res.json({ success: true });
  }
);

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

  if (!user || isTokenRevoked(payload, user)) {
    return res.json(null); // Also covers sessions ended by a password reset
  }

  res.json({ user: enrichOwnProfile(user), token });
});

// ==========================================
// Users Endpoints
// ==========================================

// Get All Users. Stays a full list — the app picks duel opponents and group
// members from it — but goes through enrichUserProgress like every other
// route, so it no longer hands out the whole beta's email addresses. It used
// to strip only the password.
app.get("/api/users", authenticate, async (req, res) => {
  try {
    const users = await db.getUsers();
    res.json(users.map((u) => enrichUserProgress(u)));
  } catch (err) {
    serverError(res, err, `${req.method} ${req.originalUrl}`);
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
  res.json(enrichOwnProfile(user));
});

// Search Users. MUST stay above /api/users/:id — Express matches routes in
// registration order, so otherwise "search" is parsed as a user id and the
// request 404s instead of searching (same trap as /api/users/me).
//
// Matches usernames only. It used to match email addresses too, which turned
// the friend search into a lookup service: type someone's email, learn whether
// they use TrinkDuell and under which name.
app.get("/api/users/search", authenticate, async (req, res) => {
  try {
    const q = req.query.q || "";
    const users = await db.searchUsers(q);
    res.json(users.map((u) => enrichUserProgress(u)));
  } catch (err) {
    serverError(res, err, `${req.method} ${req.originalUrl}`);
  }
});

// Get Specific User
app.get("/api/users/:id", authenticate, async (req, res) => {
  const users = await db.getUsers();
  const user = users.find((u) => u.id === req.params.id);
  if (!user) {
    return res.status(404).json({ error: "Benutzer nicht gefunden." });
  }
  // Own id via this route still counts as own profile.
  res.json(enrichUserProgress(user, { includeEmail: user.id === req.userId }));
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

  // Update properties. Only these four are writable — the client PUTs the
  // whole user object, so anything not picked out here (points, level, rank,
  // achievements, email) stays server-owned and cannot be self-assigned.
  const { name, avatar, title, selected_title } = req.body;

  if (name !== undefined) {
    const nameCheck = validateText(name, "Username", {
      ...LIMITS.username,
      pattern: USERNAME_PATTERN,
      patternHint: "Username darf nur Buchstaben, Zahlen, Punkt, Bindestrich und Unterstrich enthalten.",
    });
    if (!nameCheck.ok) return res.status(400).json({ error: nameCheck.error });

    if (nameCheck.value.toLowerCase() !== user.name.toLowerCase()) {
      const taken = users.some(
        (u) => u.id !== user.id && u.name.toLowerCase() === nameCheck.value.toLowerCase()
      );
      if (taken) {
        return res.status(400).json({ error: "Dieser Username ist bereits vergeben!" });
      }
      // Friendships reference users by name, so a rename has to carry over or
      // the user silently loses every friend.
      await db.renameUserInFriendships(user.name, nameCheck.value);
    }
    user.name = nameCheck.value;
  }

  // Only overwrite the avatar with an actual value. Clients send the whole
  // user object on updates (e.g. a rename), and any object that happened to
  // carry an empty/null avatar used to wipe the stored profile picture —
  // users had to re-upload it. There is no "remove avatar" feature, so an
  // empty value here always means "unchanged", never "delete".
  if (avatar) {
    const avatarCheck = validateAvatarDataUrl(avatar);
    if (!avatarCheck.ok) return res.status(400).json({ error: avatarCheck.error });
    user.avatar = avatarCheck.value;
  }

  // Titles are chosen from a fixed set the server assigns by level, so they
  // are bounded text rather than free input.
  for (const [field, value] of [["title", title], ["selected_title", selected_title]]) {
    if (value === undefined) continue;
    const check = validateText(value, "Titel", { max: 40 });
    if (!check.ok) return res.status(400).json({ error: check.error });
    user[field] = check.value;
  }

  await db.saveUser(user);
  await db.recalculateAllUsers(); // Make sure ranks/achievements recalculate

  // Guarded above: this can only ever be the caller's own profile.
  res.json(enrichOwnProfile(user));
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

  // If it's a Base64 image payload (e.g. from post request). Validated rather
  // than stored verbatim: this value is handed back out as an image source, so
  // an arbitrary string here (a remote URL, a javascript: URL, or simply a
  // megabyte of junk) has no business being accepted.
  if (req.body && req.body.image) {
    const check = validateAvatarDataUrl(req.body.image);
    if (!check.ok) {
      return res.status(400).json({ error: check.error });
    }
    user.avatar = check.value;
    await db.saveUser(user);
    return res.json({ avatarUrl: check.value });
  }

  // Multipart upload: convert the uploaded file into the same Base64 data
  // URL shape the JSON path stores, so both paths behave identically.
  // The mimetype is already restricted to images by avatarUpload's fileFilter.
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
    serverError(res, err, `${req.method} ${req.originalUrl}`);
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
    serverError(res, err, `${req.method} ${req.originalUrl}`);
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

    res.json(enrichOwnProfile(refreshedUser || user));
  } catch (error) {
    serverError(res, error, `${req.method} ${req.originalUrl}`);
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
    serverError(res, err, `${req.method} ${req.originalUrl}`);
  }
});

// Create Custom Drink
app.post("/api/drinks", authenticate, async (req, res) => {
  const { category, volume, abv, calories } = req.body;
  if (!category || !volume || abv === undefined) {
    return res.status(400).json({ error: "Name, Kategorie, Volumen und Alkoholgehalt fehlen." });
  }

  const nameCheck = validateText(req.body.name, "Getränkename", LIMITS.drinkName);
  if (!nameCheck.ok) return res.status(400).json({ error: nameCheck.error });

  const categoryCheck = validateText(category, "Kategorie", { max: 30 });
  if (!categoryCheck.ok) return res.status(400).json({ error: categoryCheck.error });

  // The old check only rejected values that were too LARGE, so negatives and
  // NaN went straight through into the score calculation.
  const volNum = parseInt(volume, 10);
  const abvNum = parseFloat(abv);
  const calNum = calories ? parseInt(calories, 10) : 0;
  if (!Number.isFinite(volNum) || volNum <= 0 || volNum > 3000) {
    return res.status(400).json({ error: "Anti-Cheat: Ungültiges Volumen oder Alkoholgehalt!" });
  }
  if (!Number.isFinite(abvNum) || abvNum < 0 || abvNum > 100) {
    return res.status(400).json({ error: "Anti-Cheat: Ungültiges Volumen oder Alkoholgehalt!" });
  }
  if (!Number.isFinite(calNum) || calNum < 0 || calNum > 10000) {
    return res.status(400).json({ error: "Ungültige Kalorienangabe." });
  }

  const newDrink = {
    id: generateUniqueId("drink"),
    name: nameCheck.value,
    category: categoryCheck.value,
    volume: volNum,
    abv: abvNum,
    calories: calNum,
    // Who may delete this later. The built-in catalog has no creator and is
    // therefore undeletable by anyone.
    createdBy: req.userId,
  };

  await db.saveDrink(newDrink);
  res.status(201).json(newDrink);
});

// Delete Custom Drink.
//
// Deleting a drink cascades to every drink_log referencing it, so this was the
// most destructive unguarded route in the API: any logged-in user could delete
// "Helles Bier" from the shared catalog and wipe that drink out of everyone's
// history and score. Two guards now:
//   1. only the creator may delete, and the built-in catalog has no creator
//   2. refuse while anyone else still has logs for it, so one user's cleanup
//      can never rewrite another user's stats
app.delete("/api/drinks/:id", authenticate, async (req, res) => {
  try {
    const drinks = await db.getDrinks();
    const drink = drinks.find((d) => d.id === req.params.id);
    if (!drink) {
      return res.status(404).json({ error: "Getränk nicht gefunden." });
    }

    if (!drink.createdBy) {
      return res.status(403).json({ error: "Getränke aus dem Standard-Katalog können nicht gelöscht werden." });
    }
    if (drink.createdBy !== req.userId) {
      return res.status(403).json({ error: "Du kannst nur selbst angelegte Getränke löschen." });
    }

    const logs = await db.getLogs();
    if (logs.some((l) => l.drinkId === drink.id && l.userId !== req.userId)) {
      return res.status(409).json({
        error: "Dieses Getränk wurde bereits von anderen eingetragen und kann nicht mehr gelöscht werden.",
      });
    }

    await db.deleteDrink(req.params.id);
    res.json({ success: true });
  } catch (err) {
    serverError(res, err, `${req.method} ${req.originalUrl}`);
  }
});

// ==========================================
// Drink Logs Endpoints
// ==========================================

// Get All Logs
//
// Cross-user by design: the scoreboard's time filters ("diese Woche", "heute")
// are computed client-side from everyone's logs, and points are public there
// anyway.
//
// Coordinates are NOT. They were being served here in full, which quietly
// handed out every user's location history and made the access check on
// /api/map pointless — the same data was one endpoint over. Nothing in the
// app reads coordinates from this route; the map has its own, filtered one.
app.get("/api/logs", authenticate, async (req, res) => {
  const logs = await db.getLogs();
  res.json(
    logs.map(({ latitude, longitude, ...log }) => log)
  );
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

  // Bounded on BOTH sides: the old check only caught values that were too
  // large, so a negative volume or a NaN went straight into the score.
  if (
    !Number.isFinite(resolvedVolume) || resolvedVolume < 0 || resolvedVolume > 3000 ||
    !Number.isFinite(resolvedAbv) || resolvedAbv < 0 || resolvedAbv > 100
  ) {
    return res.status(400).json({ error: "Anti-Cheat: Ungültiges Volumen oder Alkoholgehalt!" });
  }

  if (!resolvedDrinkId && drink_name) {
    const nameCheck = validateText(drink_name, "Getränkename", LIMITS.drinkName);
    if (!nameCheck.ok) return res.status(400).json({ error: nameCheck.error });

    const drinks = await db.getDrinks();
    let drink = drinks.find(d => d.name.toLowerCase() === nameCheck.value.toLowerCase() && d.volume === Number(volume_ml));
    if (!drink) {
      const abv = volume_ml > 0 ? (alcohol_grams / 0.789 / volume_ml) * 100 : 0;
      drink = {
        id: generateUniqueId("drink"),
        name: nameCheck.value,
        category: is_water ? "Alkoholfrei" : "Bier",
        volume: Number(volume_ml) || 330,
        abv: Number(abv.toFixed(2)),
        calories: 0,
        createdBy: req.userId,
      };
      await db.saveDrink(drink);
    }
    resolvedDrinkId = drink.id;
  }

  if (!resolvedDrinkId) {
    return res.status(400).json({ error: "drinkId oder drink_name wird benötigt." });
  }

  // The client may set a timestamp so the offline sync queue can replay a log
  // with the time it actually happened — but it was accepted unchecked, so any
  // value at all (a date in 2099, or a string that isn't a date) ended up in
  // the scoreboard's time filters and in duel scoring. Bounded to a plausible
  // window instead.
  const now = Date.now();
  const MAX_BACKDATE_MS = 30 * 24 * 60 * 60 * 1000; // offline sync can lag
  const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
  let resolvedTimestamp = new Date().toISOString();
  if (timestamp !== undefined && timestamp !== null) {
    const parsed = new Date(timestamp).getTime();
    if (!Number.isFinite(parsed) || parsed > now + MAX_CLOCK_SKEW_MS || parsed < now - MAX_BACKDATE_MS) {
      return res.status(400).json({ error: "Ungültiger Zeitstempel." });
    }
    resolvedTimestamp = new Date(parsed).toISOString();
  }

  // Coordinates have to be real coordinates — they are rendered on a map.
  const rawLatitude = latitude !== undefined && latitude !== null ? latitude : lat;
  const rawLongitude = longitude !== undefined && longitude !== null ? longitude : lng;
  let resolvedLatitude = null;
  let resolvedLongitude = null;
  if (rawLatitude !== undefined && rawLatitude !== null && rawLongitude !== undefined && rawLongitude !== null) {
    const latNum = Number(rawLatitude);
    const lngNum = Number(rawLongitude);
    if (!Number.isFinite(latNum) || latNum < -90 || latNum > 90 ||
        !Number.isFinite(lngNum) || lngNum < -180 || lngNum > 180) {
      return res.status(400).json({ error: "Ungültige Koordinaten." });
    }
    resolvedLatitude = latNum;
    resolvedLongitude = lngNum;
  }

  const newLog = {
    id: generateUniqueId("log"),
    drinkId: resolvedDrinkId,
    userId: req.userId,
    eventId,
    timestamp: resolvedTimestamp,
    latitude: resolvedLatitude,
    longitude: resolvedLongitude,
  };

  await db.saveLog(newLog);
  res.status(201).json({ success: true, log: newLog });
});

// Delete a Log
app.delete("/api/logs/:id", authenticate, async (req, res) => {
  try {
    // Without this check any authenticated user could delete anyone else's
    // drink logs just by guessing an id — and thereby change their score.
    const logs = await db.getLogs();
    const log = logs.find((l) => l.id === req.params.id);
    if (!log) {
      return res.status(404).json({ error: "Eintrag nicht gefunden." });
    }
    if (log.userId !== req.userId) {
      return res.status(403).json({ error: "Du kannst nur deine eigenen Einträge löschen." });
    }

    await db.deleteLog(req.params.id);
    res.json({ success: true });
  } catch (err) {
    serverError(res, err, `${req.method} ${req.originalUrl}`);
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
    serverError(res, err, `${req.method} ${req.originalUrl}`);
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
    serverError(res, err, `${req.method} ${req.originalUrl}`);
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
    serverError(res, error, `${req.method} ${req.originalUrl}`);
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
    serverError(res, err, `${req.method} ${req.originalUrl}`);
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
    serverError(res, err, `${req.method} ${req.originalUrl}`);
  }
});

// Get Group Messages — members only.
// Group ids are guessable (and were listable via /api/groups), so without
// this check any logged-in user could read any group's entire chat history.
app.get("/api/messages/group/:groupId", authenticate, async (req, res) => {
  try {
    const group = await getGroupIfMember(req.params.groupId, req.userId);
    if (!group) {
      return res.status(403).json({ error: "Du bist kein Mitglied dieser Gruppe." });
    }

    const messages = await db.getGroupMessages(req.params.groupId);
    res.json(messages);
  } catch (err) {
    serverError(res, err, `${req.method} ${req.originalUrl}`);
  }
});

// Send Message
app.post("/api/messages", authenticate, async (req, res) => {
  try {
    const { receiverId, groupId } = req.body;
    const contentCheck = validateText(req.body.content, "Nachricht", { max: LIMITS.messageContent.max });
    if (!contentCheck.ok) {
      return res.status(400).json({ error: contentCheck.error });
    }
    const content = contentCheck.value;
    if (!receiverId && !groupId) {
      return res.status(400).json({ error: "Empfänger oder Gruppe muss angegeben werden." });
    }

    // Writing follows the same rule as reading: post into a group only as a
    // member, and DM only confirmed friends (which is also the only way the
    // app offers to open a direct chat).
    if (groupId) {
      const group = await getGroupIfMember(groupId, req.userId);
      if (!group) {
        return res.status(403).json({ error: "Du bist kein Mitglied dieser Gruppe." });
      }
    } else {
      const allUsers = await db.getUsers();
      const receiver = allUsers.find((u) => u.id === receiverId);
      if (!receiver) {
        return res.status(404).json({ error: "Empfänger nicht gefunden." });
      }
      if (!(await areFriends(req.user.name, receiver.name))) {
        return res.status(403).json({ error: "Du kannst nur befreundeten Nutzern schreiben." });
      }
    }

    const newMessage = {
      id: generateUniqueId("msg"),
      sender_id: req.userId,
      receiver_id: receiverId || null,
      group_id: groupId || null,
      content,
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
    serverError(res, err, `${req.method} ${req.originalUrl}`);
  }
});

// Get Groups — only the ones I belong to (or have asked to join).
// It used to return every group with its full member list, which is both a
// social-graph leak and the source of the guessable group ids that made the
// group chats readable.
app.get("/api/groups", authenticate, async (req, res) => {
  const groups = await db.getGroups();
  res.json(
    groups.filter(
      (g) =>
        (g.memberIds || []).includes(req.userId) ||
        (g.pendingUserIds || []).includes(req.userId)
    )
  );
});

// Create Group
app.post("/api/groups", authenticate, async (req, res) => {
  const { memberIds } = req.body;
  const nameCheck = validateText(req.body.name, "Gruppenname", LIMITS.groupName);
  if (!nameCheck.ok) {
    return res.status(400).json({ error: nameCheck.error });
  }

  // Bounded and checked against real accounts — an unbounded array of
  // arbitrary strings would otherwise land in the group record as-is.
  let initialMembers = [req.userId];
  if (Array.isArray(memberIds)) {
    if (memberIds.length > 100) {
      return res.status(400).json({ error: "Zu viele Mitglieder auf einmal." });
    }
    const allUsers = await db.getUsers();
    const knownIds = new Set(allUsers.map((u) => u.id));
    initialMembers = Array.from(
      new Set([req.userId, ...memberIds.filter((id) => typeof id === "string" && knownIds.has(id))])
    );
  }

  const newGroup = {
    id: generateUniqueId("group"),
    name: nameCheck.value,
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

// Get All Events — only my own.
// Every event carries the invite code that grants membership, so the full
// list was effectively a master key to every event in the system.
app.get("/api/events", authenticate, async (req, res) => {
  const events = await db.getEvents();
  res.json(events.filter((e) => (e.memberIds || []).includes(req.userId)));
});

// Create Event
app.post("/api/events", authenticate, async (req, res) => {
  const { durationHours } = req.body;
  const nameCheck = validateText(req.body.name, "Eventname", LIMITS.eventName);
  if (!nameCheck.ok) {
    return res.status(400).json({ error: nameCheck.error });
  }

  // Unbounded before: "999999999" produced an event running past year 30000,
  // and a non-numeric value produced an Invalid Date that was stored as-is.
  const hours = parseInt(durationHours, 10);
  if (!Number.isFinite(hours) || hours < 1 || hours > 168) {
    return res.status(400).json({ error: "Eventdauer muss zwischen 1 und 168 Stunden liegen." });
  }

  // The invite code grants membership, so it comes from crypto, not
  // Math.random — whose output is predictable from previously seen values.
  const inviteCode = crypto.randomBytes(4).toString("hex").toUpperCase();
  const newEvent = {
    id: generateUniqueId("event"),
    name: nameCheck.value,
    creatorId: req.userId,
    inviteCode,
    memberIds: [req.userId],
    endTimestamp: new Date(Date.now() + hours * 60 * 60 * 1000).toISOString(),
  };

  await db.saveEvent(newEvent);
  res.status(201).json(newEvent);
});

// Join Event
app.post("/api/events/join", authenticate, async (req, res) => {
  const { code } = req.body;
  if (typeof code !== "string" || !code.trim() || code.length > 32) {
    return res.status(400).json({ error: "Einladungscode fehlt oder ist ungültig." });
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

// Get Posts — the same visibility rule the feed applies, since this returns
// the same records. Previously every group post was readable by everyone.
app.get("/api/posts", authenticate, async (req, res) => {
  try {
    const [posts, groups, events, users, friendships] = await Promise.all([
      db.getPosts(),
      db.getGroups(),
      db.getEvents(),
      db.getUsers(),
      db.getFriendships(),
    ]);

    const myGroupIds = new Set(
      groups.filter((g) => (g.memberIds || []).includes(req.userId)).map((g) => g.id)
    );
    const myEventIds = new Set(
      events.filter((e) => (e.memberIds || []).includes(req.userId)).map((e) => e.id)
    );
    const friendIds = resolveFriendUserIds(req.user, users, friendships);

    res.json(
      posts.filter((p) => {
        if (p.userId === req.userId) return true;
        // Level-up announcements, same as the friends feed treats them.
        if (p.userId === "system") return true;
        if (p.contextType === "friends") return friendIds.has(p.userId);
        if (p.contextType === "group") return myGroupIds.has(p.contextId);
        if (p.contextType === "event") return myEventIds.has(p.contextId);
        return false;
      })
    );
  } catch (err) {
    serverError(res, err, `${req.method} ${req.originalUrl}`);
  }
});

// Create Post
app.post("/api/posts", authenticate, async (req, res) => {
  const { contextType, contextId, image } = req.body;
  if (!contextType || !contextId) {
    return res.status(400).json({ error: "Kontext fehlt." });
  }

  const textCheck = validateText(req.body.text, "Beitrag", { max: LIMITS.postText.max });
  if (!textCheck.ok) {
    return res.status(400).json({ error: textCheck.error });
  }
  const text = textCheck.value;

  if (image !== undefined && image !== null && image !== "") {
    const imageCheck = validateAvatarDataUrl(image);
    if (!imageCheck.ok) return res.status(400).json({ error: imageCheck.error });
  }

  // Posting into a context requires belonging to it — otherwise anyone could
  // drop a post into any group's feed.
  if (contextType === "friends") {
    // A status update to my own friends; the context is me.
    if (contextId !== req.userId) {
      return res.status(403).json({ error: "Du kannst nur in deinem eigenen Namen posten." });
    }
  } else if (contextType === "group") {
    if (!(await getGroupIfMember(contextId, req.userId))) {
      return res.status(403).json({ error: "Du bist kein Mitglied dieser Gruppe." });
    }
  } else if (contextType === "event") {
    const events = await db.getEvents();
    const event = events.find((e) => e.id === contextId);
    if (!event || !(event.memberIds || []).includes(req.userId)) {
      return res.status(403).json({ error: "Du nimmst an diesem Event nicht teil." });
    }
  } else {
    return res.status(400).json({ error: "Unbekannter Kontext-Typ." });
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
    // Only duels I'm actually part of. This also fixes a visible bug: the
    // games screen renders whatever this returns under "Laufende Duelle"
    // without filtering, so strangers' duels showed up in everyone's list.
    res.json(duels.filter((d) => d.creatorId === req.userId || d.opponentId === req.userId));
  } catch (error) {
    serverError(res, error, `${req.method} ${req.originalUrl}`);
  }
});

// Create Duel
app.post("/api/duels", authenticate, async (req, res) => {
  try {
    const { opponentId, duration } = req.body;
    if (!opponentId || !duration) {
      return res.status(400).json({ error: "opponentId und duration fehlen." });
    }
    if (opponentId === req.userId) {
      return res.status(400).json({ error: "Du kannst dich nicht selbst herausfordern." });
    }

    const opponents = await db.getUsers();
    if (!opponents.some((u) => u.id === opponentId)) {
      return res.status(404).json({ error: "Gegner nicht gefunden." });
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
    serverError(res, error, `${req.method} ${req.originalUrl}`);
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
    serverError(res, error, `${req.method} ${req.originalUrl}`);
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
    // Progress is recalculated for every quest above (a group's quest must
    // keep counting whether or not I happen to be looking), but only my own
    // groups' quests go out.
    const myGroupIds = new Set(
      groups.filter((g) => (g.memberIds || []).includes(req.userId)).map((g) => g.id)
    );
    res.json(quests.filter((q) => myGroupIds.has(q.groupId)));
  } catch (error) {
    serverError(res, error, `${req.method} ${req.originalUrl}`);
  }
});

// Create Group Quest — members only. Anyone could previously set a goal for
// any group they were not part of.
app.post("/api/quests", authenticate, async (req, res) => {
  try {
    const { groupId, type, targetValue, durationHours } = req.body;
    if (!groupId || !type || !targetValue || !durationHours) {
      return res.status(400).json({ error: "Alle Parameter für Gruppen-Quest fehlen." });
    }

    if (!(await getGroupIfMember(groupId, req.userId))) {
      return res.status(403).json({ error: "Du bist kein Mitglied dieser Gruppe." });
    }

    const titleCheck = validateText(req.body.title, "Quest-Titel", LIMITS.questTitle);
    if (!titleCheck.ok) return res.status(400).json({ error: titleCheck.error });

    // getGroupQuests() branches on these three values; an unknown type would
    // produce a quest that can never make progress.
    if (!["drinks", "volume", "water"].includes(type)) {
      return res.status(400).json({ error: "Unbekannter Quest-Typ." });
    }

    const target = parseFloat(targetValue);
    if (!Number.isFinite(target) || target <= 0 || target > 10000) {
      return res.status(400).json({ error: "Zielwert muss zwischen 1 und 10000 liegen." });
    }

    const hours = parseInt(durationHours, 10);
    if (!Number.isFinite(hours) || hours < 1 || hours > 168) {
      return res.status(400).json({ error: "Quest-Dauer muss zwischen 1 und 168 Stunden liegen." });
    }

    const start = new Date();
    const end = new Date(start.getTime() + hours * 60 * 60 * 1000);

    const newQuest = {
      id: generateUniqueId("quest"),
      groupId,
      title: titleCheck.value,
      type,
      targetValue: target,
      currentValue: 0.0,
      status: "active",
      startTime: start.toISOString(),
      endTime: end.toISOString(),
    };

    await db.saveGroupQuest(newQuest);
    res.status(201).json(newQuest);
  } catch (error) {
    serverError(res, error, `${req.method} ${req.originalUrl}`);
  }
});

// ==========================================
// Friends Endpoints
// ==========================================

// Send a friend request
app.post("/api/friends/request", authenticate, async (req, res) => {
  try {
    const { receiver_username } = req.body;
    if (!receiver_username) {
      return res.status(400).json({ error: "Empfänger wird benötigt." });
    }

    // The sender is whoever holds the token, never what the body claims —
    // otherwise anyone could send requests in someone else's name. The client
    // still sends sender_username; it is ignored on purpose.
    const sender = req.user;
    const sender_username = sender.name;

    if (receiver_username.toLowerCase() === sender_username.toLowerCase()) {
      return res.status(400).json({ error: "Du kannst dir nicht selbst eine Anfrage schicken." });
    }

    const users = await db.getUsers();
    const receiver = users.find(u => u.name.toLowerCase() === receiver_username.toLowerCase());

    if (!receiver) {
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
    serverError(res, error, `${req.method} ${req.originalUrl}`);
  }
});

// Accept a friend request
//
// Only the RECEIVER may accept, and the receiver is taken from the token.
// This route used to trust the body completely, so an attacker could send
// themselves a request and immediately accept it in the victim's name —
// granting themselves friend status, and with it the victim's feed, radar
// and map pins, without the victim ever being asked.
app.post("/api/friends/accept", authenticate, async (req, res) => {
  try {
    const { sender_username } = req.body;
    if (!sender_username) {
      return res.status(400).json({ error: "Absender wird benötigt." });
    }

    const receiver_username = req.user.name;

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
    serverError(res, error, `${req.method} ${req.originalUrl}`);
  }
});

// Get all friends for a user (accepted and pending).
//
// Own list only. The username in the path is kept for compatibility with the
// existing client (which always passes its own name), but anything else is
// refused: a friends list is a social graph, and it was readable for every
// user by simply putting their name in the URL.
app.get("/api/friends/:username", authenticate, async (req, res) => {
  try {
    const { username } = req.params;
    if (username.toLowerCase() !== req.user.name.toLowerCase()) {
      return res.status(403).json({ error: "Du kannst nur deine eigene Freundesliste abrufen." });
    }

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
    serverError(res, error, `${req.method} ${req.originalUrl}`);
  }
});

// ==========================================
// Error handling
// ==========================================
// Last middleware on purpose. Without it Express answers these cases with its
// default HTML error page including a stack trace — an API client gets
// unparseable output, and the response leaks internals.
// The fourth parameter is what marks this as an error handler for Express.
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err && err.message === "CORS_NOT_ALLOWED") {
    return res.status(403).json({ error: "Zugriff von dieser Herkunft ist nicht erlaubt." });
  }
  if (err && err.message === "UNSUPPORTED_IMAGE_TYPE") {
    return res.status(400).json({ error: "Ungültiges Bildformat. Erlaubt sind JPEG, PNG, WebP und GIF." });
  }
  // Oversized body: express.json throws PayloadTooLargeError, multer throws
  // LIMIT_FILE_SIZE. This is the error that showed up unexplained in the old
  // server logs.
  if ((err && err.type === "entity.too.large") || err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "Die gesendeten Daten sind zu groß." });
  }
  if (err && err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Ungültiges JSON im Request-Body." });
  }

  console.error(`[TrinkDuell] Unbehandelter Fehler bei ${req.method} ${req.originalUrl}:`, err);
  res.status(500).json({ error: "Auf dem Server ist ein Fehler aufgetreten. Bitte versuche es später erneut." });
});

// ==========================================
// Start Server
// ==========================================
app.listen(PORT, "0.0.0.0", async () => {
  console.log(`[TrinkDuell Backend] Server läuft auf http://localhost:${PORT}`);
  // Hash any existing plaintext passwords (safe no-op if already hashed)
  await migratePlaintextPasswords();
});
