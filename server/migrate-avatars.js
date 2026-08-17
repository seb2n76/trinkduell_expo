#!/usr/bin/env node
/**
 * Verschiebt bestehende Base64-Profilbilder in den Objektspeicher.
 *
 * Warum überhaupt: ein Base64-Avatar liegt in der Nutzertabelle und wird
 * dadurch in JEDER Antwort mitgeschleppt, die Nutzer enthält — Nutzerliste,
 * Suche, Freundesliste, Rangliste. Bei einem 200-KB-Bild und zehn Nutzern
 * sind das zwei Megabyte pro Feed-Aufruf.
 *
 * Aufruf auf dem Server (R2-Zugangsdaten müssen gesetzt sein):
 *
 *     docker compose -f server/docker-compose.yml exec backend \
 *       node server/migrate-avatars.js --dry-run
 *     docker compose -f server/docker-compose.yml exec backend \
 *       node server/migrate-avatars.js
 *
 * Ohne --dry-run wird geschrieben. Das Skript ist wiederholbar: bereits
 * migrierte Nutzer werden übersprungen, ein Abbruch mitten drin ist also
 * unproblematisch.
 *
 * Es verkleinert die Bilder NICHT. Ein Bestandsbild neu zu kodieren würde
 * hier eine Bildbibliothek auf dem Server verlangen, die es bewusst nicht
 * gibt (das Verkleinern passiert im Client). Die Bytes bleiben also gleich,
 * wandern aber aus der Datenbank heraus.
 */
const { PutObjectCommand, S3Client } = require("@aws-sdk/client-s3");
const crypto = require("crypto");
const db = require("./db");

const DRY_RUN = process.argv.includes("--dry-run");

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const BUCKET = process.env.R2_BUCKET;
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const PUBLIC_URL = (process.env.R2_PUBLIC_URL || "").replace(/\/+$/, "");

const EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

function parseDataUrl(value) {
  const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/.exec(value || "");
  if (!match) return null;
  return { contentType: match[1], buffer: Buffer.from(match[2], "base64") };
}

async function main() {
  if (!ACCOUNT_ID || !BUCKET || !ACCESS_KEY_ID || !SECRET_ACCESS_KEY || !PUBLIC_URL) {
    console.error("FEHLER: R2_* Umgebungsvariablen fehlen. Nichts zu tun.");
    process.exit(1);
  }

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY },
    requestChecksumCalculation: "WHEN_REQUIRED",
  });

  const users = await db.getUsers();
  const candidates = users.filter((u) => u.avatar && u.avatar.startsWith("data:"));

  console.log(`${users.length} Nutzer, davon ${candidates.length} mit Base64-Avatar.`);
  if (DRY_RUN) console.log("(Probelauf — es wird nichts geschrieben)\n");

  let migrated = 0;
  let skipped = 0;
  let bytesFreed = 0;

  for (const user of candidates) {
    const parsed = parseDataUrl(user.avatar);
    if (!parsed) {
      console.log(`  ÜBERSPRUNGEN ${user.name}: Avatar ist kein erkanntes Base64-Bild`);
      skipped++;
      continue;
    }

    const extension = EXTENSIONS[parsed.contentType];
    const key = `avatar/${user.id}/${crypto.randomBytes(16).toString("hex")}.${extension}`;
    const sizeKb = (parsed.buffer.length / 1024).toFixed(0);

    if (DRY_RUN) {
      console.log(`  WÜRDE ${user.name} migrieren: ${sizeKb} KB -> ${key}`);
      migrated++;
      bytesFreed += user.avatar.length;
      continue;
    }

    try {
      await client.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: key,
          Body: parsed.buffer,
          ContentType: parsed.contentType,
        })
      );

      // Erst nach erfolgreichem Upload das Feld ersetzen. Andersherum wäre
      // bei einem Fehlschlag das Bild weg.
      user.avatar = `${PUBLIC_URL}/${key}`;
      await db.saveUser(user);

      console.log(`  OK ${user.name}: ${sizeKb} KB -> ${key}`);
      migrated++;
      bytesFreed += parsed.buffer.length;
    } catch (err) {
      console.error(`  FEHLER bei ${user.name}: ${err.message}`);
      skipped++;
    }
  }

  console.log(
    `\nFertig: ${migrated} migriert, ${skipped} übersprungen, ` +
      `${(bytesFreed / 1024).toFixed(0)} KB aus der Datenbank entfernt.`
  );

  if (!DRY_RUN && migrated > 0) {
    console.log("Die App liefert die Bilder ab jetzt über die CDN-Domain aus.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration fehlgeschlagen:", err);
    process.exit(1);
  });
