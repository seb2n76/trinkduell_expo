// Ein Fehler in einer Route darf den Server nicht beenden.
//
// Hintergrund: Express 4 leitet eine abgelehnte Promise aus einem
// `async`-Handler nicht an die Fehler-Middleware weiter. Sie wird zur
// `unhandledRejection`, und die beendet seit Node 15 den Prozess. Am
// 18.08.2026 hat auf diesem Weg ein `undefined.map()` in `GET /api/logs` das
// komplette Backend abgerissen — ein Request, alle Nutzer offline.
//
// Der interessante Teil dieser Tests ist deshalb nicht der 500er. Der ist
// leicht. Entscheidend ist die Zeile DANACH: antwortet der Server noch?
// Zwei Netze, und sie tun Verschiedenes — im Mutationstest sauber getrennt:
//
//   wrapAsync     — der Request bekommt eine 500-Antwort, und der Fehler
//                   landet in der Fehler-Middleware. Ohne ihn hängt der
//                   Aufrufer bis ins Timeout, auch wenn der Server lebt.
//   process.on()  — der Prozess bleibt am Leben. Ohne ihn beendet Node sich
//                   bei der ersten unbehandelten Ablehnung.
//
// Baut man beide aus, ist der Zustand vom 18.08.2026 wieder da: ein Request
// auf eine fehlerhafte Route, und der Server ist weg.
//
// Die Zeitlimits unten sind Absicht: fällt der Wrapper weg, soll der Test
// scheitern statt zu hängen.

const test = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer } = require("./helpers/server");

/** Der Server antwortet noch — 401 ist die erwartete Antwort ohne Token. */
async function serverLebt(call) {
  const res = await call("GET", "/users");
  return res.status === 401;
}

test("Fehler in Routen beenden den Server nicht", async (t) => {
  const server = await startTestServer({
    env: { TRINKDUELL_ENABLE_FAULT_ROUTE: "1" },
  });
  t.after(() => server.stop());
  const { call } = server;

  await t.test("eine async-Route ohne try/catch antwortet mit 500", { timeout: 10000 }, async () => {
    const res = await call("GET", "/__fault/async");
    assert.equal(res.status, 500);
    assert.match(res.json.error, /Auf dem Server ist ein Fehler aufgetreten/);
  });

  await t.test("und der Server lebt danach weiter", { timeout: 10000 }, async () => {
    assert.ok(await serverLebt(call), "Der Prozess muss den Routenfehler überleben");
  });

  await t.test("die Antwort verrät keine Interna", { timeout: 10000 }, async () => {
    const res = await call("GET", "/__fault/async");
    const body = JSON.stringify(res.json);
    // Die Testroute schreibt absichtlich einen Pfad in die Fehlermeldung.
    assert.ok(!body.includes("intern"), "Kein interner Pfad in der Antwort");
    assert.ok(!body.includes("Absichtlicher"), "Keine Roh-Fehlermeldung in der Antwort");
    assert.ok(!body.includes("at "), "Kein Stacktrace in der Antwort");
  });

  await t.test("ein synchroner Wurf verhält sich genauso", { timeout: 10000 }, async () => {
    const res = await call("GET", "/__fault/sync");
    assert.equal(res.status, 500);
    assert.ok(await serverLebt(call), "Auch ein synchroner Wurf darf nichts umwerfen");
  });

  await t.test("eine losgelöste Ablehnung beendet den Prozess nicht", { timeout: 10000 }, async () => {
    // Diese kann der Wrapper nicht sehen: sie hängt an keinem Request. Sie
    // trifft nur auf das process.on("unhandledRejection")-Netz.
    const res = await call("GET", "/__fault/detached");
    assert.equal(res.status, 200);

    // Kurz warten: die Ablehnung wird erst nach der Antwort gemeldet.
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.ok(await serverLebt(call), "Eine losgelöste Ablehnung darf nichts umwerfen");
  });

  await t.test("mehrere Fehler nacheinander werfen den Server nicht um", { timeout: 10000 }, async () => {
    for (let i = 0; i < 5; i++) {
      const res = await call("GET", "/__fault/async");
      assert.equal(res.status, 500, `Versuch ${i + 1}`);
    }
    assert.ok(await serverLebt(call), "Auch nach fünf Fehlern muss der Server stehen");
  });

  await t.test("der Fehler steht im Server-Log", { timeout: 10000 }, async () => {
    // Die Antwort ist absichtlich nichtssagend — die Ursache muss dafür im Log
    // stehen, sonst ist ein Produktionsfehler nicht mehr aufzuklären.
    assert.match(
      server.serverLog(),
      /Absichtlicher Testfehler/,
      "Die echte Ursache gehört ins Log, nicht in die Antwort"
    );
  });
});

test("Fehlerinjektion ist ohne die Umgebungsvariable nicht erreichbar", async (t) => {
  // Die Routen dürfen im Container nicht existieren. Ohne diesen Test wäre
  // nichts dagegen, dass sie versehentlich immer registriert werden.
  const server = await startTestServer();
  t.after(() => server.stop());

  for (const pfad of ["/__fault/async", "/__fault/sync", "/__fault/detached"]) {
    const res = await server.call("GET", pfad);
    assert.equal(res.status, 404, `${pfad} darf ohne die Variable nicht existieren`);
  }
});
