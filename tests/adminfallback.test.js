// Die Admin-Konsole darf keinen Offline-Rückfall haben.
//
// Statische Prüfung wie in schema.test.js und upload.test.js: api.ts lässt
// sich in nacktem Node nicht laden, das Muster ist aber im Quelltext
// erkennbar.
//
// Der Fall, der zugeschlagen hat: Alle Admin-Aufrufe wurden in
// `executeApiCall(netz, lokalerErsatz)` gewickelt. Bei einem Netzfehler —
// und der Circuit Breaker löst schon nach EINEM aus — lieferte der Ersatz:
//
//   banUser              → { success: true }, ohne irgendwo zu sperren.
//                          Ein Moderator hält einen Missbrauchsfall für
//                          erledigt, während der Account weiterläuft.
//   getAdminStats        → erfundene Serverwerte (Laufzeit 3600 s, 42 MB)
//                          und feste Nullen für offene Meldungen.
//
// Dieselbe Begründung, aus der deleteAccount und die Passwort-Routen den
// Rückfall bewusst umgehen: was am Server hängt, darf lokal nicht
// vorgetäuscht werden.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const apiTs = fs.readFileSync(
  path.join(__dirname, "..", "src", "services", "api.ts"),
  "utf8"
);

test("Admin-Konsole ohne Offline-Rückfall", async (t) => {
  const adminBlock = apiTs.slice(apiTs.indexOf("─── Admin Console Endpoints"));

  await t.test("der Admin-Block ist vorhanden", () => {
    assert.ok(adminBlock.length > 500, "Admin-Block in api.ts nicht gefunden");
  });

  await t.test("kein executeApiCall unter den Admin-Aufrufen", () => {
    assert.ok(
      !adminBlock.includes("executeApiCall"),
      "Admin-Aufrufe dürfen nicht auf lokale Mock-Daten zurückfallen — " +
        "eine Moderationsansicht zeigt Serverzustand oder gar nichts."
    );
  });

  await t.test("die gefährlichen Aktionen gehen direkt an den Server", () => {
    for (const name of ["banUser", "resetUserStats", "adminDeletePost", "sendAdminBroadcast"]) {
      const i = adminBlock.indexOf(`${name}:`);
      assert.ok(i >= 0, `${name} fehlt im Admin-Block`);
      // Der Rumpf bis zur nächsten Methode
      const rumpf = adminBlock.slice(i, adminBlock.indexOf("\n  },", i));
      assert.match(rumpf, /axiosInstance\./, `${name} muss den Server aufrufen`);
    }
  });

  await t.test("es gibt keine lokalen Admin-Ersatzfunktionen mehr", () => {
    const mockTs = fs.readFileSync(
      path.join(__dirname, "..", "src", "services", "mockData.ts"),
      "utf8"
    );
    for (const name of ["banUserLocal", "getAdminStatsLocal", "resetUserStatsLocal"]) {
      assert.ok(
        !mockTs.includes(`export const ${name}`),
        `${name} ist wieder da — ein lokaler Ersatz für eine Moderationsaktion`
      );
    }
  });
});
