import React, { useCallback, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiService, GroupMembers } from "@/services/api";
import { User } from "@/services/mockData";
import { triggerHaptic } from "@/services/haptics";
import { notify, confirmAction } from "@/services/dialogs";
import { useThemeColors } from "@/services/theme";

/**
 * Eine Gruppe verwalten.
 *
 * Eigener Screen statt Dialog im Dialog: die Ansicht wurde bisher aus dem
 * Freunde-Modal geöffnet und musste deshalb im JSX hinter ihm stehen, sonst
 * lag sie dahinter (Modal-Stapelung auf react-native-web). Als Route stellt
 * sich die Frage nicht mehr — und der Zurück-Weg ist der übliche.
 */
export default function GroupManageScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();

  const [members, setMembers] = useState<GroupMembers | null>(null);
  const [friends, setFriends] = useState<User[]>([]);
  const [meId, setMeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);

  const loadMembers = useCallback(async () => {
    try {
      setMembers(await apiService.getGroupMembers(id));
    } catch (error) {
      notify("Fehler", error instanceof Error ? error.message : "Mitglieder konnten nicht geladen werden.");
      setMembers(null);
    }
  }, [id]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const me = await apiService.getCurrentUser();
      setMeId(me.id);
      await loadMembers();
      const friendData = await apiService.getFriends(me.name);
      setFriends(friendData.friends || []);

      try {
        setInviteCode(await apiService.getGroupInvite(id));
      } catch {
        // Kein notify: für ein einfaches Mitglied ist die 403 der Normalfall,
        // nicht ein Fehler. Der Abschnitt bleibt dann einfach leer.
        setInviteCode(null);
      }
    } catch (error) {
      console.error("Failed to load group management screen:", error);
    } finally {
      setLoading(false);
    }
  }, [id, loadMembers]);

  useFocusEffect(
    useCallback(() => {
      loadAll();
    }, [loadAll])
  );

  const handleRotateInvite = () => {
    confirmAction(
      "Code erneuern?",
      "Der bisherige Code wird ungültig. Wer ihn hat, kommt damit nicht mehr herein — genau dafür ist das gedacht, wenn jemand die Gruppe verlassen musste.",
      async () => {
        setInviteBusy(true);
        try {
          setInviteCode(await apiService.rotateGroupInvite(id));
          await triggerHaptic("success");
        } catch (error) {
          await triggerHaptic("error");
          notify("Fehler", error instanceof Error ? error.message : "Code konnte nicht erneuert werden.");
        } finally {
          setInviteBusy(false);
        }
      },
      "Erneuern"
    );
  };

  const handleAddMember = async (user: User) => {
    setBusyUserId(user.id);
    try {
      await apiService.addGroupMember(id, user.id);
      await triggerHaptic("success");
      await loadMembers();
    } catch (error) {
      await triggerHaptic("error");
      notify("Fehler", error instanceof Error ? error.message : "Hinzufügen fehlgeschlagen.");
    } finally {
      setBusyUserId(null);
    }
  };

  const handleRemoveMember = (member: { id: string; name: string }) => {
    confirmAction(
      "Mitglied entfernen",
      `${member.name} wirklich aus "${name || "dieser Gruppe"}" entfernen?`,
      async () => {
        setBusyUserId(member.id);
        try {
          await apiService.removeGroupMember(id, member.id);
          await triggerHaptic("success");
          await loadMembers();
        } catch (error) {
          await triggerHaptic("error");
          notify("Fehler", error instanceof Error ? error.message : "Entfernen fehlgeschlagen.");
        } finally {
          setBusyUserId(null);
        }
      },
      "Entfernen"
    );
  };

  const handleLeaveGroup = () => {
    if (!meId) return;

    // Die Folgen unterscheiden sich deutlich, also steht in der Rückfrage auch
    // Verschiedenes: als Letzter löst man die Gruppe samt Chatverlauf auf, als
    // Admin gibt man die Rolle ab.
    const anzahl = members?.members.length ?? 0;
    const istAdmin = members?.isAdmin ?? false;
    const frage =
      anzahl <= 1
        ? `Du bist das letzte Mitglied. "${name || "Die Gruppe"}" wird mitsamt dem Chatverlauf gelöscht.`
        : istAdmin
        ? `Du gibst die Adminrolle an das dienstälteste Mitglied ab und verlässt "${name || "die Gruppe"}".`
        : `"${name || "Die Gruppe"}" wirklich verlassen?`;

    confirmAction(
      anzahl <= 1 ? "Gruppe auflösen" : "Gruppe verlassen",
      frage,
      async () => {
        setBusyUserId(meId);
        try {
          const res = await apiService.removeGroupMember(id, meId);
          await triggerHaptic("success");
          notify("Erledigt", res.groupDeleted ? "Die Gruppe wurde aufgelöst." : "Du hast die Gruppe verlassen.");
          router.back();
        } catch (error) {
          await triggerHaptic("error");
          notify("Fehler", error instanceof Error ? error.message : "Verlassen fehlgeschlagen.");
        } finally {
          setBusyUserId(null);
        }
      },
      anzahl <= 1 ? "Auflösen" : "Verlassen"
    );
  };

  const handleJoinRequest = async (userId: string, accept: boolean) => {
    setBusyUserId(userId);
    try {
      await apiService.handleJoinRequest(id, userId, accept);
      await triggerHaptic("success");
      await loadMembers();
    } catch (error) {
      await triggerHaptic("error");
      notify("Fehler", error instanceof Error ? error.message : "Anfrage konnte nicht bearbeitet werden.");
    } finally {
      setBusyUserId(null);
    }
  };

  /** Freunde, die noch nicht in der Gruppe sind — die Kandidaten zum Hinzufügen. */
  const addableFriends = friends.filter(
    (f) => !(members?.members || []).some((m) => m.id === f.id)
  );

  const isAdmin = members?.isAdmin ?? false;

  return (
    <View className="flex-1 bg-bg">
      <Stack.Screen options={{ title: name || "Gruppe" }} />

      {loading && !members ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={c.accent2} />
        </View>
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerClassName="px-4 pt-5 pb-16"
          showsVerticalScrollIndicator={false}
        >
          <View className="w-full self-center" style={{ maxWidth: 640 }}>
            <Text className="text-content-faint text-[10px] font-semibold mb-5 px-1">
              {isAdmin
                ? "Du bist Admin — du kannst Mitglieder hinzufügen und entfernen."
                : "Du bist Mitglied dieser Gruppe."}
            </Text>

            {/* Einladungscode — nur der Admin bekommt ihn vom Server */}
            {inviteCode && (
              <View className="mb-7">
                <Text className="text-content-faint text-[10px] font-black uppercase tracking-widest mb-2.5 px-1">
                  Einladungscode
                </Text>
                <View className="bg-accent/5 border border-accent/25 rounded-3xl p-4">
                  <Text
                    selectable
                    accessibilityLabel={`Einladungscode ${inviteCode}`}
                    className="text-content text-2xl font-black tracking-[6px] mb-2"
                  >
                    {inviteCode}
                  </Text>
                  <Text className="text-content-muted text-[10px] leading-4 mb-3">
                    Wer diesen Code eingibt, wird sofort Mitglied — ohne weitere Freigabe.
                  </Text>
                  <TouchableOpacity
                    onPress={handleRotateInvite}
                    disabled={inviteBusy}
                    accessibilityLabel="Einladungscode erneuern"
                    className="bg-surface-alt border border-line rounded-xl py-2.5 items-center flex-row justify-center"
                  >
                    {inviteBusy ? (
                      <ActivityIndicator size="small" color={c.accent} />
                    ) : (
                      <>
                        <Ionicons name="refresh" size={13} color={c.contentMuted} />
                        <Text className="text-content-muted text-[10px] font-black uppercase tracking-wider ml-1.5">
                          Code erneuern
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
                <Text className="text-content-faint text-[10px] leading-4 mt-2 px-1">
                  Nach einem Rauswurf erneuern — sonst kommt die Person mit dem alten Code einfach
                  zurück.
                </Text>
              </View>
            )}

            {/* Offene Beitrittsanfragen — nur der Admin sieht sie */}
            {isAdmin && (members?.pending.length ?? 0) > 0 && (
              <View className="mb-7">
                <Text className="text-warning text-[10px] font-black uppercase tracking-widest mb-2.5 px-1">
                  Offene Anfragen ({members?.pending.length})
                </Text>
                {members?.pending.map((p) => (
                  <View
                    key={p.id}
                    className="flex-row items-center bg-warning/5 border border-warning/20 rounded-2xl px-3.5 py-2.5 mb-2"
                  >
                    <Text className="text-content text-xs font-black flex-1" numberOfLines={1}>
                      {p.name}
                    </Text>
                    {busyUserId === p.id ? (
                      <ActivityIndicator size="small" color={c.warning} />
                    ) : (
                      <>
                        <TouchableOpacity
                          onPress={() => handleJoinRequest(p.id, false)}
                          accessibilityLabel={`${p.name} ablehnen`}
                          className="px-2.5 py-1.5"
                        >
                          <Text className="text-content-muted text-[10px] font-black uppercase">Nein</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => handleJoinRequest(p.id, true)}
                          accessibilityLabel={`${p.name} aufnehmen`}
                          className="bg-warning px-3 py-1.5 rounded-xl"
                        >
                          <Text className="text-on-accent text-[10px] font-black uppercase">
                            Aufnehmen
                          </Text>
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                ))}
              </View>
            )}

            {/* Mitglieder */}
            <View className="mb-7">
              <Text className="text-content-faint text-[10px] font-black uppercase tracking-widest mb-2.5 px-1">
                Mitglieder ({members?.members.length ?? 0})
              </Text>
              {members?.members.map((m) => {
                const binIch = m.id === meId;
                // Sich selbst entfernt man über "Gruppe verlassen" unten —
                // das erklärt die Folgen, dieser Knopf täte es wortlos.
                const darfEntfernen = isAdmin && !binIch;
                return (
                  <View
                    key={m.id}
                    className="flex-row items-center bg-surface border border-line rounded-2xl px-3.5 py-3 mb-2"
                  >
                    <View className="w-8 h-8 rounded-xl bg-accent-2/10 border border-accent-2/20 items-center justify-center">
                      <Ionicons name="person" size={14} color={c.accent2} />
                    </View>
                    <View className="flex-1 ml-3">
                      <Text className="text-content text-xs font-black" numberOfLines={1}>
                        {m.name}
                        {binIch ? " (du)" : ""}
                      </Text>
                      {m.isAdmin && (
                        <Text className="text-accent-2-ink text-[9px] font-black uppercase mt-0.5">
                          Admin
                        </Text>
                      )}
                    </View>
                    {busyUserId === m.id ? (
                      <ActivityIndicator size="small" color={c.danger} />
                    ) : darfEntfernen ? (
                      <TouchableOpacity
                        onPress={() => handleRemoveMember(m)}
                        accessibilityLabel={`${m.name} aus der Gruppe entfernen`}
                        className="p-2"
                      >
                        <Ionicons name="person-remove-outline" size={16} color={c.danger} />
                      </TouchableOpacity>
                    ) : null}
                  </View>
                );
              })}
            </View>

            {/* Freunde hinzufügen — nur der Admin */}
            {isAdmin && (
              <View className="mb-7">
                <Text className="text-content-faint text-[10px] font-black uppercase tracking-widest mb-2.5 px-1">
                  Freunde hinzufügen
                </Text>
                {addableFriends.length === 0 ? (
                  <Text className="text-content-faint text-[11px] font-medium py-2 px-1">
                    {friends.length === 0
                      ? "Du hast noch keine Freunde hinzugefügt."
                      : "Alle deine Freunde sind schon in dieser Gruppe."}
                  </Text>
                ) : (
                  addableFriends.map((f) => (
                    <TouchableOpacity
                      key={f.id}
                      onPress={() => handleAddMember(f)}
                      disabled={busyUserId === f.id}
                      accessibilityLabel={`${f.name} zur Gruppe hinzufügen`}
                      className="flex-row items-center bg-surface border border-line rounded-2xl px-3.5 py-3 mb-2"
                    >
                      <View className="w-8 h-8 rounded-xl bg-surface-alt border border-line items-center justify-center">
                        <Ionicons name="person-outline" size={14} color={c.contentFaint} />
                      </View>
                      <Text className="text-content text-xs font-black flex-1 ml-3" numberOfLines={1}>
                        {f.name}
                      </Text>
                      {busyUserId === f.id ? (
                        <ActivityIndicator size="small" color={c.accent2} />
                      ) : (
                        <Ionicons name="add-circle-outline" size={18} color={c.accent2} />
                      )}
                    </TouchableOpacity>
                  ))
                )}
              </View>
            )}

            <TouchableOpacity
              onPress={() => {
                triggerHaptic("light");
                router.push({ pathname: "/friends/quests/[id]", params: { id, name: name || "" } });
              }}
              accessibilityLabel="Quests dieser Gruppe"
              className="bg-success/10 border border-success/30 rounded-2xl py-3.5 items-center flex-row justify-center mb-7"
            >
              <Ionicons name="trophy-outline" size={16} color={c.success} />
              <Text className="text-success text-xs font-black uppercase tracking-wider ml-2">
                Quests
              </Text>
            </TouchableOpacity>

            {/* Abgesetzt: das Verlassen kann die Gruppe samt Chatverlauf
                löschen und steht deshalb nicht zwischen den Mitgliederzeilen. */}
            <View className="border-t border-line pt-6">
              <TouchableOpacity
                onPress={handleLeaveGroup}
                disabled={busyUserId === meId}
                accessibilityLabel="Gruppe verlassen"
                className="bg-danger/10 border border-danger/30 rounded-2xl py-3.5 items-center flex-row justify-center"
              >
                {busyUserId === meId ? (
                  <ActivityIndicator size="small" color={c.danger} />
                ) : (
                  <>
                    <Ionicons name="exit-outline" size={16} color={c.danger} />
                    <Text className="text-danger text-xs font-black uppercase tracking-wider ml-2">
                      {(members?.members.length ?? 0) <= 1 ? "Gruppe auflösen" : "Gruppe verlassen"}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      )}
    </View>
  );
}
