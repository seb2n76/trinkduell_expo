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
import * as ImagePicker from "expo-image-picker";
import { apiService } from "@/services/api";
import { triggerHaptic } from "@/services/haptics";
import {
  User,
  FeedItem,
  FeedScope,
  Group,
  RadarEntry,
  ReportReason,
  REPORT_REASON_LABELS,
} from "@/services/mockData";
import { Ionicons } from "@expo/vector-icons";
import { Avatar } from "@/components/Avatar";
import { FriendsRadarSkeleton, FeedItemSkeleton } from "@/components/Skeleton";
import { useThemeColors, type ThemeColors } from "@/services/theme";
import { uploadImage } from "@/services/upload";

// ─────────────────────────────────────────────
// Freunde-Radar: wer ist gerade unterwegs?
// ─────────────────────────────────────────────
const radarStatusStyles = (c: ThemeColors) =>
  ({
    active: { dot: c.success, label: "Gerade aktiv", ring: "border-success/50" },
    recent: { dot: c.warning, label: "Vor kurzem", ring: "border-warning/40" },
    idle: { dot: c.contentFaint, label: "Ruhig", ring: "border-line" },
  }) as const;

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
  const c = useThemeColors();
  const RADAR_STATUS_STYLES = radarStatusStyles(c);
  const activeCount = entries.filter((e) => e.status === "active").length;

  return (
    <View className="bg-surface/90 border border-accent/20 rounded-3xl p-5 mb-5 shadow-2xl overflow-hidden relative">
      <View className="absolute -right-8 -top-8 w-36 h-36 rounded-full bg-accent/10 blur-2xl pointer-events-none" />

      <View className="flex-row items-center justify-between mb-4">
        <View className="flex-row items-center space-x-3">
          <View className="w-10 h-10 rounded-2xl bg-accent/10 border border-accent/30 items-center justify-center shadow-md">
            <Ionicons name="radio" size={20} color={c.accent} />
          </View>
          <View className="ml-3">
            <Text className="text-content text-base font-black tracking-wide">Freunde-Radar</Text>
            <Text className="text-accent-ink text-[10px] font-bold uppercase tracking-wider">
              Wer ist gerade unterwegs?
            </Text>
          </View>
        </View>

        {activeCount > 0 && (
          <View className="bg-success/10 border border-success/30 px-2.5 py-1 rounded-full">
            <Text className="text-success text-[9px] font-black uppercase tracking-widest">
              {activeCount} aktiv
            </Text>
          </View>
        )}
      </View>

      {loading ? (
        <FriendsRadarSkeleton />
      ) : entries.length === 0 ? (
        <Text className="text-content-muted text-xs leading-relaxed font-medium">
          Noch keine Freunde hinzugefügt. Füge unter Menü → Freunde welche hinzu, um zu sehen, wer
          gerade unterwegs ist. 🍻
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
                    className="absolute bottom-0 right-0 w-4 h-4 rounded-full border-2 border-line"
                  />
                </View>

                <Text className="text-content text-[10px] font-black mt-1.5 text-center" numberOfLines={1}>
                  {entry.username}
                </Text>
                <Text className="text-content-faint text-[8px] font-semibold text-center" numberOfLines={1}>
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
        className="flex-row items-center justify-between mt-4 pt-3 border-t border-line"
      >
        <View className="flex-row items-center">
          <Ionicons name="map-outline" size={13} color={c.accent} />
          <Text className="text-accent-ink text-[10px] font-black uppercase tracking-wider ml-1.5">
            Karte öffnen
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={14} color={c.accent} />
      </TouchableOpacity>
    </View>
  );
}

// ─────────────────────────────────────────────
// Interactive Reactions Bar (Pills on Feed Cards)
// ─────────────────────────────────────────────
function FeedReactionsBar({
  item,
  currentUserId,
  onReact,
}: {
  item: FeedItem;
  currentUserId?: string;
  onReact: (itemId: string, emoji: "cheers" | "fire" | "water") => void;
}) {
  const [showMore, setShowMore] = useState(false);

  const cheersList = item.reactions?.cheers || [];
  const fireList = item.reactions?.fire || [];
  const waterList = item.reactions?.water || [];

  const hasCheered = currentUserId ? cheersList.includes(currentUserId) : false;
  const hasFired = currentUserId ? fireList.includes(currentUserId) : false;
  const hasWatered = currentUserId ? waterList.includes(currentUserId) : false;

  return (
    <View className="flex-row items-center flex-wrap pt-2.5 mt-2.5 border-t border-line/60 gap-1.5">
      {/* 🍻 Main Prost Button */}
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => onReact(item.id, "cheers")}
        className={`flex-row items-center px-2.5 py-1 rounded-full border transition-all ${
          hasCheered
            ? "bg-amber-400/20 border-amber-400/60"
            : "bg-surface-alt/40 border-line hover:border-line-strong"
        }`}
      >
        <Text className="text-xs mr-1">🍻</Text>
        <Text
          className={`text-[10px] font-black uppercase tracking-wider ${
            hasCheered ? "text-amber-400" : "text-content-faint"
          }`}
        >
          Prost{cheersList.length > 0 ? ` · ${cheersList.length}` : ""}
        </Text>
      </TouchableOpacity>

      {/* 🔥 Fire Reaction (if reacted or tray open) */}
      {(fireList.length > 0 || showMore || hasFired) && (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => onReact(item.id, "fire")}
          className={`flex-row items-center px-2 py-1 rounded-full border ${
            hasFired
              ? "bg-rose-500/20 border-rose-500/60"
              : "bg-surface-alt/40 border-line"
          }`}
        >
          <Text className="text-xs mr-1">🔥</Text>
          {fireList.length > 0 && (
            <Text
              className={`text-[10px] font-black ${
                hasFired ? "text-rose-400" : "text-content-faint"
              }`}
            >
              {fireList.length}
            </Text>
          )}
        </TouchableOpacity>
      )}

      {/* 💧 Water Reaction (if reacted or tray open) */}
      {(waterList.length > 0 || showMore || hasWatered) && (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => onReact(item.id, "water")}
          className={`flex-row items-center px-2 py-1 rounded-full border ${
            hasWatered
              ? "bg-sky-400/20 border-sky-400/60"
              : "bg-surface-alt/40 border-line"
          }`}
        >
          <Text className="text-xs mr-1">💧</Text>
          {waterList.length > 0 && (
            <Text
              className={`text-[10px] font-black ${
                hasWatered ? "text-sky-400" : "text-content-faint"
              }`}
            >
              {waterList.length}
            </Text>
          )}
        </TouchableOpacity>
      )}

      {/* Toggle emoji tray */}
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => {
          triggerHaptic("light");
          setShowMore(!showMore);
        }}
        className="w-6 h-6 rounded-full bg-surface-alt/30 border border-line items-center justify-center"
      >
        <Ionicons
          name={showMore ? "close" : "add"}
          size={12}
          color="#94a3b8"
        />
      </TouchableOpacity>
    </View>
  );
}

