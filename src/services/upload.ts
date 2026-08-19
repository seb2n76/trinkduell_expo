import { Platform } from "react-native";
import * as ImageManipulator from "expo-image-manipulator";
import { apiService } from "./api";

/**
 * Bild-Uploads: verkleinern, neu kodieren, direkt zu R2 laden.
 *
 * Das Neukodieren ist nicht nur Kompression. Es ist gleichzeitig die
 * Datenschutzmaßnahme: sowohl `canvas.toDataURL()` im Web als auch
 * ImageManipulator nativ schreiben ein **frisches** Bild ohne die
 * EXIF-Metadaten des Originals. Damit verlassen die GPS-Koordinaten aus der
 * Kamera das Gerät nie — besser, als sie zum Server zu schicken und dort zu
 * entfernen.
 *
 * Der Upload geht anschließend direkt an die vom Server signierte URL. Das
 * Backend sieht die Bytes nicht mehr; es kannte bisher jedes Bild als
 * Base64-Block in der Datenbank.
 */

export type UploadKind = "avatar" | "proof";

/** Zielmaße pro Verwendung. Ein Avatar braucht keine 4000 Pixel Breite. */
const TARGETS: Record<UploadKind, { maxSize: number; quality: number }> = {
  avatar: { maxSize: 512, quality: 0.8 },
  proof: { maxSize: 1280, quality: 0.7 },
};

export interface PreparedImage {
  blob: Blob;
  contentType: string;
  byteLength: number;
}

/**
 * Verkleinert und kodiert neu. Gibt immer JPEG zurück — ein Format reicht,
 * und JPEG ist für Fotos das kompakteste der erlaubten.
 */
export async function prepareImage(uri: string, kind: UploadKind): Promise<PreparedImage> {
  const { maxSize, quality } = TARGETS[kind];

  if (Platform.OS === "web") {
    return prepareImageWeb(uri, maxSize, quality);
  }

  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: maxSize } }],
    { compress: quality, format: ImageManipulator.SaveFormat.JPEG }
  );

  const response = await fetch(result.uri);
  const blob = await response.blob();
  return { blob, contentType: "image/jpeg", byteLength: blob.size };
}

async function prepareImageWeb(
  uri: string,
  maxSize: number,
  quality: number
): Promise<PreparedImage> {
  const image = await loadImage(uri);

  // Seitenverhältnis behalten, längere Kante auf maxSize begrenzen. Kleinere
  // Bilder werden nicht hochskaliert — das würde nur Bytes erzeugen.
  const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Bild konnte nicht verarbeitet werden.");
  ctx.drawImage(image, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality)
  );
  if (!blob) throw new Error("Bild konnte nicht komprimiert werden.");

  return { blob, contentType: "image/jpeg", byteLength: blob.size };
}

function loadImage(uri: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    // Nötig, falls die Quelle eine fremde URL ist; bei data:/blob: harmlos.
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Bild konnte nicht geladen werden."));
    image.src = uri;
  });
}

/**
 * Kompletter Weg: verkleinern, URL signieren lassen, direkt hochladen.
 * Liefert die öffentliche URL, die anschließend im Datensatz landet.
 */
export async function uploadImage(uri: string, kind: UploadKind): Promise<string> {
  const prepared = await prepareImage(uri, kind);

  const { uploadUrl, publicUrl } = await apiService.requestUploadUrl({
    kind,
    contentType: prepared.contentType,
    contentLength: prepared.byteLength,
  });

  let response: Response;
  try {
    response = await fetch(uploadUrl, {
      // Content-Type und -Length sind Teil der Signatur. Weicht hier etwas ab,
      // lehnt R2 den Upload ab — genau das ist der Sinn: die signierte URL
      // erlaubt nur exakt dieses eine Bild.
      headers: { "Content-Type": prepared.contentType },
      body: prepared.blob,
    });
  } catch {
    // Ein fehlgeschlagenes fetch OHNE Antwort heisst im Browser fast immer
    // CORS: das PUT geht direkt an R2, also muss der Bucket PUT von der
    // Web-Domain erlauben. Ohne diese Unterscheidung stuende hier nur
    // "Failed to fetch", und niemand kaeme darauf, wo man nachsehen muss.
    throw new Error(
      "Der Bild-Speicher hat die Verbindung abgelehnt. Falls das im Browser passiert: die CORS-Regeln des R2-Buckets müssen PUT von dieser Domain erlauben."
    );
  }

  if (!response.ok) {
    throw new Error(`Upload fehlgeschlagen (${response.status}).`);
  }

  return publicUrl;
}
