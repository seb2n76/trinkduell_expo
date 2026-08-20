// HTTP-Methode des Direkt-Uploads zu R2.
//
// Statische Prüfung wie in schema.test.js: `src/services/upload.ts` importiert
// react-native und expo-image-manipulator und lässt sich in einem nackten Node
// nicht laden. Der Fehler, den dieser Test verhindert, ist aber rein
// struktureller Natur und damit auch im Quelltext erkennbar.
//
// Der Fall, der zugeschlagen hat (Commit 489feb9): Beim Ergänzen einer
// Fehlermeldung ist `method: "PUT"` aus dem fetch-Aufruf verschwunden. Ohne
// method ist ein fetch ein GET, und ein GET mit body wirft sofort
// "Request with GET/HEAD method cannot have body" — noch bevor eine
// Verbindung aufgebaut wird.
//
// Besonders zäh war die Fehlersuche, weil derselbe Commit einen catch-Block
// ergänzte, der JEDEN Wurf als CORS-Problem deutete. Die App meldete also
// "die CORS-Regeln des R2-Buckets müssen PUT erlauben", während der Bucket
// nie gefragt worden war. Wochenlang wurde an der falschen Stelle gesucht.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const uploadTs = fs.readFileSync(
  path.join(__dirname, "..", "src", "services", "upload.ts"),
  "utf8"
);

test("Direkt-Upload zu R2", async (t) => {
  await t.test("sendet den Bild-Body per PUT", () => {
    // Der Aufruf, der die signierte URL benutzt.
    const aufruf = uploadTs.slice(
      uploadTs.indexOf("fetch(uploadUrl"),
      uploadTs.indexOf("if (!response.ok)")
    );

    assert.ok(aufruf.length > 0, "fetch(uploadUrl ...) nicht gefunden");
    assert.match(
      aufruf,
      /method:\s*"PUT"/,
      'Der Upload braucht method: "PUT" — ohne wird daraus ein GET, und ein ' +
        "GET mit body wirft, bevor der Speicher überhaupt erreicht wird."
    );
  });

  await t.test("schickt den Body als Blob mit", () => {
    const aufruf = uploadTs.slice(
      uploadTs.indexOf("fetch(uploadUrl"),
      uploadTs.indexOf("if (!response.ok)")
    );
    assert.match(aufruf, /body:\s*prepared\.blob/, "Der Bild-Body fehlt");
  });

  await t.test("deutet einen Aufbaufehler nicht als CORS-Problem", () => {
    // Ein TypeError aus dem fetch-Aufbau bedeutet einen Fehler in unserer
    // eigenen Anfrage. Ihn als CORS zu melden schickt die Fehlersuche an den
    // Bucket statt in den Code — genau das ist hier einmal passiert.
    assert.match(
      uploadTs,
      /cannot have body/i,
      "Der catch-Block muss den Aufbaufehler vom Verbindungsfehler trennen"
    );
  });
});