// ─────────────────────────────────────────────
// Main Screen: Live Activity Feed
// ─────────────────────────────────────────────
export default function LivePulseFeed() {
  const c = useThemeColors();
  const router = useRouter();
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  const [reportTarget, setReportTarget] = useState<FeedItem | null>(null);
  const [reportReason, setReportReason] = useState<ReportReason | null>(null);
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [radarEntries, setRadarEntries] = useState<RadarEntry[]>([]);
  const [radarLoading, setRadarLoading] = useState(true);
  const [scope, setScope] = useState<FeedScope>("friends");
  // null = alle eigenen Gruppen zusammen, sonst genau diese eine.
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [myGroups, setMyGroups] = useState<Group[]>([]);
  const [showImageSource, setShowImageSource] = useState(false);
  const [inputText, setInputText] = useState("");
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadFeedData = async (activeScope: FeedScope, groupId: string | null = null) => {
    try {
      const me = await apiService.getCurrentUser();
      if (!me) {
        setLoading(false);
        setRadarLoading(false);
        return;
      }

      setCurrentUser(me);

      const [radar, fetchedFeed, groups] = await Promise.all([
        apiService.getRadar(me.name).catch((e) => {
          console.warn("Radar konnte nicht geladen werden:", e);
          return [] as RadarEntry[];
        }),
        apiService.getFeed(activeScope, me.name, groupId).catch((e) => {
          console.warn("Feed konnte nicht geladen werden:", e);
          return [] as FeedItem[];
        }),
        apiService.getGroups().catch(() => [] as Group[]),
      ]);

      setRadarEntries(radar);
      setMyGroups(groups.filter((g) => (g.memberIds || []).includes(me.id)));

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
      loadFeedData(scope, selectedGroupId);
    }, [scope, selectedGroupId])
  );

  useEffect(() => {
    const interval = setInterval(() => loadFeedData(scope, selectedGroupId), 15000);
    return () => clearInterval(interval);
  }, [scope, selectedGroupId]);

  const handleOpenMap = async () => {
    await triggerHaptic("light");
    router.push("/map");
  };

  /** Umschalten zwischen Freunden, allen Gruppen und einer einzelnen Gruppe. */
  const handleFilterChange = async (nextScope: FeedScope, groupId: string | null) => {
    if (nextScope === scope && groupId === selectedGroupId) return;
    await triggerHaptic("light");
    setScope(nextScope);
    setSelectedGroupId(groupId);
    setLoading(true);
    loadFeedData(nextScope, groupId);
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await triggerHaptic("light");
    await loadFeedData(scope, selectedGroupId);
    setRefreshing(false);
  }, [scope, selectedGroupId]);

  /**
   * Foto aus der Galerie wählen oder direkt aufnehmen.
   *
   * Bis August 2026 gab es hier ausschließlich die Galerie — auf einer Party
   * ist das genau der falsche Weg herum: das Foto entsteht im Moment, nicht
   * vorher. Im Browser gibt es keine Kamera über diesen Weg, dort bleibt es
   * bei der Galerie.
   */
  const pickFrom = async (quelle: "kamera" | "galerie") => {
    triggerHaptic("light");
    try {
      const permission =
        quelle === "kamera"
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        const msg =
          quelle === "kamera"
            ? "Für Aufnahmen wird der Zugriff auf die Kamera benötigt."
            : "Berechtigung für die Fotogalerie wird benötigt.";
        if (Platform.OS === "web") window.alert(msg);
        else Alert.alert("Zugriff verweigert", msg);
        return;
      }

      const optionen = {
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 3] as [number, number],
        quality: 0.8,
      };
      const result =
        quelle === "kamera"
          ? await ImagePicker.launchCameraAsync(optionen)
          : await ImagePicker.launchImageLibraryAsync(optionen);

      if (!result.canceled && result.assets && result.assets[0]) {
        setSelectedImage(result.assets[0].uri);
        triggerHaptic("success");
      }
    } catch (err) {
      console.warn("Fehler bei Bildauswahl:", err);
    }
  };

  const handlePickImage = async () => {
    // Im Browser kennt expo-image-picker keine Kamera — die Auswahl waere
    // dort eine Sackgasse.
    if (Platform.OS === "web") {
      await pickFrom("galerie");
      return;
    }
    setShowImageSource(true);
  };

  // Handle React to feed item
  const handleReact = async (itemId: string, emoji: "cheers" | "fire" | "water") => {
    if (!currentUser) return;
    triggerHaptic("medium");

    // Optimistic UI Update
    setFeedItems((prev) =>
      prev.map((item) => {
        if (item.id !== itemId) return item;
        const currentReactions = item.reactions || { cheers: [], fire: [], water: [] };
        const emojiList = currentReactions[emoji] || [];
        const isReacted = emojiList.includes(currentUser.id);
        const updatedList = isReacted
          ? emojiList.filter((id) => id !== currentUser.id)
          : [...emojiList, currentUser.id];

        return {
          ...item,
          reactions: {
            ...currentReactions,
            [emoji]: updatedList,
          },
        };
      })
    );

    try {
      await apiService.toggleReaction(itemId, emoji, currentUser.id);
    } catch (err) {
      console.warn("Reaction failed, will refresh on next poll:", err);
    }
  };

  const handleDeletePost = (item: FeedItem) => {
    const question = item.image
      ? "Diesen Beitrag samt Foto löschen? Das lässt sich nicht rückgängig machen."
      : "Diesen Beitrag löschen? Das lässt sich nicht rückgängig machen.";

    const remove = async () => {
      try {
        await triggerHaptic("medium");
        await apiService.deletePost(item.id);
        setFeedItems((items) => items.filter((i) => i.id !== item.id));
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Beitrag konnte nicht gelöscht werden.";
        if (Platform.OS === "web") window.alert(msg);
        else Alert.alert("Fehler", msg);
      }
    };

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
    if ((!inputText.trim() && !selectedImage) || !currentUser) return;
    setIsSubmitting(true);
    try {
      let uploadedUrl: string | undefined = undefined;

      if (selectedImage) {
        try {
          uploadedUrl = await uploadImage(selectedImage, "proof");
        } catch {
          // Fallback to local URI in case cloud storage is not connected
          uploadedUrl = selectedImage;
        }
      }

      await triggerHaptic("success");
      // Beitrag geht dorthin, wo man gerade hinschaut. Vorher landete er
      // IMMER bei den Freunden — auch wenn man gerade eine Gruppe offen
      // hatte, wo er dann nie auftauchte. Genau das machte die Gruppen
      // unverständlich.
      await apiService.createPost(
        inputText.trim() || (selectedImage ? "📸 Schnappschuss geteilt" : ""),
        selectedGroupId ? "group" : "friends",
        selectedGroupId || currentUser.id,
        uploadedUrl
      );
      setInputText("");
      setSelectedImage(null);
      await loadFeedData(scope, selectedGroupId);
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
      return "bg-accent/10 border-accent/20 text-accent-ink";
    if (tagText === "[Erfolg]")
      return "bg-warning/10 border-warning/20 text-warning";
    if (tagText === "[Gruppe]")
      return "bg-accent-2/10 border-accent-2/20 text-accent-2-ink";
    return "bg-surface-alt/10 border-line-strong/20 text-content-muted";
  };

  const getNeonTagText = (item: FeedItem) => {
    if (item.is_water) return "[Hydro-Pulse]";
    if ((item.alcohol_grams || 0) > 15 || (item.volume_ml || 0) >= 500)
      return "[Erfolg]";
    return scope === "groups" ? "[Gruppe]" : "[Freund]";
  };

  return (
    <View className="flex-1 bg-bg">
      <ScrollView
        className="flex-1 px-5 pt-3"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={c.accent}
            colors={[c.accent]}
          />
        }
      >
        {/* Freunde-Radar */}
        <FriendsRadar entries={radarEntries} loading={radarLoading} onOpenMap={handleOpenMap} />

        {/* Filterleiste: Freunde, alle Gruppen, oder eine einzelne Gruppe.
            Vorher gab es nur zwei Knöpfe, und "Gruppen" warf sämtliche
            Gruppen zusammen — bei mehr als einer war nicht mehr erkennbar,
            was wozu gehört. Waagerecht scrollbar, damit auch acht Gruppen
            hineinpassen. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="mb-5 -mx-1"
          contentContainerStyle={{ paddingHorizontal: 4, gap: 8 }}
        >
          {[
            { key: "friends" as const, groupId: null, label: "Freunde", icon: "people" },
            ...(myGroups.length > 0
              ? [
                  {
                    key: "groups" as const,
                    groupId: null,
                    label: "Alle Gruppen",
                    icon: "people-circle",
                  },
                ]
              : []),
            ...myGroups.map((g) => ({
              key: "groups" as const,
              groupId: g.id,
              label: g.name,
              icon: "people-circle-outline",
            })),
          ].map((tab) => {
            const isActive = scope === tab.key && selectedGroupId === tab.groupId;
            return (
              <TouchableOpacity
                key={`${tab.key}-${tab.groupId ?? "alle"}`}
                onPress={() => handleFilterChange(tab.key, tab.groupId)}
                className={`px-3.5 py-2.5 rounded-2xl flex-row items-center border ${
                  isActive ? "bg-accent/10 border-accent/50" : "bg-surface border-line"
                }`}
              >
                <Ionicons
                  name={tab.icon as any}
                  size={13}
                  color={isActive ? c.accent : c.contentFaint}
                />
                <Text
                  className={`text-xs font-black uppercase tracking-wider ml-1.5 ${
                    isActive ? "text-accent-ink" : "text-content-faint"
                  }`}
                  numberOfLines={1}
                >
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Status Creator Box */}
        {currentUser && (
          <View className="bg-surface border border-line p-4 rounded-3xl mb-5 shadow-sm">
            <View className="flex-row items-center justify-between mb-2">
              {/* Sagt vor dem Tippen, wo der Beitrag landet. */}
              <Text className="text-content-faint text-[9px] font-black uppercase tracking-wider flex-1 mr-2" numberOfLines={1}>
                {selectedGroupId
                  ? `An „${myGroups.find((g) => g.id === selectedGroupId)?.name ?? "Gruppe"}“`
                  : "An deine Freunde"}
              </Text>
              {selectedImage && (
                <View className="bg-accent/20 px-2 py-0.5 rounded-full">
                  <Text className="text-accent text-[8px] font-black uppercase">Foto angehängt</Text>
                </View>
              )}
            </View>

            {/* Photo Thumbnail Preview (if picked) */}
            {selectedImage && (
              <View className="relative mb-3 self-start">
                <Image
                  source={{ uri: selectedImage }}
                  className="w-20 h-20 rounded-2xl border border-accent/40 bg-surface-alt"
                  resizeMode="cover"
                />
                <TouchableOpacity
                  onPress={() => setSelectedImage(null)}
                  className="absolute -top-1.5 -right-1.5 bg-rose-500 w-5 h-5 rounded-full items-center justify-center shadow"
                >
                  <Ionicons name="close" size={12} color="#ffffff" />
                </TouchableOpacity>
              </View>
            )}

            <View className="flex-row items-center space-x-2">
              <Avatar
                uri={currentUser.avatar}
                name={currentUser.name}
                size={36}
                className="border border-line"
              />
              <TextInput
                placeholder="Was geht ab bei dir?..."
                placeholderTextColor={c.contentFaint}
                value={inputText}
                onChangeText={setInputText}
                maxLength={100}
                className="flex-1 bg-surface border border-line rounded-2xl px-4 py-2.5 text-content font-bold text-xs"
              />

              {/* Photo Button */}
              <TouchableOpacity
                onPress={handlePickImage}
                className="bg-surface border border-line p-2.5 rounded-2xl active:scale-95 items-center justify-center"
              >
                <Ionicons
                  name="camera-outline"
                  size={18}
                  color={selectedImage ? c.accent : c.contentFaint}
                />
              </TouchableOpacity>

              {/* Submit Post Button */}
              <TouchableOpacity
                onPress={handleCreatePost}
                disabled={isSubmitting || (!inputText.trim() && !selectedImage)}
                className="bg-accent p-2.5 rounded-2xl active:scale-95 disabled:opacity-40"
              >
                {isSubmitting ? (
                  <ActivityIndicator size="small" color={c.onAccent} />
                ) : (
                  <Ionicons name="send" size={16} color={c.onAccent} />
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Activities List Header */}
        <Text className="text-content-faint text-[10px] font-black uppercase tracking-widest mb-3">
          Live-Aktivitäten
        </Text>

        {loading ? (
          <View className="mb-6">
            <FeedItemSkeleton />
            <FeedItemSkeleton />
            <FeedItemSkeleton />
          </View>
        ) : feedItems.length === 0 ? (
          <View className="py-14 items-center justify-center bg-surface border border-line rounded-3xl p-6 mb-8">
            <Ionicons name="chatbubbles-outline" size={36} color={c.contentFaint} style={{ marginBottom: 12 }} />
            <Text className="text-content text-xs font-black uppercase tracking-wider text-center mb-1">
              {scope === "groups" ? "Noch nichts aus deinen Gruppen" : "Noch keine Einträge vorhanden"}
            </Text>
            <Text className="text-content-muted text-[11px] font-medium text-center leading-relaxed">
              {scope === "groups"
                ? "Erstelle eine Gruppe oder tritt einer bei, um die Aktivität deiner Crew zu sehen!"
                : "Teile deinen ersten Status mit deinen Freunden oder logge ein Getränk!"}
            </Text>
          </View>
        ) : (
          feedItems.map((item) => {
            const isMe = item.userId === currentUser?.id;
            const isHighlight =
              item.userId === "system" ||
              item.text?.includes("LEVEL UP") ||
              item.text?.includes("Duell") ||
              item.text?.includes("Königshof");

            if (item.type === "post") {
              const isSystem = item.userId === "system";
              const tagColor = isHighlight
                ? "bg-amber-400/20 border-amber-400/40 text-amber-400"
                : isSystem
                ? "bg-warning/10 border-warning/20 text-warning"
                : "bg-accent/10 border-accent/20 text-accent-ink";
              const tagLabel = isHighlight ? "[Highlight 🏆]" : isSystem ? "[Erfolg]" : "[Status]";
              const titleText = isHighlight
                ? "Party-Highlight"
                : isSystem
                ? "System-Meldung"
                : isMe
                ? "Dein Status"
                : `${item.username} teilt`;

              return (
                <View
                  key={item.id}
                  className={`bg-surface border p-4 rounded-3xl mb-3 shadow-lg flex-row space-x-3 ${
                    isHighlight
                      ? "border-amber-400/50 bg-amber-500/5"
                      : "border-line"
                  }`}
                >
                  {isHighlight || isSystem ? (
                    <View className="w-10 h-10 rounded-2xl bg-amber-400/20 border border-amber-400/40 items-center justify-center">
                      <Ionicons name="trophy" size={20} color="#fbbf24" />
                    </View>
                  ) : (
                    <Avatar
                      uri={item.userAvatar}
                      name={item.username}
                      size={40}
                      className="border border-line"
                    />
                  )}
                  <View className="flex-1">
                    <View className="flex-row items-center justify-between flex-wrap mb-1.5">
                      <Text className="text-content text-xs font-black">{titleText}</Text>
                      <View className={`border px-1.5 py-0.5 rounded ${tagColor}`}>
                        <Text className="text-[7px] font-black uppercase tracking-widest leading-none">
                          {tagLabel}
                        </Text>
                      </View>
                    </View>
                    <Text className="text-content text-xs font-semibold leading-relaxed mb-2.5">
                      {item.text}
                    </Text>

                    {/* Foto.
                        Bewusst groß und im 4:3-Format statt der früheren
                        200-Pixel-Leiste: ein Schnappschuss ist der einzige
                        Inhalt hier, den man wirklich ANSCHAUT — der Rest
                        wird gelesen. Ein Bild in Briefmarkengröße lädt
                        niemanden zum Hinsehen ein. */}
                    {item.image && (
                      <Image
                        source={{ uri: item.image }}
                        style={{ width: "100%", aspectRatio: 4 / 3 }}
                        className="rounded-2xl mb-2.5 bg-surface-alt"
                        resizeMode="cover"
                        accessibilityLabel={`Foto von ${item.username}`}
                      />
                    )}

                    <View className="flex-row items-center justify-between">
                      <View className="flex-row items-center space-x-1.5">
                        <Ionicons
                          name={isHighlight ? "star" : isSystem ? "trophy" : "chatbubble-ellipses"}
                          size={11}
                          color={isHighlight ? "#fbbf24" : isSystem ? c.warning : c.accent}
                        />
                        <Text className="text-content-faint text-[8px] font-extrabold uppercase">
                          {isHighlight ? "SPOTLIGHT" : isSystem ? "LEVEL-UP" : "PIN-STATUS"}
                        </Text>
                      </View>
                      <View className="flex-row items-center">
                        <Text className="text-content-faint text-[8px] font-bold">
                          {new Date(item.timestamp).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}{" "}
                          Uhr
                        </Text>
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
                            <Ionicons name="flag-outline" size={11} color={c.contentFaint} />
                          </TouchableOpacity>
                        )}
                        {isMe && !isSystem && (
                          <TouchableOpacity
                            onPress={() => handleDeletePost(item)}
                            accessibilityLabel="Eigenen Beitrag löschen"
                            className="ml-2 w-6 h-6 items-center justify-center"
                          >
                            <Ionicons name="trash-outline" size={11} color={c.contentFaint} />
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>

                    {/* Interactive Reactions Bar */}
                    <FeedReactionsBar
                      item={item}
                      currentUserId={currentUser?.id}
                      onReact={handleReact}
                    />
                  </View>
                </View>
              );
            }

            // Drink Log Item
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
                className="bg-surface border border-line p-4 rounded-3xl mb-3 shadow-lg flex-row space-x-3"
              >
                <Avatar
                  uri={item.userAvatar}
                  name={item.username}
                  size={40}
                  className="border border-line"
                />
                <View className="flex-1">
                  <View className="flex-row items-center justify-between flex-wrap mb-1">
                    <Text className="text-content text-xs font-black">{titleText}</Text>
                    <View className={`border px-1.5 py-0.5 rounded ${getTagStyle(tagText)}`}>
                      <Text className="text-[7px] font-black uppercase tracking-widest leading-none">
                        {tagText}
                      </Text>
                    </View>
                  </View>
                  <Text className="text-content-muted text-xs font-medium leading-relaxed mb-2.5">
                    {detailText}
                  </Text>
                  <View className="flex-row items-center justify-between">
                    <View className="flex-row items-center space-x-1.5">
                      <Ionicons
                        name={item.is_water ? "water" : "beer"}
                        size={11}
                        color={item.is_water ? c.accent : c.warning}
                      />
                      <Text className="text-content-faint text-[8px] font-extrabold uppercase">
                        {item.is_water ? "HYDRATION" : "ALKOHOL"}
                      </Text>
                    </View>
                    <Text className="text-content-faint text-[8px] font-bold">
                      {new Date(item.timestamp).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      Uhr
                    </Text>
                  </View>

                  {/* Interactive Reactions Bar on Drink Logs */}
                  <FeedReactionsBar
                    item={item}
                    currentUserId={currentUser?.id}
                    onReact={handleReact}
                  />
                </View>
              </View>
            );
          })
        )}
        <View className="h-10" />
      </ScrollView>

      {/* Reporting Modal */}
      <Modal visible={!!reportTarget} animationType="slide" transparent>
        <View className="flex-1 bg-black/70 justify-end">
          <View className="bg-surface border-t border-line rounded-t-3xl p-6 pb-10">
            <Text className="text-content text-base font-black mb-1">Beitrag melden</Text>
            <Text className="text-content-muted text-[11px] leading-4 mb-5" numberOfLines={3}>
              Von {reportTarget?.username}: „{reportTarget?.text}“
            </Text>

            {(Object.keys(REPORT_REASON_LABELS) as ReportReason[]).map((reason) => (
              <TouchableOpacity
                key={reason}
                onPress={() => setReportReason(reason)}
                className={`flex-row items-center py-3.5 px-4 rounded-2xl mb-2 border ${
                  reportReason === reason
                    ? "bg-warning/10 border-warning/40"
                    : "bg-surface-alt/60 border-line"
                }`}
              >
                <Ionicons
                  name={reportReason === reason ? "radio-button-on" : "radio-button-off"}
                  size={16}
                  color={reportReason === reason ? c.warning : c.contentFaint}
                />
                <Text
                  className={`text-xs font-bold ml-3 ${
                    reportReason === reason ? "text-warning" : "text-content-muted"
                  }`}
                >
                  {REPORT_REASON_LABELS[reason]}
                </Text>
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              onPress={handleSubmitReport}
              disabled={!reportReason || reportSubmitting}
              className="w-full bg-warning py-3.5 rounded-2xl items-center mt-3 active:scale-95 disabled:opacity-40"
            >
              {reportSubmitting ? (
                <ActivityIndicator color={c.onAccent} />
              ) : (
                <Text className="text-on-accent font-black text-xs uppercase tracking-wider">
                  Meldung absenden
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setReportTarget(null)} className="mt-3 py-3 items-center">
              <Text className="text-content-muted text-xs font-black uppercase tracking-wider">Abbrechen</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Kamera oder Galerie?
          Auf einer Party entsteht das Foto im Moment — deshalb steht die
          Kamera oben und ist der offensichtliche Weg. */}
      <Modal visible={showImageSource} animationType="fade" transparent>
        <View className="flex-1 bg-black/80 justify-end">
          <View className="bg-surface border-t border-line rounded-t-3xl p-5 pb-8">
            <Text className="text-content text-sm font-black uppercase tracking-wider text-center mb-4">
              Foto hinzufügen
            </Text>

            <TouchableOpacity
              onPress={() => {
                setShowImageSource(false);
                pickFrom("kamera");
              }}
              className="flex-row items-center bg-bg border border-line p-4 rounded-2xl mb-3"
            >
              <Ionicons name="camera" size={20} color={c.accent} />
              <View className="ml-3 flex-1">
                <Text className="text-content text-sm font-black">Kamera</Text>
                <Text className="text-content-faint text-[11px] font-medium">
                  Jetzt aufnehmen
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={c.contentFaint} />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                setShowImageSource(false);
                pickFrom("galerie");
              }}
              className="flex-row items-center bg-bg border border-line p-4 rounded-2xl"
            >
              <Ionicons name="images" size={20} color={c.accent} />
              <View className="ml-3 flex-1">
                <Text className="text-content text-sm font-black">Galerie</Text>
                <Text className="text-content-faint text-[11px] font-medium">
                  Vorhandenes Foto wählen
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={c.contentFaint} />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setShowImageSource(false)}
              className="mt-4 py-3 items-center"
            >
              <Text className="text-content-muted text-xs font-black uppercase tracking-wider">
                Abbrechen
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}
