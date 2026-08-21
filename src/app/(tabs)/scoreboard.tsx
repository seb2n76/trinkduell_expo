import React, { useState, useCallback, useMemo } from "react";
import { Text, View, FlatList, TouchableOpacity, RefreshControl } from "react-native";
import { Image } from "expo-image";
import { useFocusEffect } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { apiService, type ScoreboardPeriod, type ScoreboardRow } from "@/services/api";
import { triggerHaptic } from "@/services/haptics";
import { Ionicons } from "@expo/vector-icons";
import Animated, { LinearTransition } from "react-native-reanimated";
import { ScoreboardPodiumSkeleton, ScoreboardRowSkeleton } from "@/components/Skeleton";
import { usePolling } from "@/services/polling";
import { useThemeColors } from "@/services/theme";

type SortCriteriaType = "count" | "alcohol";

/**
 * Rangliste.
 *
 * Die Zahlen dieses Schirms (Anzahl, Alkohol, Menge, Kalorien, Aufteilung
 * nach Kategorie) hat der Client bis zum 21.08.2026 selbst gerechnet. Dafür
 * lud er über `/logs` SÄMTLICHE Einträge SÄMTLICHER Konten herunter und
 * filterte sie in einer verschachtelten Schleife — je Nutzer einmal durch
 * alle Einträge, je Eintrag einmal durch alle Getränke.
 *
 * Das war zweierlei zugleich: teuer, und ein Datenleck. Angezeigt wird von
 * den Rohdaten nämlich nichts, nur ihre Summe. Die kommt jetzt fertig vom
 * Server (`GET /scoreboard?period=…`), und fremde Einzeleinträge verlassen
 * die Datenbank gar nicht mehr.
 *
 * Der Abruf lief außerdem an der API-Schicht vorbei, mit einem eigenen
 * `fetch` samt handgebautem Authorization-Header. Damit fehlten Zeitlimit,
 * 401-Behandlung und die deutschen Fehlertexte des Servers.
 */
