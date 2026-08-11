import { Platform } from "react-native";

/**
 * Whether this device can scan a barcode with the camera.
 *
 * Native (iOS + Android app): always — expo-camera does the decoding itself.
 *
 * Web: expo-camera delegates to the browser's BarcodeDetector API. Chrome and
 * Chromium-based browsers on Android and desktop have it; **Safari and every
 * browser on iOS do not**, because iOS forces all browsers onto WebKit. There
 * is no way around that short of shipping a JavaScript decoder, which would
 * add a few hundred kilobytes to a bundle we are otherwise trying to keep
 * small — so those users get manual entry instead.
 *
 * Also false on any insecure origin: getUserMedia needs https or localhost.
 */
export function isCameraScanSupported(): boolean {
  if (Platform.OS !== "web") return true;
  if (typeof window === "undefined") return false;
  if (!window.isSecureContext) return false;
  return "BarcodeDetector" in window;
}

/** Why scanning is unavailable, for a message the user can act on. */
export function getScanUnavailableReason(): string {
  if (typeof window === "undefined") return "Scannen ist hier nicht verfügbar.";
  if (!window.isSecureContext) {
    return "Die Kamera braucht eine sichere Verbindung (https). Gib den Barcode so lange von Hand ein.";
  }
  return "Dein Browser kann keine Barcodes lesen — auf iPhone und iPad betrifft das alle Browser. In der App funktioniert der Scanner. Bis dahin kannst du den Code von Hand eingeben.";
}

/**
 * EAN-8/EAN-13 including the check digit.
 *
 * Mirrors validateEan() in server/index.js on purpose: catching a misread code
 * before the request saves a round trip, but the server stays the authority —
 * the barcode ends up in a catalogue everyone shares.
 */
export function isValidEan(raw: string): boolean {
  const value = raw.trim();
  if (!/^\d{8}$|^\d{13}$/.test(value)) return false;

  const digits = value.split("").map(Number);
  const check = digits.pop() as number;
  let sum = 0;
  for (let i = digits.length - 1, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3) {
    sum += digits[i] * weight;
  }
  return (10 - (sum % 10)) % 10 === check;
}
