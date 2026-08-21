import { useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";

/**
 * Abfragen im Takt — aber nur, solange jemand hinsieht.
 *
 * Die App fragte an fünf Stellen unabhängig voneinander nach: Feed, Rangliste,
 * Tab-Abzeichen und Ungelesen-Zähler alle 15 Sekunden, die Spielräume alle
 * 2,5. Alle fünf hingen an einem nackten `setInterval` in einem `useEffect`.
 * Ein solcher Timer läuft weiter, wenn die App in den Hintergrund geht.
 *
 * Auf einem echten Gerät heißt das: Die App liegt minimiert in der Tasche und
 * fragt trotzdem die ganze Nacht weiter — auf einer Party bei allen Gästen
 * gleichzeitig, mit vier Abfragen je Gerät und Minute. Das kostet Akku beim
 * Nutzer und Last beim Server, und zwar für Daten, die niemand ansieht.
 *
 * `AppState` schließt genau diese Lücke. Ob der SCHIRM gerade sichtbar ist,
 * weiß dieser Haken nicht — das entscheidet die Navigation, nicht die
 * Plattform. Screens reichen dafür `useIsFocused()` als `enabled` herein
 * (siehe Feed und Rangliste); Anbieter außerhalb eines Navigators wie der
 * Ungelesen-Zähler lassen es weg.
 */
export function useAppActive(): boolean {
  const [active, setActive] = useState(() => AppState.currentState !== "background");

  useEffect(() => {
    const handle = (state: AppStateStatus) => setActive(state === "active");
    const subscription = AppState.addEventListener("change", handle);
    return () => subscription.remove();
  }, []);

  return active;
}

interface PollingOptions {
  /** Zusätzliche Bedingung, meist `useIsFocused()` des Screens. */
  enabled?: boolean;
  /**
   * Einmal sofort ausführen, wenn die App aus dem Hintergrund zurückkommt.
   * Was währenddessen passiert ist, hat der Timer ja nicht mitbekommen —
   * ohne das stünde nach dem Aufwecken bis zum nächsten Takt ein veralteter
   * Stand auf dem Schirm.
   */
  refreshOnResume?: boolean;
}

/**
 * Führt `callback` alle `intervalMs` aus, solange die App im Vordergrund und
 * `enabled` wahr ist.
 *
 * Der Rückruf wird in einer Ref gehalten: sonst müsste jeder Aufrufer ihn in
 * `useCallback` wickeln, und ein vergessenes `useCallback` würde den Timer
 * bei jedem Rendern neu aufsetzen — der häufigste Weg, versehentlich viel
 * öfter abzufragen als gedacht.
 */
export function usePolling(
  callback: () => void,
  intervalMs: number,
  { enabled = true, refreshOnResume = true }: PollingOptions = {}
): void {
  const savedCallback = useRef(callback);
  savedCallback.current = callback;

  const appActive = useAppActive();
  const warVorherAktiv = useRef(appActive);

  useEffect(() => {
    const kommtZurueck = appActive && !warVorherAktiv.current;
    warVorherAktiv.current = appActive;

    if (!enabled || !appActive) return;

    if (kommtZurueck && refreshOnResume) savedCallback.current();

    const interval = setInterval(() => savedCallback.current(), intervalMs);
    return () => clearInterval(interval);
  }, [enabled, appActive, intervalMs, refreshOnResume]);
}
