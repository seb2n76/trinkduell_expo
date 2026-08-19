import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { apiService, UnreadSummary } from "@/services/api";

/**
 * Ungelesene Nachrichten, einmal geladen für die ganze App.
 *
 * Ein Abruf liefert alle Zahlen auf einmal (`total` plus eine Map je
 * Unterhaltung). Der Zähler am Menü-Symbol ist `total`, die Punkte an Freunden
 * und Gruppen kommen aus der Map.
 *
 * Warum ein Context und nicht State im jeweiligen Screen: die Zahl wird an
 * drei Stellen gebraucht, die seit der Navigations-Umstellung nicht mehr
 * dieselbe Komponente sind — das Abzeichen am Burger-Symbol, die Punkte in der
 * Freundes-/Gruppenliste und der Chat, der beim Öffnen als gelesen markiert.
 * Drei eigene Abrufe wären dreimal derselbe Request und würden sich
 * gegenseitig überholen.
 */

interface UnreadContextValue {
  unread: UnreadSummary;
  /** Zahlen neu vom Server holen. */
  refresh: () => Promise<void>;
  /** Eine Unterhaltung als gelesen markieren. */
  markRead: (ziel: { receiverId?: string; groupId?: string }) => Promise<void>;
  /** Ungelesene einer Unterhaltung, 0 wenn keine. */
  unreadFor: (ziel: { userId?: string; groupId?: string }) => number;
}

const LEER: UnreadSummary = { total: 0, conversations: {} };

const UnreadContext = createContext<UnreadContextValue>({
  unread: LEER,
  refresh: async () => {},
  markRead: async () => {},
  unreadFor: () => 0,
});

export const useUnread = () => useContext(UnreadContext);

export function UnreadProvider({
  enabled,
  children,
}: {
  /** Nur abrufen, solange jemand angemeldet ist — sonst antwortet jeder Request 401. */
  enabled: boolean;
  children: React.ReactNode;
}) {
  const [unread, setUnread] = useState<UnreadSummary>(LEER);

  const refresh = useCallback(async () => {
    try {
      setUnread(await apiService.getUnreadMessages());
    } catch (error) {
      // Bewusst still und ohne Zurücksetzen: bei einem Netzfehler ist die
      // bisherige Anzeige die bessere Auskunft als eine plötzliche Null.
      console.warn("Ungelesen-Zahlen konnten nicht geladen werden:", error);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setUnread(LEER);
      return;
    }
    refresh();
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, [enabled, refresh]);

  /**
   * Der Zähler wird zusätzlich sofort lokal abgezogen — auf die Serverantwort
   * zu warten, bevor der Punkt verschwindet, fühlt sich beim Öffnen eines
   * Chats träge an.
   */
  const markRead = useCallback(
    async (ziel: { receiverId?: string; groupId?: string }) => {
      const key = ziel.groupId ? `group:${ziel.groupId}` : `dm:${ziel.receiverId}`;
      setUnread((vorher) => {
        const offen = vorher.conversations[key] || 0;
        if (!offen) return vorher;
        const rest = { ...vorher.conversations };
        delete rest[key];
        return { total: Math.max(0, vorher.total - offen), conversations: rest };
      });

      try {
        await apiService.markConversationRead(ziel);
      } catch (error) {
        console.warn("Lesestand konnte nicht gespeichert werden:", error);
        // Zurückholen, was gerade lokal abgezogen wurde — sonst behauptet die
        // Anzeige „gelesen", während der Server es anders weiß.
        await refresh();
      }
    },
    [refresh]
  );

  const unreadFor = useCallback(
    (ziel: { userId?: string; groupId?: string }) =>
      unread.conversations[ziel.groupId ? `group:${ziel.groupId}` : `dm:${ziel.userId}`] || 0,
    [unread]
  );

  return (
    <UnreadContext.Provider value={{ unread, refresh, markRead, unreadFor }}>
      {children}
    </UnreadContext.Provider>
  );
}
