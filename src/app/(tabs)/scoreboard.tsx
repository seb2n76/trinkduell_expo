import React, { useState, useCallback, useMemo, useEffect } from "react";
import { Text, View, ScrollView, TouchableOpacity, Image, ActivityIndicator, RefreshControl } from "react-native";
import { useFocusEffect } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiService } from "@/services/api";
import { triggerHaptic } from "@/services/haptics";
import { User, Drink, DrinkLog } from "@/services/mockData";
import { Ionicons } from "@expo/vector-icons";
import Animated, { LinearTransition } from "react-native-reanimated";
import { API_URL } from "@/services/config";

type PeriodType = "this_month" | "last_month" | "all";
type SortCriteriaType = "count" | "alcohol";

// Shape of a row returned from /api/scoreboard
interface LiveScoreboardEntry {
  id?: string;
  username?: string;
  name?: string;
  points?: number;
  avatar?: string;
  title?: string;
  rank?: string;
  alcoholGrams?: number;
  level?: number;
  currentLevel?: number;
  xpForNextLevel?: number;
  xpProgressInCurrentLevel?: number;
}

export default function ScoreboardScreen() {
  const [users, setUsers] = useState<User[]>([]);
  const [logs, setLogs] = useState<DrinkLog[]>([]);
  const [drinks, setDrinks] = useState<Drink[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filters
  const [period, setPeriod] = useState<PeriodType>("this_month");
  const [sortCriteria, setSortCriteria] = useState<SortCriteriaType>("count");
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

  const loadData = async (isPullToRefresh = false) => {
    if (isPullToRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const currUser = await apiService.getCurrentUser();
      const localUsers = await apiService.getUsers();
      const logsList = await apiService.getDrinkLogs();
      const drinksList = await apiService.getDrinks();
      
      setCurrentUser(currUser);
      setLogs(logsList);
      setDrinks(drinksList);

      // Fetch from live API with Authorization header
      const token = await AsyncStorage.getItem("trinkduell_v2_jwt_token");
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      } else if (currUser) {
        headers["Authorization"] = `Bearer mock-jwt-token-${currUser.id}`;
      }

      const response = await fetch(`${API_URL}/api/scoreboard`, {
        method: "GET",
        headers,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const rawData = await response.json();
      let usersArray: LiveScoreboardEntry[] = [];

      if (Array.isArray(rawData)) {
        usersArray = rawData;
      } else if (rawData && typeof rawData === 'object' && Array.isArray(rawData.rows)) {
        usersArray = rawData.rows;
      } else if (rawData && typeof rawData === 'object' && rawData.result && Array.isArray(rawData.result.rows)) {
        usersArray = rawData.result.rows;
      }

      const enrichedUsers = usersArray.map((su) => {
        const localU = localUsers.find((u) => u.id === su.id || u.name === su.username);
        const name = su.username || su.name || localU?.name || "Unbekannter Trinker";
        const points = typeof su.points === "number" ? su.points : (localU?.points || 0);
        const rawAg = (su as Record<string, unknown>).alcohol_grams ?? su.alcoholGrams;
        const alcoholGrams = typeof rawAg === "number" ? rawAg : (localU?.alcoholGrams || 0);
        const avatar = su.avatar || localU?.avatar || undefined;
        const level = su.currentLevel || su.level || localU?.currentLevel || localU?.level || 1;
        const title = su.title || localU?.selected_title || localU?.title || "Neuling";
        const rank = su.rank || localU?.rank || "Unranked";

        return {
          id: su.id || localU?.id || "unknown",
          name,
          points,
          avatar: avatar || "",
          title,
          rank,
          achievements: localU?.achievements || [],
          email: localU?.email,
          selected_title: title,
          level,
          currentLevel: level,
          alcoholGrams,
        } as User;
      });

      setUsers(enrichedUsers);
      
    } catch (error) {
      console.warn("Live Scoreboard API failed, using local user list:", error);
      try {
        const userList = await apiService.getUsers();
        setUsers(userList || []);
      } catch (fallbackError) {
        setUsers([]);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  const handlePeriodChange = async (newPeriod: PeriodType) => {
    if (period !== newPeriod) {
      await triggerHaptic("medium");
      setPeriod(newPeriod);
    }
  };

  const handleSortChange = async (newSort: SortCriteriaType) => {
    if (sortCriteria !== newSort) {
      await triggerHaptic("medium");
      setSortCriteria(newSort);
    }
  };

  const handleToggleExpand = async (userId: string) => {
    await triggerHaptic("light");
    setExpandedUserId((prev) => (prev === userId ? null : userId));
  };

  // Process users and metrics dynamically based on period and sorting criteria
  const processedUsers = useMemo(() => {
    if (users.length === 0) return [];

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    let filterFn = (log: DrinkLog) => true;

    if (period === "this_month") {
      filterFn = (log: DrinkLog) => {
        const d = new Date(log.timestamp);
        return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
      };
    } else if (period === "last_month") {
      let lastMonth = currentMonth - 1;
      let lastMonthYear = currentYear;
      if (lastMonth < 0) {
        lastMonth = 11;
        lastMonthYear = currentYear - 1;
      }
      filterFn = (log: DrinkLog) => {
        const d = new Date(log.timestamp);
        return d.getFullYear() === lastMonthYear && d.getMonth() === lastMonth;
      };
    }

    const filteredLogs = logs.filter(filterFn);

    const mapped = users.map((u) => {
      const userLogs = filteredLogs.filter((l) => l.userId === u.id);

      let alcoholGrams = 0;
      let totalCalories = 0;
      let totalVolume = 0;
      const categoryTally = {
        Bier: 0,
        Wein: 0,
        Sekt: 0,
        Schnaps: 0,
        Mischgetränk: 0,
        Alkoholfrei: 0,
      };

      userLogs.forEach((log) => {
        const drink = drinks.find((d) => d.id === log.drinkId);
        if (drink) {
          alcoholGrams += drink.volume * (drink.abv / 100) * 0.789;
          totalCalories += drink.calories;
          totalVolume += drink.volume;
          if (drink.category in categoryTally) {
            categoryTally[drink.category as keyof typeof categoryTally]++;
          }
        }
      });

      return {
        ...u,
        periodCount: userLogs.length,
        periodAlcoholGrams: Number(alcoholGrams.toFixed(2)),
        periodVolume: totalVolume,
        periodCalories: totalCalories,
        categoryTally,
      };
    });

    mapped.sort((a, b) => {
      if (sortCriteria === "count") {
        if (b.periodCount !== a.periodCount) {
          return b.periodCount - a.periodCount;
        }
        return b.periodAlcoholGrams - a.periodAlcoholGrams;
      } else {
        if (b.periodAlcoholGrams !== a.periodAlcoholGrams) {
          return b.periodAlcoholGrams - a.periodAlcoholGrams;
        }
        return b.periodCount - a.periodCount;
      }
    });

    return mapped;
  }, [users, logs, drinks, period, sortCriteria]);

  // Podium mapping (top 3)
  const podiumUsers = processedUsers.slice(0, 3);
  // Remaining users list below podium (rank 4+)
  const listUsers = processedUsers.slice(3);

  const getRankBadgeColor = (rank: string) => {
    switch (rank) {
      case "Diamant": return "bg-cyan-400/10 border-cyan-400/20 text-cyan-400";
      case "Platin": return "bg-fuchsia-500/10 border-fuchsia-500/20 text-fuchsia-500";
      case "Gold": return "bg-yellow-400/10 border-yellow-400/20 text-yellow-400";
      case "Silber": return "bg-slate-300/10 border-slate-300/20 text-slate-300";
      case "Bronze": return "bg-amber-600/10 border-amber-600/20 text-amber-600";
      default: return "bg-slate-500/10 border-slate-500/20 text-slate-400";
    }
  };

  const getCategoryIcon = (category: string): "beer" | "wine" | "wine-outline" | "flask" | "water" => {
    switch (category) {
      case "Bier": return "beer";
      case "Wein": return "wine";
      case "Sekt": return "wine-outline";
      case "Schnaps": return "flask";
      case "Mischgetränk": return "wine";
      default: return "water";
    }
  };

  const getCategoryColorHex = (category: string): string => {
    switch (category) {
      case "Bier": return "#22d3ee";
      case "Wein": return "#c084fc";
      case "Sekt": return "#f472b6";
      case "Schnaps": return "#fb7185";
      case "Mischgetränk": return "#fbbf24";
      default: return "#34d399";
    }
  };

  return (
    <View className="flex-1 bg-slate-950">
      <ScrollView 
        className="flex-1 px-5 pt-4" 
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadData(true)}
            tintColor="#22d3ee"
            colors={["#22d3ee"]}
            progressBackgroundColor="#0f172a"
          />
        }
      >
        
        {/* ==========================================
            1. PERIOD SELECTOR TABS
            ========================================== */}
        <View className="flex-row bg-slate-900 border border-white/5 rounded-2xl p-1 mb-4">
          {(["this_month", "last_month", "all"] as PeriodType[]).map((p) => {
            const label = p === "this_month" ? "Dieser Monat" : p === "last_month" ? "Letzter Monat" : "Gesamt";
            const isActive = period === p;
            return (
              <TouchableOpacity
                key={p}
                onPress={() => handlePeriodChange(p)}
                className={`flex-1 py-2.5 rounded-xl items-center ${
                  isActive ? "bg-white/5 border border-white/10" : ""
                }`}
              >
                <Text className={`text-xs font-black uppercase tracking-wider ${isActive ? "text-cyan-400" : "text-slate-500"}`}>
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ==========================================
            2. SORT SELECTOR
            ========================================== */}
        <View className="flex-row justify-between items-center mb-6">
          <Text className="text-white/40 text-[10px] font-black uppercase tracking-widest">Sortieren nach</Text>
          <View className="flex-row bg-slate-900 border border-white/5 rounded-xl p-0.5">
            <TouchableOpacity
              onPress={() => handleSortChange("count")}
              className={`flex-row items-center px-3 py-1.5 rounded-lg space-x-1 ${
                sortCriteria === "count" ? "bg-cyan-400/10 border border-cyan-400/20" : ""
              }`}
            >
              <Ionicons name="wine-outline" size={12} color={sortCriteria === "count" ? "#22d3ee" : "#64748b"} />
              <Text className={`text-[10px] font-black uppercase ml-1 ${sortCriteria === "count" ? "text-cyan-400" : "text-slate-500"}`}>
                Menge
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              onPress={() => handleSortChange("alcohol")}
              className={`flex-row items-center px-3 py-1.5 rounded-lg space-x-1 ${
                sortCriteria === "alcohol" ? "bg-rose-500/10 border border-rose-500/20" : ""
              }`}
            >
              <Ionicons name="flask-outline" size={12} color={sortCriteria === "alcohol" ? "#f43f5e" : "#64748b"} />
              <Text className={`text-[10px] font-black uppercase ml-1 ${sortCriteria === "alcohol" ? "text-rose-500" : "text-slate-500"}`}>
                Alkohol
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Empty state when no data exists */}
        {processedUsers.length === 0 && !loading && (
          <View className="py-14 items-center justify-center bg-white/5 border border-white/5 rounded-3xl p-6 my-6">
            <Ionicons name="trophy-outline" size={36} color="#64748b" style={{ marginBottom: 12 }} />
            <Text className="text-white text-xs font-black uppercase tracking-wider text-center mb-1">
              Noch keine Einträge vorhanden
            </Text>
            <Text className="text-slate-400 text-[11px] font-medium text-center leading-relaxed">
              Sobald Getränke geloggt werden, erscheint hier das Scoreboard!
            </Text>
          </View>
        )}

        {/* ==========================================
            3. COMPETITIVE PODIUM (1-3)
            ========================================== */}
        {podiumUsers.length > 0 && (
          <View className="flex-row justify-center items-end mt-4 mb-8 px-1">
            
            {/* #2 Place - Silver */}
            {podiumUsers[1] && (
              <Animated.View layout={LinearTransition.springify().damping(15)} key={podiumUsers[1].id} className="items-center mx-1.5 w-[28%]">
                <TouchableOpacity
                  onPress={() => handleToggleExpand(podiumUsers[1].id)}
                  className="items-center w-full bg-white/5 border border-slate-300/30 rounded-2xl p-2.5 pt-6 relative"
                  style={{ minHeight: 135 }}
                >
                  <View className="absolute -top-6 bg-slate-900 border-2 border-slate-300 w-11 h-11 rounded-full items-center justify-center overflow-hidden">
                    {podiumUsers[1].avatar ? (
                      <Image source={{ uri: podiumUsers[1].avatar }} className="w-full h-full" />
                    ) : (
                      <Ionicons name="person" size={20} color="#94a3b8" />
                    )}
                  </View>
                  <View className="absolute top-2 right-2 bg-slate-300 px-1 py-0.5 rounded">
                    <Text className="text-slate-950 text-[8px] font-black">#2</Text>
                  </View>
                  <Text className="text-white text-xs font-bold text-center mt-2 w-full" numberOfLines={1}>
                    {(podiumUsers[1].name || "Unbekannter Trinker").split(" ")[0]}
                  </Text>
                  <Text className="text-slate-300 text-[10px] font-black mt-1">
                    {sortCriteria === "count"
                      ? `${podiumUsers[1].periodCount} Drk`
                      : `${podiumUsers[1].periodAlcoholGrams.toFixed(2)}g`}
                  </Text>
                  <View className="mt-2 bg-slate-300/10 border border-slate-300/20 px-1.5 py-0.5 rounded-full">
                    <Text className="text-slate-300 text-[7px] font-black uppercase">
                      Lvl {podiumUsers[1].level || 1} • {podiumUsers[1].rank}
                    </Text>
                  </View>
                  <Text className="text-slate-500 text-[8px] font-bold mt-1.5 text-center" numberOfLines={1}>
                    {podiumUsers[1].title}
                  </Text>
                </TouchableOpacity>
              </Animated.View>
            )}

            {/* #1 Place - Gold */}
            {podiumUsers[0] && (
              <Animated.View layout={LinearTransition.springify().damping(15)} key={podiumUsers[0].id} className="items-center mx-1.5 w-[33%]">
                <TouchableOpacity
                  onPress={() => handleToggleExpand(podiumUsers[0].id)}
                  className="items-center w-full bg-white/5 border-2 border-yellow-400 rounded-3xl p-3.5 pt-8 relative shadow-[0_0_15px_rgba(234,179,8,0.25)]"
                  style={{ minHeight: 165 }}
                >
                  <View className="absolute -top-11 z-10">
                    <Ionicons name="trophy" size={22} color="#facc15" />
                  </View>
                  <View className="absolute -top-7 bg-slate-900 border-2 border-yellow-400 w-13 h-13 rounded-full items-center justify-center overflow-hidden">
                    {podiumUsers[0].avatar ? (
                      <Image source={{ uri: podiumUsers[0].avatar }} className="w-full h-full" />
                    ) : (
                      <Ionicons name="person" size={24} color="#eab308" />
                    )}
                  </View>
                  <View className="absolute top-2 right-2 bg-yellow-400 px-1.5 py-0.5 rounded">
                    <Text className="text-slate-950 text-[8px] font-black">#1</Text>
                  </View>
                  <Text className="text-white text-sm font-black text-center mt-2 w-full" numberOfLines={1}>
                    {(podiumUsers[0].name || "Unbekannter Trinker").split(" ")[0]}
                  </Text>
                  <Text className="text-yellow-400 text-xs font-black mt-1">
                    {sortCriteria === "count"
                      ? `${podiumUsers[0].periodCount} Drk`
                      : `${podiumUsers[0].periodAlcoholGrams.toFixed(2)}g`}
                  </Text>
                  <View className="mt-2 bg-yellow-400/10 border border-yellow-400/20 px-2 py-0.5 rounded-full">
                    <Text className="text-yellow-400 text-[8px] font-black uppercase">
                      Lvl {podiumUsers[0].level || 1} • {podiumUsers[0].rank}
                    </Text>
                  </View>
                  <Text className="text-yellow-500/80 text-[8px] font-extrabold mt-1.5 text-center" numberOfLines={1}>
                    {podiumUsers[0].title}
                  </Text>
                </TouchableOpacity>
              </Animated.View>
            )}

            {/* #3 Place - Bronze */}
            {podiumUsers[2] && (
              <Animated.View layout={LinearTransition.springify().damping(15)} key={podiumUsers[2].id} className="items-center mx-1.5 w-[28%]">
                <TouchableOpacity
                  onPress={() => handleToggleExpand(podiumUsers[2].id)}
                  className="items-center w-full bg-white/5 border border-amber-600/30 rounded-2xl p-2.5 pt-6 relative"
                  style={{ minHeight: 135 }}
                >
                  <View className="absolute -top-6 bg-slate-900 border-2 border-amber-600 w-11 h-11 rounded-full items-center justify-center overflow-hidden">
                    {podiumUsers[2].avatar ? (
                      <Image source={{ uri: podiumUsers[2].avatar }} className="w-full h-full" />
                    ) : (
                      <Ionicons name="person" size={20} color="#d97706" />
                    )}
                  </View>
                  <View className="absolute top-2 right-2 bg-amber-600 px-1 py-0.5 rounded">
                    <Text className="text-slate-950 text-[8px] font-black">#3</Text>
                  </View>
                  <Text className="text-white text-xs font-bold text-center mt-2 w-full" numberOfLines={1}>
                    {(podiumUsers[2].name || "Unbekannter Trinker").split(" ")[0]}
                  </Text>
                  <Text className="text-amber-600 text-[10px] font-black mt-1">
                    {sortCriteria === "count"
                      ? `${podiumUsers[2].periodCount} Drk`
                      : `${podiumUsers[2].periodAlcoholGrams.toFixed(2)}g`}
                  </Text>
                  <View className="mt-2 bg-amber-600/10 border border-amber-600/20 px-1.5 py-0.5 rounded-full">
                    <Text className="text-amber-600 text-[7px] font-black uppercase">
                      Lvl {podiumUsers[2].level || 1} • {podiumUsers[2].rank}
                    </Text>
                  </View>
                  <Text className="text-slate-500 text-[8px] font-bold mt-1.5 text-center" numberOfLines={1}>
                    {podiumUsers[2].title}
                  </Text>
                </TouchableOpacity>
              </Animated.View>
            )}

          </View>
        )}

        {/* ==========================================
            4. LIST FOR THE REMAINING PLACES (4+)
            ========================================== */}
        {listUsers.length > 0 && (
          <View className="mb-10">
            <Text className="text-white/40 text-[10px] font-black uppercase tracking-widest mb-3">Ränge ab Platz 4</Text>
            
            {listUsers.map((item, index) => {
              const isSelf = item.id === currentUser?.id;
              const isExpanded = expandedUserId === item.id;
              
              let borderStyle = isSelf ? "border-cyan-400/50" : "border-white/10";
              const realRank = index + 4;

              return (
                <Animated.View
                  layout={LinearTransition.springify().damping(15)}
                  key={item.id}
                  className={`bg-white/5 border rounded-2xl p-4 mb-3 shadow-lg ${borderStyle}`}
                >
                  <TouchableOpacity
                    onPress={() => handleToggleExpand(item.id)}
                    className="flex-row items-center justify-between"
                    activeOpacity={0.8}
                  >
                    <View className="flex-row items-center space-x-3 flex-1">
                      <View className="w-6 items-center justify-center">
                        <Text className="text-white/40 text-xs font-black">#{realRank}</Text>
                      </View>
                      
                      {item.avatar ? (
                        <Image source={{ uri: item.avatar }} className="w-9 h-9 rounded-full border border-white/10" />
                      ) : (
                        <View className="w-9 h-9 rounded-full bg-slate-900 border border-white/10 items-center justify-center">
                          <Ionicons name="person" size={16} color="#94a3b8" />
                        </View>
                      )}

                      <View className="ml-2.5 flex-1">
                        <View className="flex-row items-center flex-wrap gap-1">
                           <Text className="text-white text-xs font-black mr-1" numberOfLines={1}>
                             {item.name || "Unbekannter Trinker"}
                           </Text>
                          <View className="bg-slate-900 border border-white/10 px-1.5 py-0.5 rounded">
                            <Text className="text-cyan-400 text-[6px] font-black uppercase tracking-wider leading-none">Lvl {item.level || 1}</Text>
                          </View>
                          <View className={`border px-1 py-0.5 rounded ${getRankBadgeColor(item.rank)}`}>
                            <Text className="text-[6px] font-black uppercase tracking-wider leading-none">{item.rank}</Text>
                          </View>
                        </View>
                        <Text className="text-white/40 text-[9px] font-bold mt-0.5">{item.title}</Text>
                      </View>
                    </View>

                    {/* Stats */}
                    <View className="flex-row items-center space-x-2">
                      <View className="items-end">
                        {sortCriteria === "count" ? (
                          <>
                            <Text className="text-cyan-400 text-sm font-black">{item.periodCount}x</Text>
                            <Text className="text-rose-500/80 text-[8px] font-bold">{item.periodAlcoholGrams.toFixed(2)}g Alk</Text>
                          </>
                        ) : (
                          <>
                            <Text className="text-rose-500 text-sm font-black">{item.periodAlcoholGrams.toFixed(2)}g</Text>
                            <Text className="text-cyan-400/80 text-[8px] font-bold">{item.periodCount} Drk</Text>
                          </>
                        )}
                      </View>
                      <Ionicons name={isExpanded ? "chevron-up" : "chevron-down"} size={14} color="#64748b" style={{ marginLeft: 4 }} />
                    </View>
                  </TouchableOpacity>

                  {/* Expand breakdown details */}
                  {isExpanded && (
                    <View className="mt-4 pt-3 border-t border-white/5">
                      <Text className="text-white/50 text-[8px] font-black uppercase tracking-widest mb-2">Getränke-Aufteilung</Text>
                      <View className="flex-row flex-wrap justify-between bg-slate-950/40 p-3 rounded-xl border border-white/5">
                        {Object.entries(item.categoryTally).map(([cat, count]) => (
                          <View key={cat} className="flex-row justify-between items-center w-[48%] py-1 border-b border-white/5">
                            <View className="flex-row items-center">
                               <Ionicons name={getCategoryIcon(cat)} size={11} color={getCategoryColorHex(cat)} />
                               <Text className="text-white/60 text-[9px] font-bold ml-1">{cat}</Text>
                            </View>
                            <Text className="text-white text-[9px] font-black">{count}x</Text>
                          </View>
                        ))}
                        
                        <View className="w-full flex-row justify-between items-center mt-3 pt-2 border-t border-white/10">
                          <View className="flex-row items-center">
                            <Ionicons name="scale-outline" size={11} color="#f43f5e" />
                            <Text className="text-white/60 text-[9px] font-bold ml-1">Gesamtvolumen</Text>
                          </View>
                          <Text className="text-rose-400 text-[9px] font-black">{(item.periodVolume / 1000).toFixed(2)}L</Text>
                        </View>

                        <View className="w-full flex-row justify-between items-center mt-1">
                          <View className="flex-row items-center">
                            <Ionicons name="flame-outline" size={11} color="#eab308" />
                            <Text className="text-white/60 text-[9px] font-bold ml-1">Kalorien</Text>
                          </View>
                          <Text className="text-yellow-400 text-[9px] font-black">{item.periodCalories} kcal</Text>
                        </View>
                      </View>
                    </View>
                  )}

                </Animated.View>
              );
            })}
          </View>
        )}
        <View className="h-10" />
      </ScrollView>
    </View>
  );
}
