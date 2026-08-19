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
  Modal,
  Platform,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { apiService } from "@/services/api";
import { triggerHaptic } from "@/services/haptics";
import {
  User,
  FeedItem,
  FeedScope,
  RadarEntry,
  ReportReason,
  REPORT_REASON_LABELS,
} from "@/services/mockData";
import { Ionicons } from "@expo/vector-icons";
import { Avatar } from "@/components/Avatar";

// ─────────────────────────────────────────────
// Freunde-Radar: wer ist gerade unterwegs?
// ─────────────────────────────────────────────
const RADAR_STATUS_STYLES = {
  active: { dot: "#34d399", label: "Gerade aktiv", ring: "border-emerald-400/50" },
  recent: { dot: "#fbbf24", label: "Vor kurzem", ring: "border-amber-400/40" },
  idle: { dot: "#475569", label: "Ruhig", ring: "border-white/10" },
} as const;

const formatLastActivity = (iso: string | null): string => {
  if (!iso) return "Noch nichts geloggt";
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return "gerade eben";
  if (diffMin < 60) return `vor ${diffMin} Min.`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `vor ${diffH} Std.`;
  return `vor ${Math.floor(diffH / 24)} Tg.`;
};

function FriendsRadar({
  entries,
  loading,
  onOpenMap,
}: {
  entries: RadarEntry[];
  loading: boolean;
  onOpenMap: () => void;
}) {
  const activeCount = entries.filter((e) => e.status === "active").length;

  return (
    <View className="bg-slate-900/90 border border-cyan-500/20 rounded-3xl p-5 mb-5 shadow-2xl overflow-hidden relative">
      <View className="absolute -right-8 -top-8 w-36 h-36 rounded-full bg-cyan-500/10 blur-2xl pointer-events-none" />

      <View className="flex-row items-center justify-between mb-4">
        <View className="flex-row items-center space-x-3">
          <View className="w-10 h-10 rounded-2xl bg-cyan-400/10 border border-cyan-400/30 items-center justify-center shadow-md">
            <Ionicons name="radio" size={20} color="#22d3ee" />
          </View>
          <View className="ml-3">
            <Text className="text-white text-base font-black tracking-wide">Freunde-Radar</Text>
            <Text className="text-cyan-400/80 text-[10px] font-bold uppercase tracking-wider">
              Wer ist gerade unterwegs?
            </Text>
          </View>
        </View>

        {activeCount > 0 && (
          <View className="bg-emerald-400/10 border border-emerald-400/30 px-2.5 py-1 rounded-full">
            <Text className="text-emerald-400 text-[9px] font-black uppercase tracking-widest">
              {activeCount} aktiv
            </Text>
          </View>
        )}
      </View>

      {loading ? (
        <View className="py-6 items-center">
          <ActivityIndicator size="small" color="#22d3ee" />
        </View>
      ) : entries.length === 0 ? (
        <Text className="text-slate-400 text-xs leading-relaxed font-medium">
          Noch keine Freunde hinzugefügt. Füge über das Menü Freunde hinzu, um zu sehen, wer gerade
          unterwegs ist. 🍻
        </Text>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-1">
          {entries.map((entry) => {
            const style = RADAR_STATUS_STYLES[entry.status];
            return (
              <View key={entry.id} className="items-center mx-1.5 w-20">
                <View className="relative">
                  <Avatar
                    uri={entry.avatar}
                    name={entry.username}
                    size={56}
                    className={`border-2 ${style.ring}`}
                  />
                  <View
                    style={{ backgroundColor: style.dot }}
                    className="absolute bottom-0 right-0 w-4 h-4 rounded-full border-2 border-slate-900"
                  />
                </View>

                <Text className="text-white text-[10px] font-black mt-1.5 text-center" numberOfLines={1}>
                  {entry.username}
                </Text>
                <Text className="text-slate-500 text-[8px] font-semibold text-center" numberOfLines={1}>
                  {formatLastActivity(entry.lastActivity)}
                </Text>
              </View>
            );
          })}
        </ScrollView>
      )}

      <TouchableOpacity
        onPress={onOpenMap}
        accessibilityLabel="Karte öffnen"
        className="flex-row items-center justify-between mt-4 pt-3 border-t border-white/5"
      >
        <View className="flex-row items-center">
          <Ionicons name="map-outline" size={13} color="#22d3ee" />
          <Text className="text-cyan-400 text-[10px] font-black uppercase tracking-wider ml-1.5">
            Karte öffnen
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={14} color="#22d3ee" />
      </TouchableOpacity>
    </View>
  );
}

