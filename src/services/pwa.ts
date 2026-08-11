import { Platform } from "react-native";

/**
 * Meldet den Service Worker an und hängt das PWA-Manifest ein.
 *
 * Beides passiert zur Laufzeit statt über eine eigene `public/index.html`.
 * Expo erzeugt dieses HTML aus einer eigenen Vorlage; eine Kopie davon im
 * Projekt würde bei jedem SDK-Update stillschweigend veralten. Die zehn
 * Zeilen hier überleben ein Update dagegen unverändert.
 *
 * Auf nativen Plattformen ein No-op — dort gibt es weder Service Worker noch
 * Manifest, und die App bringt ihr Bundle ohnehin mit.
 */
export function setupPwa(): void {
  if (Platform.OS !== "web") return;
  if (typeof window === "undefined" || typeof document === "undefined") return;

  ensureManifestLink();
  registerServiceWorker();
}

function ensureManifestLink(): void {
  if (document.querySelector('link[rel="manifest"]')) return;

  const link = document.createElement("link");
  link.rel = "manifest";
  link.href = "/manifest.json";
  document.head.appendChild(link);

  // Färbt unter Android die Systemleiste im App-Modus.
  if (!document.querySelector('meta[name="theme-color"]')) {
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    meta.content = "#020617";
    document.head.appendChild(meta);
  }
}

function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;

  // Service Worker brauchen https (oder localhost). Ohne diese Prüfung wirft
  // die Registrierung in unsicheren Kontexten eine Ausnahme in die Konsole.
  if (!window.isSecureContext) return;

  const register = () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.warn("[PWA] Service Worker konnte nicht registriert werden:", error);
    });
  };

  // Erst nach dem Laden registrieren, damit die Registrierung nicht mit dem
  // ersten Rendern um Bandbreite konkurriert.
  //
  // Der readyState-Zweig ist nicht optional: setupPwa() läuft aus einem
  // useEffect, und das passiert in aller Regel NACH "load". Ein reiner
  // addEventListener("load") würde also nie feuern — der Service Worker war
  // damit schlicht nie registriert.
  if (document.readyState === "complete") {
    register();
  } else {
    window.addEventListener("load", register, { once: true });
  }
}
