// Test harness: starts the real backend in a child process against a
// throwaway JSON database, and hands the test a small API client.
//
// Deliberately the real server, not a stub — these tests exist to prove the
// authorization and validation rules that live in server/index.js actually
// hold over HTTP, which is the only place they matter.
const { spawn } = require("node:child_process");
const net = require("node:net");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SERVER_ENTRY = path.join(__dirname, "..", "..", "server", "index.js");
const STARTUP_TIMEOUT_MS = 20000;

// Ask the OS for a free port, then release it again. A fixed port would make
// two test files running in parallel collide.
function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/**
 * Starts a backend instance. Returns a handle with:
 *   base        - http://127.0.0.1:<port>/api
 *   call()      - fetch wrapper returning { status, json }
 *   register()  - creates a user and returns { token, user, ... }
 *   serverLog() - everything the server printed so far (stdout + stderr)
 *   stop()      - kills the server and deletes the throwaway database
 */
async function startTestServer() {
  const port = await findFreePort();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "trinkduell-test-"));
  const dbFile = path.join(tmpDir, "db.json");

  const env = { ...process.env };
  // JSON mode, never Postgres: the tests must not reach a real database, and
  // DATABASE_URL is also what makes index.js enforce a production JWT secret.
  delete env.DATABASE_URL;
  // No mail provider, so the reset code goes to the log where a test can
  // read it — exactly the path a beta deployment without Resend uses.
  delete env.RESEND_API_KEY;
  env.PORT = String(port);
  env.TRINKDUELL_DB_FILE = dbFile;
  env.JWT_SECRET = "test-secret-not-used-anywhere-else";

  const child = spawn(process.execPath, [SERVER_ENTRY], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let log = "";
  child.stdout.on("data", (chunk) => { log += chunk.toString(); });
  child.stderr.on("data", (chunk) => { log += chunk.toString(); });

  const base = `http://127.0.0.1:${port}/api`;

  await waitUntilReady(base, child, () => log);

  // `ip` sets X-Forwarded-For, which is how the server identifies a client
  // (see clientIp in server/index.js). Tests use it to act as separate
  // machines where that is what a real run would look like.
  async function call(method, routePath, body, token, ip) {
    const res = await fetch(base + routePath, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(ip ? { "X-Forwarded-For": ip } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    try {
      json = await res.json();
    } catch {
      // Some responses legitimately have no body.
    }
    return { status: res.status, json };
  }

  // Unique per call so tests never collide on usernames or emails.
  //
  // Each registration comes from its own simulated IP. The signup limit is 20
  // per hour per IP and a full suite creates far more accounts than that — so
  // without this the rate limiter (correctly) blocks the tests themselves.
  // Simulating separate devices is the honest fix; weakening the limit for
  // tests would mean the limit is no longer the one running in production.
  let seq = 0;
  async function register(prefix = "user") {
    seq += 1;
    // Must stay inside the server's 24-character username limit while still
    // being unique across runs (the throwaway database is new each time, but
    // a shared one would otherwise collide).
    const name = `${prefix.slice(0, 12)}${Date.now().toString(36).slice(-5)}${seq}`;
    const res = await call(
      "POST",
      "/auth/register",
      {
        username: name,
        email: `${name}@test.local`,
        password: "testpasswort1",
      },
      undefined,
      `10.${(seq >> 16) & 255}.${(seq >> 8) & 255}.${seq & 255}`
    );
    if (res.status !== 201) {
      throw new Error(`Registrierung fehlgeschlagen (${res.status}): ${JSON.stringify(res.json)}`);
    }
    return {
      token: res.json.token,
      id: res.json.user.id,
      name: res.json.user.name,
      email: `${name}@test.local`,
      password: "testpasswort1",
    };
  }

  async function stop() {
    await new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      child.once("exit", resolve);
      child.kill();
      // Don't hang the whole run if the process refuses to go.
      setTimeout(resolve, 3000).unref();
    });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  return { base, call, register, stop, serverLog: () => log };
}

async function waitUntilReady(base, child, getLog) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Server ist beim Start beendet worden (Code ${child.exitCode}):\n${getLog()}`);
    }
    try {
      // Any answer at all means the HTTP server is accepting connections; 401
      // is the expected one for an unauthenticated request.
      await fetch(`${base}/users`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  throw new Error(`Server war nach ${STARTUP_TIMEOUT_MS} ms nicht erreichbar:\n${getLog()}`);
}

module.exports = { startTestServer };
