const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const db = require("./db");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const { sendPushNotification } = require("./push");
const { sendPasswordResetEmail } = require("./email");
const storage = require("./storage");

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

// ─── Async-Fehler auffangen ───────────────────────────────────────────────────
//
// Express 4 leitet eine abgelehnte Promise aus einem `async`-Handler NICHT an
// die Fehler-Middleware weiter. Sie wird zur `unhandledRejection` — und die
// beendet seit Node 15 den Prozess. Ein einziger fehlerhafter Request nimmt
// damit den Server für ALLE Nutzer mit. Genau das ist am 18.08.2026 passiert:
// ein `undefined.map()` in `GET /api/logs` hat das Backend abgerissen.
//
// Von 58 Routen hatten 19 kein `try/catch`. Die Lücke ist also nicht dadurch
// entstanden, dass jemand die Regel nicht kannte, sondern dadurch, dass man
// sie 19-mal vergessen kann. Deshalb wird hier EINMAL die Registrierung
// umgebogen statt 19-mal der Rumpf ergänzt: jeder Handler, der eine Promise
// zurückgibt, hängt danach automatisch am `catch(next)` und landet in der
// Fehler-Middleware ganz unten — die dieselbe 500-Antwort schickt wie das
// bisherige `serverError()`. Für den Aufrufer ändert sich also nichts.
//
// Die bestehenden `try/catch`-Blöcke bleiben, wo sie sind: sie fangen weiter
// zuerst, und ihre Log-Zeile nennt die Route direkt. Das hier ist das Netz
// darunter, nicht ihr Ersatz.
function wrapAsync(handler) {
  if (typeof handler !== "function") return handler;
  // Fehler-Middleware erkennt Express an vier Parametern. Würde sie umgebogen,
  // hätte die Hülle drei — Express hielte sie für normale Middleware und die
  // Fehlerbehandlung wäre still abgeschaltet.
  if (handler.length === 4) return handler;

  return function wrapped(req, res, next) {
    let result;
    try {
      result = handler(req, res, next);
    } catch (err) {
      // Synchroner Wurf. Express fängt den zwar selbst, aber hier ist es
      // einheitlich und kostet nichts.
      next(err);
      return undefined;
    }
    if (result && typeof result.then === "function") {
      result.catch(next);
    }
    return result;
  };
}

// `use` und `all` sind bewusst dabei: auch Middleware kann async sein, und ein
// Fehler darin hat dieselbe Wirkung.
for (const method of ["get", "post", "put", "delete", "patch", "use", "all"]) {
  const original = app[method].bind(app);
  app[method] = (...args) => original(...args.map(wrapAsync));
}

// Letztes Netz. Mit dem Wrapper oben sollte hier nichts mehr ankommen; wenn
// doch, dann aus Code außerhalb eines Requests (Timer, Ereignis-Handler).
//
// Bewusst OHNE `process.exit`: eine abgelehnte Promise irgendwo ist kein Grund,
// alle laufenden Requests abzubrechen. Protokollieren und weiterlaufen ist hier
// die richtige Abwägung — der Container hat `restart: always`, ein Absturz wäre
// also ohnehin nur die teurere Variante desselben Ausgangs.
process.on("unhandledRejection", (reason) => {
  console.error("[TrinkDuell] Unbehandelte Promise-Ablehnung:", reason);
});

