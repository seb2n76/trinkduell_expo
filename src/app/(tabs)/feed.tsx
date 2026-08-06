import React, { useState, useCallback, useEffect } from "react";
import {
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  Image,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from "react-native";
import { useFocusEffect } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiService } from "@/services/api";
import { triggerHaptic } from "@/services/haptics";
import { User } from "@/services/mockData";
import { Ionicons } from "@expo/vector-icons";
import { API_URL } from "@/services/config";

interface FeedItem {
  id: string;
  userId: string;
  username: string;
  userAvatar: string | null;
  drink_name?: string;
  volume_ml?: number;
  alcohol_grams?: number;
  is_water?: boolean;
  latitude: number | null;
  longitude: number | null;
  timestamp: string;
  text?: string;
  type?: "log" | "post";
}

// ─────────────────────────────────────────────
// "Live-Karte demnächst" - Edles Dunkles Banner UI
// ─────────────────────────────────────────────
function MapComingSoonBanner() {
  return (
    <View className="bg-slate-900/90 border border-cyan-500/20 rounded-3xl p-5 mb-5 shadow-2xl overflow-hidden relative">
      {/* Background Glow Effect */}
      <View className="absolute -right-8 -top-8 w-36 h-36 rounded-full bg-cyan-500/10 blur-2xl pointer-events-none" />
      <View className="absolute -left-8 -bottom-8 w-36 h-36 rounded-full bg-fuchsia-500/10 blur-2xl pointer-events-none" />

      {/* Grid Pattern Simulation */}
      <View className="absolute inset-0 opacity-10 pointer-events-none">
        <View className="absolute left-1/3 top-0 bottom-0 w-px bg-white/20" />
        <View className="absolute left-2/3 top-0 bottom-0 w-px bg-white/20" />
        <View className="absolute top-1/2 left-0 right-0 h-px bg-white/20" />
      </View>

      <View className="flex-row items-center justify-between mb-3">
        <View className="flex-row items-center space-x-3">
          <View className="w-10 h-10 rounded-2xl bg-cyan-400/10 border border-cyan-400/30 items-center justify-center shadow-md">
            <Ionicons name="map" size={20} color="#22d3ee" />
          </View>
          <View>
            <Text className="text-white text-base font-black tracking-wide">
              Live-Karte
            </Text>
            <Text className="text-cyan-400/80 text-[10px] font-bold uppercase tracking-wider">
              Echtzeit-Tracking & Hotspots
            </Text>
          </View>
        </View>

        <View className="bg-amber-400/10 border border-amber-400/30 px-2.5 py-1 rounded-full">
          <Text className="text-amber-400 text-[9px] font-black uppercase tracking-widest">
            Demnächst
          </Text>
        </View>
      </View>

      <Text className="text-slate-300 text-xs leading-relaxed font-medium mb-3">
        Die GPS-Live-Karte wird derzeit optimiert, um maximale Stabilität und Akkuschonung auf allen Geräten zu bieten. 🍺
      </Text>

      {/* Mini Feature Chips */}
      <View className="flex-row flex-wrap gap-2 pt-1 border-t border-white/5">
        {[
          { icon: "location", label: "Crew Radar", color: "#22d3ee" },
          { icon: "flame", label: "Heatmaps", color: "#f97316" },
          { icon: "pin", label: "Spot Check-ins", color: "#c084fc" },
        ].map((chip) => (
          <View
            key={chip.label}
            className="flex-row items-center bg-white/5 border border-white/10 px-2.5 py-1 rounded-xl"
          >
            <Ionicons name={chip.icon as any} size={11} color={chip.color} />
            <Text className="text-slate-300 text-[10px] font-semibold ml-1.5">
              {chip.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────
// Main Screen: Live Activity Feed
// ─────────────────────────────────────────────
export default function LivePulseFeed() {
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [friendIds, setFriendIds] = useState<Set<string>>(new Set());
  const [inputText, setInputText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadFeedData = async () => {
    try {
      const me = await apiService.getCurrentUser();
      if (!me) {
        console.warn("User not found in feed load, aborting.");
        setLoading(false);
        return;
      }
      const allGroups = await apiService.getGroups();

      setCurrentUser(me);

      // Build Set of friend userIds from all groups
      const myGroups = allGroups.filter((g) => g.memberIds.includes(me.id));
      const fIds = new Set<string>();
      myGroups.forEach((g) => {
        g.memberIds.forEach((id) => fIds.add(id));
      });
      fIds.add(me.id);
      setFriendIds(fIds);

      // Fetch Live Feed from Backend
      let fetchedFeed: FeedItem[] = [];
      try {
        const token = await AsyncStorage.getItem("trinkduell_v2_jwt_token");
        const headers: Record<string, string> = {};
        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        }

        const response = await fetch(`${API_URL}/api/feed`, { headers });
        if (response.ok) {
          fetchedFeed = (await response.json()) as FeedItem[];
        } else {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
      } catch (err) {
        console.warn("Live API feed failed, falling back to local database:", err);
        try {
          const allLogs = await apiService.getDrinkLogs();
          const allDrinks = await apiService.getDrinks();
          const allUsers = await apiService.getUsers();
          const allPosts = await apiService.getPosts();

          const feedLogs = allLogs.map((log) => {
            const userObj = [me, ...allUsers].find((u) => u.id === log.userId);
            const drink = allDrinks.find((d) => d.id === log.drinkId);
            return {
              id: log.id,
              userId: log.userId,
              username: userObj ? userObj.name : "Unbekannt",
              userAvatar: userObj ? userObj.avatar || null : null,
              drink_name: drink ? drink.name : "Getränk",
              volume_ml: drink ? drink.volume : 330,
              alcohol_grams: drink
                ? Number((drink.volume * (drink.abv / 100) * 0.789).toFixed(2))
                : 0,
              is_water: drink ? drink.abv === 0 : false,
              latitude: null,
              longitude: null,
              timestamp: log.timestamp,
              type: "log" as const,
            };
          });

          const feedPosts = allPosts.map((post) => {
            const userObj = [me, ...allUsers].find((u) => u.id === post.userId);
            return {
              id: post.id,
              userId: post.userId,
              username: userObj
                ? userObj.name
                : post.userId === "system"
                ? "TrinkDuell"
                : "System",
              userAvatar: userObj ? userObj.avatar || null : null,
              text: post.text,
              latitude: null,
              longitude: null,
              timestamp: post.timestamp,
              type: "post" as const,
            };
          });

          fetchedFeed = [...feedLogs, ...feedPosts];
        } catch (fallbackErr) {
          console.error("Feed fallback also failed:", fallbackErr);
        }
      }

      // Sort descending + deduplicate
      const sorted = fetchedFeed.sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      const seenItemIds = new Set<string>();
      const uniqueSorted = sorted.filter((item) => {
        if (seenItemIds.has(item.id)) return false;
        seenItemIds.add(item.id);
        return true;
      });

      setFeedItems(uniqueSorted);
    } catch (e) {
      console.error("Failed to load feed screen:", e);
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadFeedData();
    }, [])
  );

  // Other people's activity doesn't otherwise show up until you leave and
  // re-enter this tab — poll while it's mounted so it feels live.
  useEffect(() => {
    const interval = setInterval(loadFeedData, 15000);
    return () => clearInterval(interval);
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await triggerHaptic("light");
    await loadFeedData();
    setRefreshing(false);
  }, []);

  const handleCreatePost = async () => {
    if (!inputText.trim() || !currentUser) return;
    setIsSubmitting(true);
    try {
      await triggerHaptic("success");
      await apiService.createPost(inputText.trim(), "group", "group-1");
      setInputText("");
      await loadFeedData();
    } catch (e) {
      console.error("Failed to create feed post:", e);
      Alert.alert(
        "Fehler",
        "Status konnte nicht gepostet werden. Bitte versuche es später erneut."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // Tag styling
  const getTagStyle = (tagText: string) => {
    if (tagText === "[Hydro-Pulse]")
      return "bg-cyan-500/10 border-cyan-400/20 text-cyan-400";
    if (tagText === "[Erfolg]")
      return "bg-yellow-500/10 border-yellow-400/20 text-yellow-400";
    if (tagText === "[Gruppe]")
      return "bg-fuchsia-500/10 border-fuchsia-400/20 text-fuchsia-400";
    return "bg-slate-500/10 border-slate-400/20 text-slate-400";
  };

  const getNeonTagText = (item: FeedItem) => {
    if (item.is_water) return "[Hydro-Pulse]";
    if ((item.alcohol_grams || 0) > 15 || (item.volume_ml || 0) >= 500)
      return "[Erfolg]";
    if (friendIds.has(item.userId)) return "[Gruppe]";
    return "[Gast]";
  };

  return (
    <View className="flex-1 bg-slate-950">
      <ScrollView
        className="flex-1 px-5 pt-3"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#22d3ee"
            colors={["#22d3ee"]}
          />
        }
      >
        {/* Banner-Grafik "Live-Karte demnächst" */}
        <MapComingSoonBanner />

        {/* Status creator box */}
        {currentUser && (
          <View className="bg-white/5 border border-white/10 p-4 rounded-3xl mb-5">
            <Text className="text-slate-500 text-[9px] font-black uppercase tracking-wider mb-2">
              Status teilen
            </Text>
            <View className="flex-row items-center space-x-3">
              <Image
                source={{
                  uri:
                    currentUser.avatar ||
                    "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&q=80",
                }}
                className="w-9 h-9 rounded-full border border-white/10"
              />
              <TextInput
                placeholder="Was geht ab bei dir?..."
                placeholderTextColor="#475569"
                value={inputText}
                onChangeText={setInputText}
                maxLength={100}
                className="flex-1 bg-slate-900 border border-white/5 rounded-2xl px-4 py-2.5 text-white font-bold text-xs"
              />
              <TouchableOpacity
                onPress={handleCreatePost}
                disabled={isSubmitting || !inputText.trim()}
                className="bg-cyan-400 p-2.5 rounded-2xl active:scale-95 disabled:opacity-40"
              >
                <Ionicons name="send" size={16} color="#020617" />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Activities list header */}
        <Text className="text-white/40 text-[10px] font-black uppercase tracking-widest mb-3">
          Live-Aktivitäten
        </Text>

        {loading ? (
          <View className="py-20 items-center justify-center">
            <ActivityIndicator size="small" color="#22d3ee" />
          </View>
        ) : feedItems.length === 0 ? (
          <View className="py-14 items-center justify-center bg-white/5 border border-white/5 rounded-3xl p-6 mb-8">
            <Ionicons name="chatbubbles-outline" size={36} color="#64748b" style={{ marginBottom: 12 }} />
            <Text className="text-white text-xs font-black uppercase tracking-wider text-center mb-1">
              Noch keine Einträge vorhanden
            </Text>
            <Text className="text-slate-400 text-[11px] font-medium text-center leading-relaxed">
              Teile deinen ersten Status mit deinen Freunden oder logge ein Getränk!
            </Text>
          </View>
        ) : (
          feedItems.map((item) => {
            const isMe = item.userId === currentUser?.id;

            if (item.type === "post") {
              const isSystem = item.userId === "system";
              const tagColor = isSystem
                ? "bg-amber-500/10 border-amber-400/20 text-amber-400"
                : "bg-cyan-500/10 border-cyan-400/20 text-cyan-400";
              const tagLabel = isSystem ? "[Erfolg]" : "[Status]";
              const titleText = isSystem
                ? "System-Meldung"
                : isMe
                ? "Dein Status"
                : `${item.username} teilt`;

              return (
                <View
                  key={item.id}
                  className="bg-white/5 border border-white/10 p-4 rounded-3xl mb-3 shadow-lg flex-row space-x-3"
                >
                  {isSystem ? (
                    <View className="w-10 h-10 rounded-full bg-amber-500/10 border border-amber-400/20 items-center justify-center">
                      <Ionicons name="sparkles" size={18} color="#fbbf24" />
                    </View>
                  ) : (
                    <Image
                      source={{
                        uri:
                          item.userAvatar ||
                          "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&q=80",
                      }}
                      className="w-10 h-10 rounded-full border border-white/10"
                    />
                  )}
                  <View className="flex-1">
                    <View className="flex-row items-center justify-between flex-wrap mb-1.5">
                      <Text className="text-white text-xs font-black">{titleText}</Text>
                      <View className={`border px-1.5 py-0.5 rounded ${tagColor}`}>
                        <Text className="text-[7px] font-black uppercase tracking-widest leading-none">
                          {tagLabel}
                        </Text>
                      </View>
                    </View>
                    <Text className="text-slate-300 text-xs font-medium leading-relaxed mb-2.5">
                      {item.text}
                    </Text>
                    <View className="flex-row items-center justify-between border-t border-white/5 pt-2">
                      <View className="flex-row items-center space-x-1.5">
                        <Ionicons
                          name={isSystem ? "trophy" : "chatbubble-ellipses"}
                          size={11}
                          color={isSystem ? "#fbbf24" : "#22d3ee"}
                        />
                        <Text className="text-slate-500 text-[8px] font-extrabold uppercase">
                          {isSystem ? "LEVEL-UP" : "PIN-STATUS"}
                        </Text>
                      </View>
                      <Text className="text-slate-500 text-[8px] font-bold">
                        {new Date(item.timestamp).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}{" "}
                        Uhr
                      </Text>
                    </View>
                  </View>
                </View>
              );
            }

            const tagText = getNeonTagText(item);
            const titleText = isMe
              ? "Du hast getrunken"
              : `${item.username} hat getrunken`;
            const detailText = `${item.drink_name ?? "Getränk"} (${
              item.volume_ml ?? 0
            }ml • ${(item.alcohol_grams ?? 0).toFixed(1)}g Alk • +${
              10 + Math.round((item.alcohol_grams ?? 0) * 2)
            } XP)`;

            return (
              <View
                key={item.id}
                className="bg-white/5 border border-white/10 p-4 rounded-3xl mb-3 shadow-lg flex-row space-x-3"
              >
                <Image
                  source={{
                    uri:
                      item.userAvatar ||
                      "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&q=80",
                  }}
                  className="w-10 h-10 rounded-full border border-white/10"
                />
                <View className="flex-1">
                  <View className="flex-row items-center justify-between flex-wrap mb-1">
                    <Text className="text-white text-xs font-black">{titleText}</Text>
                    <View className={`border px-1.5 py-0.5 rounded ${getTagStyle(tagText)}`}>
                      <Text className="text-[7px] font-black uppercase tracking-widest leading-none">
                        {tagText}
                      </Text>
                    </View>
                  </View>
                  <Text className="text-slate-300 text-xs font-medium leading-relaxed mb-2.5">
                    {detailText}
                  </Text>
                  <View className="flex-row items-center justify-between border-t border-white/5 pt-2">
                    <View className="flex-row items-center space-x-1.5">
                      <Ionicons
                        name={item.is_water ? "water" : "beer"}
                        size={11}
                        color={item.is_water ? "#38bdf8" : "#fbbf24"}
                      />
                      <Text className="text-slate-500 text-[8px] font-extrabold uppercase">
                        {item.is_water ? "HYDRATION" : "ALKOHOL"}
                      </Text>
                    </View>
                    <Text className="text-slate-500 text-[8px] font-bold">
                      {new Date(item.timestamp).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      Uhr
                    </Text>
                  </View>
                </View>
              </View>
            );
          })
        )}
        <View className="h-10" />
      </ScrollView>
    </View>
  );
}
