import React, { useCallback, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiService } from "@/services/api";
import { BlockedUser } from "@/services/mockData";
import { Avatar } from "@/components/Avatar";
import { notify } from "@/services/dialogs";

/**
 * Blockierte Nutzer verwalten.
 *
 * Eigener Screen und nicht mehr am Ende der Freundesliste: eine Blockierung
 * aufzuheben ist eine Datenschutz-Entscheidung, keine Freundes-Aktion — und
 * die Stores verlangen, dass sie auffindbar rückgängig zu machen ist.
 */
export default function BlockedUsersScreen() {
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
    <View className="flex-1 bg-slate-950">
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-5 pt-6 pb-16"
        showsVerticalScrollIndicator={false}
      >
        <View className="w-full self-center" style={{ maxWidth: 640 }}>
          <Text className="text-slate-400 text-[11px] leading-relaxed mb-5">
            Wen du blockierst, siehst du nicht mehr — weder im Feed, auf der Karte noch in der
            Rangliste, und umgekehrt genauso.
          </Text>

          {loading ? (
            <View className="py-12 items-center">
              <ActivityIndicator color="#22d3ee" />
            </View>
          ) : blocked.length === 0 ? (
            <View className="py-12 items-center bg-slate-900/40 border border-white/5 rounded-3xl">
              <Ionicons name="checkmark-circle-outline" size={32} color="#475569" />
              <Text className="text-slate-500 text-xs font-bold mt-2 text-center">
                Du hast niemanden blockiert.
              </Text>
            </View>
          ) : (
            blocked.map((entry) => (
              <View
                key={entry.id}
                className="bg-slate-900 border border-white/5 rounded-2xl p-3.5 flex-row justify-between items-center mb-2.5"
              >
                <View className="flex-row items-center flex-1 mr-2">
                  <Avatar
                    uri={entry.avatar || undefined}
                    name={entry.username}
                    size={32}
                    className="border border-white/10"
                  />
                  <Text className="text-white text-xs font-black ml-3 flex-1" numberOfLines={1}>
                    {entry.username}
                  </Text>
                </View>
                {busyId === entry.id ? (
                  <ActivityIndicator size="small" color="#22d3ee" />
                ) : (
                  <TouchableOpacity
                    onPress={() => handleUnblock(entry)}
                    accessibilityLabel={`Blockierung von ${entry.username} aufheben`}
                    className="bg-white/5 border border-white/10 px-3 py-1.5 rounded-xl"
                  >
                    <Text className="text-slate-300 text-[10px] font-black uppercase">Aufheben</Text>
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
