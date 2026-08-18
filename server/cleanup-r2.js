#!/usr/bin/env node
/**
 * Löscht verwaiste Objekte aus dem R2-Bucket.
 *
 * Wie sie entstehen: `POST /api/uploads/presign` signiert eine Upload-URL,
 * der Client lädt das Bild hoch — und bricht dann ab, bevor der Beitrag
 * gespeichert oder der Avatar gesetzt wird. Das Objekt liegt dann im Bucket,
 * und nichts zeigt darauf. Es kostet Speicher und taucht in keiner Statistik
 * auf.
 *
 * Aufruf auf dem Server:
 *
 *     docker compose -f server/docker-compose.yml exec backend \
 *       node server/cleanup-r2.js
 *     docker compose -f server/docker-compose.yml exec backend \
 *       node server/cleanup-r2.js --delete
 *
 * ES WIRD NICHTS GELÖSCHT, solange `--delete` fehlt. Das ist bei einem
 * Löschskript die richtige Voreinstellung — die anderen Skripte hier haben
 * `--dry-run` als Schalter, weil sie nur schreiben, nicht vernichten.
 *
 * Zwei Sicherheitsnetze, weil ein Fehler hier fremde Bilder kostet:
 *
 *   1. **Schonfrist.** Objekte, die jünger als GRACE_HOURS sind, werden nie
 *      angefasst. Zwischen "Upload fertig" und "Beitrag gespeichert" liegen
 *      Sekunden, aber ein Nutzer kann das Formular auch eine Weile offen
 *      lassen. Ohne diese Frist löscht ein unglücklich getimter Lauf ein
 *      Bild, das gerade rechtmäßig entsteht.
 *   2. **Referenzen zuerst, dann Liste.** Erst werden ALLE Verweise aus der
 *      Datenbank eingesammelt, dann der Bucket gelistet. Andersherum könnte
 *      ein Objekt, das während des Laufs verknüpft wird, als verwaist gelten.
 *
 * Die einfachere Alternative, falls das hier zu viel ist: eine
 * Lebenszyklus-Regel im Cloudflare-Dashboard, die Objekte nach N Tagen
 * löscht. Die kennt allerdings keine Verweise und würde auch benutzte Bilder
 * wegräumen — taugt also nur mit einer sehr langen Frist.
 */
const { ListObjectsV2Command, DeleteObjectCommand, S3Client } = require("@aws-sdk/client-s3");
const db = require("./db");

const DELETE = process.argv.includes("--delete");
const GRACE_HOURS = 24;

// Einzelzugriffe statt Destrukturierung: `expo/no-env-var-destructuring`
// verbietet Letzteres, weil Expos Build-Zeit-Ersetzung von process.env.X nur
// bei direktem Zugriff greift. Hier laeuft zwar reines Node, aber die Regel
// gilt fuer das ganze Repo - und eine Ausnahme waere teurer als fuenf Zeilen.
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_BUCKET = process.env.R2_BUCKET;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;

function konfiguriert() {
  return Boolean(R2_ACCOUNT_ID && R2_BUCKET && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_PUBLIC_URL);
}

/** Schlüssel aus einer öffentlichen URL, oder null wenn sie nicht zu uns gehört. */
function keyAus(url) {
  if (typeof url !== "string") return null;
  const praefix = `${R2_PUBLIC_URL}/`;
  if (!url.startsWith(praefix)) return null;
  const key = url.slice(praefix.length);
  return key && !key.includes("..") ? key : null;
}

/**
 * Jeder Schlüssel, auf den irgendetwas in der Datenbank zeigt.
 *
 * Wer hier eine Quelle vergisst, löscht benutzte Bilder. Deshalb steht die
 * Liste beisammen und nicht verstreut.
 */
async function referenzierteSchluessel() {
  const [users, posts] = await Promise.all([db.getUsers(), db.getPosts()]);
  const keys = new Set();

  for (const u of users) {
    const k = keyAus(u.avatar);
    if (k) keys.add(k);
  }
  for (const p of posts) {
    const k = keyAus(p.image);
    if (k) keys.add(k);
  }

  return keys;
}

async function main() {
  if (!konfiguriert()) {
    console.error(
      "R2 ist nicht konfiguriert (R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID,\n" +
        "R2_SECRET_ACCESS_KEY, R2_PUBLIC_URL). Ohne diese Werte gibt es nichts aufzuräumen."
    );
    process.exit(1);
  }

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  });

  // Reihenfolge ist Absicht, siehe Kopfkommentar.
  const referenziert = await referenzierteSchluessel();
  console.log(`${referenziert.size} verwendete Objekte laut Datenbank.`);

  const grenze = Date.now() - GRACE_HOURS * 60 * 60 * 1000;
  let geprueft = 0;
  let jung = 0;
  const verwaist = [];

  let token;
  do {
    const res = await client.send(
      new ListObjectsV2Command({ Bucket: R2_BUCKET, ContinuationToken: token })
    );
    for (const obj of res.Contents || []) {
      geprueft++;
      if (referenziert.has(obj.Key)) continue;
      if (new Date(obj.LastModified).getTime() > grenze) {
        jung++;
        continue;
      }
      verwaist.push({ key: obj.Key, groesse: obj.Size, datum: obj.LastModified });
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);

  const bytes = verwaist.reduce((summe, o) => summe + (o.groesse || 0), 0);
  console.log(`${geprueft} Objekte im Bucket, ${jung} davon jünger als ${GRACE_HOURS} h (unangetastet).`);
  console.log(`${verwaist.length} verwaist, zusammen ${Math.round(bytes / 1024)} KB.\n`);

  if (verwaist.length === 0) {
    console.log("Nichts aufzuräumen.");
    return;
  }

  for (const o of verwaist) {
    console.log(`  ${DELETE ? "LÖSCHE" : "WÜRDE LÖSCHEN"} ${o.key} (${Math.round((o.groesse || 0) / 1024)} KB, ${new Date(o.datum).toISOString().slice(0, 10)})`);
  }

  if (!DELETE) {
    console.log(`\nProbelauf. Zum wirklichen Löschen mit --delete aufrufen.`);
    return;
  }

  let geloescht = 0;
  for (const o of verwaist) {
    try {
      await client.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: o.key }));
      geloescht++;
    } catch (err) {
      console.error(`  FEHLER bei ${o.key}: ${err.message}`);
    }
  }
  console.log(`\nFertig: ${geloescht} von ${verwaist.length} gelöscht.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Aufräumen fehlgeschlagen:", err);
    process.exit(1);
  });
