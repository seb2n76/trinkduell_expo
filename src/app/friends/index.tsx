import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Modal,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiService } from "@/services/api";
import {
  User,
  Group,
  Event,
  ReportReason,
  REPORT_REASON_LABELS,
} from "@/services/mockData";
import { Avatar } from "@/components/Avatar";
import { triggerHaptic } from "@/services/haptics";
import { notify, confirmAction } from "@/services/dialogs";
import { useUnread } from "@/components/UnreadProvider";
import { useThemeColors } from "@/services/theme";
import { KeyboardSafe, KeyboardSheet, SHEET_ANIMATION } from "@/components/KeyboardSafe";

type TabKey = "friends" | "groups" | "events";

const TABS: { key: TabKey; label: string; icon: React.ComponentProps<typeof Ionicons>["name"] }[] = [
  { key: "friends", label: "Freunde", icon: "people-outline" },
  { key: "groups", label: "Gruppen", icon: "people-circle-outline" },
  { key: "events", label: "Events", icon: "flame-outline" },
];

/**
 * Verbleibende Zeit als kurzer Text, plus ob das Event schon vorbei ist.
 *
 * Der Server filtert abgelaufene Events nicht heraus — sie bleiben in der
 * Liste, damit man sieht, woran man teilgenommen hat. Die Unterscheidung
 * passiert hier.
 */
const eventRestzeit = (endTimestamp: string) => {
  const rest = new Date(endTimestamp).getTime() - Date.now();
  if (rest <= 0) return { vorbei: true, text: "beendet" };
  const stunden = Math.floor(rest / 3600000);
  const minuten = Math.floor((rest % 3600000) / 60000);
  return {
    vorbei: false,
    text: stunden > 0 ? `noch ${stunden} Std ${minuten} Min` : `noch ${minuten} Min`,
  };
};

/**
 * Freunde, Gruppen und Events.
 *
 * Drei Reiter statt eines langen Dialogs: vorher standen Gruppen- und
 * Eventliste unbeweglich über der Freundesliste, deren Scrollbereich dadurch
 * mit jeder weiteren Gruppe schrumpfte — bei ein paar Einträgen blieb von der
 * Freundesliste nichts Sichtbares übrig. Jeder Reiter hat jetzt die volle
 * Höhe und seinen eigenen Scrollbereich.
 */
