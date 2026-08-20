import React, { useCallback, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiService } from "@/services/api";
import { BlockedUser } from "@/services/mockData";
import { Avatar } from "@/components/Avatar";
import { notify } from "@/services/dialogs";
import { useThemeColors } from "@/services/theme";

/**
 * Blockierte Nutzer verwalten.
 *
 * Eigener Screen und nicht mehr am Ende der Freundesliste: eine Blockierung
 * aufzuheben ist eine Datenschutz-Entscheidung, keine Freundes-Aktion — und
 * die Stores verlangen, dass sie auffindbar rückgängig zu machen ist.
 */
export default function BlockedUsersScreen() {
  const c = useThemeColors();
  const [blocked, setBlocked] = useState<BlockedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setBlocked(await apiService.getBlockedUsers());
    } catch (e) {
      console.warn("Failed to load blocked users:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handleUnblock = async (entry: BlockedUser) => {
    setBusyId(entry.id);
    try {
      await apiService.unblockUser(entry.userId);
      notify("Aufgehoben", `${entry.username} ist nicht mehr blockiert.`);
      await load();
    } catch (e) {
      notify("Fehler", e instanceof Error ? e.message : "Konnte nicht aufgehoben werden.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <View className="flex-1 bg-bg">
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-5 pt-6 pb-16"
        showsVerticalScrollIndicator={false}
      >
        <View className="w-full self-center" style={{ maxWidth: 640 }}>
          <Text className="text-content-muted text-[11px] leading-relaxed mb-5">
            Wen du blockierst, siehst du nicht mehr — weder im Feed, auf der Karte noch in der
            Rangliste, und umgekehrt genauso.
          </Text>

          {loading ? (
            <View className="py-12 items-center">
              <ActivityIndicator color={c.accent} />
            </View>
          ) : blocked.length === 0 ? (
            <View className="py-12 items-center bg-surface/40 border border-line rounded-3xl">
              <Ionicons name="checkmark-circle-outline" size={32} color={c.contentFaint} />
              <Text className="text-content-faint text-xs font-bold mt-2 text-center">
                Du hast niemanden blockiert.
              </Text>
            </View>
          ) : (
            blocked.map((entry) => (
              <View
                key={entry.id}
                className="bg-surface border border-line rounded-2xl p-3.5 flex-row justify-between items-center mb-2.5"
              >
                <View className="flex-row items-center flex-1 mr-2">
                  <Avatar
                    uri={entry.avatar || undefined}
                    name={entry.username}
                    size={32}
                    className="border border-line"
                  />
                  <Text className="text-content text-xs font-black ml-3 flex-1" numberOfLines={1}>
                    {entry.username}
                  </Text>
                </View>
                {busyId === entry.id ? (
                  <ActivityIndicator size="small" color={c.accent} />
                ) : (
                  <TouchableOpacity
                    onPress={() => handleUnblock(entry)}
                    accessibilityLabel={`Blockierung von ${entry.username} aufheben`}
                    className="bg-surface border border-line px-3 py-1.5 rounded-xl"
                  >
                    <Text className="text-content-muted text-[10px] font-black uppercase">Aufheben</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}
