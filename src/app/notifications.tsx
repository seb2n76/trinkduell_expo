import React, { useState, useEffect } from "react";
import { Text, View, ScrollView, TouchableOpacity, Image } from "react-native";
import { useRouter } from "expo-router";
import { apiService } from "@/services/api";
import { triggerHaptic } from "@/services/haptics";
import { User, Group } from "@/services/mockData";
import { Ionicons } from "@expo/vector-icons";
import { useThemeColors } from "@/services/theme";

interface RequestItem {
  group: Group;
  user: User;
}

export default function NotificationsScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadRequests = async () => {
    try {
      const currentUser = await apiService.getCurrentUser();
      const allGroups = await apiService.getGroups();
      const allUsers = await apiService.getUsers();

      // Find groups where current user is admin
      const adminGroups = allGroups.filter((g) => g.adminId === currentUser.id);

      // Collect pending requests
      const items: RequestItem[] = [];
      adminGroups.forEach((group) => {
        if (group.pendingUserIds && group.pendingUserIds.length > 0) {
          group.pendingUserIds.forEach((pUserId) => {
            const user = allUsers.find((u) => u.id === pUserId);
            if (user) {
              items.push({ group, user });
            }
          });
        }
      });

      setRequests(items);
    } catch (error) {
      console.error("Failed to load notifications:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRequests();
  }, []);

  const handleAction = async (groupId: string, targetUserId: string, accept: boolean) => {
    try {
      await triggerHaptic(accept ? "success" : "light");
      await apiService.handleJoinRequest(groupId, targetUserId, accept);
      await loadRequests(); // Reload list
    } catch (error) {
      await triggerHaptic("error");
      console.error("Failed to process request:", error);
    }
  };

  return (
    <View className="flex-1 bg-bg px-6 py-6 justify-center">
      <View className="flex-1 max-w-md w-full mx-auto justify-center pt-10">
        <Text className="text-3xl font-black text-accent-ink mb-2 text-center tracking-wide">
          ANFRAGEN
        </Text>
        <Text className="text-xs text-accent-2-ink font-bold uppercase tracking-widest mb-6 text-center">
          Gruppen-Beitrittsanfragen
        </Text>

        <View className="bg-surface border border-line rounded-3xl p-5 mb-6 flex-1 max-h-[450px]">
          {loading ? (
            <View className="flex-1 items-center justify-center">
              <Text className="text-content-faint text-xs font-bold">Lade Anfragen...</Text>
            </View>
          ) : requests.length === 0 ? (
            <View className="flex-1 items-center justify-center space-y-3">
              <Ionicons name="mail-open-outline" size={48} color={c.contentFaint} />
              <Text className="text-content-faint text-xs font-bold text-center mt-2">
                Keine ausstehenden Beitrittsanfragen vorhanden.
              </Text>
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false} className="flex-1">
              <Text className="text-content-faint text-[10px] font-black uppercase tracking-widest mb-3">
                Ausstehend ({requests.length})
              </Text>
              
              {requests.map((item, idx) => (
                <View
                  key={`${item.group.id}-${item.user.id}-${idx}`}
                  className="bg-surface border border-line rounded-2xl p-4 mb-3 flex-row items-center justify-between"
                >
                  <View className="flex-row items-center space-x-3 flex-1 mr-2">
                    <Image
                      source={{ uri: item.user.avatar }}
                      className="w-10 h-10 rounded-full border border-line"
                    />
                    <View className="ml-2.5 flex-1">
                      <Text className="text-content text-xs font-bold" numberOfLines={1}>
                        {item.user.name}
                      </Text>
                      <Text className="text-accent-ink text-[10px] font-bold mt-0.5" numberOfLines={1}>
                        will &quot;{item.group.name}&quot; beitreten
                      </Text>
                    </View>
                  </View>

                  <View className="flex-row space-x-1.5">
                    <TouchableOpacity
                      onPress={() => handleAction(item.group.id, item.user.id, true)}
                      className="bg-success/10 border border-success/20 p-2.5 rounded-xl active:scale-95 active:bg-success/20"
                    >
                      <Ionicons name="checkmark" size={16} color={c.success} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => handleAction(item.group.id, item.user.id, false)}
                      className="bg-danger/10 border border-danger/20 p-2.5 rounded-xl active:scale-95 active:bg-danger/20"
                    >
                      <Ionicons name="close" size={16} color={c.danger} />
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </ScrollView>
          )}
        </View>

        <TouchableOpacity
          onPress={() => {
            triggerHaptic("light");
            router.back();
          }}
          className="bg-surface border border-line py-3.5 rounded-xl items-center active:scale-95 mb-4 shadow-lg"
        >
          <Text className="text-content font-black tracking-widest text-xs uppercase">Schließen</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
