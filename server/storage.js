const crypto = require("crypto");
const { S3Client, DeleteObjectCommand, HeadObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

/**
 * Object storage (Cloudflare R2) für Bild-Uploads.
 *
 * Bilder lagen bisher als Base64 in der Datenbank. Das bremst zweifach: jede
 * Nutzerliste schleppt die Avatare mit, und jeder Upload läuft durch den
 * Node-Prozess. Stattdessen signiert der Server nur eine kurzlebige URL, und
 * der Client lädt direkt zu R2.
 *
 * Ohne konfigurierte Zugangsdaten ist das Modul ein No-op — die App läuft
 * dann wie bisher weiter, statt beim Start umzufallen. Lokale Entwicklung
 * braucht keinen Cloud-Speicher.
 */

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const BUCKET = process.env.R2_BUCKET;
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const PUBLIC_URL = (process.env.R2_PUBLIC_URL || "").replace(/\/+$/, "");

/** Wie lange eine signierte Upload-URL gilt. Kurz: sie ist ein Einmal-Schlüssel. */
const UPLOAD_URL_TTL_SECONDS = 5 * 60;

/** Obergrenze pro Bild. Der Client komprimiert vorher; das hier ist die Bremse. */
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

const ALLOWED_CONTENT_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Wofür ein Bild hochgeladen wird — bestimmt das Schlüssel-Präfix. */
const UPLOAD_KINDS = ["avatar", "proof"];

let client = null;

function isStorageConfigured() {
  return Boolean(ACCOUNT_ID && BUCKET && ACCESS_KEY_ID && SECRET_ACCESS_KEY && PUBLIC_URL);
}

function getClient() {
  if (!isStorageConfigured()) return null;
  if (client) return client;

  client = new S3Client({
    // R2 kennt keine Regionen; "auto" ist der von Cloudflare vorgesehene Wert.
    region: "auto",
    endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET_ACCESS_KEY,
    },
    // Neuere SDK-Versionen hängen von sich aus eine CRC32-Prüfsumme an. Beim
    // Signieren kennt das SDK die Bytes aber nicht und berechnet die Summe des
    // LEEREN Payloads (x-amz-checksum-crc32=AAAAAA==). Lädt der Client danach
    // echte Bytes hoch, passt die Prüfsumme nicht und R2 lehnt ab. Für
    // signierte URLs muss das also aus.
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
  return client;
}

/**
 * Signiert einen Upload.
 *
 * Wichtig sind die beiden Festschreibungen: Content-Type UND Content-Length
 * gehen in die Signatur ein. Ohne sie wäre eine signierte PUT-URL eine offene
 * Tür — wer sie hat, könnte beliebig große Dateien beliebigen Typs in den
 * Bucket schreiben. So passt nur genau das Bild hinein, das angekündigt wurde.
 *
 * Der Schlüssel enthält die Nutzer-ID, damit sich Besitz später allein aus
 * dem Pfad ableiten lässt, plus 16 Zufallsbytes, damit Schlüssel nicht
 * erratbar sind.
 */
async function createPresignedUpload({ userId, kind, contentType, contentLength }) {
  if (!isStorageConfigured()) {
    return { ok: false, error: "Bild-Upload ist auf diesem Server nicht konfiguriert." };
  }
  if (!UPLOAD_KINDS.includes(kind)) {
    return { ok: false, error: "Unbekannter Upload-Typ." };
  }
  const extension = ALLOWED_CONTENT_TYPES[contentType];
  if (!extension) {
    return { ok: false, error: "Ungültiges Bildformat. Erlaubt sind JPEG, PNG und WebP." };
  }
  const size = Number(contentLength);
  if (!Number.isInteger(size) || size <= 0 || size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error: `Das Bild ist zu groß (maximal ${Math.round(MAX_UPLOAD_BYTES / 1024)} KB).`,
    };
  }

  const key = `${kind}/${userId}/${crypto.randomBytes(16).toString("hex")}.${extension}`;

  const uploadUrl = await getSignedUrl(
    getClient(),
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: contentType,
      ContentLength: size,
    }),
    {
      expiresIn: UPLOAD_URL_TTL_SECONDS,
      // Beide Header MÜSSEN in die Signatur. Ohne content-type signiert das
      // SDK nur content-length und host — dann könnte man über eine für JPEG
      // ausgestellte URL text/html hochladen und würde HTML von der eigenen
      // CDN-Domain ausliefern. Das ist ein Stored-XSS auf cdn.trinkduell.com.
      signableHeaders: new Set(["content-length", "content-type"]),
    }
  );

  return {
    ok: true,
    key,
    uploadUrl,
    publicUrl: `${PUBLIC_URL}/${key}`,
    expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
    maxBytes: MAX_UPLOAD_BYTES,
  };
}