export default function FriendsScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const { unreadFor } = useUnread();

  const [tab, setTab] = useState<TabKey>("friends");
  const [dbUser, setDbUser] = useState<User | null>(null);
  const [friendsList, setFriendsList] = useState<User[]>([]);
  const [pendingRequests, setPendingRequests] = useState<User[]>([]);
  const [groupsList, setGroupsList] = useState<Group[]>([]);
  const [eventsList, setEventsList] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);

  // Nutzersuche
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Aktionen auf eine andere Person
  const [actionTargetUser, setActionTargetUser] = useState<User | null>(null);
  const [reportTargetUser, setReportTargetUser] = useState<User | null>(null);
  const [reportReason, setReportReason] = useState<ReportReason | null>(null);
  const [reportDetails, setReportDetails] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);

  // Gruppe erstellen
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [groupBusy, setGroupBusy] = useState(false);

  // Event erstellen
  const [showCreateEvent, setShowCreateEvent] = useState(false);
  const [newEventName, setNewEventName] = useState("");
  const [newEventHours, setNewEventHours] = useState("6");
  const [eventBusy, setEventBusy] = useState(false);
  const [eventError, setEventError] = useState("");
  const [eventInviteCode, setEventInviteCode] = useState<string | null>(null);

  // Beitreten per Code. Ein Dialog für beide: Gruppen und Events
  // unterscheiden sich hier nur im Text und in der aufgerufenen Route.
  const [codeModalMode, setCodeModalMode] = useState<"group" | "event" | null>(null);
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinError, setJoinError] = useState("");

  const loadAll = useCallback(async () => {
    try {
      const currentUser = await apiService.getCurrentUser();
      setDbUser(currentUser);

      const [friendData, groups, events] = await Promise.all([
        apiService.getFriends(currentUser.name),
        // Gruppen kommen aus derselben Ansicht: /api/groups liefert seit der
        // Autorisierungsrunde nur noch die eigenen, es ist also keine
        // zusätzliche Filterung nötig.
        apiService.getGroups(),
        apiService.getEvents().catch((e) => {
          console.warn("Events konnten nicht geladen werden:", e);
          return [] as Event[];
        }),
      ]);

      setFriendsList(friendData.friends || []);
      setPendingRequests(friendData.pending || []);
      setGroupsList(groups);
      setEventsList(events);
    } catch (e) {
      console.error("Failed to load friends screen:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadAll();
    }, [loadAll])
  );

  // Live-Suche
  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = await apiService.searchUsers(query);
        setSearchResults(results.filter((u) => u.id !== dbUser?.id));
      } catch (e) {
        console.error("Live user search error:", e);
      } finally {
        setIsSearching(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [searchQuery, dbUser]);

  // ── Freunde ─────────────────────────────────────────────────────────────

  const handleSendFriendRequest = async (targetUsername: string) => {
    if (!dbUser || !targetUsername) return;
    if (targetUsername.toLowerCase() === dbUser.name.toLowerCase()) {
      notify("Fehler", "Du kannst dir nicht selbst eine Anfrage schicken!");
      return;
    }

    try {
      await triggerHaptic("success");
      await apiService.sendFriendRequest(dbUser.name, targetUsername);
      notify("Erfolg", `Freundschaftsanfrage an ${targetUsername} gesendet!`);
      setSearchQuery("");
      setSearchResults([]);
      await loadAll();
    } catch (e) {
      await triggerHaptic("error");
      notify("Fehler", e instanceof Error ? e.message : "Anfrage konnte nicht gesendet werden.");
    }
  };

  const handleAcceptFriendRequest = async (senderName: string) => {
    if (!dbUser) return;
    try {
      await triggerHaptic("success");
      await apiService.acceptFriendRequest(senderName, dbUser.name);
      notify("Erfolg", `Freundschaftsanfrage von ${senderName} angenommen!`);
      await loadAll();
    } catch (e) {
      await triggerHaptic("error");
      notify("Fehler", e instanceof Error ? e.message : "Anfrage konnte nicht angenommen werden.");
    }
  };

  const handleRemoveFriend = (friend: User) => {
    confirmAction(
      "Freund entfernen",
      `${friend.name} aus deiner Freundesliste entfernen? Ihr seht dann gegenseitig eure Aktivitäten und Standorte nicht mehr.`,
      async () => {
        try {
          await apiService.removeFriend(friend.name);
          setActionTargetUser(null);
          notify("Entfernt", `${friend.name} ist nicht mehr in deiner Freundesliste.`);
          await loadAll();
        } catch (e) {
          notify("Fehler", e instanceof Error ? e.message : "Konnte nicht entfernt werden.");
        }
      },
      "Entfernen"
    );
  };

  const handleBlockUser = (target: User) => {
    confirmAction(
      "Nutzer blockieren",
      `${target.name} blockieren? Ihr seht euch gegenseitig nicht mehr — weder im Feed, auf der Karte noch in der Rangliste. Eine bestehende Freundschaft wird aufgelöst.`,
      async () => {
        try {
          await apiService.blockUser(target.id);
          setActionTargetUser(null);
          notify("Blockiert", `${target.name} wurde blockiert.`);
          await loadAll();
        } catch (e) {
          notify("Fehler", e instanceof Error ? e.message : "Konnte nicht blockiert werden.");
        }
      },
      "Blockieren"
    );
  };

  const handleSubmitReport = async () => {
    if (!reportTargetUser || !reportReason) return;
    setReportSubmitting(true);
    try {
      await apiService.reportContent({
        reportedUserId: reportTargetUser.id,
        contentType: "user",
        reason: reportReason,
        details: reportDetails.trim() || undefined,
      });
      setReportTargetUser(null);
      setReportReason(null);
      setReportDetails("");
      notify(
        "Meldung eingegangen",
        "Danke. Wir sehen uns die Meldung an und melden uns, falls wir Rückfragen haben. Wenn du die Person nicht mehr sehen möchtest, kannst du sie zusätzlich blockieren."
      );
    } catch (e) {
      notify("Fehler", e instanceof Error ? e.message : "Meldung konnte nicht gesendet werden.");
    } finally {
      setReportSubmitting(false);
    }
  };

  const openDirectChat = (friend: User) => {
    triggerHaptic("light");
    router.push({ pathname: "/chat/[id]", params: { id: friend.id, type: "dm", name: friend.name } });
  };

  const openGroupChat = (group: Group) => {
    triggerHaptic("light");
    router.push({ pathname: "/chat/[id]", params: { id: group.id, type: "group", name: group.name } });
  };

  // ── Gruppen ─────────────────────────────────────────────────────────────

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) {
      notify("Fehler", "Bitte gib einen Gruppen-Namen ein!");
      return;
    }
    setGroupBusy(true);
    try {
      await triggerHaptic("success");
      await apiService.createGroup(newGroupName.trim(), selectedMemberIds);
      notify("Erfolg", `Gruppe "${newGroupName.trim()}" wurde erstellt!`);
      setShowCreateGroup(false);
      setNewGroupName("");
      setSelectedMemberIds([]);
      setGroupsList(await apiService.getGroups());
    } catch {
      notify("Fehler", "Gruppe konnte nicht erstellt werden.");
    } finally {
      setGroupBusy(false);
    }
  };

  // ── Events ──────────────────────────────────────────────────────────────

  const handleCreateEvent = async () => {
    setEventError("");
    const name = newEventName.trim();
    if (name.length < 2) {
      setEventError("Der Eventname braucht mindestens 2 Zeichen.");
      return;
    }
    const hours = parseInt(newEventHours, 10);
    if (!Number.isFinite(hours) || hours < 1 || hours > 168) {
      setEventError("Die Dauer muss zwischen 1 und 168 Stunden liegen.");
      return;
    }

    setEventBusy(true);
    try {
      const event = await apiService.createEvent(name, hours);
      await triggerHaptic("success");
      setEventsList(await apiService.getEvents());
      setNewEventName("");
      setNewEventHours("6");
      // Der Code ist der einzige Weg, jemanden dazuzuholen — deshalb bleibt der
      // Dialog offen und zeigt ihn, statt sich wortlos zu schließen.
      setEventInviteCode(event.inviteCode);
    } catch (error) {
      await triggerHaptic("error");
      setEventError(error instanceof Error ? error.message : "Event konnte nicht erstellt werden.");
    } finally {
      setEventBusy(false);
    }
  };

  const handleJoinByCode = async () => {
    setJoinError("");
    const code = joinCodeInput.trim();
    if (!code) {
      setJoinError("Bitte gib einen Code ein.");
      return;
    }

    setJoinBusy(true);
    try {
      if (codeModalMode === "event") {
        const event = await apiService.joinEventWithCode(code);
        // Der Offline-Fallback der Client-Bibliothek kann hier null liefern;
        // das ist kein Erfolg, auch wenn keine Ausnahme fliegt.
        if (!event) throw new Error("Ungültiger Code. Event nicht gefunden.");
        await triggerHaptic("success");
        setCodeModalMode(null);
        setJoinCodeInput("");
        setEventsList(await apiService.getEvents());
        notify("Willkommen", `Du bist jetzt bei "${event.name}" dabei.`);
        return;
      }

      const group = await apiService.joinGroupByCode(code);
      await triggerHaptic("success");
      setCodeModalMode(null);
      setJoinCodeInput("");
      setGroupsList(await apiService.getGroups());
      notify("Willkommen", `Du bist jetzt Mitglied von "${group.name}".`);
    } catch (error) {
      await triggerHaptic("error");
      setJoinError(
        error instanceof Error && error.message
          ? error.message
          : "Beitritt fehlgeschlagen. Bist du mit dem Internet verbunden?"
      );
    } finally {
      setJoinBusy(false);
    }
  };

  const openCodeDialog = (mode: "group" | "event") => {
    triggerHaptic("light");
    setJoinError("");
    setJoinCodeInput("");
    setCodeModalMode(mode);
  };

  // ── Reiter ──────────────────────────────────────────────────────────────

  const renderFriendsTab = () => (
    <View className="flex-1">
      {/* Suchfeld bleibt stehen, die Treffer scrollen darunter. */}
      <View className="px-4 pt-4 pb-3">
        <View className="flex-row items-center bg-surface border border-line rounded-2xl px-3">
          <Ionicons name="search" size={15} color={c.contentFaint} />
          <TextInput
            placeholder="Nutzer suchen..."
            placeholderTextColor={c.contentFaint}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Nutzer suchen"
            className="flex-1 py-3 px-2 text-content text-xs font-bold"
          />
          {isSearching && <ActivityIndicator size="small" color={c.accent2} />}
          {!isSearching && searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery("")} className="p-1">
              <Ionicons name="close-circle" size={16} color={c.contentFaint} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pb-12"
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {searchQuery.trim().length > 0 && (
          <View className="mb-6">
            <Text className="text-accent-ink text-[10px] font-black uppercase tracking-wider mb-3">
              {isSearching
                ? "Suche..."
                : searchResults.length > 0
                ? `Vorschläge (${searchResults.length})`
                : "Keine Treffer"}
            </Text>

            {!isSearching && searchResults.length === 0 && (
              <View className="bg-surface/60 border border-line rounded-2xl p-4">
                <Text className="text-content-muted text-[11px] text-center leading-relaxed">
                  Niemand mit diesem Namen gefunden. Achte auf die genaue Schreibweise — der Name
                  muss so eingegeben werden, wie er bei der Registrierung gewählt wurde.
                </Text>
              </View>
            )}

            {searchResults.map((resUser) => {
              const alreadyFriend = friendsList.some((f) => f.id === resUser.id);
              const incomingRequest = pendingRequests.some((p) => p.id === resUser.id);

              return (
                <View
                  key={resUser.id}
                  className="bg-surface border border-accent/20 rounded-2xl p-3 flex-row justify-between items-center mb-2"
                >
                  <View className="flex-row items-center flex-1 mr-2">
                    <Avatar
                      uri={resUser.avatar}
                      name={resUser.name}
                      size={36}
                      className="border border-line"
                    />
                    <View className="flex-1 ml-3">
                      <Text className="text-content text-xs font-black" numberOfLines={1}>
                        {resUser.name}
                      </Text>
                      <Text className="text-accent-ink text-[10px] font-bold">
                        Lv. {resUser.currentLevel || resUser.level || 1} ·{" "}
                        {resUser.title || "Neuling"}
                      </Text>
                    </View>
                  </View>

                  {alreadyFriend ? (
                    <View className="flex-row items-center px-3 py-1.5">
                      <Ionicons name="checkmark-circle" size={14} color={c.success} />
                      <Text className="text-success font-black text-[10px] uppercase ml-1">
                        Befreundet
                      </Text>
                    </View>
                  ) : incomingRequest ? (
                    <TouchableOpacity
                      onPress={() => handleAcceptFriendRequest(resUser.name)}
                      className="bg-accent-2 px-3 py-1.5 rounded-xl flex-row items-center"
                    >
                      <Ionicons name="checkmark" size={12} color={c.onAccent} />
                      <Text className="text-on-accent font-black text-[10px] uppercase ml-1">
                        Annehmen
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      onPress={() => handleSendFriendRequest(resUser.name)}
                      className="bg-accent px-3 py-1.5 rounded-xl flex-row items-center"
                    >
                      <Ionicons name="person-add" size={12} color={c.onAccent} />
                      <Text className="text-on-accent font-black text-[10px] uppercase ml-1">
                        Anfragen
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {loading ? (
          <View className="py-12 justify-center items-center">
            <ActivityIndicator size="large" color={c.accent2} />
          </View>
        ) : (
          <>
            {pendingRequests.length > 0 && (
              <View className="mb-6">
                <Text className="text-accent-2-ink text-[10px] font-black uppercase tracking-wider mb-3">
                  Ausstehende Anfragen ({pendingRequests.length})
                </Text>
                {pendingRequests.map((req) => (
                  <View
                    key={req.id}
                    className="bg-surface border border-accent-2/15 rounded-2xl p-3.5 flex-row justify-between items-center mb-2.5"
                  >
                    <View className="flex-row items-center flex-1 mr-2">
                      <Avatar
                        uri={req.avatar}
                        name={req.name}
                        size={32}
                        className="border border-line"
                      />
                      <View className="flex-1 ml-3">
                        <Text className="text-content text-xs font-black">{req.name}</Text>
                        <Text className="text-accent-2-ink text-[9px] font-bold">
                          @{req.name.toLowerCase().replace(/\s+/g, "_")}
                        </Text>
                      </View>
                    </View>
                    <TouchableOpacity
                      onPress={() => handleAcceptFriendRequest(req.name)}
                      className="bg-accent-2 px-3 py-1.5 rounded-xl flex-row items-center"
                    >
                      <Ionicons name="checkmark" size={14} color={c.onAccent} />
                      <Text className="text-on-accent font-black text-[10px] uppercase ml-1">
                        Annehmen
                      </Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            <Text className="text-content-muted text-[10px] font-black uppercase tracking-wider mb-3">
              Meine Freunde ({friendsList.length})
            </Text>
            {friendsList.length === 0 ? (
              <View className="py-12 bg-surface/40 border border-line rounded-2xl items-center justify-center">
                <Ionicons name="people-outline" size={32} color={c.contentFaint} />
                <Text className="text-content-faint text-xs font-bold text-center mt-2">
                  Noch keine Freunde hinzugefügt.
                </Text>
                <Text className="text-content-faint text-[10px] text-center mt-1 px-6 leading-4">
                  Such oben nach einem Namen, um eine Anfrage zu schicken.
                </Text>
              </View>
            ) : (
              friendsList.map((friend) => (
                <View
                  key={friend.id}
                  className="bg-surface border border-line rounded-2xl p-3.5 flex-row justify-between items-center mb-2.5"
                >
                  <View className="flex-row items-center flex-1 mr-2">
                    <Avatar
                      uri={friend.avatar}
                      name={friend.name}
                      size={36}
                      className="border border-line"
                    />
                    <View className="flex-1 ml-3">
                      <Text className="text-content text-xs font-black" numberOfLines={1}>
                        {friend.name}
                      </Text>
                      <Text className="text-accent-ink text-[9px] font-bold mt-0.5">
                        @{friend.name.toLowerCase().replace(/\s+/g, "_")}
                      </Text>
                    </View>
                  </View>

                  <View className="flex-row items-center">
                    <TouchableOpacity
                      onPress={() => openDirectChat(friend)}
                      accessibilityLabel={`Chat mit ${friend.name} öffnen`}
                      className="bg-accent/10 border border-accent/30 px-3 py-1.5 rounded-xl relative flex-row items-center"
                    >
                      <Ionicons name="chatbubble-ellipses-outline" size={14} color={c.accent} />
                      <Text className="text-accent-ink text-[10px] font-black uppercase ml-1">
                        Chat
                      </Text>
                      {unreadFor({ userId: friend.id }) > 0 && (
                        <View className="absolute -top-1.5 -right-1.5 bg-accent min-w-[16px] h-[16px] rounded-full items-center justify-center border border-surface-alt px-1">
                          <Text className="text-[9px] font-black text-on-accent">
                            {unreadFor({ userId: friend.id })}
                          </Text>
                        </View>
                      )}
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={() => {
                        triggerHaptic("light");
                        setActionTargetUser(friend);
                      }}
                      accessibilityLabel={`Optionen für ${friend.name}`}
                      className="ml-2 w-8 h-8 items-center justify-center rounded-xl bg-surface border border-line"
                    >
                      <Ionicons name="ellipsis-horizontal" size={14} color={c.contentMuted} />
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
          </>
        )}
      </ScrollView>
    </View>
  );

  const renderGroupsTab = () => (
    <View className="flex-1">
      <View className="px-4 pt-4 pb-3 flex-row" style={{ gap: 10 }}>
        <TouchableOpacity
          onPress={() => {
            triggerHaptic("light");
            setShowCreateGroup(true);
          }}
          className="flex-1 bg-accent-2/10 border border-accent-2/30 p-3 rounded-2xl flex-row items-center justify-center active:scale-95"
        >
          <Ionicons name="people-circle-outline" size={17} color={c.accent2} />
          <Text className="text-accent-2-ink font-black text-xs uppercase tracking-wider ml-2">
            Neue Gruppe
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => openCodeDialog("group")}
          accessibilityLabel="Gruppe per Code beitreten"
          className="bg-surface border border-line px-4 rounded-2xl items-center justify-center"
        >
          <Ionicons name="enter-outline" size={18} color={c.contentMuted} />
        </TouchableOpacity>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pb-12"
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View className="py-12 items-center">
            <ActivityIndicator size="large" color={c.accent2} />
          </View>
        ) : groupsList.length === 0 ? (
          <View className="py-12 bg-surface/40 border border-line rounded-2xl items-center justify-center">
            <Ionicons name="people-circle-outline" size={32} color={c.contentFaint} />
            <Text className="text-content-faint text-xs font-bold text-center mt-2">
              Noch keine Gruppe.
            </Text>
            <Text className="text-content-faint text-[10px] text-center mt-1 px-6 leading-4">
              Leg eine an oder tritt mit einem Einladungscode bei — Gruppen lassen sich bewusst
              nicht durchsuchen.
            </Text>
          </View>
        ) : (
          groupsList.map((group) => {
            const isAdmin = group.adminId === dbUser?.id;
            return (
              <View
                key={group.id}
                className="bg-surface border border-accent-2/15 rounded-2xl p-3.5 flex-row justify-between items-center mb-2.5"
              >
                <View className="flex-row items-center flex-1 mr-2">
                  <View className="w-9 h-9 rounded-xl bg-accent-2/10 border border-accent-2/20 items-center justify-center">
                    <Ionicons name="people" size={16} color={c.accent2} />
                  </View>
                  <View className="flex-1 ml-3">
                    <Text className="text-content text-xs font-black" numberOfLines={1}>
                      {group.name}
                    </Text>
                    <Text className="text-accent-2-ink text-[9px] font-bold mt-0.5">
                      {(group.memberIds || []).length}{" "}
                      {(group.memberIds || []).length === 1 ? "Mitglied" : "Mitglieder"}
                      {isAdmin ? " · Admin" : ""}
                    </Text>
                  </View>
                </View>

                <TouchableOpacity
                  onPress={() => {
                    triggerHaptic("light");
                    router.push({ pathname: "/friends/group/[id]", params: { id: group.id, name: group.name } });
                  }}
                  accessibilityLabel={`Gruppe ${group.name} verwalten`}
                  className="bg-surface-alt border border-line px-2.5 py-1.5 rounded-xl mr-1.5"
                >
                  <Ionicons name="settings-outline" size={14} color={c.contentMuted} />
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => openGroupChat(group)}
                  accessibilityLabel={`Gruppenchat ${group.name} öffnen`}
                  className="bg-accent-2/10 border border-accent-2/30 px-3 py-1.5 rounded-xl relative flex-row items-center"
                >
                  <Ionicons name="chatbubble-ellipses-outline" size={14} color={c.accent2} />
                  <Text className="text-accent-2-ink text-[10px] font-black uppercase ml-1">Chat</Text>
                  {unreadFor({ groupId: group.id }) > 0 && (
                    <View className="absolute -top-1.5 -right-1.5 bg-accent-2 min-w-[16px] h-[16px] rounded-full items-center justify-center border border-surface-alt px-1">
                      <Text className="text-[9px] font-black text-on-accent">
                        {unreadFor({ groupId: group.id })}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );

  const renderEventsTab = () => (
    <View className="flex-1">
      <View className="px-4 pt-4 pb-3 flex-row" style={{ gap: 10 }}>
        <TouchableOpacity
          onPress={() => {
            triggerHaptic("light");
            setEventError("");
            setEventInviteCode(null);
            setShowCreateEvent(true);
          }}
          className="flex-1 bg-warning/10 border border-warning/30 p-3 rounded-2xl flex-row items-center justify-center active:scale-95"
        >
          <Ionicons name="flame-outline" size={17} color={c.warning} />
          <Text className="text-warning font-black text-xs uppercase tracking-wider ml-2">
            Event starten
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => openCodeDialog("event")}
          accessibilityLabel="Event per Code beitreten"
          className="bg-surface border border-line px-4 rounded-2xl items-center justify-center"
        >
          <Ionicons name="enter-outline" size={18} color={c.contentMuted} />
        </TouchableOpacity>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pb-12"
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View className="py-12 items-center">
            <ActivityIndicator size="large" color={c.warning} />
          </View>
        ) : eventsList.length === 0 ? (
          <View className="py-12 bg-surface/40 border border-line rounded-2xl items-center justify-center">
            <Ionicons name="flame-outline" size={32} color={c.contentFaint} />
            <Text className="text-content-faint text-xs font-bold text-center mt-2">
              Noch kein Event.
            </Text>
            <Text className="text-content-faint text-[10px] text-center mt-1 px-6 leading-4">
              Starte eins für den Abend — die Teilnehmer kommen über einen Code dazu.
            </Text>
          </View>
        ) : (
          eventsList.map((ev) => {
            const rest = eventRestzeit(ev.endTimestamp);
            return (
              <View
                key={ev.id}
                className={`border rounded-2xl p-3.5 flex-row items-center mb-2.5 ${
                  rest.vorbei
                    ? "bg-surface/40 border-line"
                    : "bg-surface border-warning/20"
                }`}
              >
                <View
                  className={`w-9 h-9 rounded-xl items-center justify-center border ${
                    rest.vorbei ? "bg-surface-alt border-line" : "bg-warning/10 border-warning/25"
                  }`}
                >
                  <Ionicons
                    name={rest.vorbei ? "time-outline" : "flame"}
                    size={16}
                    color={rest.vorbei ? c.contentFaint : c.warning}
                  />
                </View>
                <View className="flex-1 ml-3">
                  <Text
                    className={`text-xs font-black ${rest.vorbei ? "text-content-faint" : "text-content"}`}
                    numberOfLines={1}
                  >
                    {ev.name}
                  </Text>
                  <Text
                    className={`text-[9px] font-bold mt-0.5 ${
                      rest.vorbei ? "text-content-faint" : "text-warning"
                    }`}
                  >
                    {(ev.memberIds || []).length} Teilnehmer · {rest.text}
                  </Text>
                </View>
                {ev.creatorId === dbUser?.id && !rest.vorbei && (
                  <View className="bg-surface-alt border border-line px-2.5 py-1 rounded-lg">
                    <Text
                      selectable
                      accessibilityLabel={`Einladungscode ${ev.inviteCode}`}
                      className="text-content-muted text-[10px] font-black tracking-widest"
                    >
                      {ev.inviteCode}
                    </Text>
                  </View>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );

  return (
    <KeyboardSafe>
    <View className="flex-1 bg-bg">
      {/* Reiterleiste. Steht fest; darunter bekommt jeder Reiter die volle
          Resthöhe für seinen eigenen Scrollbereich. */}
      <View className="flex-row bg-surface border-b border-line px-3 py-2" style={{ gap: 6 }}>
        {TABS.map((t) => {
          const active = tab === t.key;
          const anzahl =
            t.key === "friends"
              ? friendsList.length + pendingRequests.length
              : t.key === "groups"
              ? groupsList.length
              : eventsList.length;
          return (
            <TouchableOpacity
              key={t.key}
              onPress={() => {
                triggerHaptic("light");
                setTab(t.key);
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={t.label}
              className={`flex-1 py-2.5 rounded-xl flex-row items-center justify-center ${
                active ? "bg-surface border border-line" : ""
              }`}
            >
              <Ionicons name={t.icon} size={14} color={active ? c.accent : c.contentFaint} />
              <Text
                className={`text-[11px] font-black uppercase tracking-wider ml-1.5 ${
                  active ? "text-accent-ink" : "text-content-faint"
                }`}
              >
                {t.label}
              </Text>
              {anzahl > 0 && (
                <Text
                  className={`text-[10px] font-black ml-1 ${
                    active ? "text-accent-ink" : "text-content-faint"
                  }`}
                >
                  {anzahl}
                </Text>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {tab === "friends" ? renderFriendsTab() : tab === "groups" ? renderGroupsTab() : renderEventsTab()}

      {/* Aktionen auf eine andere Person. Melden und Blockieren sind
          Store-Pflicht für Apps mit nutzergenerierten Inhalten — und sie zählen
          nur, wenn sie dort erreichbar sind, wo die Inhalte stehen. */}
      <Modal visible={!!actionTargetUser} animationType="fade" transparent>
        <KeyboardSheet className="flex-1 bg-black/70 justify-end">
          <View className="bg-surface border-t border-line rounded-t-3xl p-6 pb-10">
            <View className="flex-row items-center mb-6">
              <Avatar
                uri={actionTargetUser?.avatar}
                name={actionTargetUser?.name}
                size={40}
                className="border border-line"
              />
              <Text className="text-content text-sm font-black ml-3 flex-1" numberOfLines={1}>
                {actionTargetUser?.name}
              </Text>
            </View>

            <TouchableOpacity
              onPress={() => actionTargetUser && handleRemoveFriend(actionTargetUser)}
              className="flex-row items-center py-4 border-b border-line"
            >
              <Ionicons name="person-remove-outline" size={18} color={c.content} />
              <Text className="text-content text-xs font-bold ml-3">Freund entfernen</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                const target = actionTargetUser;
                setActionTargetUser(null);
                setReportReason(null);
                setReportDetails("");
                setReportTargetUser(target);
              }}
              className="flex-row items-center py-4 border-b border-line"
            >
              <Ionicons name="flag-outline" size={18} color={c.warning} />
              <Text className="text-warning text-xs font-bold ml-3">Melden</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => actionTargetUser && handleBlockUser(actionTargetUser)}
              className="flex-row items-center py-4"
            >
              <Ionicons name="ban-outline" size={18} color={c.danger} />
              <Text className="text-danger text-xs font-bold ml-3">Blockieren</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setActionTargetUser(null)}
              className="mt-4 py-3.5 rounded-2xl bg-surface border border-line items-center"
            >
              <Text className="text-content-muted text-xs font-black uppercase tracking-wider">
                Abbrechen
              </Text>
            </TouchableOpacity>
          </View>
        </KeyboardSheet>
      </Modal>

      {/* Melden */}
      <Modal visible={!!reportTargetUser} animationType={SHEET_ANIMATION} transparent>
        <KeyboardSheet className="flex-1 bg-black/70 justify-end">
          <View className="bg-surface border-t border-line rounded-t-3xl p-6 pb-10">
            <Text className="text-content text-base font-black mb-1">
              {reportTargetUser?.name} melden
            </Text>
            <Text className="text-content-muted text-[11px] leading-4 mb-5">
              Wir sehen uns jede Meldung an. Bei Gefahr für Leib und Leben wende dich bitte
              zusätzlich an die Polizei.
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

            <TextInput
              placeholder="Was ist passiert? (optional)"
              placeholderTextColor="rgba(255,255,255,0.3)"
              value={reportDetails}
              onChangeText={setReportDetails}
              multiline
              maxLength={1000}
              className="bg-surface-alt/60 border border-line rounded-2xl px-4 py-3 text-content text-xs mt-2 mb-4 min-h-[72px]"
            />

            <TouchableOpacity
              onPress={handleSubmitReport}
              disabled={!reportReason || reportSubmitting}
              className="w-full bg-warning py-3.5 rounded-2xl items-center active:scale-95 disabled:opacity-40"
            >
              {reportSubmitting ? (
                <ActivityIndicator color={c.onAccent} />
              ) : (
                <Text className="text-on-accent font-black text-xs uppercase tracking-wider">
                  Meldung absenden
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setReportTargetUser(null)} className="mt-3 py-3 items-center">
              <Text className="text-content-muted text-xs font-black uppercase tracking-wider">
                Abbrechen
              </Text>
            </TouchableOpacity>
          </View>
        </KeyboardSheet>
      </Modal>

      {/* Gruppe erstellen */}
      <Modal
        visible={showCreateGroup}
        transparent
        animationType={SHEET_ANIMATION}
        onRequestClose={() => setShowCreateGroup(false)}
      >
        <KeyboardSheet className="flex-1 bg-black/85 justify-end">
          <View className="bg-surface-alt border-t border-accent-2/30 rounded-t-3xl p-6 pb-8">
            <View className="flex-row justify-between items-center mb-5">
              <Text className="text-content text-base font-black uppercase tracking-wider">
                Gruppe erstellen 👥
              </Text>
              <TouchableOpacity onPress={() => setShowCreateGroup(false)} className="p-1">
                <Ionicons name="close" size={24} color={c.contentFaint} />
              </TouchableOpacity>
            </View>

            <Text className="text-content-muted text-[10px] font-black uppercase tracking-wider mb-2">
              Gruppen-Name
            </Text>
            <TextInput
              placeholder="z. B. Stammtisch, Festival Crew 2026"
              placeholderTextColor={c.contentFaint}
              value={newGroupName}
              onChangeText={setNewGroupName}
              accessibilityLabel="Gruppen-Name"
              className="bg-surface border border-line rounded-2xl px-4 py-3 text-content font-bold text-xs mb-5"
            />

            <Text className="text-content-muted text-[10px] font-black uppercase tracking-wider mb-2">
              Freunde auswählen ({selectedMemberIds.length})
            </Text>

            <ScrollView className="max-h-48 mb-6" showsVerticalScrollIndicator={false}>
              {friendsList.length === 0 ? (
                <Text className="text-content-faint text-xs italic text-center py-4">
                  Füge zuerst Freunde hinzu!
                </Text>
              ) : (
                friendsList.map((f) => {
                  const isSelected = selectedMemberIds.includes(f.id);
                  return (
                    <TouchableOpacity
                      key={f.id}
                      onPress={() => {
                        triggerHaptic("light");
                        setSelectedMemberIds((prev) =>
                          isSelected ? prev.filter((id) => id !== f.id) : [...prev, f.id]
                        );
                      }}
                      className={`p-3 rounded-2xl border flex-row justify-between items-center mb-2 ${
                        isSelected ? "bg-accent-2/20 border-accent-2" : "bg-surface border-line"
                      }`}
                    >
                      <Text className="text-content text-xs font-bold">{f.name}</Text>
                      <Ionicons
                        name={isSelected ? "checkmark-circle" : "ellipse-outline"}
                        size={18}
                        color={isSelected ? c.accent2 : c.contentFaint}
                      />
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>

            <TouchableOpacity
              onPress={handleCreateGroup}
              disabled={!newGroupName.trim() || groupBusy}
              className="w-full bg-accent-2 py-3.5 rounded-2xl items-center active:scale-95 disabled:opacity-40"
            >
              {groupBusy ? (
                <ActivityIndicator size="small" color={c.onAccent} />
              ) : (
                <Text className="text-on-accent font-black text-xs uppercase tracking-wider">
                  Gruppe jetzt erstellen
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardSheet>
      </Modal>

      {/* Event starten */}
      <Modal
        visible={showCreateEvent}
        transparent
        animationType={SHEET_ANIMATION}
        onRequestClose={() => setShowCreateEvent(false)}
      >
        <KeyboardSheet className="flex-1 bg-black/85 justify-end">
          <View className="bg-surface-alt border-t border-warning/30 rounded-t-3xl p-6 pb-8">
            <View className="flex-row justify-between items-center mb-2">
              <Text className="text-content text-base font-black uppercase tracking-wider">
                {eventInviteCode ? "Event läuft 🔥" : "Event starten 🔥"}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setShowCreateEvent(false);
                  setEventInviteCode(null);
                  setEventError("");
                }}
                className="p-1"
              >
                <Ionicons name="close" size={24} color={c.contentFaint} />
              </TouchableOpacity>
            </View>

            {eventInviteCode ? (
              <>
                <Text className="text-content-muted text-[11px] leading-relaxed mb-4">
                  Gib diesen Code weiter — damit kommen deine Leute dazu.
                </Text>
                <View className="bg-warning/5 border border-warning/25 rounded-2xl p-4 mb-5 items-center">
                  <Text
                    selectable
                    accessibilityLabel={`Event-Code ${eventInviteCode}`}
                    className="text-content text-2xl font-black tracking-[6px]"
                  >
                    {eventInviteCode}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => {
                    setShowCreateEvent(false);
                    setEventInviteCode(null);
                  }}
                  className="bg-warning rounded-2xl py-3.5 items-center"
                >
                  <Text className="text-on-accent text-xs font-black uppercase tracking-wider">
                    Fertig
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text className="text-content-muted text-[11px] leading-relaxed mb-5">
                  Ein Event ist ein Abend mit festem Ende. Danach läuft es von selbst aus.
                </Text>

                <TextInput
                  value={newEventName}
                  onChangeText={setNewEventName}
                  placeholder="Name, z. B. Geburtstag Lisa"
                  placeholderTextColor={c.contentFaint}
                  maxLength={60}
                  accessibilityLabel="Eventname"
                  className="bg-surface border border-line rounded-2xl px-4 py-3.5 text-content text-sm mb-3"
                />

                <Text className="text-content-muted text-[10px] font-black uppercase tracking-wider mb-2">
                  Dauer
                </Text>
                <View className="flex-row mb-3" style={{ gap: 8 }}>
                  {["4", "6", "12", "24"].map((h) => {
                    const aktiv = newEventHours === h;
                    return (
                      <TouchableOpacity
                        key={h}
                        onPress={() => setNewEventHours(h)}
                        accessibilityLabel={`${h} Stunden`}
                        className={`flex-1 py-2.5 rounded-xl border items-center ${
                          aktiv ? "bg-warning/10 border-warning/40" : "bg-surface border-line"
                        }`}
                      >
                        <Text
                          className={`text-[11px] font-black ${
                            aktiv ? "text-warning" : "text-content-muted"
                          }`}
                        >
                          {h} Std
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {eventError ? (
                  <View className="bg-danger/10 border border-danger/30 rounded-2xl p-3 mb-3 flex-row items-start">
                    <Ionicons name="alert-circle" size={15} color={c.danger} />
                    <Text className="text-danger text-[11px] leading-4 ml-2 flex-1">
                      {eventError}
                    </Text>
                  </View>
                ) : null}

                <TouchableOpacity
                  onPress={handleCreateEvent}
                  disabled={eventBusy || !newEventName.trim()}
                  accessibilityLabel="Event anlegen"
                  className={`rounded-2xl py-3.5 items-center ${
                    eventBusy || !newEventName.trim() ? "bg-surface-alt" : "bg-warning"
                  }`}
                >
                  {eventBusy ? (
                    <ActivityIndicator size="small" color={c.onAccent} />
                  ) : (
                    <Text
                      className={`text-xs font-black uppercase tracking-wider ${
                        !newEventName.trim() ? "text-content-faint" : "text-on-accent"
                      }`}
                    >
                      Event starten
                    </Text>
                  )}
                </TouchableOpacity>
              </>
            )}
          </View>
        </KeyboardSheet>
      </Modal>

      {/* Beitreten per Code */}
      <Modal
        visible={codeModalMode !== null}
        transparent
        animationType={SHEET_ANIMATION}
        onRequestClose={() => setCodeModalMode(null)}
      >
        <KeyboardSheet className="flex-1 bg-black/85 justify-end">
          <View className="bg-surface-alt border-t border-accent-2/30 rounded-t-3xl p-6 pb-8">
            <View className="flex-row justify-between items-center mb-2">
              <Text className="text-content text-base font-black uppercase tracking-wider">
                {codeModalMode === "event" ? "Event beitreten" : "Gruppe beitreten"}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setCodeModalMode(null);
                  setJoinCodeInput("");
                  setJoinError("");
                }}
                className="p-1"
              >
                <Ionicons name="close" size={24} color={c.contentFaint} />
              </TouchableOpacity>
            </View>

            <Text className="text-content-muted text-[11px] leading-relaxed mb-5">
              {codeModalMode === "event"
                ? "Gib den Code ein, den du vom Gastgeber bekommen hast."
                : "Gib den Einladungscode ein, den du vom Gruppen-Admin bekommen hast. Gruppen lassen sich bewusst nicht durchsuchen."}
            </Text>

            <TextInput
              value={joinCodeInput}
              onChangeText={(t) => setJoinCodeInput(t.toUpperCase())}
              placeholder="z. B. A1B2C3D4"
              placeholderTextColor={c.contentFaint}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={32}
              onSubmitEditing={handleJoinByCode}
              accessibilityLabel="Einladungscode eingeben"
              className="bg-surface border border-line rounded-2xl px-4 py-3.5 text-content text-lg font-black tracking-[4px] mb-3"
            />

            {joinError ? (
              <View className="bg-danger/10 border border-danger/30 rounded-2xl p-3 mb-3 flex-row items-start">
                <Ionicons name="alert-circle" size={15} color={c.danger} />
                <Text className="text-danger text-[11px] leading-4 ml-2 flex-1">{joinError}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              onPress={handleJoinByCode}
              disabled={joinBusy || !joinCodeInput.trim()}
              accessibilityLabel="Mit Code beitreten"
              className={`rounded-2xl py-3.5 items-center ${
                joinBusy || !joinCodeInput.trim() ? "bg-surface-alt" : "bg-accent-2"
              }`}
            >
              {joinBusy ? (
                <ActivityIndicator size="small" color={c.onAccent} />
              ) : (
                <Text
                  className={`text-xs font-black uppercase tracking-wider ${
                    !joinCodeInput.trim() ? "text-content-faint" : "text-content"
                  }`}
                >
                  Beitreten
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardSheet>
      </Modal>
    </View>
    </KeyboardSafe>
  );
}