// Eine `uncaughtException` ist etwas anderes: danach kann der Prozesszustand
// beschädigt sein (halb geschriebene Datei, offene Transaktion). Hier wird
// deshalb protokolliert und beendet — der Neustart durch Docker ist der
// sauberere Weg als mit unbekanntem Zustand weiterzumachen.
process.on("uncaughtException", (err) => {
  console.error("[TrinkDuell] Unbehandelte Ausnahme, Prozess wird beendet:", err);
  process.exit(1);
});

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
// ACHTUNG: ALLOWED_ORIGINS in server/.env ERSETZT diese Liste, es ergänzt sie
// nicht. Wer die Variable setzt, muss also auch die localhost-Einträge
// mitnehmen, falls er die Web-App lokal gegen den Produktionsserver testen
// will.
const DEFAULT_ALLOWED_ORIGINS = [
  "https://webapp.trinkduell.com", // Netlify
  "https://cloud.trinkduell.com", // Cloudflare Pages
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

/**
 * Validates an EAN-8 or EAN-13 barcode, check digit included.
 *
 * The check digit matters here: the drinks table is a shared, community-fed
 * catalogue, and a mistyped or misread code would permanently attach a wrong
 * product to a barcode everyone else then scans. Verifying it rejects most
 * transposed digits before they get that far.
 */
function validateEan(raw) {
  if (typeof raw !== "string") {
    return { ok: false, error: "Barcode fehlt." };
  }
  const value = raw.trim();
  if (!/^\d{8}$|^\d{13}$/.test(value)) {
    return { ok: false, error: "Barcode muss 8 oder 13 Ziffern haben." };
  }

  // EAN check digit: weights alternate 3/1 from the right, excluding the
  // check digit itself; the total must round up to a multiple of ten.
  const digits = value.split("").map(Number);
  const check = digits.pop();
  let sum = 0;
  for (let i = digits.length - 1, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3) {
    sum += digits[i] * weight;
  }
  if ((10 - (sum % 10)) % 10 !== check) {
    return { ok: false, error: "Barcode ist ungültig (Prüfziffer stimmt nicht)." };
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

/**
 * Akzeptiert entweder ein Base64-Bild (der alte Weg, für Bestandsdaten und
 * Server ohne R2) oder eine URL aus dem eigenen Objektspeicher.
 *
 * Die Besitzprüfung ist der Punkt: Signieren und Eintragen der URL sind zwei
 * getrennte Schritte, also könnte man sonst im zweiten eine fremde oder
 * beliebige externe URL unterschieben — und hätte damit ein Bild im eigenen
 * Profil, das man nie hochgeladen hat, oder einen Tracking-Pixel im Feed
 * aller Freunde.
 */
/**
 * Löscht das ersetzte Avatar-Objekt aus dem Speicher.
 *
 * Nur wenn es überhaupt ein eigenes Speicher-Objekt war (Base64-Bestandsdaten
 * liegen in der Datenbank und verschwinden mit dem Feld) und nur, wenn es
 * nicht dasselbe Objekt ist — ein zweimal gesetztes Bild darf sich nicht
 * selbst löschen.
 */
function releaseReplacedAvatar(previousAvatar, nextAvatar, userId) {
  if (!previousAvatar || previousAvatar === nextAvatar) return;
  if (!storage.isOwnStorageUrl(previousAvatar, userId)) return;

  const key = storage.keyFromPublicUrl(previousAvatar);
  if (key) {
    storage.deleteObject(key).catch(() => {});
  }
}

function validateImageReference(raw, userId) {
  if (typeof raw !== "string") {
    return { ok: false, error: "Bilddaten fehlen." };
  }
  if (raw.startsWith("data:")) {
    return validateAvatarDataUrl(raw);
  }
  if (storage.isOwnStorageUrl(raw, userId)) {
    return { ok: true, value: raw };
  }
  return { ok: false, error: "Ungültige Bildreferenz." };
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

/**
 * Everyone the given user must not see, and who must not see them.
 *
 * A block counts in BOTH directions on purpose: if it only hid the blocked
 * person from the blocker, the blocked person could still watch the feed,
 * radar and map of someone who explicitly wanted rid of them — which is the
 * opposite of what blocking is for.
 */
async function getBlockedUserIds(userId) {
  const blocks = await db.getBlocks();
  const hidden = new Set();
  for (const b of blocks) {
    if (b.blockerId === userId) hidden.add(b.blockedId);
    else if (b.blockedId === userId) hidden.add(b.blockerId);
  }
  return hidden;
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

// Passwort ändern, während man eingeloggt ist
//
// Der Nachweis ist hier das ALTE Passwort, nicht der Token. Sonst würde ein
// kurz unbeaufsichtigtes, entsperrtes Gerät reichen, um das Konto dauerhaft zu
// übernehmen — der Token allein darf das nicht können.
app.post(
  "/api/auth/change-password",
  authenticate,
  // Bewusst NACH authenticate: so sitzt der Kontozähler auf der Nutzer-ID
  // statt auf einem Wert aus dem Body. Eine ID aus einem geprüften Token kann
  // der Aufrufer nicht fälschen, um fremde Konten auszusperren.
  rateLimit({
    scope: "changepw",
    ipMax: 60,
    accountMax: 10,
    windowMs: 15 * MINUTE,
    accountKey: (req) => req.userId,
  }),
  async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (typeof currentPassword !== "string" || typeof newPassword !== "string" || !currentPassword || !newPassword) {
      return res.status(400).json({ error: "Aktuelles und neues Passwort werden benötigt." });
    }
    // Vor bcrypt.compare begrenzen: ein unbegrenztes Passwort ist Rechenzeit,
    // die der Aufrufer sonst gratis auf dem Server verbrennt.
    if (currentPassword.length > LIMITS.password.max) {
      return res.status(401).json({ error: "Das aktuelle Passwort ist falsch." });
    }
    if (newPassword.length < LIMITS.password.min) {
      return res.status(400).json({
        error: `Passwort muss mindestens ${LIMITS.password.min} Zeichen lang sein.`,
      });
    }
    if (newPassword.length > LIMITS.password.max) {
      return res.status(400).json({ error: "Passwort ist zu lang." });
    }
    if (newPassword === currentPassword) {
      return res.status(400).json({ error: "Das neue Passwort muss sich vom alten unterscheiden." });
    }

    // try/catch ist hier Pflicht, nicht Geschmack: unter Express 4 landet eine
    // abgelehnte Promise aus einem async-Handler NICHT in der Fehler-Middleware,
    // sondern als unhandledRejection - und die beendet den Node-Prozess. Ein
    // Ausrutscher von bcrypt oder der Datenbank wuerde sonst den ganzen Server
    // mitnehmen, nicht nur diesen einen Request.
    try {
      const isCurrentValid = await bcrypt.compare(currentPassword, req.user.password);
      if (!isCurrentValid) {
        return res.status(401).json({ error: "Das aktuelle Passwort ist falsch." });
      }

      const hashedPassword = await bcrypt.hash(newPassword, 12);
      // Beendet auch jede andere bestehende Sitzung — genau der Sinn der Übung,
      // wenn jemand das Passwort ändert, weil es in fremde Hände geraten ist.
      // Ein offener Reset-Code verfällt dabei mit, sonst bliebe der Weg über
      // „Passwort vergessen" für den Angreifer offen.
      await db.setPasswordAndClearResetCode(req.user.id, hashedPassword);

      // Die eigene Sitzung darf das überleben: ohne frischen Token würde sich
      // der Nutzer mit der Änderung selbst aussperren. Der neue Token wird nach
      // dem Stichtag ausgestellt und ist deshalb als einziger noch gültig.
      const token = signToken(req.user.id);

      // Wer sein Passwort gerade nachweislich kannte, soll nicht an einem
      // Limit hängen bleiben, das eigene Tippfehler aufgebaut haben.
      clearRateLimit(`changepw:acct:${req.user.id.toLowerCase()}`);
      clearRateLimit(`login:acct:${req.user.email.toLowerCase()}`);
      clearRateLimit(`login:acct:${req.user.name.toLowerCase()}`);

      res.json({ success: true, token });
    } catch (err) {
      serverError(res, err, `${req.method} ${req.originalUrl}`);
    }
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
    const [users, hidden] = await Promise.all([db.getUsers(), getBlockedUserIds(req.userId)]);
    res.json(users.filter((u) => !hidden.has(u.id)).map((u) => enrichUserProgress(u)));
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
    const [users, hidden] = await Promise.all([db.searchUsers(q), getBlockedUserIds(req.userId)]);
    res.json(users.filter((u) => !hidden.has(u.id)).map((u) => enrichUserProgress(u)));
  } catch (err) {
    serverError(res, err, `${req.method} ${req.originalUrl}`);
  }
});

// Get Specific User
app.get("/api/users/:id", authenticate, async (req, res) => {
  const users = await db.getUsers();
  const user = users.find((u) => u.id === req.params.id);
  const hidden = await getBlockedUserIds(req.userId);
  // A blocked user reads as non-existent rather than "forbidden" — a 403
  // would confirm the account is there and that a block is in place.
  if (!user || hidden.has(user.id)) {
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
    const avatarCheck = validateImageReference(avatar, req.userId);
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
    const check = validateImageReference(req.body.image, req.userId);
    if (!check.ok) {
      return res.status(400).json({ error: check.error });
    }

    const previousAvatar = user.avatar;
    user.avatar = check.value;
    await db.saveUser(user);

    // Das ersetzte Objekt aufräumen. Ohne das bleibt bei jedem
    // Profilbildwechsel eine Datei im Bucket liegen, auf die nichts mehr
    // zeigt — nach genug Wechseln zahlt man für Müll. Erst nach dem
    // erfolgreichen Speichern, damit ein Fehlschlag nicht beide Bilder
    // vernichtet, und ohne await: ein misslungenes Löschen darf den
    // Bildwechsel nicht scheitern lassen.
    releaseReplacedAvatar(previousAvatar, check.value, req.userId);

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

/**
 * Welche Getränke aus dem geteilten Katalog jemand sehen darf.
 *
 * Vorher bekam jeder alles — legte irgendwer ein Getränk an, stand es bei
 * allen im Katalog UND als Kachel im Dashboard. Diese Regel lässt genau das
 * durch, was für andere einen Wert hat:
 *
 *   - der eingebaute Katalog (kein Ersteller)
 *   - die eigenen Getränke
 *   - alles mit gültigem Barcode: ein gescanntes Produkt ist ein reales
 *     Produkt, das ist der Sinn der Community-Datenbank
 *
 * Was übrig bleibt — fremde Frei-Text-Einträge wie "Testgetränk 123" —
 * bleibt beim Ersteller.
 */
function isDrinkVisibleTo(drink, userId) {
  if (!drink.createdBy) return true;
  if (drink.createdBy === userId) return true;
  return Boolean(drink.ean);
}

// Get All Drinks
app.get("/api/drinks", authenticate, async (req, res) => {
  try {
    const drinks = await db.getDrinks();
    res.json(drinks.filter((d) => isDrinkVisibleTo(d, req.userId)));
  } catch (err) {
    serverError(res, err, `${req.method} ${req.originalUrl}`);
  }
});

// Persönliche Schnellwahl: die Kacheln auf dem Dashboard.
app.get("/api/users/me/drinks", authenticate, async (req, res) => {
  try {
    const [ids, drinks] = await Promise.all([
      db.getUserDrinkIds(req.userId),
      db.getDrinks(),
    ]);

    // Nach ids sortiert ausgeben, nicht nach Katalogreihenfolge — die
    // Reihenfolge IST die Einstellung des Nutzers. Verwaiste Einträge
    // (Getränk gelöscht) fallen dabei still heraus.
    const byId = new Map(drinks.map((d) => [d.id, d]));
    res.json(ids.map((id) => byId.get(id)).filter(Boolean));
  } catch (err) {
    serverError(res, err, `${req.method} ${req.originalUrl}`);
  }
});

const MAX_QUICK_PICKS = 12;

app.put("/api/users/me/drinks", authenticate, async (req, res) => {
  try {
    const { drinkIds } = req.body;
    if (!Array.isArray(drinkIds)) {
      return res.status(400).json({ error: "drinkIds muss eine Liste sein." });
    }
    if (drinkIds.length > MAX_QUICK_PICKS) {
      return res.status(400).json({
        error: `Höchstens ${MAX_QUICK_PICKS} Getränke in der Schnellwahl.`,
      });
    }

    const drinks = await db.getDrinks();
    const byId = new Map(drinks.map((d) => [d.id, d]));

    // Doppelte entfernen, Reihenfolge des ersten Vorkommens behalten.
    const seen = new Set();
    const cleaned = [];
    for (const id of drinkIds) {
      if (typeof id !== "string" || seen.has(id)) continue;
      const drink = byId.get(id);
      // Nichts in die Schnellwahl legen, was der Nutzer gar nicht sehen darf —
      // sonst wäre die Sichtbarkeitsregel über diesen Weg umgehbar.
      if (!drink || !isDrinkVisibleTo(drink, req.userId)) {
        return res.status(400).json({ error: "Unbekanntes Getränk in der Auswahl." });
      }
      seen.add(id);
      cleaned.push(id);
    }

    await db.setUserDrinkIds(req.userId, cleaned);
    res.json(cleaned.map((id) => byId.get(id)));
  } catch (err) {
    serverError(res, err, `${req.method} ${req.originalUrl}`);
  }
});

// Look up a scanned barcode.
//
// MUST stay above any /api/drinks/:id route — Express matches in registration
// order, so "ean" would otherwise be read as a drink id. Same trap that once
// killed /api/users/search (see section 3.1 of the handover).
app.get("/api/drinks/ean/:ean", authenticate, async (req, res) => {
  try {
    const check = validateEan(req.params.ean);
    if (!check.ok) {
      return res.status(400).json({ error: check.error });
    }

    const drinks = await db.getDrinks();
    const drink = drinks.find((d) => d.ean === check.value);

    if (!drink) {
      // Not an error condition — this is how a product enters the community
      // catalogue. The client opens its "name this drink" dialog on 404.
      return res.status(404).json({ error: "Barcode noch nicht bekannt.", ean: check.value });
    }

    res.json(drink);
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

  // Optional barcode: set when the user names a product they just scanned.
  let ean = null;
  if (req.body.ean !== undefined && req.body.ean !== null && req.body.ean !== "") {
    const eanCheck = validateEan(req.body.ean);
    if (!eanCheck.ok) return res.status(400).json({ error: eanCheck.error });
    ean = eanCheck.value;

    // Two people can scan the same unknown code at the same time. Whoever
    // lands second gets the existing entry instead of an error — and instead
    // of a duplicate, which the unique index would reject anyway.
    const existing = (await db.getDrinks()).find((d) => d.ean === ean);
    if (existing) {
      return res.status(200).json(existing);
    }
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
    ean,
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
    const hidden = await getBlockedUserIds(req.userId);

    const now = Date.now();
    const ACTIVE_MS = 30 * 60 * 1000;
    const RECENT_MS = 3 * 60 * 60 * 1000;

    const radar = users
      .filter((u) => friendIds.has(u.id) && !hidden.has(u.id))
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

    // Blocking wins over every other visibility rule. Removing the friendship
    // alone would not be enough: a shared group would still put the blocked
    // person back into the group feed.
    const hidden = await getBlockedUserIds(req.userId);
    hidden.forEach((id) => visibleUserIds.delete(id));

    const friendUserIds = visibleUserIds;

    const filteredLogs = logs.filter((l) => friendUserIds.has(l.userId));
    const filteredPosts = posts.filter((p) => !hidden.has(p.userId) && visiblePostFilter(p));

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
        // Beweisfoto. Fehlte hier, wodurch ein Bild zwar gespeichert, aber im
        // Feed nie angezeigt wurde.
        image: post.image || null,
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

    // Location is the most sensitive thing here, so a block removes it even
    // when a shared group would otherwise grant access.
    const hidden = await getBlockedUserIds(req.userId);
    hidden.forEach((id) => visibleUserIds.delete(id));

    res.json(mappedLogs.filter((entry) => visibleUserIds.has(entry.userId)));
  } catch (error) {
    serverError(res, error, `${req.method} ${req.originalUrl}`);
  }
});

// Get Scoreboard
app.get("/api/scoreboard", authenticate, async (req, res) => {
  try {
    const [allUsers, hidden] = await Promise.all([db.getUsers(), getBlockedUserIds(req.userId)]);
    // Blocked users drop out of the ranking too — "I don't want to see this
    // person" would ring hollow if they still sat next to you in the list.
    const users = allUsers.filter((u) => !hidden.has(u.id));
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
// ─── Ungelesene Nachrichten ───────────────────────────────────────────────────
//
// Push gibt es seit `7841c4d`, aber in der App war nirgends zu sehen, WO etwas
// Neues liegt. Grundlage ist ein Lesestand pro Nutzer und Unterhaltung
// (`conversation_reads`); ungelesen ist alles, was danach kam.

/** `dm:<andereNutzerId>` bzw. `group:<gruppenId>`. */
function conversationKey({ otherUserId, groupId }) {
  return groupId ? `group:${groupId}` : `dm:${otherUserId}`;
}

// Ungelesen-Zahlen für alle Unterhaltungen auf einmal
//
// Ein Aufruf statt einer Abfrage pro Freund/Gruppe: die Liste im Drawer will
// alle Zahlen gleichzeitig, und der Drawer-Zähler ist ihre Summe.
app.get("/api/messages/unread", authenticate, async (req, res) => {
  const groups = await db.getGroups();
  const meineGruppen = groups.filter((g) => (g.memberIds || []).includes(req.userId));
  const gruppenIds = meineGruppen.map((g) => g.id);

  const [nachrichten, staende, blockiert] = await Promise.all([
    db.getMessagesForUnread(req.userId, gruppenIds),
    db.getConversationReads(req.userId),
    getBlockedUserIds(req.userId),
  ]);

  const zaehler = {};
  for (const m of nachrichten) {
    // Blockierte zählen nicht. Sonst stünde eine Zahl an einer Gruppe, deren
    // Nachricht man beim Öffnen gar nicht zu sehen bekommt (der Gruppenchat
    // filtert Blockierte heraus) — ein Zähler, der sich nie leeren lässt.
    if (blockiert.has(m.sender_id)) continue;

    const key = m.group_id ? `group:${m.group_id}` : `dm:${m.sender_id}`;
    const stand = staende[key];
    if (stand && new Date(m.timestamp).getTime() <= new Date(stand).getTime()) continue;

    zaehler[key] = (zaehler[key] || 0) + 1;
  }

  const total = Object.values(zaehler).reduce((a, b) => a + b, 0);
  res.json({ total, conversations: zaehler });
});

// Unterhaltung als gelesen markieren
//
// Der Zeitstempel kommt vom Server, nicht aus dem Body: eine Uhr auf dem Gerät
// kann falsch stehen, und ein Stand in der Zukunft würde alle künftigen
// Nachrichten stumm als gelesen verbuchen.
app.post("/api/messages/read", authenticate, async (req, res) => {
  const { receiverId, groupId } = req.body;
  if (!receiverId && !groupId) {
    return res.status(400).json({ error: "receiverId oder groupId muss angegeben werden." });
  }
  if (receiverId && groupId) {
    return res.status(400).json({ error: "Entweder receiverId oder groupId, nicht beides." });
  }

  if (groupId) {
    // Nur für eigene Gruppen. Ohne die Prüfung könnte man beliebige
    // Gruppen-IDs in die eigene Lesestand-Tabelle schreiben — harmlos, aber
    // es wäre ein Weg, fremde IDs zu erraten und Müll anzulegen.
    if (!(await getGroupIfMember(groupId, req.userId))) {
      return res.status(403).json({ error: "Du bist kein Mitglied dieser Gruppe." });
    }
  } else {
    const users = await db.getUsers();
    if (!users.some((u) => u.id === receiverId)) {
      return res.status(404).json({ error: "Benutzer nicht gefunden." });
    }
  }

  const key = conversationKey({ otherUserId: receiverId, groupId });
  await db.setConversationRead(req.userId, key, new Date().toISOString());
  res.json({ success: true, conversationKey: key });
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

    // Blockierte Mitglieder ausblenden. Ein Block hindert niemanden daran, in
    // einer gemeinsamen Gruppe zu schreiben — beide sind ja Mitglieder. Ohne
    // diesen Filter läse man also weiter genau die Person mit, die man
    // loswerden wollte.
    const [messages, hidden] = await Promise.all([
      db.getGroupMessages(req.params.groupId),
      getBlockedUserIds(req.userId),
    ]);

    res.json(messages.filter((m) => !hidden.has(m.sender_id)));
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
    let group = null;
    if (groupId) {
      group = await getGroupIfMember(groupId, req.userId);
      if (!group) {
        return res.status(403).json({ error: "Du bist kein Mitglied dieser Gruppe." });
      }
    } else {
      const allUsers = await db.getUsers();
      const receiver = allUsers.find((u) => u.id === receiverId);
      const hidden = await getBlockedUserIds(req.userId);
      // Same wording for "blocked" as for "not a friend": telling the sender
      // they were blocked turns the block into a notification.
      if (!receiver || hidden.has(receiver.id)) {
        return res.status(403).json({ error: "Du kannst nur befreundeten Nutzern schreiben." });
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
    const senderName = sender ? sender.name : "Unbekannt";

    // Chat war das einzige Ereignis ohne Benachrichtigung — Duelle,
    // Freundschaftsanfragen und Gruppenbeitritte hatten längst eine. Ein Chat,
    // von dem man nichts mitbekommt, wird nicht benutzt.
    notifyAboutMessage({ group, senderId: req.userId, senderName, receiverId, content });

    res.status(201).json({
      ...newMessage,
      sender_name: senderName,
      sender_avatar: sender ? sender.avatar : null,
    });
  } catch (err) {
    serverError(res, err, `${req.method} ${req.originalUrl}`);
  }
});

/** Wie viel Nachrichtentext in der Benachrichtigung landet. */
const MESSAGE_PREVIEW_LENGTH = 120;

/** Obergrenze für Empfänger einer Gruppennachricht, damit eine große Gruppe
 *  keine unbegrenzte Zahl paralleler Push-Requests auslöst. */
// Obergrenze fuer die Gruppengroesse. Dieselbe Zahl, die die Anlege-Route
// schon fuer die Startliste verwendet.
const MAX_GROUP_MEMBERS = 100;

const MAX_GROUP_PUSH_RECIPIENTS = 50;

/**
 * Benachrichtigt über eine neue Nachricht.
 *
 * Läuft absichtlich ohne await und verschluckt Fehler: ein fehlgeschlagener
 * Push darf das Senden der Nachricht nicht scheitern lassen — die Nachricht
 * ist zu diesem Zeitpunkt bereits gespeichert.
 */
function notifyAboutMessage({ group, senderId, senderName, receiverId, content }) {
  const preview =
    content.length > MESSAGE_PREVIEW_LENGTH
      ? `${content.slice(0, MESSAGE_PREVIEW_LENGTH)}…`
      : content;

  (async () => {
    if (group) {
      const recipients = (group.memberIds || [])
        .filter((id) => id !== senderId)
        .slice(0, MAX_GROUP_PUSH_RECIPIENTS);

      // Wer den Absender blockiert hat, bekommt dessen Gruppennachricht nicht
      // aufs Sperrbildschirm geschoben. Der Block verhindert das Schreiben in
      // einer Gruppe nicht (beide sind ja Mitglieder), also muss er hier
      // greifen.
      const blocks = await db.getBlocks();
      const blockedPairs = new Set(
        blocks.map((b) => `${b.blockerId}:${b.blockedId}`)
      );

      for (const memberId of recipients) {
        if (blockedPairs.has(`${memberId}:${senderId}`)) continue;
        if (blockedPairs.has(`${senderId}:${memberId}`)) continue;

        sendPushNotification(
          memberId,
          `${group.name}`,
          `${senderName}: ${preview}`,
          { type: "group_message", groupId: group.id }
        ).catch(() => {});
      }
      return;
    }

    if (receiverId) {
      sendPushNotification(receiverId, senderName, preview, {
        type: "direct_message",
        senderId,
      }).catch(() => {});
    }
  })().catch(() => {});
}

// Get Groups — only the ones I belong to (or have asked to join).
// It used to return every group with its full member list, which is both a
// social-graph leak and the source of the guessable group ids that made the
// group chats readable.
app.get("/api/groups", authenticate, async (req, res) => {
  const groups = await db.getGroups();
  const meine = groups.filter(
    (g) =>
      (g.memberIds || []).includes(req.userId) ||
      (g.pendingUserIds || []).includes(req.userId)
  );

  // Der Einladungscode geht nur an den Admin. Für alle anderen wird er hier
  // entfernt: wer ihn hat, kann beliebige Leute hereinholen, und das ist eine
  // Admin-Entscheidung. Ohne diese Zeile stünde er in jeder Gruppenliste.
  res.json(
    meine.map(({ inviteCode, ...rest }) =>
      rest.adminId === req.userId ? { ...rest, inviteCode } : rest
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
    // Die Startliste kommt ohne den Ersteller — deshalb einer weniger, sonst
    // waere die frisch angelegte Gruppe sofort ueber der Grenze.
    if (memberIds.length > MAX_GROUP_MEMBERS - 1) {
      return res.status(400).json({ error: `Eine Gruppe fasst höchstens ${MAX_GROUP_MEMBERS} Mitglieder.` });
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
    inviteCode: generateInviteCode(),
  };

  await db.saveGroup(newGroup);
  res.status(201).json(newGroup);
});
// ─── Gruppen-Einladungscodes ─────────────────────────────────────────────────
//
// Warum ein Code und keine öffentliche Gruppenliste: seit der
// Autorisierungsrunde liefert `GET /api/groups` nur noch eigene Gruppen. Fremde
// sind bewusst nicht auffindbar — eine durchsuchbare Liste aller Gruppen wäre
// genau der Social-Graph-Leak, der damals geschlossen wurde. Der Code kehrt die
// Richtung um: nicht suchen, sondern eingeladen werden. Events machen es seit
// jeher genauso.
//
// 8 Hex-Zeichen aus crypto.randomBytes — dieselbe Stärke wie bei Events. Zu
// kurz wäre ratbar, zu lang unpraktisch zum Weitergeben.
function generateInviteCode() {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

/**
 * Gibt den Code der Gruppe zurück und legt ihn an, falls er fehlt.
 *
 * Gruppen, die vor dieser Funktion entstanden sind, haben keinen. Statt eines
 * Migrationsskripts entsteht er beim ersten Abruf — das kostet nichts und kann
 * nicht vergessen werden.
 */
async function ensureGroupInviteCode(group) {
  if (group.inviteCode) return group.inviteCode;
  group.inviteCode = generateInviteCode();
  await db.saveGroup(group);
  return group.inviteCode;
}

// Einladungscode ansehen (nur Admin)
//
// Bewusst nicht für alle Mitglieder: wer den Code hat, kann beliebige Leute
// hereinholen. Das ist eine Admin-Entscheidung.
app.get("/api/groups/:id/invite", authenticate, async (req, res) => {
  const groups = await db.getGroups();
  const group = groups.find((g) => g.id === req.params.id);
  if (!group) {
    return res.status(404).json({ error: "Gruppe nicht gefunden." });
  }
  if (group.adminId !== req.userId) {
    return res.status(403).json({ error: "Nur Administratoren sehen den Einladungscode." });
  }

  res.json({ inviteCode: await ensureGroupInviteCode(group) });
});

// Einladungscode neu vergeben (nur Admin)
//
// Nicht bequem, sondern nötig: ohne Rotation wäre das Entfernen eines
// Mitglieds wirkungslos. Wer den alten Code noch hat, träte einfach wieder
// bei. Nach jedem Rauswurf gehört der Code erneuert — der Hinweis dazu steht
// in der Oberfläche.
app.post("/api/groups/:id/invite/rotate", authenticate, async (req, res) => {
  const groups = await db.getGroups();
  const group = groups.find((g) => g.id === req.params.id);
  if (!group) {
    return res.status(404).json({ error: "Gruppe nicht gefunden." });
  }
  if (group.adminId !== req.userId) {
    return res.status(403).json({ error: "Nur Administratoren können den Code erneuern." });
  }

  group.inviteCode = generateInviteCode();
  await db.saveGroup(group);
  res.json({ inviteCode: group.inviteCode });
});

// Mit einem Code beitreten
//
// Direkt Mitglied, ohne Freigabe durch den Admin — wie bei Events. Wer den
// Code hat, wurde eingeladen; eine zweite Bestätigung wäre reine Reibung.
// Der Weg über `POST /:id/join` (Anfrage, die der Admin freigibt) bleibt
// daneben bestehen für den Fall, dass jemand die Gruppen-ID kennt.
app.post("/api/groups/join", authenticate, async (req, res) => {
  const { code } = req.body;
  if (typeof code !== "string" || !code.trim() || code.length > 32) {
    return res.status(400).json({ error: "Einladungscode fehlt oder ist ungültig." });
  }

  const gesucht = code.trim().toUpperCase();
  const groups = await db.getGroups();
  const group = groups.find((g) => g.inviteCode && g.inviteCode === gesucht);
  if (!group) {
    return res.status(404).json({ error: "Ungültiger Code. Gruppe nicht gefunden." });
  }

  if ((group.memberIds || []).includes(req.userId)) {
    // Ohne Code in der Antwort: der Beitretende ist kein Admin, und der Code
    // hat in seinem Client nichts verloren.
    const { inviteCode: _schonDrin, ...ohneCode } = group;
    return res.status(200).json(ohneCode);
  }
  if ((group.memberIds || []).length >= MAX_GROUP_MEMBERS) {
    return res.status(400).json({
      error: `Diese Gruppe ist voll (${MAX_GROUP_MEMBERS} Mitglieder).`,
    });
  }

  // Dieselbe Regel wie beim Hinzufügen durch den Admin: eine Blockierung darf
  // sich nicht über den Umweg Gruppe aushebeln lassen. Geprüft wird gegen den
  // Admin, denn er ist es, der die Gruppe führt.
  const blocked = await getBlockedUserIds(req.userId);
  if (blocked.has(group.adminId)) {
    return res.status(403).json({ error: "Zwischen euch besteht eine Blockierung." });
  }

  group.memberIds.push(req.userId);
  group.pendingUserIds = (group.pendingUserIds || []).filter((id) => id !== req.userId);
  await db.saveGroup(group);

  sendPushNotification(
    group.adminId,
    "Neues Gruppenmitglied",
    `${req.user.name} ist "${group.name}" beigetreten.`,
    { type: "group_joined", groupId: group.id }
  ).catch(() => {});

  const { inviteCode: _verbraucht, ...ohneCode } = group;
  res.json(ohneCode);
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
// Mitglied hinzufügen (nur Admin)
app.post("/api/groups/:id/members", authenticate, async (req, res) => {
  const { userId } = req.body;
  if (typeof userId !== "string" || !userId) {
    return res.status(400).json({ error: "userId fehlt." });
  }

  const groups = await db.getGroups();
  const group = groups.find((g) => g.id === req.params.id);
  if (!group) {
    return res.status(404).json({ error: "Gruppe nicht gefunden." });
  }
  if (group.adminId !== req.userId) {
    return res.status(403).json({ error: "Nur Administratoren können Mitglieder hinzufügen." });
  }

  const users = await db.getUsers();
  const target = users.find((u) => u.id === userId);
  if (!target) {
    return res.status(404).json({ error: "Benutzer nicht gefunden." });
  }
  if ((group.memberIds || []).includes(userId)) {
    return res.status(409).json({ error: `${target.name} ist bereits Mitglied.` });
  }
  if ((group.memberIds || []).length >= MAX_GROUP_MEMBERS) {
    return res.status(400).json({
      error: `Eine Gruppe fasst höchstens ${MAX_GROUP_MEMBERS} Mitglieder.`,
    });
  }

  // Blockierung gilt in beide Richtungen. Ohne diese Prüfung wäre "in eine
  // Gruppe stecken" der Weg, eine Blockierung zu umgehen: Gruppenchat und
  // Gruppen-Feed führen die beiden sonst wieder zusammen.
  const blocked = await getBlockedUserIds(req.userId);
  if (blocked.has(userId)) {
    return res.status(403).json({ error: "Zwischen euch besteht eine Blockierung." });
  }

  group.memberIds.push(userId);
  // Eine offene Beitrittsanfrage ist damit erledigt.
  group.pendingUserIds = (group.pendingUserIds || []).filter((id) => id !== userId);
  await db.saveGroup(group);

  sendPushNotification(
    userId,
    "Zu einer Gruppe hinzugefügt",
    `${req.user.name} hat dich zu "${group.name}" hinzugefügt.`,
    { type: "group_added", groupId: group.id }
  ).catch(() => {});

  res.json(group);
});

// Mitglied entfernen — und der Weg, eine Gruppe zu verlassen
//
// Wer die eigene ID einsetzt, verlässt die Gruppe. Das muss IMMER möglich
// sein: eine Gruppe, aus der man nicht herauskommt, ist zusammen mit der
// Blockierfunktion ein echtes Problem — man säße mit jemandem im selben Chat,
// den man gerade blockiert hat.
//
// Der Admin ist der interessante Fall, und das Verhalten ist bewusst so
// gewählt:
//
//   - Verlässt der Admin eine Gruppe mit weiteren Mitgliedern, geht die
//     Adminrolle automatisch an das dienstälteste verbliebene Mitglied
//     (das erste in `memberIds`). Die Alternative — "Admin darf nicht raus,
//     bevor er übergeben hat" — sperrt genau die Person ein, die vielleicht
//     gerade wegen eines Konflikts gehen will.
//   - Ist der Admin das letzte Mitglied, wird die Gruppe gelöscht. Eine
//     mitgliederlose Gruppe wäre für niemanden mehr sichtbar, läge aber samt
//     Chatverlauf für immer in der Datenbank.
app.delete("/api/groups/:id/members/:userId", authenticate, async (req, res) => {
  const targetId = req.params.userId;

  const groups = await db.getGroups();
  const group = groups.find((g) => g.id === req.params.id);
  if (!group) {
    return res.status(404).json({ error: "Gruppe nicht gefunden." });
  }

  const selbst = targetId === req.userId;
  if (!selbst && group.adminId !== req.userId) {
    return res.status(403).json({ error: "Nur Administratoren können Mitglieder entfernen." });
  }
  if (!(group.memberIds || []).includes(targetId)) {
    return res.status(404).json({ error: "Diese Person ist kein Mitglied dieser Gruppe." });
  }

  group.memberIds = group.memberIds.filter((id) => id !== targetId);
  group.pendingUserIds = (group.pendingUserIds || []).filter((id) => id !== targetId);

  if (group.memberIds.length === 0) {
    await db.deleteGroup(group.id);
    return res.json({ success: true, groupDeleted: true });
  }

  let newAdminId = null;
  if (group.adminId === targetId) {
    newAdminId = group.memberIds[0];
    group.adminId = newAdminId;
  }

  await db.saveGroup(group);

  if (newAdminId) {
    sendPushNotification(
      newAdminId,
      "Du bist jetzt Gruppen-Admin",
      `Du verwaltest ab sofort "${group.name}".`,
      { type: "group_admin", groupId: group.id }
    ).catch(() => {});
  }
  if (!selbst) {
    sendPushNotification(
      targetId,
      "Aus einer Gruppe entfernt",
      `Du bist nicht mehr Mitglied von "${group.name}".`,
      { type: "group_removed", groupId: group.id }
    ).catch(() => {});
  }

  res.json({ success: true, groupDeleted: false, adminId: group.adminId });
});

// Mitglieder einer Gruppe — nur für Mitglieder, und nur das Nötige.
//
// Ohne diese Route müsste der Client die Namen aus `/api/users` zusammensuchen,
// was die vollständige Nutzerliste ans Gerät gäbe.
app.get("/api/groups/:id/members", authenticate, async (req, res) => {
  const group = await getGroupIfMember(req.params.id, req.userId);
  if (!group) {
    return res.status(404).json({ error: "Gruppe nicht gefunden." });
  }

  const users = await db.getUsers();
  const byId = new Map(users.map((u) => [u.id, u]));
  const members = (group.memberIds || [])
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((u) => ({
      id: u.id,
      name: u.name,
      avatar: u.avatar,
      isAdmin: u.id === group.adminId,
    }));

  const pending = (group.pendingUserIds || [])
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((u) => ({ id: u.id, name: u.name, avatar: u.avatar }));

  res.json({ members, pending, adminId: group.adminId, isAdmin: group.adminId === req.userId });
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
    const [posts, groups, events, users, friendships, hidden] = await Promise.all([
      db.getPosts(),
      db.getGroups(),
      db.getEvents(),
      db.getUsers(),
      db.getFriendships(),
      getBlockedUserIds(req.userId),
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
        if (hidden.has(p.userId)) return false;
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
    const imageCheck = validateImageReference(image, req.userId);
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

// Eigenen Beitrag löschen.
//
// Seit es Beweisfotos gibt, wiegt das schwer: wer versehentlich das falsche
// Bild hochlädt, kam bisher nicht mehr daran. Für die Stores ist "Nutzer
// können eigene Inhalte entfernen" außerdem eine Erwartung.
app.delete("/api/posts/:id", authenticate, async (req, res) => {
  try {
    const posts = await db.getPosts();
    const post = posts.find((p) => p.id === req.params.id);

    if (!post) {
      return res.status(404).json({ error: "Beitrag nicht gefunden." });
    }
    if (post.userId !== req.userId) {
      return res.status(403).json({ error: "Du kannst nur eigene Beiträge löschen." });
    }

    await db.deletePost(post.id);

    // Das Bild muss mit weg, sonst bleibt es unter seiner CDN-URL abrufbar,
    // obwohl der Beitrag gelöscht ist — für ein Beweisfoto von einer Party
    // wäre "gelöscht, aber weiterhin öffentlich erreichbar" das Gegenteil
    // dessen, was der Nutzer erwartet.
    //
    // Eine bestehende Meldung zu diesem Beitrag bleibt davon unberührt: sie
    // speichert einen eigenen Textauszug (siehe POST /api/reports), gerade
    // damit sie nicht ins Leere läuft, wenn der Autor das Original entfernt.
    if (post.image && storage.isOwnStorageUrl(post.image, req.userId)) {
      const key = storage.keyFromPublicUrl(post.image);
      // Ohne await und mit verschlucktem Fehler: der Beitrag ist bereits
      // gelöscht, ein misslungenes Aufräumen darf die Antwort nicht kippen.
      if (key) storage.deleteObject(key).catch(() => {});
    }

    res.json({ success: true });
  } catch (err) {
    serverError(res, err, `${req.method} ${req.originalUrl}`);
  }
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
    const hidden = await getBlockedUserIds(req.userId);
    res.json(
      duels.filter(
        (d) =>
          (d.creatorId === req.userId || d.opponentId === req.userId) &&
          !hidden.has(d.creatorId) &&
          !hidden.has(d.opponentId)
      )
    );
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

    // Reads as "no such user", so a block cannot be probed for.
    const hidden = await getBlockedUserIds(req.userId);
    if (hidden.has(receiver.id)) {
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

// Remove a friend, or withdraw/decline a pending request. Either side may do
// it — a friendship one person cannot leave is not a friendship.
app.delete("/api/friends/:username", authenticate, async (req, res) => {
  try {
    const other = req.params.username;
    if (other.toLowerCase() === req.user.name.toLowerCase()) {
      return res.status(400).json({ error: "Ungültiger Benutzer." });
    }

    const friendships = await db.getFriendships();
    const exists = friendships.some((f) => {
      const sender = (f.sender_username || "").toLowerCase();
      const receiver = (f.receiver_username || "").toLowerCase();
      const me = req.user.name.toLowerCase();
      const them = other.toLowerCase();
      return (sender === me && receiver === them) || (sender === them && receiver === me);
    });

    if (!exists) {
      return res.status(404).json({ error: "Keine Freundschaft oder Anfrage gefunden." });
    }

    await db.deleteFriendship(req.user.name, other);
    res.json({ success: true });
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

    // A block should have removed the friendship already, but a stale row
    // must never put a blocked person back into the list.
    const hidden = await getBlockedUserIds(req.userId);

    const friendsList = users
      .filter(u => !hidden.has(u.id) && acceptedFriendnames.some(fn => fn.toLowerCase() === u.name.toLowerCase()))
      .map(u => enrichUserProgress(u));

    // Pending requests received (incoming requests that this user can accept)
    const pendingIncomingNames = friendships
      .filter(f => f.status === "pending" && f.receiver_username.toLowerCase() === username.toLowerCase())
      .map(f => f.sender_username);

    const pendingList = users
      .filter(u => !hidden.has(u.id) && pendingIncomingNames.some(pn => pn.toLowerCase() === u.name.toLowerCase()))
      .map(u => enrichUserProgress(u));

    res.json({ friends: friendsList, pending: pendingList });
  } catch (error) {
    serverError(res, error, `${req.method} ${req.originalUrl}`);
  }
});

// ==========================================
// Uploads (Cloudflare R2)
// ==========================================

// Signiert eine kurzlebige Upload-URL. Der Client lädt damit direkt zu R2 —
// das Backend trägt den Bild-Traffic nicht mehr.
//
// Bewusst NICHT hier: das Entfernen der EXIF-Daten. Bei einem Direkt-Upload
// sieht der Server die Bytes nie. Der Client kodiert das Bild vor dem Upload
// neu (siehe src/services/upload.ts), wodurch EXIF und damit die
// GPS-Koordinaten verschwinden, bevor das Foto das Gerät verlässt — das ist
// für die Privatsphäre besser als serverseitiges Nachbessern, aber eben nicht
// erzwingbar. Wer den Client manipuliert, gibt seinen eigenen Standort preis.
app.post(
  "/api/uploads/presign",
  authenticate,
  // Jede signierte URL ist ein Schreibrecht auf den Bucket. Begrenzt, damit
  // niemand sich hunderte auf Vorrat ausstellen lässt.
  rateLimit({ scope: "presign", ipMax: 120, windowMs: HOUR }),
  async (req, res) => {
    try {
      if (!storage.isStorageConfigured()) {
        return res.status(503).json({
          error: "Bild-Upload ist auf diesem Server nicht konfiguriert.",
        });
      }

      const { kind, contentType, contentLength } = req.body;
      const result = await storage.createPresignedUpload({
        userId: req.userId,
        kind,
        contentType,
        contentLength,
      });

      if (!result.ok) {
        return res.status(400).json({ error: result.error });
      }

      res.json({
        uploadUrl: result.uploadUrl,
        publicUrl: result.publicUrl,
        key: result.key,
        expiresInSeconds: result.expiresInSeconds,
      });
    } catch (err) {
      serverError(res, err, `${req.method} ${req.originalUrl}`);
    }
  }
);

// Sagt dem Client, ob dieser Server Uploads kann — der Client soll den
// Foto-Button sonst gar nicht erst anbieten.
app.get("/api/uploads/config", authenticate, (req, res) => {
  res.json({
    enabled: storage.isStorageConfigured(),
    maxBytes: storage.MAX_UPLOAD_BYTES,
    contentTypes: Object.keys(storage.ALLOWED_CONTENT_TYPES),
  });
});

// ==========================================
// Blocking & Reporting
// ==========================================
// Required by both stores for apps carrying user-generated content (chat,
// posts, usernames, avatars). Blocking is the user's own remedy; reporting
// routes a case to the operator.

// Who I have blocked (not who blocked me — that stays invisible on purpose,
// otherwise the block itself becomes a message).
app.get("/api/blocks", authenticate, async (req, res) => {
  try {
    const [blocks, users] = await Promise.all([db.getBlocks(), db.getUsers()]);
    const mine = blocks.filter((b) => b.blockerId === req.userId);

    res.json(
      mine.map((b) => {
        const blockedUser = users.find((u) => u.id === b.blockedId);
        return {
          id: b.id,
          userId: b.blockedId,
          username: blockedUser ? blockedUser.name : "Unbekannt",
          avatar: blockedUser ? blockedUser.avatar || null : null,
          timestamp: b.timestamp,
        };
      })
    );
  } catch (err) {
    serverError(res, err, `${req.method} ${req.originalUrl}`);
  }
});

app.post("/api/blocks", authenticate, async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId || typeof userId !== "string") {
      return res.status(400).json({ error: "userId fehlt." });
    }
    if (userId === req.userId) {
      return res.status(400).json({ error: "Du kannst dich nicht selbst blockieren." });
    }

    const users = await db.getUsers();
    const target = users.find((u) => u.id === userId);
    if (!target) {
      return res.status(404).json({ error: "Benutzer nicht gefunden." });
    }

    await db.saveBlock({
      id: generateUniqueId("block"),
      blockerId: req.userId,
      blockedId: userId,
      timestamp: new Date().toISOString(),
    });

    // A block that left the friendship intact would be no block at all — the
    // friendship is what grants feed, radar and map access.
    await db.deleteFriendship(req.user.name, target.name);

    res.status(201).json({ success: true });
  } catch (err) {
    serverError(res, err, `${req.method} ${req.originalUrl}`);
  }
});

app.delete("/api/blocks/:userId", authenticate, async (req, res) => {
  try {
    await db.deleteBlock(req.userId, req.params.userId);
    // Deliberately does NOT restore the friendship — unblocking means "I can
    // see this person again", not "we are friends again".
    res.json({ success: true });
  } catch (err) {
    serverError(res, err, `${req.method} ${req.originalUrl}`);
  }
});

const REPORT_REASONS = ["belaestigung", "spam", "unangemessen", "fake", "sonstiges"];

app.post(
  "/api/reports",
  authenticate,
  // A report costs the operator attention, so it is worth limiting — but
  // loosely, because a genuine victim may have several things to report.
  rateLimit({ scope: "report", ipMax: 60, windowMs: HOUR }),
  async (req, res) => {
    try {
      const { reportedUserId, contentType, contentId, reason, details } = req.body;

      if (!REPORT_REASONS.includes(reason)) {
        return res.status(400).json({ error: "Bitte wähle einen gültigen Meldegrund." });
      }
      if (!["user", "post", "message"].includes(contentType)) {
        return res.status(400).json({ error: "Unbekannter Inhaltstyp." });
      }

      let detailsText = null;
      if (details !== undefined && details !== null && details !== "") {
        const check = validateText(details, "Beschreibung", { max: 1000 });
        if (!check.ok) return res.status(400).json({ error: check.error });
        detailsText = check.value;
      }

      const users = await db.getUsers();
      const reported = users.find((u) => u.id === reportedUserId);
      if (!reported) {
        return res.status(404).json({ error: "Gemeldeter Benutzer nicht gefunden." });
      }
      if (reported.id === req.userId) {
        return res.status(400).json({ error: "Du kannst dich nicht selbst melden." });
      }

      // Store a copy of what was reported: the author can delete the original
      // at any time, and then the report would be about nothing.
      let excerpt = null;
      if (contentType === "post" && contentId) {
        const post = (await db.getPosts()).find((p) => p.id === contentId);
        if (post) excerpt = String(post.text).slice(0, 500);
      } else if (contentType === "message" && contentId) {
        const messages = await db.getDirectMessages(req.userId, reported.id);
        const message = messages.find((m) => m.id === contentId);
        if (message) excerpt = String(message.content).slice(0, 500);
      }

      const report = {
        id: generateUniqueId("report"),
        reporterId: req.userId,
        reportedUserId: reported.id,
        reportedUsername: reported.name,
        contentType,
        contentId: contentId || null,
        contentExcerpt: excerpt,
        reason,
        details: detailsText,
        status: "open",
        timestamp: new Date().toISOString(),
      };

      await db.saveReport(report);

      // Also to the log: the stores expect a report to be acted on within 24
      // hours, and nobody watches a database table. `docker compose logs
      // backend | grep MELDUNG` is the operator's inbox until there is a
      // moderation screen.
      console.warn(
        `[TrinkDuell] MELDUNG (${reason}) gegen "${reported.name}" von "${req.user.name}" ` +
          `— Typ: ${contentType}${contentId ? `, Inhalt: ${contentId}` : ""}` +
          `${detailsText ? `, Beschreibung: ${detailsText}` : ""}` +
          `${excerpt ? `, Auszug: "${excerpt.slice(0, 120)}"` : ""}`
      );

      res.status(201).json({ success: true });
    } catch (err) {
      serverError(res, err, `${req.method} ${req.originalUrl}`);
    }
  }
);
// Fehlerinjektion, ausschließlich für den Test in tests/asyncerrors.test.js.
//
// Ohne eine Route, die zuverlässig scheitert, ließe sich die Zusicherung
// „ein Fehler in einer Route beendet den Server nicht" nicht über HTTP gegen
// den echten Server prüfen — und genau darum geht es hier. Die Routen
// existieren nur, wenn die Umgebungsvariable gesetzt ist; im Container ist sie
// es nicht (siehe server/docker-compose.yml).
if (process.env.TRINKDUELL_ENABLE_FAULT_ROUTE === "1") {
  console.warn("[TrinkDuell] ACHTUNG: Fehlerinjektions-Routen aktiv (nur für Tests).");

  // Bewusst OHNE try/catch — das ist der Fall, den wrapAsync abfangen muss.
  app.get("/api/__fault/async", async () => {
    await new Promise((resolve) => setTimeout(resolve, 1));
    throw new Error("Absichtlicher Testfehler: geheimer interner Pfad D:\\\\intern\\\\secret");
  });

  app.get("/api/__fault/sync", () => {
    throw new Error("Absichtlicher synchroner Testfehler");
  });

  // Eine abgelehnte Promise, die keinem Request gehört: sie kann den Wrapper
  // gar nicht erreichen und trifft nur auf das process-Netz.
  app.get("/api/__fault/detached", (req, res) => {
    Promise.reject(new Error("Absichtlich losgeloeste Ablehnung"));
    res.json({ ok: true });
  });
}


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
  try {
    // Hash any existing plaintext passwords (safe no-op if already hashed)
    await migratePlaintextPasswords();
  } catch (err) {
    // Der listen-Rückruf ist async und hängt an keinem Request: eine Ablehnung
    // hier ginge am Wrapper vorbei. Ein fehlgeschlagener Migrationslauf darf
    // den gerade gestarteten Server nicht sofort wieder umwerfen.
    console.error("[TrinkDuell] Passwort-Migration beim Start fehlgeschlagen:", err);
  }
});