/**
 * Prüft, ob eine Bild-URL vom eigenen Speicher kommt und dem Aufrufer gehört.
 *
 * Ohne diese Prüfung könnte man nach dem Signieren eine beliebige fremde URL
 * als Avatar oder Beweisfoto eintragen — der Upload selbst ist ja getrennt von
 * dem Moment, in dem die URL im Datensatz landet. Der Pfad trägt die
 * Nutzer-ID, deshalb ist Besitz allein daraus entscheidbar.
 */
function isOwnStorageUrl(url, userId) {
  if (!isStorageConfigured()) return false;
  if (typeof url !== "string" || !url.startsWith(`${PUBLIC_URL}/`)) return false;

  const key = url.slice(PUBLIC_URL.length + 1);
  // Kein Verzeichniswechsel, keine Query-Anhängsel.
  if (key.includes("..") || key.includes("?") || key.includes("#")) return false;

  const match = key.match(/^([a-z]+)\/([^/]+)\/[a-f0-9]{32}\.(jpg|png|webp)$/);
  if (!match) return false;

  const [, kind, ownerId] = match;
  return UPLOAD_KINDS.includes(kind) && ownerId === userId;
}

/**
 * Zieht den Objekt-Schlüssel aus einer öffentlichen URL. Gibt null zurück,
 * wenn die URL nicht aus diesem Speicher kommt — Löschen soll nie auf einer
 * fremden URL operieren.
 */
function keyFromPublicUrl(url) {
  if (!isStorageConfigured()) return null;
  if (typeof url !== "string" || !url.startsWith(`${PUBLIC_URL}/`)) return null;

  const key = url.slice(PUBLIC_URL.length + 1);
  if (!key || key.includes("..")) return null;
  return key;
}

/** Existiert das Objekt und passt seine Größe? Nach dem Upload aufgerufen. */
async function verifyUploadedObject(key) {
  if (!isStorageConfigured()) return { ok: false, error: "Speicher nicht konfiguriert." };

  try {
    const head = await getClient().send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    if (head.ContentLength > MAX_UPLOAD_BYTES) {
      return { ok: false, error: "Das hochgeladene Bild ist zu groß." };
    }
    return { ok: true, size: head.ContentLength, contentType: head.ContentType };
  } catch {
    return { ok: false, error: "Upload nicht gefunden." };
  }
}

/** Aufräumen, etwa wenn ein Beitrag zum Bild nie zustande kommt. */
async function deleteObject(key) {
  if (!isStorageConfigured()) return;
  try {
    await getClient().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  } catch (err) {
    // Ein fehlgeschlagenes Löschen darf den Aufrufer nie scheitern lassen —
    // im schlimmsten Fall bleibt ein Objekt liegen.
    console.warn(`[Storage] Objekt ${key} konnte nicht gelöscht werden:`, err.message);
  }
}

module.exports = {
  isStorageConfigured,
  createPresignedUpload,
  isOwnStorageUrl,
  keyFromPublicUrl,
  verifyUploadedObject,
  deleteObject,
  MAX_UPLOAD_BYTES,
  ALLOWED_CONTENT_TYPES,
  UPLOAD_KINDS,
};
