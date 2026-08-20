import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  TextInput,
  Alert,
  Modal,
  Platform,
  RefreshControl,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  apiService,
  AdminDashboardData,
  AdminUser,
  AdminRoom,
  ModerationReport,
  ReportStatus,
} from "@/services/api";
import { Drink } from "@/services/mockData";
import { triggerHaptic } from "@/services/haptics";
import { notify } from "@/services/dialogs";
import { useThemeColors } from "@/services/theme";
import { Avatar } from "@/components/Avatar";

type AdminTab = "dashboard" | "users" | "reports" | "drinks" | "broadcast";

const REPORT_GRUENDE: Record<string, string> = {
  belaestigung: "Belästigung",
  spam: "Spam",
  unangemessen: "Unangemessen",
  fake: "Fake-Profil",
  sonstiges: "Sonstiges",
};

export default function AdminConsoleScreen() {
  const c = useThemeColors();
  const [activeTab, setActiveTab] = useState<AdminTab>("dashboard");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Data States
  const [dashboardData, setDashboardData] = useState<AdminDashboardData | null>(null);
  const [activeRooms, setActiveRooms] = useState<AdminRoom[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [userQuery, setUserQuery] = useState("");
  const [userFilter, setUserFilter] = useState<"all" | "banned">("all");
  const [reports, setReports] = useState<ModerationReport[]>([]);
  const [reportFilter, setReportFilter] = useState<ReportStatus>("open");
  const [reportCounts, setReportCounts] = useState<Record<ReportStatus, number>>({
    open: 0,
    resolved: 0,
    dismissed: 0,
  });
  const [drinks, setDrinks] = useState<Drink[]>([]);
  const [drinkQuery, setDrinkQuery] = useState("");

  // Modals & Action States
  const [selectedDrink, setSelectedDrink] = useState<Drink | null>(null);
  const [editDrinkName, setEditDrinkName] = useState("");
  const [editDrinkVolume, setEditDrinkVolume] = useState("");
  const [editDrinkAbv, setEditDrinkAbv] = useState("");
  const [editDrinkCalories, setEditDrinkCalories] = useState("");
  const [editDrinkEan, setEditDrinkEan] = useState("");
  const [editDrinkHidden, setEditDrinkHidden] = useState(false);
  const [broadcastMessage, setBroadcastMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Load Tab Data
  const loadData = useCallback(async () => {
    try {
      if (activeTab === "dashboard") {
        const [dash, rooms] = await Promise.all([
          apiService.getAdminStats().catch(() => null),
          apiService.getAdminRooms().catch(() => []),
        ]);
        setDashboardData(dash);
        setActiveRooms(rooms);
      } else if (activeTab === "users") {
        const userList = await apiService.getAdminUsers({
          q: userQuery,
          filter: userFilter,
        });
        setUsers(userList);
      } else if (activeTab === "reports") {
        const inbox = await apiService.getReports(reportFilter);
        setReports(inbox.reports || []);
        if (inbox.counts) setReportCounts(inbox.counts);
      } else if (activeTab === "drinks") {
        const drinkList = await apiService.getAdminDrinks();
        setDrinks(drinkList);
      }
    } catch (err) {
      console.warn("Fehler beim Laden der Admin-Daten:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [activeTab, userQuery, userFilter, reportFilter]);

  useEffect(() => {
    setLoading(true);
    loadData();
  }, [loadData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await triggerHaptic("light");
    await loadData();
  };

  // User Actions
  const handleToggleBan = async (user: AdminUser) => {
    const actionName = user.banned ? "entsperren" : "sperren";
    const confirmMsg = `Möchtest du ${user.name} wirklich ${actionName}?`;

    const execute = async () => {
      try {
        await triggerHaptic("medium");
        await apiService.banUser(user.id, !user.banned);
        notify("Erfolg", `Nutzer ${user.name} wurde ${user.banned ? "entsperrt" : "gesperrt"}.`);
        loadData();
      } catch (err: any) {
        notify("Fehler", err?.message || "Aktion fehlgeschlagen.");
      }
    };

    if (Platform.OS === "web") {
      if (window.confirm(confirmMsg)) execute();
      return;
    }
    Alert.alert(actionName === "sperren" ? "Nutzer sperren" : "Nutzer entsperren", confirmMsg, [
      { text: "Abbrechen", style: "cancel" },
      { text: "Bestätigen", style: user.banned ? "default" : "destructive", onPress: execute },
    ]);
  };

  const handleResetStats = (user: AdminUser) => {
    const confirmMsg = `Möchtest du alle Punkte, Level und Logs von ${user.name} zurücksetzen (Anti-Cheat)?`;

    const execute = async () => {
      try {
        await triggerHaptic("heavy");
        await apiService.resetUserStats(user.id);
        notify("Zurückgesetzt", `Stats von ${user.name} wurden auf 0 / Level 1 gesetzt.`);
        loadData();
      } catch (err: any) {
        notify("Fehler", err?.message || "Fehler beim Zurücksetzen.");
      }
    };

    if (Platform.OS === "web") {
      if (window.confirm(confirmMsg)) execute();
      return;
    }
    Alert.alert("Stats zurücksetzen", confirmMsg, [
      { text: "Abbrechen", style: "cancel" },
      { text: "Zurücksetzen", style: "destructive", onPress: execute },
    ]);
  };

  const handleCleanAvatar = (user: AdminUser) => {
    const confirmMsg = `Möchtest du das Profilbild von ${user.name} entfernen?`;

    const execute = async () => {
      try {
        await triggerHaptic("medium");
        await apiService.cleanUserProfile(user.id);
        notify("Profil bereinigt", `Avatar von ${user.name} wurde entfernt.`);
        loadData();
      } catch (err: any) {
        notify("Fehler", err?.message || "Fehler beim Bereinigen.");
      }
    };

    if (Platform.OS === "web") {
      if (window.confirm(confirmMsg)) execute();
      return;
    }
    Alert.alert("Profilbild entfernen", confirmMsg, [
      { text: "Abbrechen", style: "cancel" },
      { text: "Entfernen", style: "destructive", onPress: execute },
    ]);
  };

  // Report Actions
  const handleReportStatus = async (reportId: string, status: ReportStatus) => {
    try {
      await triggerHaptic("light");
      await apiService.setReportStatus(reportId, status);
      loadData();
    } catch (err: any) {
      notify("Fehler", err?.message || "Status konnte nicht gesetzt werden.");
    }
  };

  const handleDeleteReportedPost = (report: ModerationReport) => {
    if (!report.contentExcerpt && report.contentType !== "post") return;
    const confirmMsg = "Möchtest du diesen Beitrag samt evtl. Beweisfoto unwiderruflich löschen?";

    const execute = async () => {
      try {
        await triggerHaptic("medium");
        await apiService.adminDeletePost(report.id);
        await apiService.setReportStatus(report.id, "resolved");
        notify("Gelöscht", "Der gemeldete Beitrag wurde aus dem Feed und Speicher entfernt.");
        loadData();
      } catch (err: any) {
        notify("Fehler", err?.message || "Beitrag konnte nicht gelöscht werden.");
      }
    };

    if (Platform.OS === "web") {
      if (window.confirm(confirmMsg)) execute();
      return;
    }
    Alert.alert("Beitrag löschen", confirmMsg, [
      { text: "Abbrechen", style: "cancel" },
      { text: "Löschen", style: "destructive", onPress: execute },
    ]);
  };

  // Room Actions
  const handleDeleteRoom = (code: string) => {
    const confirmMsg = `Möchtest du Raum ${code} wirklich zwangsweise beenden?`;

    const execute = async () => {
      try {
        await triggerHaptic("heavy");
        await apiService.adminDeleteRoom(code);
        notify("Raum geschlossen", `Der Party-Raum ${code} wurde beendet.`);
        loadData();
      } catch (err: any) {
        notify("Fehler", err?.message || "Raum konnte nicht geschlossen werden.");
      }
    };

    if (Platform.OS === "web") {
      if (window.confirm(confirmMsg)) execute();
      return;
    }
    Alert.alert("Raum beenden", confirmMsg, [
      { text: "Abbrechen", style: "cancel" },
      { text: "Beenden", style: "destructive", onPress: execute },
    ]);
  };

  // Drink Edit Actions
  const openEditDrink = (drink: Drink) => {
    setSelectedDrink(drink);
    setEditDrinkName(drink.name);
    setEditDrinkVolume(String(drink.volume));
    setEditDrinkAbv(String(drink.abv));
    setEditDrinkCalories(String(drink.calories || 0));
    setEditDrinkEan(drink.ean || "");
    setEditDrinkHidden(Boolean(drink.hidden));
  };

  const handleSaveDrink = async () => {
    if (!selectedDrink) return;
    setIsSubmitting(true);
    try {
      await triggerHaptic("success");
      await apiService.adminUpdateDrink(selectedDrink.id, {
        name: editDrinkName.trim(),
        volume: Number(editDrinkVolume) || selectedDrink.volume,
        abv: Number(editDrinkAbv) || selectedDrink.abv,
        calories: Number(editDrinkCalories) || selectedDrink.calories,
        ean: editDrinkEan.trim() || undefined,
        hidden: editDrinkHidden,
      });
      setSelectedDrink(null);
      notify("Gespeichert", "Getränk wurde erfolgreich aktualisiert.");
      loadData();
    } catch (err: any) {
      notify("Fehler", err?.message || "Getränk konnte nicht gespeichert werden.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Broadcast Action
  const handleSendBroadcast = async () => {
    if (!broadcastMessage.trim()) return;
    setIsSubmitting(true);
    try {
      await triggerHaptic("success");
      await apiService.sendAdminBroadcast(broadcastMessage.trim());
      setBroadcastMessage("");
      notify("Gesendet! 📢", "Die System-Mitteilung wurde im Feed veröffentlicht.");
    } catch (err: any) {
      notify("Fehler", err?.message || "Broadcast konnte nicht gesendet werden.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filtered Drinks
  const filteredDrinks = drinks.filter(
    (d) =>
      d.name.toLowerCase().includes(drinkQuery.toLowerCase()) ||
      (d.ean && d.ean.includes(drinkQuery))
  );

  return (
    <View className="flex-1 bg-bg">
      {/* Header Tabs */}
      <View className="bg-surface border-b border-line px-3 pt-2 pb-2">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row">
          {([
            { key: "dashboard" as const, label: "Dashboard", icon: "stats-chart" },
            { key: "users" as const, label: "Nutzer", icon: "people" },
            { key: "reports" as const, label: `Meldungen (${reportCounts.open})`, icon: "alert-circle" },
            { key: "drinks" as const, label: "Katalog", icon: "beer" },
            { key: "broadcast" as const, label: "Broadcast", icon: "megaphone" },
          ]).map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <TouchableOpacity
                key={tab.key}
                onPress={() => {
                  triggerHaptic("light");
                  setActiveTab(tab.key);
                }}
                className={`flex-row items-center px-3.5 py-2 mr-2 rounded-2xl border ${
                  isActive
                    ? "bg-warning/20 border-warning/60"
                    : "bg-surface-alt/40 border-line"
                }`}
              >
                <Ionicons
                  name={tab.icon as any}
                  size={14}
                  color={isActive ? c.warning : c.contentFaint}
                  style={{ marginRight: 6 }}
                />
                <Text
                  className={`text-xs font-black uppercase tracking-wider ${
                    isActive ? "text-warning" : "text-content-faint"
                  }`}
                >
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView
        className="flex-1 px-4 pt-4"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.warning} />
        }
      >
        {/* ========================================================================= */}
        {/* TAB 1: DASHBOARD                                                          */}
        {/* ========================================================================= */}
        {activeTab === "dashboard" && (
          <View className="pb-12">
            {loading ? (
              <ActivityIndicator size="large" color={c.warning} style={{ marginTop: 40 }} />
            ) : dashboardData ? (
              <>
                {/* 2x2 KPI Grid */}
                <View className="flex-row flex-wrap gap-3 mb-6">
                  {/* Total Accounts */}
                  <View className="flex-1 min-w-[45%] bg-surface border border-line p-4 rounded-3xl shadow-sm">
                    <View className="flex-row items-center justify-between mb-2">
                      <Text className="text-content-faint text-[9px] font-black uppercase tracking-wider">
                        Nutzer Gesamt
                      </Text>
                      <Ionicons name="people" size={16} color={c.accent} />
                    </View>
                    <Text className="text-content text-2xl font-black">
                      {dashboardData.stats.usersCount}
                    </Text>
                    {dashboardData.stats.bannedUsersCount > 0 && (
                      <Text className="text-danger text-[10px] font-bold mt-1">
                        {dashboardData.stats.bannedUsersCount} gesperrt
                      </Text>
                    )}
                  </View>

                  {/* Volume Tracked */}
                  <View className="flex-1 min-w-[45%] bg-surface border border-line p-4 rounded-3xl shadow-sm">
                    <View className="flex-row items-center justify-between mb-2">
                      <Text className="text-content-faint text-[9px] font-black uppercase tracking-wider">
                        Volumen getrunken
                      </Text>
                      <Ionicons name="beer" size={16} color={c.warning} />
                    </View>
                    <Text className="text-content text-2xl font-black">
                      {(dashboardData.stats.totalVolumeMl / 1000).toFixed(1)} L
                    </Text>
                    <Text className="text-content-faint text-[10px] font-bold mt-1">
                      {dashboardData.stats.logsCount} Logs erfasst
                    </Text>
                  </View>

                  {/* Open Reports */}
                  <View className="flex-1 min-w-[45%] bg-surface border border-line p-4 rounded-3xl shadow-sm">
                    <View className="flex-row items-center justify-between mb-2">
                      <Text className="text-content-faint text-[9px] font-black uppercase tracking-wider">
                        Meldungen
                      </Text>
                      <Ionicons name="alert-circle" size={16} color={c.warning} />
                    </View>
                    <Text
                      className={`text-2xl font-black ${
                        dashboardData.stats.openReportsCount > 0
                          ? "text-danger"
                          : "text-content"
                      }`}
                    >
                      {dashboardData.stats.openReportsCount}
                    </Text>
                    <Text className="text-content-faint text-[10px] font-bold mt-1">
                      {dashboardData.stats.reportsCount} gesamt
                    </Text>
                  </View>

                  {/* Active Duels */}
                  <View className="flex-1 min-w-[45%] bg-surface border border-line p-4 rounded-3xl shadow-sm">
                    <View className="flex-row items-center justify-between mb-2">
                      <Text className="text-content-faint text-[9px] font-black uppercase tracking-wider">
                        Aktive Duelle
                      </Text>
                      <Ionicons name="flash" size={16} color={c.success} />
                    </View>
                    <Text className="text-content text-2xl font-black">
                      {dashboardData.stats.activeDuelsCount}
                    </Text>
                    <Text className="text-content-faint text-[10px] font-bold mt-1">
                      {dashboardData.stats.duelsCount} Duelle gesamt
                    </Text>
                  </View>
                </View>

                {/* Active Party Lobbies & Story-RPGs */}
                <View className="bg-surface border border-line rounded-3xl p-5 mb-6 shadow-sm">
                  <View className="flex-row items-center justify-between mb-3">
                    <View className="flex-row items-center space-x-2">
                      <Ionicons name="game-controller" size={18} color={c.warning} />
                      <Text className="text-content text-sm font-black tracking-wide ml-2">
                        Live Party-Räume & Story-RPGs ({activeRooms.length})
                      </Text>
                    </View>
                  </View>

                  {activeRooms.length === 0 ? (
                    <Text className="text-content-muted text-xs font-medium py-2">
                      Aktuell keine aktiven Multi-Device Spielräume geöffnet.
                    </Text>
                  ) : (
                    activeRooms.map((room) => (
                      <View
                        key={room.code}
                        className="bg-surface-alt/40 border border-line rounded-2xl p-3.5 mb-2.5 flex-row items-center justify-between"
                      >
                        <View className="flex-1">
                          <View className="flex-row items-center space-x-2 mb-1">
                            <View className="bg-warning/20 px-2 py-0.5 rounded-md">
                              <Text className="text-warning text-xs font-black font-mono">
                                {room.code}
                              </Text>
                            </View>
                            <Text className="text-content text-xs font-bold ml-1.5">
                              {room.gameId}
                            </Text>
                          </View>
                          <Text className="text-content-faint text-[10px] font-medium">
                            Host: {room.hostName} · {room.playerCount} Spieler · Status:{" "}
                            {room.status}
                          </Text>
                        </View>
                        <TouchableOpacity
                          onPress={() => handleDeleteRoom(room.code)}
                          className="bg-danger/20 border border-danger/40 px-3 py-1.5 rounded-xl ml-2 active:scale-95"
                        >
                          <Text className="text-danger text-[10px] font-black uppercase tracking-wider">
                            Schließen
                          </Text>
                        </TouchableOpacity>
                      </View>
                    ))
                  )}
                </View>

                {/* Server & System Health */}
                <View className="bg-surface border border-line rounded-3xl p-5 mb-6 shadow-sm">
                  <Text className="text-content-faint text-[9px] font-black uppercase tracking-wider mb-3">
                    Server & System-Info
                  </Text>
                  <View className="space-y-2">
                    <View className="flex-row justify-between py-1 border-b border-line/40">
                      <Text className="text-content-muted text-xs font-medium">Uptime</Text>
                      <Text className="text-content text-xs font-black">
                        {Math.floor(dashboardData.server.uptimeSeconds / 3600)} Std.{" "}
                        {Math.floor((dashboardData.server.uptimeSeconds % 3600) / 60)} Min.
                      </Text>
                    </View>
                    <View className="flex-row justify-between py-1 border-b border-line/40">
                      <Text className="text-content-muted text-xs font-medium">Speicher (RAM)</Text>
                      <Text className="text-content text-xs font-black">
                        {dashboardData.server.memoryUsageMb} MB
                      </Text>
                    </View>
                    <View className="flex-row justify-between py-1 border-b border-line/40">
                      <Text className="text-content-muted text-xs font-medium">Speicher-Engine</Text>
                      <Text className="text-content text-xs font-black">
                        {dashboardData.server.isPgMode ? "PostgreSQL Container" : "JSON Database Mode"}
                      </Text>
                    </View>
                    <View className="flex-row justify-between py-1">
                      <Text className="text-content-muted text-xs font-medium">Node.js Runtime</Text>
                      <Text className="text-content text-xs font-black">
                        {dashboardData.server.nodeVersion}
                      </Text>
                    </View>
                  </View>
                </View>
              </>
            ) : null}
          </View>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: BENUTZERVERWALTUNG                                                  */}
        {/* ========================================================================= */}
        {activeTab === "users" && (
          <View className="pb-12">
            {/* Search Input & Filter Pills */}
            <View className="bg-surface border border-line p-3 rounded-2xl mb-4 flex-row items-center space-x-2">
              <Ionicons name="search" size={16} color={c.contentFaint} />
              <TextInput
                placeholder="Nutzer suchen nach Name, E-Mail oder ID..."
                placeholderTextColor={c.contentFaint}
                value={userQuery}
                onChangeText={setUserQuery}
                className="flex-1 text-content font-bold text-xs px-2"
              />
              {userQuery ? (
                <TouchableOpacity onPress={() => setUserQuery("")}>
                  <Ionicons name="close-circle" size={16} color={c.contentFaint} />
                </TouchableOpacity>
              ) : null}
            </View>

            <View className="flex-row space-x-2 mb-4">
              <TouchableOpacity
                onPress={() => setUserFilter("all")}
                className={`px-3 py-1.5 rounded-xl border ${
                  userFilter === "all"
                    ? "bg-warning/20 border-warning/60"
                    : "bg-surface border-line"
                }`}
              >
                <Text
                  className={`text-[10px] font-black uppercase tracking-wider ${
                    userFilter === "all" ? "text-warning" : "text-content-faint"
                  }`}
                >
                  Alle ({users.length})
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setUserFilter("banned")}
                className={`px-3 py-1.5 rounded-xl border ml-2 ${
                  userFilter === "banned"
                    ? "bg-danger/20 border-danger/60"
                    : "bg-surface border-line"
                }`}
              >
                <Text
                  className={`text-[10px] font-black uppercase tracking-wider ${
                    userFilter === "banned" ? "text-danger" : "text-content-faint"
                  }`}
                >
                  Gesperrt
                </Text>
              </TouchableOpacity>
            </View>

            {loading ? (
              <ActivityIndicator size="large" color={c.warning} style={{ marginTop: 20 }} />
            ) : users.length === 0 ? (
              <Text className="text-content-muted text-center py-8 text-xs font-medium">
                Keine passenden Nutzer gefunden.
              </Text>
            ) : (
              users.map((u) => (
                <View
                  key={u.id}
                  className={`bg-surface border rounded-3xl p-4 mb-3 shadow-sm ${
                    u.banned ? "border-danger/40 bg-danger/5" : "border-line"
                  }`}
                >
                  <View className="flex-row items-center justify-between mb-2">
                    <View className="flex-row items-center space-x-3">
                      <Avatar uri={u.avatar} name={u.name} size={42} className="border border-line" />
                      <View className="ml-3">
                        <View className="flex-row items-center space-x-1.5">
                          <Text className="text-content text-sm font-black">{u.name}</Text>
                          {u.isModerator && (
                            <View className="bg-warning/20 border border-warning/40 px-1.5 py-0.5 rounded ml-1">
                              <Text className="text-warning text-[7px] font-black uppercase">
                                Admin
                              </Text>
                            </View>
                          )}
                          {u.banned && (
                            <View className="bg-danger/20 border border-danger/40 px-1.5 py-0.5 rounded ml-1">
                              <Text className="text-danger text-[7px] font-black uppercase">
                                Gesperrt
                              </Text>
                            </View>
                          )}
                        </View>
                        <Text className="text-content-faint text-[10px] font-medium">
                          {u.email || u.id}
                        </Text>
                      </View>
                    </View>

                    <View className="items-end">
                      <Text className="text-content text-xs font-black">Level {u.level}</Text>
                      <Text className="text-content-faint text-[9px] font-bold">
                        {u.points} XP · {u.rank}
                      </Text>
                    </View>
                  </View>

                  {/* Actions Toolbar */}
                  <View className="flex-row items-center justify-end space-x-2 pt-3 border-t border-line/40 gap-2">
                    {/* Clean Avatar */}
                    {u.avatar && (
                      <TouchableOpacity
                        onPress={() => handleCleanAvatar(u)}
                        className="bg-surface-alt border border-line px-2.5 py-1.5 rounded-xl active:scale-95"
                      >
                        <Text className="text-content-muted text-[10px] font-bold">
                          🧹 Avatar löschen
                        </Text>
                      </TouchableOpacity>
                    )}

                    {/* Anti-Cheat Reset */}
                    <TouchableOpacity
                      onPress={() => handleResetStats(u)}
                      className="bg-surface-alt border border-line px-2.5 py-1.5 rounded-xl active:scale-95"
                    >
                      <Text className="text-content-muted text-[10px] font-bold">
                        ⚖️ Anti-Cheat
                      </Text>
                    </TouchableOpacity>

                    {/* Ban / Unban */}
                    <TouchableOpacity
                      onPress={() => handleToggleBan(u)}
                      className={`px-3 py-1.5 rounded-xl border active:scale-95 ${
                        u.banned
                          ? "bg-success/20 border-success/40"
                          : "bg-danger/20 border-danger/40"
                      }`}
                    >
                      <Text
                        className={`text-[10px] font-black uppercase tracking-wider ${
                          u.banned ? "text-success" : "text-danger"
                        }`}
                      >
                        {u.banned ? "Entsperren" : "Sperren"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
          </View>
        )}

        {/* ========================================================================= */}
        {/* TAB 3: MELDUNGEN & CONTENT MODERATION                                     */}
        {/* ========================================================================= */}
        {activeTab === "reports" && (
          <View className="pb-12">
            {/* Filter Pills */}
            <View className="flex-row space-x-2 mb-4">
              {(["open", "resolved", "dismissed"] as ReportStatus[]).map((st) => {
                const label = st === "open" ? "Offen" : st === "resolved" ? "Erledigt" : "Verworfen";
                const isSelected = reportFilter === st;
                return (
                  <TouchableOpacity
                    key={st}
                    onPress={() => setReportFilter(st)}
                    className={`px-3.5 py-1.5 rounded-xl border mr-2 ${
                      isSelected
                        ? "bg-warning/20 border-warning/60"
                        : "bg-surface border-line"
                    }`}
                  >
                    <Text
                      className={`text-[10px] font-black uppercase tracking-wider ${
                        isSelected ? "text-warning" : "text-content-faint"
                      }`}
                    >
                      {label} ({reportCounts[st]})
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {loading ? (
              <ActivityIndicator size="large" color={c.warning} style={{ marginTop: 20 }} />
            ) : reports.length === 0 ? (
              <Text className="text-content-muted text-center py-8 text-xs font-medium">
                Keine Meldungen in diesem Filter vorhanden.
              </Text>
            ) : (
              reports.map((r) => (
                <View
                  key={r.id}
                  className="bg-surface border border-line rounded-3xl p-4 mb-3 shadow-sm"
                >
                  <View className="flex-row items-center justify-between mb-2">
                    <View className="bg-warning/10 border border-warning/30 px-2 py-0.5 rounded">
                      <Text className="text-warning text-[8px] font-black uppercase tracking-wider">
                        {REPORT_GRUENDE[r.reason] || r.reason}
                      </Text>
                    </View>
                    <Text className="text-content-faint text-[9px] font-bold">
                      {new Date(r.timestamp).toLocaleString([], {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </Text>
                  </View>

                  <Text className="text-content text-xs font-black mb-1">
                    {r.reporterName} meldet {r.reportedName}
                  </Text>

                  {r.details ? (
                    <Text className="text-content-muted text-xs font-medium mb-2">
                      Grund: „{r.details}“
                    </Text>
                  ) : null}

                  {r.contentExcerpt ? (
                    <View className="bg-surface-alt border border-line rounded-xl p-3 mb-3">
                      <Text className="text-content-faint text-[8px] font-black uppercase mb-1">
                        Gemeldeter Inhalt
                      </Text>
                      <Text className="text-content text-xs font-semibold">
                        „{r.contentExcerpt}“
                      </Text>
                    </View>
                  ) : null}

                  {/* Actions for Open Reports */}
                  <View className="flex-row items-center justify-end space-x-2 pt-2 border-t border-line/40 gap-2">
                    {r.contentType === "post" && r.status === "open" && (
                      <TouchableOpacity
                        onPress={() => handleDeleteReportedPost(r)}
                        className="bg-danger/20 border border-danger/40 px-3 py-1.5 rounded-xl active:scale-95"
                      >
                        <Text className="text-danger text-[10px] font-black uppercase">
                          🗑️ Beitrag löschen
                        </Text>
                      </TouchableOpacity>
                    )}

                    {r.status === "open" && (
                      <>
                        <TouchableOpacity
                          onPress={() => handleReportStatus(r.id, "dismissed")}
                          className="bg-surface-alt border border-line px-3 py-1.5 rounded-xl active:scale-95"
                        >
                          <Text className="text-content-faint text-[10px] font-black uppercase">
                            Verwerfen
                          </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          onPress={() => handleReportStatus(r.id, "resolved")}
                          className="bg-success/20 border border-success/40 px-3 py-1.5 rounded-xl active:scale-95"
                        >
                          <Text className="text-success text-[10px] font-black uppercase">
                            Erledigen
                          </Text>
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                </View>
              ))
            )}
          </View>
        )}

        {/* ========================================================================= */}
        {/* TAB 4: GETRÄNKE- & BARCODE-KATALOG                                       */}
        {/* ========================================================================= */}
        {activeTab === "drinks" && (
          <View className="pb-12">
            <View className="bg-surface border border-line p-3 rounded-2xl mb-4 flex-row items-center space-x-2">
              <Ionicons name="search" size={16} color={c.contentFaint} />
              <TextInput
                placeholder="Getränk oder Barcode suchen..."
                placeholderTextColor={c.contentFaint}
                value={drinkQuery}
                onChangeText={setDrinkQuery}
                className="flex-1 text-content font-bold text-xs px-2"
              />
            </View>

            {loading ? (
              <ActivityIndicator size="large" color={c.warning} style={{ marginTop: 20 }} />
            ) : filteredDrinks.length === 0 ? (
              <Text className="text-content-muted text-center py-8 text-xs font-medium">
                Keine Getränke gefunden.
              </Text>
            ) : (
              filteredDrinks.map((d) => (
                <TouchableOpacity
                  key={d.id}
                  onPress={() => openEditDrink(d)}
                  className={`bg-surface border rounded-3xl p-4 mb-2.5 flex-row items-center justify-between ${
                    d.hidden ? "border-danger/40 opacity-70" : "border-line"
                  }`}
                >
                  <View className="flex-1">
                    <View className="flex-row items-center space-x-2 mb-1">
                      <Text className="text-content text-xs font-black">{d.name}</Text>
                      {d.ean && (
                        <View className="bg-accent/20 px-1.5 py-0.5 rounded ml-1.5">
                          <Text className="text-accent text-[8px] font-mono font-bold">
                            EAN: {d.ean}
                          </Text>
                        </View>
                      )}
                      {d.hidden && (
                        <View className="bg-danger/20 px-1.5 py-0.5 rounded ml-1.5">
                          <Text className="text-danger text-[8px] font-black uppercase">
                            Ausgeblendet
                          </Text>
                        </View>
                      )}
                    </View>
                    <Text className="text-content-faint text-[10px] font-medium">
                      {d.volume} ml · {d.abv}% Alk · {d.calories || 0} kcal · Kat: {d.category}
                    </Text>
                  </View>
                  <Ionicons name="create-outline" size={16} color={c.warning} />
                </TouchableOpacity>
              ))
            )}
          </View>
        )}

        {/* ========================================================================= */}
        {/* TAB 5: BROADCAST / SYSTEM-MITTEILUNG                                      */}
        {/* ========================================================================= */}
        {activeTab === "broadcast" && (
          <View className="pb-12">
            <View className="bg-surface border border-line rounded-3xl p-5 mb-5 shadow-sm">
              <Text className="text-content text-sm font-black mb-1">
                Offizielle System-Mitteilung 📢
              </Text>
              <Text className="text-content-muted text-[11px] font-medium mb-4 leading-relaxed">
                Diese Nachricht erscheint für alle Nutzer im Live-Feed mit einem goldenen Spotlight-Rahmen
                und offiziellem System-Badge.
              </Text>

              <TextInput
                placeholder="z. B. Heute Abend um 20:00 Uhr großes Community-Event! 🍻"
                placeholderTextColor={c.contentFaint}
                value={broadcastMessage}
                onChangeText={setBroadcastMessage}
                multiline
                numberOfLines={4}
                className="bg-surface-alt border border-line rounded-2xl p-3.5 text-content font-semibold text-xs mb-4 min-h-[100px]"
                textAlignVertical="top"
              />

              {/* Live Preview */}
              {broadcastMessage.trim() ? (
                <View className="mb-4">
                  <Text className="text-content-faint text-[9px] font-black uppercase tracking-wider mb-2">
                    Vorschau im Feed:
                  </Text>
                  <View className="bg-surface border border-warning/50 bg-warning/5 p-4 rounded-3xl shadow-lg flex-row space-x-3">
                    <View className="w-10 h-10 rounded-2xl bg-warning/20 border border-warning/40 items-center justify-center">
                      <Ionicons name="trophy" size={20} color={c.warning} />
                    </View>
                    <View className="flex-1 ml-2">
                      <View className="flex-row items-center justify-between mb-1">
                        <Text className="text-content text-xs font-black">Party-Highlight</Text>
                        <View className="border border-warning/40 bg-warning/20 px-1.5 py-0.5 rounded">
                          <Text className="text-warning text-[7px] font-black uppercase">
                            [Highlight 🏆]
                          </Text>
                        </View>
                      </View>
                      <Text className="text-content text-xs font-semibold">
                        📢 [SYSTEM-MITTEILUNG]: {broadcastMessage.trim()}
                      </Text>
                    </View>
                  </View>
                </View>
              ) : null}

              <TouchableOpacity
                onPress={handleSendBroadcast}
                disabled={isSubmitting || !broadcastMessage.trim()}
                className="w-full bg-warning py-3.5 rounded-2xl items-center active:scale-95 disabled:opacity-40"
              >
                {isSubmitting ? (
                  <ActivityIndicator color={c.onAccent} />
                ) : (
                  <Text className="text-on-accent font-black text-xs uppercase tracking-wider">
                    Jetzt an alle senden
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Drink Edit Modal */}
      <Modal visible={!!selectedDrink} animationType="slide" transparent>
        <View className="flex-1 bg-black/75 justify-end">
          <View className="bg-surface border-t border-line rounded-t-3xl p-6 pb-10 max-h-[85%]">
            <Text className="text-content text-base font-black mb-4">Getränk bearbeiten</Text>

            <Text className="text-content-faint text-[9px] font-black uppercase tracking-wider mb-1">
              Name
            </Text>
            <TextInput
              value={editDrinkName}
              onChangeText={setEditDrinkName}
              className="bg-surface-alt border border-line rounded-xl px-3.5 py-2.5 text-content font-bold text-xs mb-3"
            />

            <View className="flex-row space-x-3 mb-3 gap-3">
              <View className="flex-1">
                <Text className="text-content-faint text-[9px] font-black uppercase tracking-wider mb-1">
                  Volumen (ml)
                </Text>
                <TextInput
                  value={editDrinkVolume}
                  onChangeText={setEditDrinkVolume}
                  keyboardType="numeric"
                  className="bg-surface-alt border border-line rounded-xl px-3.5 py-2.5 text-content font-bold text-xs"
                />
              </View>
              <View className="flex-1">
                <Text className="text-content-faint text-[9px] font-black uppercase tracking-wider mb-1">
                  Alkohol (% vol)
                </Text>
                <TextInput
                  value={editDrinkAbv}
                  onChangeText={setEditDrinkAbv}
                  keyboardType="numeric"
                  className="bg-surface-alt border border-line rounded-xl px-3.5 py-2.5 text-content font-bold text-xs"
                />
              </View>
            </View>

            <View className="flex-row space-x-3 mb-4 gap-3">
              <View className="flex-1">
                <Text className="text-content-faint text-[9px] font-black uppercase tracking-wider mb-1">
                  Kalorien (kcal)
                </Text>
                <TextInput
                  value={editDrinkCalories}
                  onChangeText={setEditDrinkCalories}
                  keyboardType="numeric"
                  className="bg-surface-alt border border-line rounded-xl px-3.5 py-2.5 text-content font-bold text-xs"
                />
              </View>
              <View className="flex-1">
                <Text className="text-content-faint text-[9px] font-black uppercase tracking-wider mb-1">
                  Barcode (EAN)
                </Text>
                <TextInput
                  value={editDrinkEan}
                  onChangeText={setEditDrinkEan}
                  placeholder="z. B. 4008248000001"
                  placeholderTextColor={c.contentFaint}
                  className="bg-surface-alt border border-line rounded-xl px-3.5 py-2.5 text-content font-bold text-xs"
                />
              </View>
            </View>

            {/* Hide / Show Toggle */}
            <TouchableOpacity
              onPress={() => setEditDrinkHidden(!editDrinkHidden)}
              className="flex-row items-center py-2.5 mb-5"
            >
              <Ionicons
                name={editDrinkHidden ? "checkbox" : "square-outline"}
                size={18}
                color={editDrinkHidden ? c.warning : c.contentFaint}
              />
              <Text className="text-content text-xs font-bold ml-2">
                Getränk im öffentlichen Katalog ausblenden
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleSaveDrink}
              disabled={isSubmitting}
              className="w-full bg-warning py-3.5 rounded-2xl items-center active:scale-95 disabled:opacity-40"
            >
              {isSubmitting ? (
                <ActivityIndicator color={c.onAccent} />
              ) : (
                <Text className="text-on-accent font-black text-xs uppercase tracking-wider">
                  Änderungen speichern
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setSelectedDrink(null)} className="mt-3 py-3 items-center">
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
