import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiService } from "@/services/api";
import { DirectMessage } from "@/services/mockData";
import { Avatar } from "@/components/Avatar";
import { triggerHaptic } from "@/services/haptics";
import { notify } from "@/services/dialogs";
import { useUnread } from "@/components/UnreadProvider";
import { useThemeColors } from "@/services/theme";

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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const me = await apiService.getCurrentUser();
      setMeId(me.id);

      if (isGroup) {
        setMessages(await apiService.getGroupMessages(id));
        markRead({ groupId: id });
      } else {
        setMessages(await apiService.getDirectMessages(id));
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
  }, [id, isGroup]);

  useEffect(() => {
    load();
  }, [load]);

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

      <ScrollView
        className="flex-1 px-5 pt-4"
        contentContainerClassName="pb-4"
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View className="py-16 items-center justify-center">
            <ActivityIndicator size="large" color={c.accent} />
          </View>
        ) : messages.length === 0 ? (
          <View className="py-16 items-center justify-center bg-surface border border-line rounded-3xl p-6 my-4">
            <Ionicons name="chatbubbles-outline" size={36} color={c.contentFaint} />
            <Text className="text-content text-xs font-black uppercase text-center mt-2">
              Noch keine Nachrichten
            </Text>
            <Text className="text-content-muted text-[10px] text-center mt-1">
              Schreibe die erste Nachricht!
            </Text>
          </View>
        ) : (
          messages.map((msg) => {
            const isMe = msg.sender_id === meId;
            return (
              <View key={msg.id} className={`mb-3 flex-row ${isMe ? "justify-end" : "justify-start"}`}>
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
          })
        )}
      </ScrollView>

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
  );
}