// ─────────────────────────────────────────────
// Main Screen: Live Activity Feed
// ─────────────────────────────────────────────
export default function LivePulseFeed() {
  const router = useRouter();
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  const [reportTarget, setReportTarget] = useState<FeedItem | null>(null);
  const [reportReason, setReportReason] = useState<ReportReason | null>(null);
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [radarEntries, setRadarEntries] = useState<RadarEntry[]>([]);
  const [radarLoading, setRadarLoading] = useState(true);
  const [scope, setScope] = useState<FeedScope>("friends");
  const [inputText, setInputText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadFeedData = async (activeScope: FeedScope) => {
    try {
      const me = await apiService.getCurrentUser();
      if (!me) {
        console.warn("User not found in feed load, aborting.");
        setLoading(false);
        setRadarLoading(false);
        return;
      }

      setCurrentUser(me);

      // Radar and feed both go through apiService so they share the auth
      // header, circuit breaker and — importantly — the same friend/group
      // filtering when falling back to local data.
      const [radar, fetchedFeed] = await Promise.all([
        apiService.getRadar(me.name).catch((e) => {
          console.warn("Radar konnte nicht geladen werden:", e);
          return [] as RadarEntry[];
        }),
        apiService.getFeed(activeScope, me.name).catch((e) => {
          console.warn("Feed konnte nicht geladen werden:", e);
          return [] as FeedItem[];
        }),
      ]);

      setRadarEntries(radar);

      // Sort descending + deduplicate
      const sorted = [...fetchedFeed].sort(
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
      setRadarLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadFeedData(scope);
    }, [scope])
  );

  // Other people's activity doesn't otherwise show up until you leave and
  // re-enter this tab — poll while it's mounted so it feels live.
  useEffect(() => {
    const interval = setInterval(() => loadFeedData(scope), 15000);
    return () => clearInterval(interval);
  }, [scope]);

  const handleOpenMap = async () => {
    await triggerHaptic("light");
    router.push("/map");
  };

  const handleScopeChange = async (nextScope: FeedScope) => {
    if (nextScope === scope) return;
    await triggerHaptic("light");
    setScope(nextScope);
    setLoading(true);
    loadFeedData(nextScope);
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await triggerHaptic("light");
    await loadFeedData(scope);
    setRefreshing(false);
  }, [scope]);

  const handleDeletePost = (item: FeedItem) => {
    const question = item.image
      ? "Diesen Beitrag samt Foto löschen? Das lässt sich nicht rückgängig machen."
      : "Diesen Beitrag löschen? Das lässt sich nicht rückgängig machen.";

    const remove = async () => {
      try {
        await triggerHaptic("medium");
        await apiService.deletePost(item.id);
        // Sofort aus der Liste nehmen statt auf den nächsten Ladevorgang zu
        // warten — bei einem Foto, das man loswerden will, zählt genau das.
        setFeedItems((items) => items.filter((i) => i.id !== item.id));
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Beitrag konnte nicht gelöscht werden.";
        if (Platform.OS === "web") window.alert(msg);
        else Alert.alert("Fehler", msg);
      }
    };

    // Alert.alert ist auf react-native-web ein No-op — ohne diesen Zweig
    // erschiene die Rückfrage im Browser nie und nichts würde passieren.
    if (Platform.OS === "web") {
      if (window.confirm(question)) remove();
      return;
    }
    Alert.alert("Beitrag löschen", question, [
      { text: "Abbrechen", style: "cancel" },
      { text: "Löschen", style: "destructive", onPress: remove },
    ]);
  };

  const handleSubmitReport = async () => {
    if (!reportTarget || !reportReason) return;
    setReportSubmitting(true);
    try {
      await apiService.reportContent({
        reportedUserId: reportTarget.userId,
        contentType: "post",
        contentId: reportTarget.id,
        reason: reportReason,
      });
      setReportTarget(null);
      setReportReason(null);
      // Alert.alert is a no-op on web, so the confirmation has to go through
      // window.alert there.
      const msg = "Danke, die Meldung ist bei uns eingegangen. Wir sehen sie uns an.";
      if (Platform.OS === "web") window.alert(msg);
      else Alert.alert("Meldung eingegangen", msg);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Meldung konnte nicht gesendet werden.";
      if (Platform.OS === "web") window.alert(msg);
      else Alert.alert("Fehler", msg);
    } finally {
      setReportSubmitting(false);
    }
  };

  const handleCreatePost = async () => {
    if (!inputText.trim() || !currentUser) return;
    setIsSubmitting(true);
    try {
      await triggerHaptic("success");
      // A status update goes to the author's friends, not to a group. It used
      // to be posted against the hardcoded group id "group-1", which no user
      // is a member of.
      await apiService.createPost(inputText.trim(), "friends", currentUser.id);
      setInputText("");
      await loadFeedData(scope);
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
    // Everything reaching this point is already scope-filtered server-side,
    // so the tag just reflects which feed you're looking at.
    return scope === "groups" ? "[Gruppe]" : "[Freund]";
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
        {/* Freunde-Radar. Die Karte klappte hier früher mit 450 px Höhe auf und
            schob den eigentlichen Feed aus dem Bild — sie liegt jetzt auf einer
            eigenen Route und wird von hier aus geöffnet. */}
        <FriendsRadar entries={radarEntries} loading={radarLoading} onOpenMap={handleOpenMap} />

        {/* Umschalter: Freunde- vs. Gruppen-Feed */}
        <View className="flex-row bg-slate-900 border border-white/5 rounded-2xl p-1 mb-5">
          {([
            { key: "friends" as const, label: "Freunde", icon: "people" },
            { key: "groups" as const, label: "Gruppen", icon: "people-circle" },
          ]).map((tab) => {
            const isActive = scope === tab.key;
            return (
              <TouchableOpacity
                key={tab.key}
                onPress={() => handleScopeChange(tab.key)}
                className={`flex-1 py-2.5 rounded-xl flex-row items-center justify-center ${
                  isActive ? "bg-white/5 border border-white/10" : ""
                }`}
              >
                <Ionicons
                  name={tab.icon as any}
                  size={13}
                  color={isActive ? "#22d3ee" : "#64748b"}
                />
                <Text
                  className={`text-xs font-black uppercase tracking-wider ml-1.5 ${
                    isActive ? "text-cyan-400" : "text-slate-500"
                  }`}
                >
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Status creator box */}
        {currentUser && (
          <View className="bg-white/5 border border-white/10 p-4 rounded-3xl mb-5">
            <Text className="text-slate-500 text-[9px] font-black uppercase tracking-wider mb-2">
              Status teilen
            </Text>
            <View className="flex-row items-center space-x-3">
              <Avatar
                uri={currentUser.avatar}
                name={currentUser.name}
                size={36}
                className="border border-white/10"
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
              {scope === "groups" ? "Noch nichts aus deinen Gruppen" : "Noch keine Einträge vorhanden"}
            </Text>
            <Text className="text-slate-400 text-[11px] font-medium text-center leading-relaxed">
              {scope === "groups"
                ? "Erstelle eine Gruppe oder tritt einer bei, um die Aktivität deiner Crew zu sehen!"
                : "Teile deinen ersten Status mit deinen Freunden oder logge ein Getränk!"}
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
                    <Avatar
                      uri={item.userAvatar}
                      name={item.username}
                      size={40}
                      className="border border-white/10"
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

                    {/* Beweisfoto. Feste Höhe mit cover, damit ein Hochformat
                        die Feed-Karte nicht auf Bildschirmhöhe aufzieht. */}
                    {item.image && (
                      <Image
                        source={{ uri: item.image }}
                        style={{ width: "100%", height: 200 }}
                        className="rounded-2xl mb-2.5 bg-slate-950"
                        resizeMode="cover"
                        accessibilityLabel={`Beweisfoto von ${item.username}`}
                      />
                    )}
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
                      <View className="flex-row items-center">
                        <Text className="text-slate-500 text-[8px] font-bold">
                          {new Date(item.timestamp).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}{" "}
                          Uhr
                        </Text>
                        {/* Reporting has to sit on the content itself — a
                            report buried in a settings menu doesn't meet the
                            stores' "reachable where the content is". */}
                        {!isMe && !isSystem && (
                          <TouchableOpacity
                            onPress={() => {
                              triggerHaptic("light");
                              setReportTarget(item);
                              setReportReason(null);
                            }}
                            accessibilityLabel={`Beitrag von ${item.username} melden`}
                            className="ml-2 w-6 h-6 items-center justify-center"
                          >
                            <Ionicons name="flag-outline" size={11} color="#64748b" />
                          </TouchableOpacity>
                        )}

                        {/* Löschen sitzt an derselben Stelle wie das Melden
                            fremder Beiträge — beides gehört an den Inhalt,
                            nicht in ein Menü. Systembeiträge (Level-Ups)
                            gehören niemandem und sind nicht löschbar. */}
                        {isMe && !isSystem && (
                          <TouchableOpacity
                            onPress={() => handleDeletePost(item)}
                            accessibilityLabel="Eigenen Beitrag löschen"
                            className="ml-2 w-6 h-6 items-center justify-center"
                          >
                            <Ionicons name="trash-outline" size={11} color="#64748b" />
                          </TouchableOpacity>
                        )}
                      </View>
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
                <Avatar
                  uri={item.userAvatar}
                  name={item.username}
                  size={40}
                  className="border border-white/10"
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

      {/* Reporting a post. Deliberately reachable straight from the item so
          the path from "this is offensive" to "reported" is one tap. */}
      <Modal visible={!!reportTarget} animationType="slide" transparent>
        <View className="flex-1 bg-black/70 justify-end">
          <View className="bg-slate-900 border-t border-white/10 rounded-t-3xl p-6 pb-10">
            <Text className="text-white text-base font-black mb-1">Beitrag melden</Text>
            <Text className="text-slate-400 text-[11px] leading-4 mb-5" numberOfLines={3}>
              Von {reportTarget?.username}: „{reportTarget?.text}“
            </Text>

            {(Object.keys(REPORT_REASON_LABELS) as ReportReason[]).map((reason) => (
              <TouchableOpacity
                key={reason}
                onPress={() => setReportReason(reason)}
                className={`flex-row items-center py-3.5 px-4 rounded-2xl mb-2 border ${
                  reportReason === reason
                    ? "bg-amber-400/10 border-amber-400/40"
                    : "bg-slate-950/60 border-white/5"
                }`}
              >
                <Ionicons
                  name={reportReason === reason ? "radio-button-on" : "radio-button-off"}
                  size={16}
                  color={reportReason === reason ? "#fbbf24" : "#64748b"}
                />
                <Text
                  className={`text-xs font-bold ml-3 ${
                    reportReason === reason ? "text-amber-400" : "text-slate-300"
                  }`}
                >
                  {REPORT_REASON_LABELS[reason]}
                </Text>
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              onPress={handleSubmitReport}
              disabled={!reportReason || reportSubmitting}
              className="w-full bg-amber-400 py-3.5 rounded-2xl items-center mt-3 active:scale-95 disabled:opacity-40"
            >
              {reportSubmitting ? (
                <ActivityIndicator color="#020617" />
              ) : (
                <Text className="text-slate-950 font-black text-xs uppercase tracking-wider">
                  Meldung absenden
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setReportTarget(null)} className="mt-3 py-3 items-center">
              <Text className="text-slate-400 text-xs font-black uppercase tracking-wider">Abbrechen</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}