export default function ScoreboardScreen() {
  const c = useThemeColors();
  const isFocused = useIsFocused();
  const [rows, setRows] = useState<ScoreboardRow[]>([]);
  const [meId, setMeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filters
  const [period, setPeriod] = useState<ScoreboardPeriod>("this_month");
  const [sortCriteria, setSortCriteria] = useState<SortCriteriaType>("count");
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

  const loadData = useCallback(
    async (isPullToRefresh = false) => {
      if (isPullToRefresh) setRefreshing(true);

      try {
        const [scoreboard, me] = await Promise.all([
          apiService.getScoreboard(period),
          // Nur für die Hervorhebung der eigenen Zeile. Schlägt das fehl,
          // ist die Liste trotzdem vollständig — also kein Grund, sie
          // deswegen gar nicht zu zeigen.
          apiService.getCurrentUser().catch(() => null),
        ]);
        setRows(scoreboard);
        if (me) setMeId(me.id);
      } catch (error) {
        console.warn("Rangliste konnte nicht geladen werden:", error);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [period]
  );

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  // Ränge ändern sich, während andere etwas eintragen — deshalb nachfragen,
  // statt auf ein manuelles Herunterziehen zu warten. Aber nur, solange der
  // Reiter offen und die App im Vordergrund ist: vorher lief dieser Timer
  // auch dann weiter, wenn die App minimiert in der Tasche lag.
  usePolling(() => loadData(), 15000, { enabled: isFocused });

  const handlePeriodChange = async (newPeriod: ScoreboardPeriod) => {
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

  // Der Server sortiert nach Punkten; dieser Schirm nach Anzahl oder Alkohol
  // des Zeitraums. Das umzusortieren kostet auf fertigen Summen nichts.
  const processedUsers = useMemo(() => {
    return [...rows].sort((a, b) => {
      if (sortCriteria === "count") {
        if (b.periodCount !== a.periodCount) return b.periodCount - a.periodCount;
        return b.periodAlcoholGrams - a.periodAlcoholGrams;
      }
      if (b.periodAlcoholGrams !== a.periodAlcoholGrams) {
        return b.periodAlcoholGrams - a.periodAlcoholGrams;
      }
      return b.periodCount - a.periodCount;
    });
  }, [rows, sortCriteria]);

  // Podium mapping (top 3)
  const podiumUsers = processedUsers.slice(0, 3);
  // Remaining users list below podium (rank 4+)
  const listUsers = processedUsers.slice(3);

  const getRankBadgeColor = (rank?: string | null) => {
    switch (rank) {
      case "Diamant": return "bg-accent/10 border-accent/20 text-accent-ink";
      case "Platin": return "bg-accent-2/10 border-accent-2/20 text-accent-2-ink";
      case "Gold": return "bg-warning/10 border-warning/20 text-warning";
      case "Silber": return "bg-surface-alt/10 border-line-strong/20 text-content-muted";
      case "Bronze": return "bg-warning/10 border-warning/20 text-warning";
      default: return "bg-surface-alt/10 border-line-strong/20 text-content-muted";
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
      case "Bier": return c.accent;
      case "Wein": return c.accent2;
      case "Sekt": return c.accent2;
      case "Schnaps": return c.danger;
      case "Mischgetränk": return c.warning;
      default: return c.success;
    }
  };

  /** Anzeigename einer Zeile — nie leer, damit die Liste keine Lücke zeigt. */
  const displayName = (row: ScoreboardRow) => row.username || "Unbekannter Trinker";

  /**
   * Alles oberhalb der Liste ab Platz 4: Filter, Sortierung und Podium.
   *
   * Als `ListHeaderComponent` statt als Teil eines umschließenden
   * ScrollViews — die Rangliste war vorher komplett ein ScrollView, der
   * jede Zeile sofort rendert und behält. Bei einer Rangliste, die mit jedem
   * neuen Konto wächst, ist genau das der Fall, für den es FlatList gibt.
   */
  const renderHeader = () => (
    <View>
      {/* ==========================================
          1. PERIOD SELECTOR TABS
          ========================================== */}
      <View className="flex-row bg-surface border border-line rounded-2xl p-1 mb-4">
        {(["this_month", "last_month", "all"] as ScoreboardPeriod[]).map((p) => {
          const label = p === "this_month" ? "Dieser Monat" : p === "last_month" ? "Letzter Monat" : "Gesamt";
          const isActive = period === p;
          return (
            <TouchableOpacity
              key={p}
              onPress={() => handlePeriodChange(p)}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={`Zeitraum ${label}`}
              className={`flex-1 py-2.5 rounded-xl items-center ${
                isActive ? "bg-surface border border-line" : ""
              }`}
            >
              <Text className={`text-xs font-black uppercase tracking-wider ${isActive ? "text-accent-ink" : "text-content-faint"}`}>
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
        <Text className="text-content-faint text-[10px] font-black uppercase tracking-widest">Sortieren nach</Text>
        <View className="flex-row bg-surface border border-line rounded-xl p-0.5">
          <TouchableOpacity
            onPress={() => handleSortChange("count")}
            accessibilityRole="button"
            accessibilityState={{ selected: sortCriteria === "count" }}
            accessibilityLabel="Nach Anzahl der Getränke sortieren"
            className={`flex-row items-center px-3 py-1.5 rounded-lg space-x-1 ${
              sortCriteria === "count" ? "bg-accent/10 border border-accent/20" : ""
            }`}
          >
            <Ionicons name="wine-outline" size={12} color={sortCriteria === "count" ? c.accent : c.contentFaint} />
            <Text className={`text-[10px] font-black uppercase ml-1 ${sortCriteria === "count" ? "text-accent-ink" : "text-content-faint"}`}>
              Menge
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => handleSortChange("alcohol")}
            accessibilityRole="button"
            accessibilityState={{ selected: sortCriteria === "alcohol" }}
            accessibilityLabel="Nach Alkoholmenge sortieren"
            className={`flex-row items-center px-3 py-1.5 rounded-lg space-x-1 ${
              sortCriteria === "alcohol" ? "bg-danger/10 border border-danger/20" : ""
            }`}
          >
            <Ionicons name="flask-outline" size={12} color={sortCriteria === "alcohol" ? c.danger : c.contentFaint} />
            <Text className={`text-[10px] font-black uppercase ml-1 ${sortCriteria === "alcohol" ? "text-danger" : "text-content-faint"}`}>
              Alkohol
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Loading Skeletons */}
      {loading && processedUsers.length === 0 && (
        <View className="mt-2">
          <ScoreboardPodiumSkeleton />
          <Text className="text-content-faint text-[10px] font-black uppercase tracking-widest mb-3">
            Ränge ab Platz 4
          </Text>
          <ScoreboardRowSkeleton />
          <ScoreboardRowSkeleton />
          <ScoreboardRowSkeleton />
          <ScoreboardRowSkeleton />
        </View>
      )}

      {/* Empty state when no data exists */}
      {processedUsers.length === 0 && !loading && (
        <View className="py-14 items-center justify-center bg-surface border border-line rounded-3xl p-6 my-6">
          <Ionicons name="trophy-outline" size={36} color={c.contentFaint} style={{ marginBottom: 12 }} />
          <Text className="text-content text-xs font-black uppercase tracking-wider text-center mb-1">
            Noch keine Einträge vorhanden
          </Text>
          <Text className="text-content-muted text-[11px] font-medium text-center leading-relaxed">
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
                accessibilityRole="button"
                accessibilityLabel={`Platz 2: ${displayName(podiumUsers[1])}, Details anzeigen`}
                className="items-center w-full bg-surface border border-line-strong/30 rounded-2xl p-2.5 pt-6 relative"
                style={{ minHeight: 135 }}
              >
                <View className="absolute -top-6 bg-surface border-2 border-line-strong w-11 h-11 rounded-full items-center justify-center overflow-hidden">
                  {podiumUsers[1].avatar ? (
                    <Image source={{ uri: podiumUsers[1].avatar }} style={{ width: "100%", height: "100%" }} contentFit="cover" />
                  ) : (
                    <Ionicons name="person" size={20} color={c.contentMuted} />
                  )}
                </View>
                <View className="absolute top-2 right-2 bg-surface-alt px-1 py-0.5 rounded">
                  <Text className="text-content text-[8px] font-black">#2</Text>
                </View>
                <Text className="text-content text-xs font-bold text-center mt-2 w-full" numberOfLines={1}>
                  {displayName(podiumUsers[1]).split(" ")[0]}
                </Text>
                <Text className="text-content-muted text-[10px] font-black mt-1">
                  {sortCriteria === "count"
                    ? `${podiumUsers[1].periodCount} Drk`
                    : `${podiumUsers[1].periodAlcoholGrams.toFixed(2)}g`}
                </Text>
                <View className="mt-2 bg-surface-alt/10 border border-line-strong/20 px-1.5 py-0.5 rounded-full">
                  <Text className="text-content-muted text-[7px] font-black uppercase">
                    Lvl {podiumUsers[1].level || 1} • {podiumUsers[1].rank}
                  </Text>
                </View>
                <Text className="text-content-faint text-[8px] font-bold mt-1.5 text-center" numberOfLines={1}>
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
                accessibilityRole="button"
                accessibilityLabel={`Platz 1: ${displayName(podiumUsers[0])}, Details anzeigen`}
                className="items-center w-full bg-surface border-2 border-warning rounded-3xl p-3.5 pt-8 relative shadow-[0_0_15px_rgba(234,179,8,0.25)]"
                style={{ minHeight: 165 }}
              >
                <View className="absolute -top-11 z-10">
                  <Ionicons name="trophy" size={22} color={c.warning} />
                </View>
                <View className="absolute -top-7 bg-surface border-2 border-warning w-13 h-13 rounded-full items-center justify-center overflow-hidden">
                  {podiumUsers[0].avatar ? (
                    <Image source={{ uri: podiumUsers[0].avatar }} style={{ width: "100%", height: "100%" }} contentFit="cover" />
                  ) : (
                    <Ionicons name="person" size={24} color={c.warning} />
                  )}
                </View>
                {/* Auf Goldgrund, nicht auf der Seitenflaeche: on-accent
                    dreht sich mit dem Schema (dunkel auf hellem Gold,
                    hell auf dunklem Amber) und bleibt so immer lesbar. */}
                <View className="absolute top-2 right-2 bg-warning px-1.5 py-0.5 rounded">
                  <Text className="text-on-accent text-[8px] font-black">#1</Text>
                </View>
                <Text className="text-content text-sm font-black text-center mt-2 w-full" numberOfLines={1}>
                  {displayName(podiumUsers[0]).split(" ")[0]}
                </Text>
                <Text className="text-warning text-xs font-black mt-1">
                  {sortCriteria === "count"
                    ? `${podiumUsers[0].periodCount} Drk`
                    : `${podiumUsers[0].periodAlcoholGrams.toFixed(2)}g`}
                </Text>
                <View className="mt-2 bg-warning/10 border border-warning/20 px-2 py-0.5 rounded-full">
                  <Text className="text-warning text-[8px] font-black uppercase">
                    Lvl {podiumUsers[0].level || 1} • {podiumUsers[0].rank}
                  </Text>
                </View>
                <Text className="text-warning text-[8px] font-extrabold mt-1.5 text-center" numberOfLines={1}>
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
                accessibilityRole="button"
                accessibilityLabel={`Platz 3: ${displayName(podiumUsers[2])}, Details anzeigen`}
                className="items-center w-full bg-surface border border-warning/30 rounded-2xl p-2.5 pt-6 relative"
                style={{ minHeight: 135 }}
              >
                <View className="absolute -top-6 bg-surface border-2 border-warning w-11 h-11 rounded-full items-center justify-center overflow-hidden">
                  {podiumUsers[2].avatar ? (
                    <Image source={{ uri: podiumUsers[2].avatar }} style={{ width: "100%", height: "100%" }} contentFit="cover" />
                  ) : (
                    <Ionicons name="person" size={20} color={c.warning} />
                  )}
                </View>
                <View className="absolute top-2 right-2 bg-warning px-1 py-0.5 rounded">
                  <Text className="text-on-accent text-[8px] font-black">#3</Text>
                </View>
                <Text className="text-content text-xs font-bold text-center mt-2 w-full" numberOfLines={1}>
                  {displayName(podiumUsers[2]).split(" ")[0]}
                </Text>
                <Text className="text-warning text-[10px] font-black mt-1">
                  {sortCriteria === "count"
                    ? `${podiumUsers[2].periodCount} Drk`
                    : `${podiumUsers[2].periodAlcoholGrams.toFixed(2)}g`}
                </Text>
                <View className="mt-2 bg-warning/10 border border-warning/20 px-1.5 py-0.5 rounded-full">
                  <Text className="text-warning text-[7px] font-black uppercase">
                    Lvl {podiumUsers[2].level || 1} • {podiumUsers[2].rank}
                  </Text>
                </View>
                <Text className="text-content-faint text-[8px] font-bold mt-1.5 text-center" numberOfLines={1}>
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
        <Text className="text-content-faint text-[10px] font-black uppercase tracking-widest mb-3">Ränge ab Platz 4</Text>
      )}
    </View>
  );

  const renderRow = ({ item, index }: { item: ScoreboardRow; index: number }) => {
    const isSelf = item.id === meId;
    const isExpanded = expandedUserId === item.id;

    const borderStyle = isSelf ? "border-accent/50" : "border-line";
    const realRank = index + 4;

    return (
      <Animated.View
        layout={LinearTransition.springify().damping(15)}
        className={`bg-surface border rounded-2xl p-4 mb-3 shadow-lg ${borderStyle}`}
      >
        <TouchableOpacity
          onPress={() => handleToggleExpand(item.id)}
          accessibilityRole="button"
          accessibilityState={{ expanded: isExpanded }}
          accessibilityLabel={`Platz ${realRank}: ${displayName(item)}, ${item.periodCount} Getränke`}
          className="flex-row items-center justify-between"
          activeOpacity={0.8}
        >
          <View className="flex-row items-center space-x-3 flex-1">
            <View className="w-6 items-center justify-center">
              <Text className="text-content-faint text-xs font-black">#{realRank}</Text>
            </View>

            {item.avatar ? (
              <Image
                source={{ uri: item.avatar }}
                style={{ width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: c.line }}
                contentFit="cover"
              />
            ) : (
              <View className="w-9 h-9 rounded-full bg-surface border border-line items-center justify-center">
                <Ionicons name="person" size={16} color={c.contentMuted} />
              </View>
            )}

            <View className="ml-2.5 flex-1">
              <View className="flex-row items-center flex-wrap gap-1">
                 <Text className="text-content text-xs font-black mr-1" numberOfLines={1}>
                   {displayName(item)}
                 </Text>
                <View className="bg-surface border border-line px-1.5 py-0.5 rounded">
                  <Text className="text-accent-ink text-[6px] font-black uppercase tracking-wider leading-none">Lvl {item.level || 1}</Text>
                </View>
                <View className={`border px-1 py-0.5 rounded ${getRankBadgeColor(item.rank)}`}>
                  <Text className="text-[6px] font-black uppercase tracking-wider leading-none">{item.rank}</Text>
                </View>
              </View>
              <Text className="text-content-faint text-[9px] font-bold mt-0.5">{item.title}</Text>
            </View>
          </View>

          {/* Stats */}
          <View className="flex-row items-center space-x-2">
            <View className="items-end">
              {sortCriteria === "count" ? (
                <>
                  <Text className="text-accent-ink text-sm font-black">{item.periodCount}x</Text>
                  <Text className="text-danger text-[8px] font-bold">{item.periodAlcoholGrams.toFixed(2)}g Alk</Text>
                </>
              ) : (
                <>
                  <Text className="text-danger text-sm font-black">{item.periodAlcoholGrams.toFixed(2)}g</Text>
                  <Text className="text-accent-ink text-[8px] font-bold">{item.periodCount} Drk</Text>
                </>
              )}
            </View>
            <Ionicons name={isExpanded ? "chevron-up" : "chevron-down"} size={14} color={c.contentFaint} style={{ marginLeft: 4 }} />
          </View>
        </TouchableOpacity>

        {/* Expand breakdown details */}
        {isExpanded && (
          <View className="mt-4 pt-3 border-t border-line">
            <Text className="text-content-muted text-[8px] font-black uppercase tracking-widest mb-2">Getränke-Aufteilung</Text>
            <View className="flex-row flex-wrap justify-between bg-surface-alt/40 p-3 rounded-xl border border-line">
              {Object.entries(item.categoryTally).map(([cat, count]) => (
                <View key={cat} className="flex-row justify-between items-center w-[48%] py-1 border-b border-line">
                  <View className="flex-row items-center">
                     <Ionicons name={getCategoryIcon(cat)} size={11} color={getCategoryColorHex(cat)} />
                     <Text className="text-content-muted text-[9px] font-bold ml-1">{cat}</Text>
                  </View>
                  <Text className="text-content text-[9px] font-black">{count}x</Text>
                </View>
              ))}

              <View className="w-full flex-row justify-between items-center mt-3 pt-2 border-t border-line">
                <View className="flex-row items-center">
                  <Ionicons name="scale-outline" size={11} color={c.danger} />
                  <Text className="text-content-muted text-[9px] font-bold ml-1">Gesamtvolumen</Text>
                </View>
                <Text className="text-danger text-[9px] font-black">{(item.periodVolume / 1000).toFixed(2)}L</Text>
              </View>

              <View className="w-full flex-row justify-between items-center mt-1">
                <View className="flex-row items-center">
                  <Ionicons name="flame-outline" size={11} color={c.warning} />
                  <Text className="text-content-muted text-[9px] font-bold ml-1">Kalorien</Text>
                </View>
                <Text className="text-warning text-[9px] font-black">{item.periodCalories} kcal</Text>
              </View>
            </View>
          </View>
        )}

      </Animated.View>
    );
  };

  return (
    <View className="flex-1 bg-bg">
      <FlatList
        className="flex-1 px-5 pt-4"
        data={listUsers}
        keyExtractor={(item) => item.id}
        renderItem={renderRow}
        ListHeaderComponent={renderHeader}
        ListFooterComponent={<View className="h-10" />}
        showsVerticalScrollIndicator={false}
        // Ohne diese beiden bleibt die Liste beim Aufklappen einer Zeile
        // hängen: FlatList misst die Höhe einmal und merkt sich sie.
        removeClippedSubviews={false}
        initialNumToRender={10}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadData(true)}
            tintColor={c.accent}
            colors={[c.accent]}
            progressBackgroundColor={c.surface}
          />
        }
      />
    </View>
  );
}
