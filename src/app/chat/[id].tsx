import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Platform,
} from "react-native";
import { KeyboardSafe } from "@/components/KeyboardSafe";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiService } from "@/services/api";
import { DirectMessage } from "@/services/mockData";
import { Avatar } from "@/components/Avatar";
import { triggerHaptic } from "@/services/haptics";
import { notify } from "@/services/dialogs";
import { useUnread } from "@/components/UnreadProvider";
import { usePolling } from "@/services/polling";
import { useThemeColors } from "@/services/theme";

/** Wie viele Nachrichten je Abruf. Entspricht der Vorgabe des Servers. */
const CHAT_PAGE_SIZE = 50;

/**
 * Direktnachrichten und Gruppenchat.
 *
 * War bisher ein Sheet über dem Freunde-Dialog, das sich nur schließen ließ,
 * indem der darunterliegende Dialog vorher zuging. Als eigene Route hat der
 * Chat einen Zurück-Weg und die volle Höhe.
 */
export default function ChatScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const { markRead } = useUnread();
  const { id, type, name } = useLocalSearchParams<{ id: string; type?: string; name?: string }>();
  const isGroup = type === "group";

  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [meId, setMeId] = useState<string | null>(null);
  const [partnerAvatar, setPartnerAvatar] = useState<string | undefined>(undefined);
  /** Gibt es vor der ältesten geladenen Nachricht noch etwas? */
  const [hasMore, setHasMore] = useState(true);
  /** Verhindert zwei gleichzeitige Nachlade-Läufe. */
  const ladeAeltere = useRef(false);

  /** Die neuesten Nachrichten dieser Unterhaltung, seitenweise. */
  const holeNachrichten = useCallback(
    (page?: { limit?: number; before?: string | null }) =>
      isGroup
        ? apiService.getGroupMessages(id, page)
        : apiService.getDirectMessages(id, page),
    [id, isGroup]
  );

  /**
   * Zwei Listen ohne Dubletten zusammenführen, aufsteigend nach Zeit.
   *
   * Nötig, weil dieselbe Nachricht aus zwei Richtungen kommen kann: einmal
   * beim optimistischen Anhängen nach dem Senden, einmal beim nächsten
   * Abruf. Verglichen wird über die Id.
   */
  const verschmelzen = (a: DirectMessage[], b: DirectMessage[]): DirectMessage[] => {
    const nachId = new Map<string, DirectMessage>();
    for (const m of [...a, ...b]) nachId.set(m.id, m);
    return [...nachId.values()].sort(
      (x, y) => new Date(x.timestamp).getTime() - new Date(y.timestamp).getTime()
    );
  };

  /**
   * Nachsehen, ob etwas Neues da ist.
   *
   * Der Chat hat bis zum 21.08.2026 GAR NICHT aktualisiert: Er lud einmal
   * beim Öffnen und hängte danach nur noch die eigenen gesendeten
   * Nachrichten an. Eingehende erschienen nie, solange der Chat offen war —
   * erst beim Verlassen und erneuten Öffnen. Der Ungelesen-Zähler oben
   * aktualisierte sich derweil alle 15 Sekunden, meldete also „neue
   * Nachricht", während der offene Chat sie nicht zeigte.
   */
  const aktualisieren = useCallback(async () => {
    try {
      const neueste = await holeNachrichten({ limit: CHAT_PAGE_SIZE });
      setMessages((vorher) => {
        const zusammen = verschmelzen(vorher, neueste);
        // Nur als gelesen melden, wenn wirklich etwas dazugekommen ist —
        // sonst schriebe jeder Takt einen Lesestand ohne Anlass.
        if (zusammen.length !== vorher.length) {
          markRead(isGroup ? { groupId: id } : { receiverId: id });
        }
        return zusammen;
      });
    } catch (e) {
      // Ein Aussetzer im Takt ist kein Grund für eine Meldung; der nächste
      // Versuch kommt in fünf Sekunden.
      console.warn("Chat konnte nicht aktualisiert werden:", e);
    }
    // markRead ist stabil genug; die Unterhaltung ist die Abhängigkeit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holeNachrichten, id, isGroup]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const me = await apiService.getCurrentUser();
      setMeId(me.id);

      if (isGroup) {
        const erste = await holeNachrichten({ limit: CHAT_PAGE_SIZE });
        setMessages(erste);
        setHasMore(erste.length >= CHAT_PAGE_SIZE);
        markRead({ groupId: id });
      } else {
        const erste = await holeNachrichten({ limit: CHAT_PAGE_SIZE });
        setMessages(erste);
        setHasMore(erste.length >= CHAT_PAGE_SIZE);
        markRead({ receiverId: id });

        // Das Profilbild kommt nicht über die Route — eine Base64-Grafik in
        // einem URL-Parameter wäre eine schlechte Idee. Es steht in der
        // Freundesliste, die ohnehin zwischengespeichert ist.
        try {
          const friendData = await apiService.getFriends(me.name);
          setPartnerAvatar((friendData.friends || []).find((f) => f.id === id)?.avatar);
        } catch {
          // Ohne Bild zeigt Avatar die Initialen — kein Grund für eine Meldung.
        }
      }
    } catch (e) {
      // Der Server antwortet mit 403, wenn man nicht (mehr) Mitglied ist —
      // etwa nachdem man aus der Gruppe entfernt wurde, während die Liste
      // noch offen war.
      notify(
        "Chat nicht verfügbar",
        e instanceof Error ? e.message : "Der Chat konnte nicht geladen werden."
      );
      router.back();
    } finally {
      setLoading(false);
    }
    // markRead und router sind stabil genug; die Abhängigkeit ist die Konversation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isGroup, holeNachrichten]);

  useEffect(() => {
    load();
  }, [load]);

  // Fünf Sekunden statt der fünfzehn der übrigen Anzeigen: Ein Chat, in dem
  // die Antwort eine Viertelminute braucht, fühlt sich kaputt an. Nur
  // solange die App im Vordergrund ist — im Hintergrund übernimmt Push.
  usePolling(aktualisieren, 5000, { enabled: !loading });

  /** Ältere Nachrichten nachladen, wenn jemand nach oben scrollt. */
  const loadEarlier = useCallback(async () => {
    if (ladeAeltere.current || !hasMore || loading || messages.length === 0) return;
    ladeAeltere.current = true;
    try {
      const aeltere = await holeNachrichten({
        limit: CHAT_PAGE_SIZE,
        before: messages[0].timestamp,
      });
      setHasMore(aeltere.length >= CHAT_PAGE_SIZE);
      if (aeltere.length > 0) setMessages((vorher) => verschmelzen(aeltere, vorher));
    } catch (e) {
      console.warn("Ältere Nachrichten konnten nicht geladen werden:", e);
    } finally {
      ladeAeltere.current = false;
    }
  }, [hasMore, loading, messages, holeNachrichten]);

  /** Für die umgedrehte Liste: jüngste Nachricht zuerst. */
  const umgekehrteNachrichten = useMemo(() => [...messages].reverse(), [messages]);

  const handleSend = async () => {
    const content = inputText.trim();
    if (!content) return;
    setInputText("");
    setSending(true);
    try {
      await triggerHaptic("light");
      const newMsg = await apiService.sendMessage({
        receiverId: isGroup ? undefined : id,
        groupId: isGroup ? id : undefined,
        content,
      });
      setMessages((prev) => [...prev, newMsg]);
    } catch {
      notify("Fehler", "Nachricht konnte nicht gesendet werden.");
      // Zurück ins Eingabefeld statt verloren — der Text war getippt.
      setInputText(content);
    } finally {
      setSending(false);
    }
  };

  return (
    // Der Chat ist der schlimmste Fall: das Eingabefeld sitzt ganz unten und
    // verschwand ohne diesen Rahmen komplett unter der Tastatur.
    <KeyboardSafe style={{ backgroundColor: c.bg }} offset={Platform.OS === "ios" ? 90 : 0}>
      <View className="flex-1 bg-bg">
      <Stack.Screen
        options={{
          title: name || (isGroup ? "Gruppenchat" : "Chat"),
          headerLeft: undefined,
        }}
      />

      {/* Gesprächspartner im Kopf der Liste: die Stack-Titelzeile zeigt nur
          den Namen, das Bild ordnet das Gespräch schneller zu. */}
      <View className="flex-row items-center px-5 py-3 border-b border-line bg-surface">
        <Avatar
          uri={isGroup ? undefined : partnerAvatar}
          name={name || (isGroup ? "Gruppe" : "Chat")}
          size={32}
          className="border border-accent/40"
        />
        <View className="ml-3 flex-1">
          <Text className="text-content font-black text-xs" numberOfLines={1}>
            {name || (isGroup ? "Gruppenchat" : "Chat")}
          </Text>
          <Text className="text-accent-ink text-[9px] font-bold">
            {isGroup ? "Gruppe" : `@${(name || "").toLowerCase().replace(/\s+/g, "_")}`}
          </Text>
        </View>
      </View>

      {/* Umgedrehte Liste.
          Zwei Fliegen: Sie startet unten bei der jüngsten Nachricht (der
          bisherige ScrollView öffnete sich ganz oben bei der ÄLTESTEN, man
          musste erst durch die halbe Historie scrollen), und `onEndReached`
          zeigt dabei nach OBEN — also genau dorthin, wo das Nachladen
          älterer Nachrichten hingehört. */}
      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={c.accent} />
        </View>
      ) : messages.length === 0 ? (
        <View className="flex-1 items-center justify-center px-5">
          <View className="w-full items-center justify-center bg-surface border border-line rounded-3xl p-6">
            <Ionicons name="chatbubbles-outline" size={36} color={c.contentFaint} />
            <Text className="text-content text-xs font-black uppercase text-center mt-2">
              Noch keine Nachrichten
            </Text>
            <Text className="text-content-muted text-[10px] text-center mt-1">
              Schreibe die erste Nachricht!
            </Text>
          </View>
        </View>
      ) : (
        <FlatList
          className="flex-1 px-5"
          data={umgekehrteNachrichten}
          keyExtractor={(msg) => msg.id}
          inverted
          contentContainerStyle={{ paddingVertical: 16 }}
          showsVerticalScrollIndicator={false}
          onEndReached={loadEarlier}
          onEndReachedThreshold={0.4}
          renderItem={({ item: msg }) => {
            const isMe = msg.sender_id === meId;
            return (
              <View className={`mb-3 flex-row ${isMe ? "justify-end" : "justify-start"}`}>
                <View
                  className={`max-w-[78%] px-4 py-2.5 rounded-2xl ${
                    isMe
                      ? "bg-accent rounded-tr-none"
                      : "bg-surface border border-line rounded-tl-none"
                  }`}
                >
                  {!isMe && msg.sender_name && (
                    <Text className="text-accent-ink text-[9px] font-black mb-1">{msg.sender_name}</Text>
                  )}
                  <Text className={`text-xs font-bold ${isMe ? "text-on-accent" : "text-content"}`}>
                    {msg.content}
                  </Text>
                  <Text
                    className={`text-[8px] mt-1 text-right font-medium ${
                      isMe ? "text-on-accent/70" : "text-content-faint"
                    }`}
                  >
                    {new Date(msg.timestamp).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </Text>
                </View>
              </View>
            );
          }}
        />
      )}

      <View
        className="flex-row items-center px-5 py-3 border-t border-line bg-surface-alt"
        style={{ gap: 8 }}
      >
        <TextInput
          placeholder="Nachricht schreiben..."
          placeholderTextColor={c.contentFaint}
          value={inputText}
          onChangeText={setInputText}
          onSubmitEditing={handleSend}
          accessibilityLabel="Nachricht schreiben"
          className="flex-1 bg-surface border border-line rounded-2xl px-4 py-3 text-content text-xs font-bold"
        />
        <TouchableOpacity
          onPress={handleSend}
          disabled={!inputText.trim() || sending}
          accessibilityLabel="Nachricht senden"
          className="bg-accent p-3 rounded-2xl active:scale-95 disabled:opacity-40"
        >
          {sending ? (
            <ActivityIndicator size="small" color={c.onAccent} />
          ) : (
            <Ionicons name="send" size={16} color={c.onAccent} />
          )}
        </TouchableOpacity>
      </View>
      </View>
    </KeyboardSafe>
  );
}
