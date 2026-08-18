import React, { useState, useEffect, useRef } from "react";
import { Tabs, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  Dimensions,
  Animated,
  TextInput,
  ScrollView,
  Image,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { apiService, GroupMembers } from "@/services/api";
import { useAuth } from "../_layout";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { triggerHaptic } from "@/services/haptics";
import {
  User,
  Drink,
  DrinkLog,
  DirectMessage,
  Group,
  BlockedUser,
  ReportReason,
  REPORT_REASON_LABELS,
} from "@/services/mockData";
import * as ImagePicker from "expo-image-picker";
import { Avatar } from "@/components/Avatar";
import { uploadImage } from "@/services/upload";
import {
  LocationMode,
  DEFAULT_LOCATION_MODE,
  getLocationMode,
  setLocationMode,
  ensureLocationPermission,
  isLocationAvailableOnPlatform,
} from "@/services/location";

const { width: screenWidth } = Dimensions.get("window");
const drawerWidth = screenWidth < 800 ? Math.min(screenWidth * 0.8, 340) : screenWidth * 0.35;

interface AchievementDef {
  id: string;
  name: string;
  icon: string;
  criteria: string;
  color: string;
  colorHex: string;
}

const ACHIEVEMENTS: AchievementDef[] = [
  { id: "FIRST_DRINK", name: "Erste Erfrischung", icon: "beer-outline", criteria: "Dein allererstes Getränk wurde erfolgreich geloggt.", color: "text-cyan-400", colorHex: "#22d3ee" },
  { id: "SOMMELIER", name: "Vielfalt-Liebhaber", icon: "wine-outline", criteria: "Getränke aus mindestens 3 verschiedenen Kategorien getrunken.", color: "text-purple-400", colorHex: "#c084fc" },
  { id: "NACHTEULE", name: "Nachteule", icon: "moon-outline", criteria: "Ein Getränk zwischen 2 und 5 Uhr morgens geloggt.", color: "text-fuchsia-400", colorHex: "#e879f9" },
  { id: "BRAUMEISTER", name: "Braumeister", icon: "beer", criteria: "Mindestens 5 Biere erfolgreich geloggt.", color: "text-yellow-400", colorHex: "#fbbf24" },
  { id: "STAMMGAST", name: "Kult-Stammgast", icon: "trophy", criteria: "Kultstatus! Mindestens 50 Biere geloggt.", color: "text-amber-500", colorHex: "#f59e0b" },
  { id: "FRUEHSCHOPPEN", name: "Frühschoppen", icon: "sunny-outline", criteria: "Ein alkoholisches Getränk vor 12 Uhr mittags geloggt.", color: "text-orange-400", colorHex: "#fb923c" },
  { id: "SAMMLER", name: "Genuss-Sammler", icon: "ribbon-outline", criteria: "Mindestens 10 verschiedene Getränke-Typen probiert.", color: "text-rose-400", colorHex: "#fb7185" },
  { id: "ANFUEHRER", name: "Der Anführer", icon: "people", criteria: "Du bist Administrator einer eigenen Freundesgruppe.", color: "text-emerald-400", colorHex: "#34d399" },
  { id: "DRIVER_OF_THE_NIGHT", name: "Driver of the Night", icon: "car-outline", criteria: "0,0g Alkohol am Abend (mindestens 1 alkoholfreies Getränk geloggt).", color: "text-blue-400", colorHex: "#60a5fa" },
  { id: "HYDRO_HOMIE", name: "Hydro-Homie", icon: "water", criteria: "Mindestens 3 Wasser hintereinander geloggt, ohne Alkohol dazwischen.", color: "text-sky-400", colorHex: "#38bdf8" },
  { id: "UEBERLEBENSKUENSTLER", name: "Überlebenskünstler", icon: "heart-outline", criteria: "Ein lebensrettendes Wasser nach 04:00 Uhr morgens geloggt.", color: "text-teal-400", colorHex: "#2dd4bf" },
];

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { logout: authLogout, updateUserContext, changePassword } = useAuth();
  const [notificationCount, setNotificationCount] = useState(0);

  // Drawer states
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [dbUser, setDbUser] = useState<User | null>(null);
  const [logs, setLogs] = useState<DrinkLog[]>([]);
  const [drinks, setDrinks] = useState<Drink[]>([]);
  const [drawerLoading, setDrawerLoading] = useState(false);

  // Profile Edit states inside drawer
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState("");

  const [showLicensesModal, setShowLicensesModal] = useState(false);
  const [showLocationModal, setShowLocationModal] = useState(false);

  // Passwort ändern
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordDone, setPasswordDone] = useState(false);
  const [locationMode, setLocationModeState] = useState<LocationMode>(DEFAULT_LOCATION_MODE);

  // Friends & Live Search states
  const [showFriendsModal, setShowFriendsModal] = useState(false);
  const [friendsList, setFriendsList] = useState<User[]>([]);
  const [pendingRequests, setPendingRequests] = useState<User[]>([]);
  const [friendSearchQuery, setFriendSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [groupsList, setGroupsList] = useState<Group[]>([]);

  // Chat / Direct Messaging states
  const [showChatModal, setShowChatModal] = useState(false);
  const [chatTargetUser, setChatTargetUser] = useState<User | null>(null);
  const [chatTargetGroup, setChatTargetGroup] = useState<Group | null>(null);
  const [chatMessages, setChatMessages] = useState<DirectMessage[]>([]);
  const [chatInputText, setChatInputText] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  // Group Creation states
  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);

  // Moderation states: acting on another user (remove / block / report) and
  // managing the list of people already blocked.
  const [actionTargetUser, setActionTargetUser] = useState<User | null>(null);
  const [reportTargetUser, setReportTargetUser] = useState<User | null>(null);
  const [reportReason, setReportReason] = useState<ReportReason | null>(null);
  const [reportDetails, setReportDetails] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [showBlockedModal, setShowBlockedModal] = useState(false);
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
  const [blockedLoading, setBlockedLoading] = useState(false);

  // Live Search Effect
  useEffect(() => {
    const query = friendSearchQuery.trim();
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
  }, [friendSearchQuery, dbUser]);

  const loadFriendsData = async () => {
    try {
      const currentUser = await apiService.getCurrentUser();
      setFriendsLoading(true);
      const data = await apiService.getFriends(currentUser.name);
      setFriendsList(data.friends || []);
      setPendingRequests(data.pending || []);

      // Gruppen kommen aus derselben Ansicht: /api/groups liefert seit der
      // Autorisierungsrunde nur noch die eigenen, es ist also keine
      // zusätzliche Filterung nötig.
      setGroupsList(await apiService.getGroups());
    } catch (e) {
      console.error("Failed to load friends in layout modal:", e);
    } finally {
      setFriendsLoading(false);
    }
  };

  // Alert.alert does nothing on react-native-web, so every confirmation and
  // error message here was invisible in the browser — actions appeared to do
  // nothing at all.
  const notify = (title: string, message: string) => {
    if (Platform.OS === "web") {
      window.alert(message);
      return;
    }
    Alert.alert(title, message);
  };

  // Alert.alert does nothing on react-native-web, so a confirmation has to go
  // through window.confirm there or the dialog never appears and the action
  // silently doesn't happen.
  const confirmAction = (title: string, message: string, onConfirm: () => void) => {
    if (Platform.OS === "web") {
      if (window.confirm(`${title}\n\n${message}`)) onConfirm();
      return;
    }
    Alert.alert(title, message, [
      { text: "Abbrechen", style: "cancel" },
      { text: "Bestätigen", style: "destructive", onPress: onConfirm },
    ]);
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
          await loadFriendsData();
        } catch (e) {
          notify("Fehler", e instanceof Error ? e.message : "Konnte nicht entfernt werden.");
        }
      }
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
          await loadFriendsData();
        } catch (e) {
          notify("Fehler", e instanceof Error ? e.message : "Konnte nicht blockiert werden.");
        }
      }
    );
  };

  const loadBlockedUsers = async () => {
    setBlockedLoading(true);
    try {
      setBlockedUsers(await apiService.getBlockedUsers());
    } catch (e) {
      console.warn("Failed to load blocked users:", e);
    } finally {
      setBlockedLoading(false);
    }
  };

  const handleUnblockUser = async (blocked: BlockedUser) => {
    try {
      await apiService.unblockUser(blocked.userId);
      notify("Aufgehoben", `${blocked.username} ist nicht mehr blockiert.`);
      await loadBlockedUsers();
    } catch (e) {
      notify("Fehler", e instanceof Error ? e.message : "Konnte nicht aufgehoben werden.");
    }
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

  const handleSendFriendRequest = async (targetUsername?: string) => {
    const receiver = targetUsername || friendSearchQuery.trim();
    if (!dbUser || !receiver) return;
    if (receiver.toLowerCase() === dbUser.name.toLowerCase()) {
      notify("Fehler", "Du kannst dir nicht selbst eine Anfrage schicken!");
      return;
    }

    try {
      await triggerHaptic("success");
      await apiService.sendFriendRequest(dbUser.name, receiver);
      notify("Erfolg", `Freundschaftsanfrage an ${receiver} gesendet!`);
      setFriendSearchQuery("");
      setSearchResults([]);
      await loadFriendsData();
    } catch (e) {
      await triggerHaptic("error");
      const msg = e instanceof Error ? e.message : "Anfrage konnte nicht gesendet werden.";
      notify("Fehler", msg);
    }
  };

  const handleAcceptFriendRequest = async (senderName: string) => {
    if (!dbUser) return;
    try {
      await triggerHaptic("success");
      await apiService.acceptFriendRequest(senderName, dbUser.name);
      notify("Erfolg", `Freundschaftsanfrage von ${senderName} angenommen!`);
      await loadFriendsData();
    } catch (e) {
      await triggerHaptic("error");
      const msg = e instanceof Error ? e.message : "Anfrage konnte nicht angenommen werden.";
      notify("Fehler", msg);
    }
  };

  // Messaging Functions
  const openDirectChat = async (targetUser: User) => {
    setChatTargetUser(targetUser);
    setChatTargetGroup(null);
    setShowChatModal(true);
    setChatLoading(true);
    try {
      const msgs = await apiService.getDirectMessages(targetUser.id);
      setChatMessages(msgs);
    } catch (e) {
      console.error("Failed to load DMs:", e);
    } finally {
      setChatLoading(false);
    }
  };

  const openGroupChat = async (targetGroup: Group) => {
    setChatTargetGroup(targetGroup);
    setChatTargetUser(null);
    setShowChatModal(true);
    setChatLoading(true);
    try {
      setChatMessages(await apiService.getGroupMessages(targetGroup.id));
    } catch (e) {
      // Der Server antwortet mit 403, wenn man nicht (mehr) Mitglied ist —
      // etwa nachdem man aus der Gruppe entfernt wurde, während die Liste
      // noch offen war.
      notify(
        "Chat nicht verfügbar",
        e instanceof Error ? e.message : "Der Gruppenchat konnte nicht geladen werden."
      );
      setShowChatModal(false);
    } finally {
      setChatLoading(false);
    }
  };

  const handleSendMessage = async () => {
    if (!chatInputText.trim() || (!chatTargetUser && !chatTargetGroup)) return;
    const content = chatInputText.trim();
    setChatInputText("");
    try {
      await triggerHaptic("light");
      const newMsg = await apiService.sendMessage({
        receiverId: chatTargetUser ? chatTargetUser.id : undefined,
        groupId: chatTargetGroup ? chatTargetGroup.id : undefined,
        content,
      });
      setChatMessages((prev) => [...prev, newMsg]);
    } catch (e) {
      notify("Fehler", "Nachricht konnte nicht gesendet werden.");
    }
  };

  // Group Creation
  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) {
      notify("Fehler", "Bitte gib einen Gruppen-Namen ein!");
      return;
    }
    try {
      await triggerHaptic("success");
      await apiService.createGroup(newGroupName.trim(), selectedMemberIds);
      notify("Erfolg", `Gruppe "${newGroupName.trim()}" wurde erstellt!`);
      setShowCreateGroupModal(false);
      setNewGroupName("");
      setSelectedMemberIds([]);
    } catch (e) {
      notify("Fehler", "Gruppe konnte nicht erstellt werden.");
    }
  };

  // Animation values
  const drawerAnim = useRef(new Animated.Value(0)).current;

  const loadNotificationCount = async () => {
    try {
      const userRes = await apiService.getCurrentUser();
      const groupsRes = await apiService.getGroups();
      const adminGroups = groupsRes.filter((g) => g.adminId === userRes.id);
      const totalPending = adminGroups.reduce((sum, g) => sum + (g.pendingUserIds?.length || 0), 0);
      setNotificationCount(totalPending);
    } catch (error) {
      console.error("Failed to load notifications count in layout:", error);
    }
  };

  useEffect(() => {
    loadNotificationCount();
    const interval = setInterval(loadNotificationCount, 15000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    getLocationMode().then(setLocationModeState);
  }, []);

  const handleLocationModeChange = async (mode: LocationMode) => {
    await triggerHaptic("light");

    // Ask for the OS permission at the moment the user opts in, not on some
    // unrelated earlier screen — otherwise the prompt has no visible reason.
    if (mode !== "off") {
      const granted = await ensureLocationPermission();
      if (!granted) {
        const msg =
          "Ohne Standort-Freigabe kann TrinkDuell deine Orte nicht speichern. Du kannst die Berechtigung in den Systemeinstellungen deines Geräts erteilen.";
        if (Platform.OS === "web") window.alert(msg);
        else Alert.alert("Standort nicht freigegeben", msg);
        return;
      }
    }

    await setLocationMode(mode);
    setLocationModeState(mode);
  };

  const openDrawer = async () => {
    setIsDrawerOpen(true);
    setDrawerLoading(true);
    Animated.timing(drawerAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();

    try {
      const currentUser = await apiService.getCurrentUser();
      if (!currentUser) {
        console.warn("User not found in drawer open, aborting.");
        return;
      }
      const allLogs = await apiService.getDrinkLogs();
      const allDrinks = await apiService.getDrinks();

      setDbUser(currentUser);
      setEditedName(currentUser.name);
      
      const userLogs = allLogs.filter((l) => l.userId === currentUser.id);
      const sortedLogs = userLogs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setLogs(sortedLogs);
      setDrinks(allDrinks);
    } catch (e) {
      console.error("Failed to load profile data inside drawer:", e);
    } finally {
      setDrawerLoading(false);
    }
  };

  const closeDrawer = () => {
    Animated.timing(drawerAnim, {
      toValue: 0,
      duration: 250,
      useNativeDriver: true,
    }).start(() => {
      setIsDrawerOpen(false);
      setIsEditingName(false);
    });
  };

  const toggleDrawer = () => {
    if (isDrawerOpen) {
      closeDrawer();
    } else {
      openDrawer();
    }
  };

  // Helper to convert local URI to Base64 (AsyncStorage persistence)
  const uriToBase64 = async (uri: string): Promise<string> => {
    const response = await fetch(uri);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = (reader.result as string).split(",")[1];
        resolve(base64String);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const handlePickAvatar = async () => {
    if (!dbUser) return;
    await triggerHaptic("light");

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      alert("Galerie-Rechte werden benötigt, um ein Profilbild zu ändern!");
      return;
    }

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
        base64: true,
      });

      if (!result.canceled) {
        setDrawerLoading(true);
        const pickedUri = result.assets[0].uri;

        // Bevorzugt in den Objektspeicher: bisher landete jedes Profilbild
        // als Base64-Block in der Datenbank und wurde damit in JEDER
        // Nutzerliste mitgeschleppt. Kann der Server das nicht (keine
        // R2-Zugangsdaten), bleibt der alte Weg als Rückfall — sonst hätten
        // Bestandsserver plötzlich keine Profilbilder mehr.
        let avatarUrl: string;
        const uploadConfig = await apiService.getUploadConfig();

        if (uploadConfig.enabled) {
          const publicUrl = await uploadImage(pickedUri, "avatar");
          const saved = await apiService.setAvatarUrl(dbUser.id, publicUrl);
          avatarUrl = saved.avatarUrl;
        } else {
          // ImagePicker's own base64 output is more reliable across platforms
          // than re-reading the picked URI via fetch/blob; only fall back to
          // that if ImagePicker didn't provide it.
          let base64Data = result.assets[0].base64 || "";
          if (!base64Data) {
            try {
              base64Data = await uriToBase64(pickedUri);
            } catch (e) {
              console.warn("Base64 conversion failed, using direct URI:", e);
            }
          }

          const uploadResult = await apiService.uploadAvatar(
            dbUser.id,
            pickedUri,
            base64Data || undefined
          );
          avatarUrl = uploadResult.avatarUrl;
        }

        const updatedUser = { ...dbUser, avatar: avatarUrl };
        setDbUser(updatedUser);
        updateUserContext(updatedUser);
      }
    } catch (error) {
      console.error("Avatar pick failed:", error);
    } finally {
      setDrawerLoading(false);
    }
  };

  const handleSaveName = async () => {
    if (!editedName.trim() || !dbUser) {
      await triggerHaptic("error");
      notify("Fehler", "Name darf nicht leer sein!");
      return;
    }

    try {
      await triggerHaptic("success");
      const updatedUser = { ...dbUser, name: editedName.trim() };
      await apiService.updateUser(updatedUser);
      setDbUser(updatedUser);
      updateUserContext(updatedUser);
      setIsEditingName(false);
    } catch (e) {
      await triggerHaptic("error");
      console.error("Failed to update name:", e);
      // The server rejects a name that is already taken, too short/long, or
      // contains disallowed characters. Without this the rename just silently
      // did nothing and the old name stayed on screen.
      const msg = e instanceof Error ? e.message : "Name konnte nicht geändert werden.";
      notify("Fehler", msg);
    }
  };



  const handleDeleteLog = async (logId: string) => {
    try {
      await triggerHaptic("medium");
      await apiService.deleteDrinkLog(logId);
      
      // Reload drawer profile stats and update global contexts
      const currentUser = await apiService.getCurrentUser();
      const allLogs = await apiService.getDrinkLogs();
      setDbUser(currentUser);
      updateUserContext(currentUser);
      
      const userLogs = allLogs.filter((l) => l.userId === currentUser.id);
      setLogs(userLogs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));
    } catch (e) {
      console.error("Failed to delete log:", e);
    }
  };

  // ── Gruppenmitglieder verwalten ─────────────────────────────────────────
  const [manageGroup, setManageGroup] = useState<Group | null>(null);
  const [groupMembers, setGroupMembers] = useState<GroupMembers | null>(null);
  const [groupMembersLoading, setGroupMembersLoading] = useState(false);
  const [groupBusyUserId, setGroupBusyUserId] = useState<string | null>(null);

  const loadGroupMembers = async (groupId: string) => {
    setGroupMembersLoading(true);
    try {
      setGroupMembers(await apiService.getGroupMembers(groupId));
    } catch (error) {
      notify("Fehler", error instanceof Error ? error.message : "Mitglieder konnten nicht geladen werden.");
      setGroupMembers(null);
    } finally {
      setGroupMembersLoading(false);
    }
  };

  // ── Einladungscode ──────────────────────────────────────────────────────
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinError, setJoinError] = useState("");

  const loadInviteCode = async (groupId: string) => {
    setInviteBusy(true);
    try {
      setInviteCode(await apiService.getGroupInvite(groupId));
    } catch {
      // Kein notify: für ein einfaches Mitglied ist die 403 der Normalfall,
      // nicht ein Fehler. Der Abschnitt bleibt dann einfach leer.
      setInviteCode(null);
    } finally {
      setInviteBusy(false);
    }
  };

  const handleRotateInvite = async () => {
    if (!manageGroup) return;
    const frage =
      "Der bisherige Code wird ungültig. Wer ihn hat, kommt damit nicht mehr herein — " +
      "genau dafür ist das gedacht, wenn jemand die Gruppe verlassen musste.";

    const ausfuehren = async () => {
      setInviteBusy(true);
      try {
        setInviteCode(await apiService.rotateGroupInvite(manageGroup.id));
        await triggerHaptic("success");
      } catch (error) {
        await triggerHaptic("error");
        notify("Fehler", error instanceof Error ? error.message : "Code konnte nicht erneuert werden.");
      } finally {
        setInviteBusy(false);
      }
    };

    if (Platform.OS === "web") {
      if (window.confirm(frage)) await ausfuehren();
      return;
    }
    Alert.alert("Code erneuern?", frage, [
      { text: "Abbrechen", style: "cancel" },
      { text: "Erneuern", style: "destructive", onPress: ausfuehren },
    ]);
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
      const group = await apiService.joinGroupByCode(code);
      await triggerHaptic("success");
      setShowJoinModal(false);
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

  const openGroupManage = async (group: Group) => {
    await triggerHaptic("light");
    setManageGroup(group);
    setGroupMembers(null);
    await loadGroupMembers(group.id);
    await loadInviteCode(group.id);
  };

  const closeGroupManage = () => {
    setManageGroup(null);
    setGroupMembers(null);
    setGroupBusyUserId(null);
    setInviteCode(null);
  };

  const handleAddGroupMember = async (user: User) => {
    if (!manageGroup) return;
    setGroupBusyUserId(user.id);
    try {
      await apiService.addGroupMember(manageGroup.id, user.id);
      await triggerHaptic("success");
      await loadGroupMembers(manageGroup.id);
      setGroupsList(await apiService.getGroups());
    } catch (error) {
      await triggerHaptic("error");
      notify("Fehler", error instanceof Error ? error.message : "Hinzufügen fehlgeschlagen.");
    } finally {
      setGroupBusyUserId(null);
    }
  };

  const handleRemoveGroupMember = async (member: { id: string; name: string }) => {
    if (!manageGroup) return;
    const frage = `${member.name} wirklich aus "${manageGroup.name}" entfernen?`;

    const ausfuehren = async () => {
      setGroupBusyUserId(member.id);
      try {
        await apiService.removeGroupMember(manageGroup.id, member.id);
        await triggerHaptic("success");
        await loadGroupMembers(manageGroup.id);
        setGroupsList(await apiService.getGroups());
      } catch (error) {
        await triggerHaptic("error");
        notify("Fehler", error instanceof Error ? error.message : "Entfernen fehlgeschlagen.");
      } finally {
        setGroupBusyUserId(null);
      }
    };

    if (Platform.OS === "web") {
      if (window.confirm(frage)) await ausfuehren();
      return;
    }
    Alert.alert("Mitglied entfernen", frage, [
      { text: "Abbrechen", style: "cancel" },
      { text: "Entfernen", style: "destructive", onPress: ausfuehren },
    ]);
  };

  const handleLeaveGroup = async () => {
    if (!manageGroup || !dbUser) return;

    // Die Folgen unterscheiden sich deutlich, also steht in der Rückfrage auch
    // Verschiedenes: als Letzter löst man die Gruppe samt Chatverlauf auf, als
    // Admin gibt man die Rolle ab.
    const anzahl = groupMembers?.members.length ?? 0;
    const istAdmin = groupMembers?.isAdmin ?? false;
    const frage =
      anzahl <= 1
        ? `Du bist das letzte Mitglied. "${manageGroup.name}" wird mitsamt dem Chatverlauf gelöscht.`
        : istAdmin
        ? `Du gibst die Adminrolle an das dienstälteste Mitglied ab und verlässt "${manageGroup.name}".`
        : `"${manageGroup.name}" wirklich verlassen?`;

    const ausfuehren = async () => {
      setGroupBusyUserId(dbUser.id);
      try {
        const res = await apiService.removeGroupMember(manageGroup.id, dbUser.id);
        await triggerHaptic("success");
        closeGroupManage();
        setGroupsList(await apiService.getGroups());
        notify(
          "Erledigt",
          res.groupDeleted ? "Die Gruppe wurde aufgelöst." : "Du hast die Gruppe verlassen."
        );
      } catch (error) {
        await triggerHaptic("error");
        notify("Fehler", error instanceof Error ? error.message : "Verlassen fehlgeschlagen.");
      } finally {
        setGroupBusyUserId(null);
      }
    };

    if (Platform.OS === "web") {
      if (window.confirm(frage)) await ausfuehren();
      return;
    }
    Alert.alert("Gruppe verlassen", frage, [
      { text: "Abbrechen", style: "cancel" },
      { text: "Verlassen", style: "destructive", onPress: ausfuehren },
    ]);
  };

  const handleGroupRequest = async (userId: string, accept: boolean) => {
    if (!manageGroup) return;
    setGroupBusyUserId(userId);
    try {
      await apiService.handleJoinRequest(manageGroup.id, userId, accept);
      await triggerHaptic("success");
      await loadGroupMembers(manageGroup.id);
      setGroupsList(await apiService.getGroups());
    } catch (error) {
      await triggerHaptic("error");
      notify("Fehler", error instanceof Error ? error.message : "Anfrage konnte nicht bearbeitet werden.");
    } finally {
      setGroupBusyUserId(null);
    }
  };

  /** Freunde, die noch nicht in der Gruppe sind — die Kandidaten zum Hinzufügen. */
  const addableFriends = friendsList.filter(
    (f) => !(groupMembers?.members || []).some((m) => m.id === f.id)
  );

  const handleLogout = async () => {
    const performLogout = async () => {
      try {
        await triggerHaptic("medium");
        closeDrawer();
        await authLogout();
      } catch (error) {
        await triggerHaptic("error");
        console.error("Failed to logout:", error);
      }
    };

    if (Platform.OS === "web") {
      if (window.confirm("Möchtest du dich wirklich abmelden?")) {
        await performLogout();
      }
    } else {
      Alert.alert("Abmelden?", "Möchtest du dich wirklich abmelden?", [
        { text: "Abbrechen", style: "cancel" },
        { text: "Abmelden", style: "destructive", onPress: performLogout },
      ]);
    }
  };

  const handleDeleteAccount = async () => {
    if (!dbUser) return;

    const performDelete = async () => {
      setDrawerLoading(true);
      try {
        await triggerHaptic("medium");
        await apiService.deleteAccount(dbUser.id);
        closeDrawer();
        await authLogout();
      } catch (error) {
        await triggerHaptic("error");
        const msg =
          "Konto konnte nicht gelöscht werden. Bitte stelle sicher, dass du mit dem Internet verbunden bist, und versuche es erneut.";
        if (Platform.OS === "web") {
          window.alert(msg);
        } else {
          Alert.alert("Fehler", msg);
        }
        console.error("Failed to delete account:", error);
      } finally {
        setDrawerLoading(false);
      }
    };

    const warningText =
      "Dein Konto und alle zugehörigen Daten (Statistiken, Freundschaften, Nachrichten) werden unwiderruflich gelöscht. Das kann nicht rückgängig gemacht werden.";

    if (Platform.OS === "web") {
      if (window.confirm(`Konto wirklich endgültig löschen?\n\n${warningText}`)) {
        await performDelete();
      }
    } else {
      Alert.alert("Konto endgültig löschen?", warningText, [
        { text: "Abbrechen", style: "cancel" },
        { text: "Endgültig löschen", style: "destructive", onPress: performDelete },
      ]);
    }
  };

  const closePasswordModal = () => {
    setShowPasswordModal(false);
    // Klartext-Passwörter nicht im State liegen lassen, nachdem der Dialog zu
    // ist — der Drawer bleibt die ganze Sitzung über montiert.
    setCurrentPassword("");
    setNewPassword("");
    setRepeatPassword("");
    setPasswordError("");
    setPasswordDone(false);
  };

  const handleChangePassword = async () => {
    setPasswordError("");

    // Die Wiederholung prüft nur der Client: der Server kennt sie nicht und
    // soll sie auch nicht kennen. Länge und Gleichheit prüft er trotzdem
    // selbst noch einmal — das hier erspart nur den Rundweg.
    if (newPassword !== repeatPassword) {
      setPasswordError("Die beiden neuen Passwörter stimmen nicht überein.");
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError("Das neue Passwort muss mindestens 8 Zeichen lang sein.");
      return;
    }
    if (newPassword === currentPassword) {
      setPasswordError("Das neue Passwort muss sich vom alten unterscheiden.");
      return;
    }

    setPasswordSaving(true);
    try {
      await changePassword(currentPassword, newPassword);
      await triggerHaptic("success");
      setPasswordDone(true);
      setCurrentPassword("");
      setNewPassword("");
      setRepeatPassword("");
    } catch (error) {
      await triggerHaptic("error");
      // Der Interceptor hat die deutsche Servermeldung schon in `message`
      // gelegt („Das aktuelle Passwort ist falsch.", Rate-Limit, …).
      const msg =
        error instanceof Error && error.message
          ? error.message
          : "Passwort konnte nicht geändert werden. Bist du mit dem Internet verbunden?";
      setPasswordError(msg);
    } finally {
      setPasswordSaving(false);
    }
  };

  // Helper colors
  const getCategoryColor = (cat: string) => {
    switch (cat) {
      case "Bier": return "bg-cyan-950 text-cyan-400 border-cyan-800";
      case "Wein": return "bg-purple-950 text-purple-400 border-purple-800";
      case "Sekt": return "bg-pink-950 text-pink-400 border-pink-800";
      case "Schnaps": return "bg-rose-950 text-rose-400 border-rose-800";
      case "Mischgetränk": return "bg-yellow-950 text-yellow-400 border-yellow-800";
      default: return "bg-emerald-950 text-emerald-400 border-emerald-800";
    }
  };

  const getCategoryIcon = (cat: string): "beer" | "wine" | "wine-outline" | "flask" | "water" => {
    switch (cat) {
      case "Bier": return "beer";
      case "Wein": return "wine";
      case "Sekt": return "wine-outline";
      case "Schnaps": return "flask";
      case "Mischgetränk": return "wine";
      default: return "water";
    }
  };

  const drawerTranslateX = drawerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-drawerWidth, 0],
  });

  const drawerOpacity = drawerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  return (
    <View className="flex-1 bg-slate-950">
      <Tabs
        screenOptions={{
          tabBarStyle: {
            backgroundColor: "#020617",
            borderTopWidth: 1,
            borderTopColor: "rgba(255, 255, 255, 0.08)",
            height: insets.bottom > 0 ? 56 + insets.bottom : 64,
            paddingBottom: insets.bottom > 0 ? insets.bottom : 8,
            paddingTop: 8,
          },
          tabBarActiveTintColor: "#22d3ee",
          tabBarInactiveTintColor: "#64748b",
          headerStyle: {
            backgroundColor: "#020617",
            borderBottomWidth: 1,
            borderBottomColor: "rgba(255, 255, 255, 0.08)",
          },
          headerTitleStyle: {
            color: "#ffffff",
            fontWeight: "900",
            letterSpacing: 1.2,
          },
          headerLeft: () => (
            <TouchableOpacity
              onPress={toggleDrawer}
              className="ml-4 p-1.5 active:scale-95"
            >
              <Ionicons name="menu-outline" size={26} color="#22d3ee" />
            </TouchableOpacity>
          ),
          headerRight: () => (
            <TouchableOpacity
              onPress={() => router.push("/notifications")}
              className="mr-4 relative p-1.5 active:scale-90"
            >
              <Ionicons name="notifications" size={24} color="#22d3ee" />
              {notificationCount > 0 && (
                <View className="absolute top-0 right-0 bg-rose-500 min-w-[18px] h-[18px] rounded-full items-center justify-center border border-slate-950 px-1">
                  <Text className="text-[10px] font-black text-white text-center">
                    {notificationCount}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          ),
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: "TrinkDuell",
            tabBarLabel: "Dashboard",
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? "wine" : "wine-outline"} size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="feed"
          options={{
            title: "Live-Pulse",
            tabBarLabel: "Feed",
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? "flash" : "flash-outline"} size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="games"
          options={{
            title: "Spiele",
            tabBarLabel: "Spiele",
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? "game-controller" : "game-controller-outline"} size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="scoreboard"
          options={{
            title: "Bestenliste",
            tabBarLabel: "Rangliste",
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? "trophy" : "trophy-outline"} size={size} color={color} />
            ),
          }}
        />
      </Tabs>

      {/* ==========================================
          GLOBAL SIDE DRAWER (Solid Absolute Sidebar Spalte)
          ========================================== */}
      {isDrawerOpen && (
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 999,
          }}
          pointerEvents="auto"
        >
          {/* Simple Backdrop Overlay (~65% remaining area) */}
          <Animated.View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(0, 0, 0, 0.5)",
              opacity: drawerOpacity,
            }}
          >
            <TouchableOpacity className="flex-1" activeOpacity={1} onPress={closeDrawer} />
          </Animated.View>

          {/* Opaque Drawer Body (35%-40% width, absolutely positioned, non-transparent slate background) */}
          <Animated.View
            style={{
              transform: [{ translateX: drawerTranslateX }],
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: drawerWidth,
            }}
            className="bg-slate-950 border-r border-slate-800"
          >
            <View className="flex-1 pt-12 pb-6 px-5 justify-between bg-slate-950">
              
              {/* Top part scrollable */}
              <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
                <View className="flex-row justify-between items-center mb-6">
                  <Text className="text-white text-lg font-black tracking-widest uppercase">TrinkDuell</Text>
                  <TouchableOpacity onPress={closeDrawer} className="p-1">
                    <Ionicons name="close-outline" size={24} color="#64748b" />
                  </TouchableOpacity>
                </View>

                {drawerLoading ? (
                  <View className="py-20 justify-center items-center">
                    <ActivityIndicator size="large" color="#22d3ee" />
                  </View>
                ) : dbUser ? (
                  <View>
                    {/* User profile details box */}
                    <View className="items-center bg-slate-900 border border-slate-800 p-4 rounded-3xl mb-6 relative">
                      <TouchableOpacity onPress={handlePickAvatar} className="relative active:scale-95 mb-3">
                        <Avatar
                          uri={dbUser.avatar}
                          name={dbUser.name}
                          size={64}
                          className="border border-slate-700"
                        />
                        <View className="absolute bottom-0 right-0 bg-cyan-400 p-1 rounded-full border border-slate-900">
                          <Ionicons name="camera" size={12} color="#020617" />
                        </View>
                      </TouchableOpacity>

                      {isEditingName ? (
                        <View className="flex-row items-center space-x-2 px-4 mb-2">
                          <TextInput
                            value={editedName}
                            onChangeText={setEditedName}
                            maxLength={20}
                            className="bg-slate-950 border border-cyan-500/50 rounded-xl px-3 py-1.5 text-white font-bold text-center flex-1"
                          />
                          <TouchableOpacity onPress={handleSaveName} className="bg-cyan-400 p-2 rounded-xl">
                            <Ionicons name="checkmark" size={14} color="#020617" />
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <TouchableOpacity onPress={() => setIsEditingName(true)} className="flex-row items-center space-x-1.5 active:scale-95">
                          <Text className="text-white text-base font-black">{dbUser.name || "Gast"}</Text>
                          <Ionicons name="pencil" size={12} color="#22d3ee" />
                        </TouchableOpacity>
                      )}

                      <Text className="text-cyan-400 text-xs font-black tracking-wide mb-2.5">
                        @{(dbUser.name || "gast").toLowerCase().replace(/\s+/g, "_")}
                      </Text>

                      <View className="flex-row items-center space-x-1 bg-slate-950 border border-slate-800 px-3 py-1 rounded-full">
                        <Text className="text-[9px] font-black text-cyan-400 uppercase tracking-widest">
                          Level {dbUser.currentLevel || dbUser.level || 1} • {dbUser.title || "Neuling"}
                        </Text>
                      </View>
                    </View>

                    {/* Friends Button */}
                    <TouchableOpacity
                      onPress={() => {
                        triggerHaptic("light");
                        setShowFriendsModal(true);
                        loadFriendsData();
                      }}
                      className="bg-slate-900 border border-slate-800 p-4 rounded-3xl mb-6 flex-row justify-between items-center active:scale-95"
                    >
                      <View className="flex-row items-center space-x-3">
                        <View className="bg-purple-500/10 p-2 rounded-xl border border-purple-500/20">
                          <Ionicons name="people-outline" size={20} color="#c084fc" />
                        </View>
                        <View>
                          <Text className="text-white text-xs font-black">Freunde verwalten</Text>
                          <Text className="text-slate-500 text-[8px] font-semibold mt-0.5">Anfragen senden & annehmen</Text>
                        </View>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color="#c084fc" />
                    </TouchableOpacity>

                    {/* Achievements grid */}
                    <Text className="text-white/40 text-[10px] font-black uppercase tracking-widest mb-3">Erfolge & Badges</Text>
                    <View className="flex-row flex-wrap gap-2 mb-6">
                      {ACHIEVEMENTS.map((ach) => {
                        const isUnlocked = (dbUser.achievements || []).some((a) => a.id === ach.id);
                        return (
                          <View
                            key={ach.id}
                            className={`w-[47%] p-3 rounded-2xl border flex-col items-center justify-center ${
                              isUnlocked
                                ? "bg-slate-900 border-slate-850"
                                : "bg-slate-900 border-slate-850 opacity-30"
                            }`}
                          >
                            <Ionicons
                              name={ach.icon as any}
                              size={20}
                              color={isUnlocked ? ach.colorHex : "#475569"}
                              className="mb-1.5"
                            />
                            <Text className={`text-[10px] font-bold text-center mb-0.5 ${isUnlocked ? "text-white" : "text-slate-500"}`}>
                              {ach.name}
                            </Text>
                            <Text className="text-[7px] text-slate-500 text-center font-medium leading-normal" numberOfLines={2}>
                              {ach.criteria}
                            </Text>
                          </View>
                        );
                      })}
                    </View>

                    {/* Consumption History */}
                    <Text className="text-white/40 text-[10px] font-black uppercase tracking-widest mb-3">Konsum-Verlauf</Text>
                    {logs.length === 0 ? (
                      <Text className="text-slate-500 text-xs italic mb-6">Noch keine Getränke geloggt.</Text>
                    ) : (
                      <View className="mb-6">
                        {logs.slice(0, 15).map((log) => {
                          const drink = drinks.find((d) => d.id === log.drinkId);
                          if (!drink) return null;
                          const logTime = new Date(log.timestamp);
                          const formattedTime = `${logTime.getHours().toString().padStart(2, "0")}:${logTime.getMinutes().toString().padStart(2, "0")}`;

                          return (
                            <View
                              key={log.id}
                              className="bg-slate-900 border border-slate-800 rounded-xl p-3 mb-2 flex-row justify-between items-center"
                            >
                              <View className="flex-row items-center space-x-2.5 flex-1">
                                <Ionicons name={getCategoryIcon(drink.category)} size={14} color={drink.abv > 0 ? "#f43f5e" : "#34d399"} />
                                <View className="flex-1">
                                  <Text className="text-white text-xs font-bold" numberOfLines={1}>
                                    {drink.name}
                                  </Text>
                                  <Text className="text-slate-500 text-[8px]">
                                    {drink.volume}ml • {drink.abv}% • {formattedTime} Uhr
                                  </Text>
                                </View>
                              </View>
                              <TouchableOpacity onPress={() => handleDeleteLog(log.id)} className="p-1 active:scale-90">
                                <Ionicons name="trash-outline" size={14} color="#f43f5e" />
                              </TouchableOpacity>
                            </View>
                          );
                        })}
                      </View>
                    )}
                  </View>
                ) : null}
              </ScrollView>

              {/* Drawer footer */}
              <View className="border-t border-slate-800 pt-4 mt-2 bg-slate-950">
                <TouchableOpacity
                  onPress={() => {
                    triggerHaptic("light");
                    setShowLocationModal(true);
                  }}
                  className="flex-row items-center space-x-2 mb-3.5 py-1"
                >
                  <Ionicons name="location-outline" size={18} color="#22d3ee" />
                  <Text className="text-white/60 text-xs font-bold">
                    Standort:{" "}
                    {locationMode === "auto"
                      ? "Automatisch"
                      : locationMode === "manual"
                      ? "Nur Check-in"
                      : "Aus"}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => {
                    triggerHaptic("light");
                    router.push("/legal/privacy");
                  }}
                  className="flex-row items-center space-x-2 mb-3.5 py-1"
                >
                  <Ionicons name="shield-checkmark-outline" size={18} color="#22d3ee" />
                  <Text className="text-white/60 text-xs font-bold">Datenschutzerklärung</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => {
                    triggerHaptic("light");
                    router.push("/legal/terms");
                  }}
                  className="flex-row items-center space-x-2 mb-3.5 py-1"
                >
                  <Ionicons name="reader-outline" size={18} color="#22d3ee" />
                  <Text className="text-white/60 text-xs font-bold">Nutzungsbedingungen</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => setShowLicensesModal(true)}
                  className="flex-row items-center space-x-2 mb-3.5 py-1"
                >
                  <Ionicons name="document-text-outline" size={18} color="#22d3ee" />
                  <Text className="text-white/60 text-xs font-bold">Lizenzen & Open Source</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => {
                    triggerHaptic("light");
                    setShowPasswordModal(true);
                  }}
                  className="flex-row items-center space-x-2 mb-3.5 py-1"
                >
                  <Ionicons name="key-outline" size={18} color="#22d3ee" />
                  <Text className="text-white/60 text-xs font-bold">Passwort ändern</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={handleLogout}
                  className="flex-row items-center space-x-2 py-1 mb-3.5"
                >
                  <Ionicons name="log-out-outline" size={18} color="#f43f5e" />
                  <Text className="text-rose-400 text-xs font-black uppercase tracking-wider">Abmelden</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={handleDeleteAccount}
                  className="flex-row items-center space-x-2 py-1"
                >
                  <Ionicons name="trash-outline" size={18} color="#7f1d1d" />
                  <Text className="text-red-900 text-[10px] font-black uppercase tracking-wider">Konto endgültig löschen</Text>
                </TouchableOpacity>
              </View>

            </View>
          </Animated.View>
        </View>
      )}



      {/* Passwort ändern */}
      <Modal
        visible={showPasswordModal}
        transparent={true}
        animationType="slide"
        onRequestClose={closePasswordModal}
      >
        <View className="flex-1 bg-black/85 justify-end">
          <View className="bg-slate-950 border-t border-cyan-500/30 rounded-t-3xl p-6 pb-8">
            <View className="flex-row justify-between items-center mb-2">
              <Text className="text-white text-base font-black uppercase tracking-wider">
                Passwort ändern 🔑
              </Text>
              <TouchableOpacity onPress={closePasswordModal} className="p-1">
                <Ionicons name="close" size={24} color="#64748b" />
              </TouchableOpacity>
            </View>

            {passwordDone ? (
              <>
                <View className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-4 mb-5 mt-3">
                  <View className="flex-row items-center mb-2">
                    <Ionicons name="checkmark-circle" size={18} color="#34d399" />
                    <Text className="text-emerald-400 text-xs font-black uppercase tracking-wider ml-2">
                      Passwort geändert
                    </Text>
                  </View>
                  <Text className="text-emerald-300/80 text-[11px] leading-relaxed">
                    Auf diesem Gerät bleibst du angemeldet. Alle anderen Geräte wurden
                    abgemeldet und brauchen ab jetzt das neue Passwort.
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={closePasswordModal}
                  className="bg-cyan-500 rounded-2xl py-3.5 items-center"
                >
                  <Text className="text-slate-950 text-xs font-black uppercase tracking-wider">
                    Fertig
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text className="text-slate-400 text-[11px] leading-relaxed mb-5">
                  Zur Sicherheit brauchen wir dein aktuelles Passwort. Danach werden alle
                  anderen Geräte abgemeldet — auf diesem bleibst du eingeloggt.
                </Text>

                <TextInput
                  value={currentPassword}
                  onChangeText={setCurrentPassword}
                  placeholder="Aktuelles Passwort"
                  placeholderTextColor="#475569"
                  secureTextEntry
                  autoCapitalize="none"
                  autoComplete="current-password"
                  textContentType="password"
                  className="bg-slate-900 border border-white/10 rounded-2xl px-4 py-3.5 text-white text-sm mb-2.5"
                />
                <TextInput
                  value={newPassword}
                  onChangeText={setNewPassword}
                  placeholder="Neues Passwort (min. 8 Zeichen)"
                  placeholderTextColor="#475569"
                  secureTextEntry
                  autoCapitalize="none"
                  autoComplete="new-password"
                  textContentType="newPassword"
                  className="bg-slate-900 border border-white/10 rounded-2xl px-4 py-3.5 text-white text-sm mb-2.5"
                />
                <TextInput
                  value={repeatPassword}
                  onChangeText={setRepeatPassword}
                  placeholder="Neues Passwort wiederholen"
                  placeholderTextColor="#475569"
                  secureTextEntry
                  autoCapitalize="none"
                  autoComplete="new-password"
                  textContentType="newPassword"
                  onSubmitEditing={handleChangePassword}
                  className="bg-slate-900 border border-white/10 rounded-2xl px-4 py-3.5 text-white text-sm mb-3"
                />

                {passwordError ? (
                  <View className="bg-rose-500/10 border border-rose-500/30 rounded-2xl p-3 mb-3 flex-row items-start">
                    <Ionicons name="alert-circle" size={15} color="#f43f5e" />
                    <Text className="text-rose-400 text-[11px] leading-4 ml-2 flex-1">
                      {passwordError}
                    </Text>
                  </View>
                ) : null}

                <TouchableOpacity
                  onPress={handleChangePassword}
                  disabled={passwordSaving || !currentPassword || !newPassword || !repeatPassword}
                  className={`rounded-2xl py-3.5 items-center ${
                    passwordSaving || !currentPassword || !newPassword || !repeatPassword
                      ? "bg-slate-800"
                      : "bg-cyan-500"
                  }`}
                >
                  {passwordSaving ? (
                    <ActivityIndicator size="small" color="#0f172a" />
                  ) : (
                    <Text
                      className={`text-xs font-black uppercase tracking-wider ${
                        !currentPassword || !newPassword || !repeatPassword
                          ? "text-slate-600"
                          : "text-slate-950"
                      }`}
                    >
                      Passwort ändern
                    </Text>
                  )}
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Standort-Einstellungen */}
      <Modal
        visible={showLocationModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowLocationModal(false)}
      >
        <View className="flex-1 bg-black/85 justify-end">
          <View className="bg-slate-950 border-t border-cyan-500/30 rounded-t-3xl p-6 pb-8">
            <View className="flex-row justify-between items-center mb-2">
              <Text className="text-white text-base font-black uppercase tracking-wider">
                Standort 📍
              </Text>
              <TouchableOpacity onPress={() => setShowLocationModal(false)} className="p-1">
                <Ionicons name="close" size={24} color="#64748b" />
              </TouchableOpacity>
            </View>

            <Text className="text-slate-400 text-[11px] leading-relaxed mb-5">
              Dein Standort wird nur mit deinen Freunden und Mitgliedern deiner Gruppen geteilt —
              niemals mit Fremden. Du kannst das jederzeit hier ändern.
            </Text>

            {!isLocationAvailableOnPlatform() && (
              <View className="bg-amber-500/10 border border-amber-500/25 rounded-2xl p-3 mb-4">
                <Text className="text-amber-400 text-[10px] font-bold leading-relaxed">
                  Im Browser funktioniert die Standortbestimmung nur über eine gesicherte
                  HTTPS-Verbindung. In der App funktioniert sie normal.
                </Text>
              </View>
            )}

            {(
              [
                {
                  key: "auto" as const,
                  icon: "navigate",
                  title: "Automatisch",
                  desc: "Jedes geloggte Getränk speichert deinen Ort. So entsteht dein persönlicher Verlauf auf der Karte.",
                },
                {
                  key: "manual" as const,
                  icon: "hand-left",
                  title: "Nur bei Check-in",
                  desc: "Getränke werden ohne Ort gespeichert. Du entscheidest per Check-in, wann dein Standort geteilt wird.",
                },
                {
                  key: "off" as const,
                  icon: "close-circle",
                  title: "Aus",
                  desc: "Es werden keinerlei Standortdaten erfasst.",
                },
              ]
            ).map((option) => {
              const isActive = locationMode === option.key;
              return (
                <TouchableOpacity
                  key={option.key}
                  onPress={() => handleLocationModeChange(option.key)}
                  className={`p-4 rounded-2xl border mb-2.5 flex-row items-start ${
                    isActive ? "bg-cyan-500/10 border-cyan-500/40" : "bg-slate-900 border-white/5"
                  }`}
                >
                  <Ionicons
                    name={option.icon as any}
                    size={18}
                    color={isActive ? "#22d3ee" : "#64748b"}
                  />
                  <View className="flex-1 ml-3">
                    <Text
                      className={`text-xs font-black mb-0.5 ${
                        isActive ? "text-cyan-400" : "text-white"
                      }`}
                    >
                      {option.title}
                    </Text>
                    <Text className="text-slate-500 text-[10px] leading-relaxed">{option.desc}</Text>
                  </View>
                  {isActive && <Ionicons name="checkmark-circle" size={18} color="#22d3ee" />}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </Modal>

      {/* Licenses Open Source Modal */}
      <Modal
        visible={showLicensesModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowLicensesModal(false)}
      >
        <View className="flex-1 bg-slate-950 pt-16 px-6">
          <View className="flex-row justify-between items-center mb-6">
            <Text className="text-white text-lg font-black uppercase tracking-wider">Software-Lizenzen</Text>
            <TouchableOpacity onPress={() => setShowLicensesModal(false)} className="p-1">
              <Ionicons name="close-circle-outline" size={28} color="#f43f5e" />
            </TouchableOpacity>
          </View>

          <ScrollView className="flex-1 mb-8" showsVerticalScrollIndicator={false}>
            <Text className="text-slate-400 text-xs leading-relaxed mb-6">
              TrinkDuell ist 100% werbefrei, open-source-konform und respektiert deine Privatsphäre. 
              Wir nutzen freie Software unter permissiven Lizenzen (MIT / BSD).
            </Text>

            {[
              { name: "React & React Native", license: "MIT License", copyright: "Copyright (c) Meta Platforms, Inc." },
              { name: "Expo SDK (Router, Haptics, ImagePicker)", license: "MIT License", copyright: "Copyright (c) 2015-present 650 Industries, Inc." },
              { name: "TailwindCSS & NativeWind v4", license: "MIT License", copyright: "Copyright (c) Tailwind Labs / Marc Rousavy" },
              { name: "Axios Network client", license: "MIT License", copyright: "Copyright (c) 2014-present Matt Zabriskie" },
              { name: "PostgreSQL Database driver (pg)", license: "MIT License", copyright: "Copyright (c) 2010-present Brian Carlson" },
              { name: "Express backend core", license: "MIT License", copyright: "Copyright (c) 2009-2014 TJ Holowaychuk" },
            ].map((lib) => (
              <View key={lib.name} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 mb-4">
                <Text className="text-cyan-400 text-sm font-black">{lib.name}</Text>
                <Text className="text-white/40 text-[9px] font-extrabold uppercase mt-1">{lib.license}</Text>
                <Text className="text-slate-500 text-[10px] mt-1.5 leading-relaxed">{lib.copyright}</Text>
              </View>
            ))}
          </ScrollView>

          <TouchableOpacity
            onPress={() => setShowLicensesModal(false)}
            className="w-full bg-cyan-400 py-4 rounded-2xl items-center shadow-lg shadow-cyan-500/20 active:scale-95 mb-8"
          >
            <Text className="text-slate-950 font-black text-sm uppercase tracking-wider">Schließen</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Friends Management Modal */}
      <Modal
        visible={showFriendsModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowFriendsModal(false)}
      >
        <View className="flex-1 bg-black/85 justify-end">
          <View className="bg-slate-900 border-t border-purple-500/25 rounded-t-3xl p-5 pb-8 max-h-[85%]">
            <View className="flex-row justify-between items-center mb-4">
              <Text className="text-white text-base font-black uppercase tracking-wider">Freunde & Suche 👥</Text>
              <TouchableOpacity
                onPress={() => {
                  triggerHaptic("light");
                  setShowFriendsModal(false);
                }}
                className="p-1"
              >
                <Ionicons name="close" size={24} color="#64748b" />
              </TouchableOpacity>
            </View>

            {/* Top Action Bar: Create Group Button */}
            <View className="flex-row mb-4" style={{ gap: 10 }}>
              <View className="flex-1">
              <TouchableOpacity
                onPress={() => {
                  triggerHaptic("light");
                  setShowCreateGroupModal(true);
                }}
                className="bg-purple-500/10 border border-purple-500/30 p-3 rounded-2xl mb-4 flex-row items-center justify-center space-x-2 active:scale-95"
              >
                <Ionicons name="people-circle-outline" size={18} color="#c084fc" />
                <Text className="text-purple-300 font-black text-xs uppercase tracking-wider">+ Neue Gruppe erstellen</Text>
              </TouchableOpacity>
              </View>
              <TouchableOpacity
                onPress={() => {
                  triggerHaptic("light");
                  setJoinError("");
                  setJoinCodeInput("");
                  setShowJoinModal(true);
                }}
                accessibilityLabel="Gruppe per Code beitreten"
                className="bg-slate-950 border border-white/10 px-4 rounded-2xl items-center justify-center"
              >
                <Ionicons name="enter-outline" size={18} color="#94a3b8" />
              </TouchableOpacity>
            </View>

            {/* Meine Gruppen. Der Gruppen-Chat war vollständig gebaut —
                Backend, API-Client, Chat-Modal — hatte aber keinen Auslöser:
                chatTargetGroup wurde nie gesetzt. Gruppen ließen sich anlegen
                und dann nie wieder öffnen. */}
            {groupsList.length > 0 && (
              <View className="mb-4">
                <Text className="text-slate-400 text-[10px] font-black uppercase tracking-wider mb-3">
                  Meine Gruppen ({groupsList.length})
                </Text>
                {groupsList.map((group) => {
                  const isAdmin = group.adminId === dbUser?.id;
                  return (
                    <View
                      key={group.id}
                      className="bg-slate-950/60 border border-purple-500/10 rounded-2xl p-3.5 flex-row justify-between items-center mb-2.5"
                    >
                      <View className="flex-row items-center flex-1 mr-2">
                        <View className="w-9 h-9 rounded-xl bg-purple-500/10 border border-purple-500/20 items-center justify-center">
                          <Ionicons name="people" size={16} color="#c084fc" />
                        </View>
                        <View className="flex-1 ml-3">
                          <Text className="text-white text-xs font-black" numberOfLines={1}>
                            {group.name}
                          </Text>
                          <Text className="text-purple-400 text-[9px] font-bold mt-0.5">
                            {(group.memberIds || []).length}{" "}
                            {(group.memberIds || []).length === 1 ? "Mitglied" : "Mitglieder"}
                            {isAdmin ? " · Admin" : ""}
                          </Text>
                        </View>
                      </View>

                      <TouchableOpacity
                        onPress={() => openGroupManage(group)}
                        accessibilityLabel={`Gruppe ${group.name} verwalten`}
                        className="bg-slate-900 border border-white/10 px-2.5 py-1.5 rounded-xl mr-1.5"
                      >
                        <Ionicons name="settings-outline" size={14} color="#94a3b8" />
                      </TouchableOpacity>

                      <TouchableOpacity
                        onPress={() => {
                          setShowFriendsModal(false);
                          openGroupChat(group);
                        }}
                        accessibilityLabel={`Gruppenchat ${group.name} öffnen`}
                        className="bg-purple-500/10 border border-purple-500/30 px-3 py-1.5 rounded-xl flex-row items-center"
                      >
                        <Ionicons name="chatbubble-ellipses-outline" size={14} color="#c084fc" />
                        <Text className="text-purple-300 text-[10px] font-black uppercase ml-1">
                          Chat
                        </Text>
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
            )}

            {/* Friend Request & Live User Search Input */}
            <View className="bg-slate-950/80 border border-white/5 rounded-2xl p-4 mb-4">
              <Text className="text-slate-400 text-[9px] font-black uppercase mb-2">Nutzer suchen</Text>
              <View className="flex-row items-center bg-slate-900 border border-white/5 rounded-xl px-3">
                <Ionicons name="search" size={14} color="#64748b" />
                <TextInput
                  placeholder="Name eingeben..."
                  placeholderTextColor="#475569"
                  value={friendSearchQuery}
                  onChangeText={setFriendSearchQuery}
                  autoCapitalize="none"
                  autoCorrect={false}
                  className="flex-1 py-2.5 px-2 text-white text-xs font-bold"
                />
                {isSearching && <ActivityIndicator size="small" color="#c084fc" />}
                {!isSearching && friendSearchQuery.length > 0 && (
                  <TouchableOpacity onPress={() => setFriendSearchQuery("")} className="p-1">
                    <Ionicons name="close-circle" size={16} color="#475569" />
                  </TouchableOpacity>
                )}
              </View>
              <Text className="text-slate-500 text-[9px] mt-2">
                Tippe einen Namen — passende Nutzer erscheinen automatisch.
              </Text>
            </View>

            <ScrollView className="flex-1 mb-2" showsVerticalScrollIndicator={false}>
              {/* Live Search Results Section */}
              {/* Suchvorschläge (erscheinen live beim Tippen) */}
              {friendSearchQuery.trim().length > 0 && (
                <View className="mb-6">
                  <Text className="text-cyan-400 text-[10px] font-black uppercase tracking-wider mb-3">
                    {isSearching
                      ? "Suche..."
                      : searchResults.length > 0
                      ? `Vorschläge (${searchResults.length})`
                      : "Keine Treffer"}
                  </Text>

                  {!isSearching && searchResults.length === 0 && (
                    <View className="bg-slate-950/60 border border-white/5 rounded-2xl p-4">
                      <Text className="text-slate-400 text-[11px] text-center leading-relaxed">
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
                        className="bg-slate-950/80 border border-cyan-500/20 rounded-2xl p-3 flex-row justify-between items-center mb-2"
                      >
                        <View className="flex-row items-center flex-1 mr-2">
                          <Avatar
                            uri={resUser.avatar}
                            name={resUser.name}
                            size={36}
                            className="border border-white/10"
                          />
                          <View className="flex-1 ml-3">
                            <Text className="text-white text-xs font-black" numberOfLines={1}>
                              {resUser.name}
                            </Text>
                            <Text className="text-cyan-400/90 text-[10px] font-bold">
                              Lv. {resUser.currentLevel || resUser.level || 1} · {resUser.title || "Neuling"}
                            </Text>
                          </View>
                        </View>

                        {alreadyFriend ? (
                          <View className="flex-row items-center px-3 py-1.5">
                            <Ionicons name="checkmark-circle" size={14} color="#34d399" />
                            <Text className="text-emerald-400 font-black text-[10px] uppercase ml-1">
                              Befreundet
                            </Text>
                          </View>
                        ) : incomingRequest ? (
                          <TouchableOpacity
                            onPress={() => handleAcceptFriendRequest(resUser.name)}
                            className="bg-purple-500 px-3 py-1.5 rounded-xl flex-row items-center"
                          >
                            <Ionicons name="checkmark" size={12} color="#020617" />
                            <Text className="text-slate-950 font-black text-[10px] uppercase ml-1">
                              Annehmen
                            </Text>
                          </TouchableOpacity>
                        ) : (
                          <TouchableOpacity
                            onPress={() => handleSendFriendRequest(resUser.name)}
                            className="bg-cyan-400 px-3 py-1.5 rounded-xl flex-row items-center"
                          >
                            <Ionicons name="person-add" size={12} color="#020617" />
                            <Text className="text-slate-950 font-black text-[10px] uppercase ml-1">
                              Anfragen
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  })}
                </View>
              )}

              {friendsLoading ? (
                <View className="py-12 justify-center items-center">
                  <ActivityIndicator size="large" color="#a855f7" />
                </View>
              ) : (
                <>
                  {/* Incoming Requests Section */}
                  {pendingRequests.length > 0 && (
                    <View className="mb-6">
                      <Text className="text-purple-400 text-[10px] font-black uppercase tracking-wider mb-3">Ausstehende Anfragen ({pendingRequests.length})</Text>
                      {pendingRequests.map((req) => (
                        <View
                          key={req.id}
                          className="bg-slate-950/60 border border-purple-500/10 rounded-2xl p-3.5 flex-row justify-between items-center mb-2.5"
                        >
                          <View className="flex-row items-center space-x-3 flex-1 mr-2">
                            <Avatar uri={req.avatar} name={req.name} size={32} className="border border-white/10" />
                            <View className="flex-1">
                              <Text className="text-white text-xs font-black">{req.name}</Text>
                              <Text className="text-purple-400 text-[9px] font-bold">@{req.name.toLowerCase().replace(/\s+/g, "_")}</Text>
                            </View>
                          </View>
                          <TouchableOpacity
                            onPress={() => handleAcceptFriendRequest(req.name)}
                            className="bg-purple-500 px-3 py-1.5 rounded-xl flex-row items-center space-x-1"
                          >
                            <Ionicons name="checkmark" size={14} color="#020617" />
                            <Text className="text-slate-950 font-black text-[10px] uppercase">Annehmen</Text>
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  )}

                  {/* Friends List Section */}
                  <Text className="text-slate-400 text-[10px] font-black uppercase tracking-wider mb-3">Meine Freunde ({friendsList.length})</Text>
                  {friendsList.length === 0 ? (
                    <View className="py-12 bg-slate-950/40 border border-white/5 rounded-2xl items-center justify-center">
                      <Ionicons name="people-outline" size={32} color="#475569" className="mb-2" />
                      <Text className="text-slate-500 text-xs font-bold text-center">Noch keine Freunde hinzugefügt.</Text>
                    </View>
                  ) : (
                    friendsList.map((friend) => (
                      <View
                        key={friend.id}
                        className="bg-slate-950/60 border border-white/5 rounded-2xl p-3.5 flex-row justify-between items-center mb-2.5"
                      >
                        <View className="flex-row items-center space-x-3 flex-1 mr-2">
                          <Avatar uri={friend.avatar} name={friend.name} size={36} className="border border-white/10" />
                          <View className="flex-1">
                            <Text className="text-white text-xs font-black" numberOfLines={1}>{friend.name}</Text>
                            <Text className="text-cyan-400 text-[9px] font-bold mt-0.5">@{friend.name.toLowerCase().replace(/\s+/g, "_")}</Text>
                          </View>
                        </View>

                        <View className="flex-row items-center">
                          <TouchableOpacity
                            onPress={() => {
                              setShowFriendsModal(false);
                              openDirectChat(friend);
                            }}
                            className="bg-cyan-400/10 border border-cyan-400/30 px-3 py-1.5 rounded-xl flex-row items-center space-x-1"
                          >
                            <Ionicons name="chatbubble-ellipses-outline" size={14} color="#22d3ee" />
                            <Text className="text-cyan-400 text-[10px] font-black uppercase">Chat</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            onPress={() => {
                              triggerHaptic("light");
                              setActionTargetUser(friend);
                            }}
                            accessibilityLabel={`Optionen für ${friend.name}`}
                            className="ml-2 w-8 h-8 items-center justify-center rounded-xl bg-white/5 border border-white/10"
                          >
                            <Ionicons name="ellipsis-horizontal" size={14} color="#94a3b8" />
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))
                  )}

                  {/* Entry point for undoing a block. Required by the stores:
                      blocking must be reversible by the user themselves. */}
                  <TouchableOpacity
                    onPress={() => {
                      triggerHaptic("light");
                      setShowBlockedModal(true);
                      loadBlockedUsers();
                    }}
                    className="mt-4 flex-row items-center justify-center py-3 rounded-2xl bg-white/5 border border-white/10"
                  >
                    <Ionicons name="ban-outline" size={14} color="#94a3b8" />
                    <Text className="text-slate-400 text-[10px] font-black uppercase tracking-wider ml-2">
                      Blockierte Nutzer verwalten
                    </Text>
                  </TouchableOpacity>
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Gruppe verwalten */}
      {/* Bewusst NACH dem Freunde-Modal: React Native Web stapelt Modals in
          DOM-Reihenfolge. Weiter oben lag dieser Dialog hinter dem Modal,
          aus dem er geöffnet wird — sichtbar war nur das Freunde-Modal. */}
      <Modal
        visible={manageGroup !== null}
        transparent={true}
        animationType="slide"
        onRequestClose={closeGroupManage}
      >
        <View className="flex-1 bg-black/85 justify-end">
          <View className="bg-slate-950 border-t border-purple-500/30 rounded-t-3xl p-6 pb-8 max-h-[88%]">
            <View className="flex-row justify-between items-center mb-1">
              <Text className="text-white text-base font-black uppercase tracking-wider flex-1 mr-2" numberOfLines={1}>
                {manageGroup?.name}
              </Text>
              <TouchableOpacity onPress={closeGroupManage} className="p-1">
                <Ionicons name="close" size={24} color="#64748b" />
              </TouchableOpacity>
            </View>
            <Text className="text-slate-500 text-[10px] font-semibold mb-4">
              {groupMembers?.isAdmin
                ? "Du bist Admin — du kannst Mitglieder hinzufügen und entfernen."
                : "Du bist Mitglied dieser Gruppe."}
            </Text>

            {groupMembersLoading && !groupMembers ? (
              <View className="py-10 items-center">
                <ActivityIndicator color="#c084fc" />
              </View>
            ) : (
              <ScrollView className="mb-4" showsVerticalScrollIndicator={false}>
                {/* Einladungscode — nur der Admin bekommt ihn vom Server */}
                {inviteCode && (
                  <View className="mb-5 bg-cyan-400/5 border border-cyan-400/25 rounded-2xl p-4">
                    <Text className="text-cyan-400 text-[10px] font-black uppercase tracking-wider mb-2">
                      Einladungscode
                    </Text>
                    <Text
                      selectable
                      accessibilityLabel={`Einladungscode ${inviteCode}`}
                      className="text-white text-2xl font-black tracking-[6px] mb-2"
                    >
                      {inviteCode}
                    </Text>
                    <Text className="text-slate-400 text-[10px] leading-4 mb-3">
                      Wer diesen Code eingibt, wird sofort Mitglied — ohne weitere Freigabe.
                    </Text>
                    <TouchableOpacity
                      onPress={handleRotateInvite}
                      disabled={inviteBusy}
                      accessibilityLabel="Einladungscode erneuern"
                      className="bg-slate-950 border border-white/10 rounded-xl py-2.5 items-center flex-row justify-center"
                    >
                      {inviteBusy ? (
                        <ActivityIndicator size="small" color="#22d3ee" />
                      ) : (
                        <>
                          <Ionicons name="refresh" size={13} color="#94a3b8" />
                          <Text className="text-slate-300 text-[10px] font-black uppercase tracking-wider ml-1.5">
                            Code erneuern
                          </Text>
                        </>
                      )}
                    </TouchableOpacity>
                    <Text className="text-slate-600 text-[9px] leading-3.5 mt-2">
                      Nach einem Rauswurf erneuern — sonst kommt die Person mit dem alten
                      Code einfach zurück.
                    </Text>
                  </View>
                )}
                {/* Offene Beitrittsanfragen — nur der Admin sieht sie */}
                {groupMembers?.isAdmin && (groupMembers?.pending.length ?? 0) > 0 && (
                  <View className="mb-5">
                    <Text className="text-amber-400 text-[10px] font-black uppercase tracking-wider mb-2.5">
                      Offene Anfragen ({groupMembers?.pending.length})
                    </Text>
                    {groupMembers?.pending.map((p) => (
                      <View
                        key={p.id}
                        className="flex-row items-center bg-amber-500/5 border border-amber-500/20 rounded-2xl px-3.5 py-2.5 mb-2"
                      >
                        <Text className="text-white text-xs font-black flex-1" numberOfLines={1}>
                          {p.name}
                        </Text>
                        {groupBusyUserId === p.id ? (
                          <ActivityIndicator size="small" color="#fbbf24" />
                        ) : (
                          <>
                            <TouchableOpacity
                              onPress={() => handleGroupRequest(p.id, false)}
                              accessibilityLabel={`${p.name} ablehnen`}
                              className="px-2.5 py-1.5"
                            >
                              <Text className="text-slate-400 text-[10px] font-black uppercase">Nein</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              onPress={() => handleGroupRequest(p.id, true)}
                              accessibilityLabel={`${p.name} aufnehmen`}
                              className="bg-amber-400 px-3 py-1.5 rounded-xl"
                            >
                              <Text className="text-slate-950 text-[10px] font-black uppercase">Aufnehmen</Text>
                            </TouchableOpacity>
                          </>
                        )}
                      </View>
                    ))}
                  </View>
                )}

                {/* Mitglieder */}
                <Text className="text-slate-400 text-[10px] font-black uppercase tracking-wider mb-2.5">
                  Mitglieder ({groupMembers?.members.length ?? 0})
                </Text>
                {groupMembers?.members.map((m) => {
                  const binIch = m.id === dbUser?.id;
                  // Sich selbst entfernt man über "Gruppe verlassen" unten —
                  // das erklärt die Folgen, dieser Knopf täte es wortlos.
                  const darfEntfernen = (groupMembers?.isAdmin ?? false) && !binIch;
                  return (
                    <View
                      key={m.id}
                      className="flex-row items-center bg-slate-900 border border-white/5 rounded-2xl px-3.5 py-3 mb-2"
                    >
                      <View className="w-8 h-8 rounded-xl bg-purple-500/10 border border-purple-500/20 items-center justify-center">
                        <Ionicons name="person" size={14} color="#c084fc" />
                      </View>
                      <View className="flex-1 ml-3">
                        <Text className="text-white text-xs font-black" numberOfLines={1}>
                          {m.name}
                          {binIch ? " (du)" : ""}
                        </Text>
                        {m.isAdmin && (
                          <Text className="text-purple-400 text-[9px] font-black uppercase mt-0.5">Admin</Text>
                        )}
                      </View>
                      {groupBusyUserId === m.id ? (
                        <ActivityIndicator size="small" color="#f43f5e" />
                      ) : darfEntfernen ? (
                        <TouchableOpacity
                          onPress={() => handleRemoveGroupMember(m)}
                          accessibilityLabel={`${m.name} aus der Gruppe entfernen`}
                          className="p-2"
                        >
                          <Ionicons name="person-remove-outline" size={16} color="#f43f5e" />
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  );
                })}

                {/* Freunde hinzufügen — nur der Admin */}
                {groupMembers?.isAdmin && (
                  <View className="mt-5">
                    <Text className="text-slate-400 text-[10px] font-black uppercase tracking-wider mb-2.5">
                      Freunde hinzufügen
                    </Text>
                    {addableFriends.length === 0 ? (
                      <Text className="text-slate-600 text-[11px] font-medium py-2">
                        {friendsList.length === 0
                          ? "Du hast noch keine Freunde hinzugefügt."
                          : "Alle deine Freunde sind schon in dieser Gruppe."}
                      </Text>
                    ) : (
                      addableFriends.map((f) => (
                        <TouchableOpacity
                          key={f.id}
                          onPress={() => handleAddGroupMember(f)}
                          disabled={groupBusyUserId === f.id}
                          accessibilityLabel={`${f.name} zur Gruppe hinzufügen`}
                          className="flex-row items-center bg-slate-900 border border-white/5 rounded-2xl px-3.5 py-3 mb-2"
                        >
                          <View className="w-8 h-8 rounded-xl bg-slate-950 border border-white/10 items-center justify-center">
                            <Ionicons name="person-outline" size={14} color="#64748b" />
                          </View>
                          <Text className="text-white text-xs font-black flex-1 ml-3" numberOfLines={1}>
                            {f.name}
                          </Text>
                          {groupBusyUserId === f.id ? (
                            <ActivityIndicator size="small" color="#c084fc" />
                          ) : (
                            <Ionicons name="add-circle-outline" size={18} color="#c084fc" />
                          )}
                        </TouchableOpacity>
                      ))
                    )}
                  </View>
                )}
              </ScrollView>
            )}

            <TouchableOpacity
              onPress={handleLeaveGroup}
              accessibilityLabel="Gruppe verlassen"
              className="bg-rose-500/10 border border-rose-500/30 rounded-2xl py-3.5 items-center flex-row justify-center"
            >
              <Ionicons name="exit-outline" size={16} color="#f43f5e" />
              <Text className="text-rose-400 text-xs font-black uppercase tracking-wider ml-2">
                {(groupMembers?.members.length ?? 0) <= 1 ? "Gruppe auflösen" : "Gruppe verlassen"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Gruppe per Code beitreten.
          Steht wie „Gruppe verwalten" NACH dem Freunde-Modal — sonst läge es
          dahinter (siehe Falle zur Modal-Stapelung in der Projektübergabe). */}
      <Modal
        visible={showJoinModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowJoinModal(false)}
      >
        <View className="flex-1 bg-black/85 justify-end">
          <View className="bg-slate-950 border-t border-purple-500/30 rounded-t-3xl p-6 pb-8">
            <View className="flex-row justify-between items-center mb-2">
              <Text className="text-white text-base font-black uppercase tracking-wider">
                Gruppe beitreten
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setShowJoinModal(false);
                  setJoinCodeInput("");
                  setJoinError("");
                }}
                className="p-1"
              >
                <Ionicons name="close" size={24} color="#64748b" />
              </TouchableOpacity>
            </View>

            <Text className="text-slate-400 text-[11px] leading-relaxed mb-5">
              Gib den Einladungscode ein, den du vom Gruppen-Admin bekommen hast.
              Gruppen lassen sich bewusst nicht durchsuchen.
            </Text>

            <TextInput
              value={joinCodeInput}
              onChangeText={(t) => setJoinCodeInput(t.toUpperCase())}
              placeholder="z. B. A1B2C3D4"
              placeholderTextColor="#475569"
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={32}
              onSubmitEditing={handleJoinByCode}
              accessibilityLabel="Einladungscode eingeben"
              className="bg-slate-900 border border-white/10 rounded-2xl px-4 py-3.5 text-white text-lg font-black tracking-[4px] mb-3"
            />

            {joinError ? (
              <View className="bg-rose-500/10 border border-rose-500/30 rounded-2xl p-3 mb-3 flex-row items-start">
                <Ionicons name="alert-circle" size={15} color="#f43f5e" />
                <Text className="text-rose-400 text-[11px] leading-4 ml-2 flex-1">{joinError}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              onPress={handleJoinByCode}
              disabled={joinBusy || !joinCodeInput.trim()}
              accessibilityLabel="Mit Code beitreten"
              className={`rounded-2xl py-3.5 items-center ${
                joinBusy || !joinCodeInput.trim() ? "bg-slate-800" : "bg-purple-500"
              }`}
            >
              {joinBusy ? (
                <ActivityIndicator size="small" color="#0f172a" />
              ) : (
                <Text
                  className={`text-xs font-black uppercase tracking-wider ${
                    !joinCodeInput.trim() ? "text-slate-600" : "text-white"
                  }`}
                >
                  Beitreten
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Direct Messaging Chat Modal */}
      <Modal
        visible={showChatModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowChatModal(false)}
      >
        <View className="flex-1 bg-black/90 justify-end">
          <View className="bg-slate-950 border-t border-cyan-500/30 rounded-t-3xl p-5 pb-8 h-[85%]">
            {/* Header */}
            <View className="flex-row justify-between items-center pb-4 border-b border-white/10 mb-4">
              <View className="flex-row items-center space-x-3">
                <Avatar
                  uri={chatTargetUser?.avatar}
                  name={chatTargetUser?.name || chatTargetGroup?.name}
                  size={36}
                  className="border border-cyan-400"
                />
                <View>
                  <Text className="text-white font-black text-sm">
                    {chatTargetUser ? chatTargetUser.name : chatTargetGroup?.name}
                  </Text>
                  <Text className="text-cyan-400 text-[9px] font-bold">
                    {chatTargetUser ? `@${chatTargetUser.name.toLowerCase().replace(/\s+/g, "_")}` : "Gruppe"}
                  </Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => setShowChatModal(false)} className="p-1">
                <Ionicons name="close" size={24} color="#64748b" />
              </TouchableOpacity>
            </View>

            {/* Messages Scroll Area */}
            <ScrollView className="flex-1 mb-4" showsVerticalScrollIndicator={false}>
              {chatLoading ? (
                <View className="py-16 items-center justify-center">
                  <ActivityIndicator size="large" color="#22d3ee" />
                </View>
              ) : chatMessages.length === 0 ? (
                <View className="py-16 items-center justify-center bg-white/5 border border-white/5 rounded-3xl p-6 my-4">
                  <Ionicons name="chatbubbles-outline" size={36} color="#64748b" className="mb-2" />
                  <Text className="text-white text-xs font-black uppercase text-center">Noch keine Nachrichten</Text>
                  <Text className="text-slate-400 text-[10px] text-center mt-1">Schreibe die erste Nachricht!</Text>
                </View>
              ) : (
                chatMessages.map((msg) => {
                  const isMe = msg.sender_id === dbUser?.id;
                  return (
                    <View
                      key={msg.id}
                      className={`mb-3 flex-row ${isMe ? "justify-end" : "justify-start"}`}
                    >
                      <View
                        className={`max-w-[78%] px-4 py-2.5 rounded-2xl ${
                          isMe
                            ? "bg-cyan-500 rounded-tr-none"
                            : "bg-slate-900 border border-white/10 rounded-tl-none"
                        }`}
                      >
                        {!isMe && msg.sender_name && (
                          <Text className="text-cyan-400 text-[9px] font-black mb-1">{msg.sender_name}</Text>
                        )}
                        <Text className={`text-xs font-bold ${isMe ? "text-slate-950" : "text-white"}`}>
                          {msg.content}
                        </Text>
                        <Text className={`text-[8px] mt-1 text-right font-medium ${isMe ? "text-slate-950/70" : "text-slate-500"}`}>
                          {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </Text>
                      </View>
                    </View>
                  );
                })
              )}
            </ScrollView>

            {/* Input Bar */}
            <View className="flex-row items-center space-x-2 pt-2 border-t border-white/10">
              <TextInput
                placeholder="Nachricht schreiben..."
                placeholderTextColor="#475569"
                value={chatInputText}
                onChangeText={setChatInputText}
                className="flex-1 bg-slate-900 border border-white/10 rounded-2xl px-4 py-3 text-white text-xs font-bold"
              />
              <TouchableOpacity
                onPress={handleSendMessage}
                disabled={!chatInputText.trim()}
                className="bg-cyan-400 p-3 rounded-2xl active:scale-95 disabled:opacity-40"
              >
                <Ionicons name="send" size={16} color="#020617" />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Group Creation Modal */}
      <Modal
        visible={showCreateGroupModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowCreateGroupModal(false)}
      >
        <View className="flex-1 bg-black/85 justify-end">
          <View className="bg-slate-950 border-t border-purple-500/30 rounded-t-3xl p-6 pb-8">
            <View className="flex-row justify-between items-center mb-5">
              <Text className="text-white text-base font-black uppercase tracking-wider">Gruppe erstellen 👥</Text>
              <TouchableOpacity onPress={() => setShowCreateGroupModal(false)} className="p-1">
                <Ionicons name="close" size={24} color="#64748b" />
              </TouchableOpacity>
            </View>

            <Text className="text-slate-400 text-[10px] font-black uppercase tracking-wider mb-2">Gruppen-Name</Text>
            <TextInput
              placeholder="z. B. Stammtisch, Festival Crew 2026"
              placeholderTextColor="#475569"
              value={newGroupName}
              onChangeText={setNewGroupName}
              className="bg-slate-900 border border-white/10 rounded-2xl px-4 py-3 text-white font-bold text-xs mb-5"
            />

            <Text className="text-slate-400 text-[10px] font-black uppercase tracking-wider mb-2">
              Freunde auswählen ({selectedMemberIds.length})
            </Text>

            <ScrollView className="max-h-48 mb-6" showsVerticalScrollIndicator={false}>
              {friendsList.length === 0 ? (
                <Text className="text-slate-500 text-xs italic text-center py-4">Füge zuerst Freunde hinzu!</Text>
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
                        isSelected ? "bg-purple-500/20 border-purple-500" : "bg-slate-900 border-white/5"
                      }`}
                    >
                      <Text className="text-white text-xs font-bold">{f.name}</Text>
                      <Ionicons
                        name={isSelected ? "checkmark-circle" : "ellipse-outline"}
                        size={18}
                        color={isSelected ? "#c084fc" : "#64748b"}
                      />
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>

            <TouchableOpacity
              onPress={handleCreateGroup}
              disabled={!newGroupName.trim()}
              className="w-full bg-purple-500 py-3.5 rounded-2xl items-center shadow-lg shadow-purple-500/20 active:scale-95 disabled:opacity-40"
            >
              <Text className="text-slate-950 font-black text-xs uppercase tracking-wider">Gruppe jetzt erstellen</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Actions on another user. Reporting and blocking are a store
          requirement for apps with user-generated content — and they only
          count if they're reachable where the content is. */}
      <Modal visible={!!actionTargetUser} animationType="fade" transparent>
        <View className="flex-1 bg-black/70 justify-end">
          <View className="bg-slate-900 border-t border-white/10 rounded-t-3xl p-6 pb-10">
            <View className="flex-row items-center mb-6">
              <Avatar uri={actionTargetUser?.avatar} name={actionTargetUser?.name} size={40} className="border border-white/10" />
              <Text className="text-white text-sm font-black ml-3 flex-1" numberOfLines={1}>
                {actionTargetUser?.name}
              </Text>
            </View>

            <TouchableOpacity
              onPress={() => actionTargetUser && handleRemoveFriend(actionTargetUser)}
              className="flex-row items-center py-4 border-b border-white/5"
            >
              <Ionicons name="person-remove-outline" size={18} color="#e2e8f0" />
              <Text className="text-slate-200 text-xs font-bold ml-3">Freund entfernen</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                const target = actionTargetUser;
                setActionTargetUser(null);
                setReportReason(null);
                setReportDetails("");
                setReportTargetUser(target);
              }}
              className="flex-row items-center py-4 border-b border-white/5"
            >
              <Ionicons name="flag-outline" size={18} color="#fbbf24" />
              <Text className="text-amber-400 text-xs font-bold ml-3">Melden</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => actionTargetUser && handleBlockUser(actionTargetUser)}
              className="flex-row items-center py-4"
            >
              <Ionicons name="ban-outline" size={18} color="#f43f5e" />
              <Text className="text-rose-400 text-xs font-bold ml-3">Blockieren</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setActionTargetUser(null)}
              className="mt-4 py-3.5 rounded-2xl bg-white/5 border border-white/10 items-center"
            >
              <Text className="text-slate-400 text-xs font-black uppercase tracking-wider">Abbrechen</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Report dialog */}
      <Modal visible={!!reportTargetUser} animationType="slide" transparent>
        <View className="flex-1 bg-black/70 justify-end">
          <View className="bg-slate-900 border-t border-white/10 rounded-t-3xl p-6 pb-10">
            <Text className="text-white text-base font-black mb-1">
              {reportTargetUser?.name} melden
            </Text>
            <Text className="text-slate-400 text-[11px] leading-4 mb-5">
              Wir sehen uns jede Meldung an. Bei Gefahr für Leib und Leben wende dich bitte
              zusätzlich an die Polizei.
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
                <Text className={`text-xs font-bold ml-3 ${reportReason === reason ? "text-amber-400" : "text-slate-300"}`}>
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
              className="bg-slate-950/60 border border-white/5 rounded-2xl px-4 py-3 text-white text-xs mt-2 mb-4 min-h-[72px]"
            />

            <TouchableOpacity
              onPress={handleSubmitReport}
              disabled={!reportReason || reportSubmitting}
              className="w-full bg-amber-400 py-3.5 rounded-2xl items-center active:scale-95 disabled:opacity-40"
            >
              {reportSubmitting ? (
                <ActivityIndicator color="#020617" />
              ) : (
                <Text className="text-slate-950 font-black text-xs uppercase tracking-wider">Meldung absenden</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setReportTargetUser(null)}
              className="mt-3 py-3 items-center"
            >
              <Text className="text-slate-400 text-xs font-black uppercase tracking-wider">Abbrechen</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Blocked users — blocking has to be reversible by the user. */}
      <Modal visible={showBlockedModal} animationType="slide" transparent>
        <View className="flex-1 bg-black/70 justify-end">
          <View className="bg-slate-900 border-t border-white/10 rounded-t-3xl p-6 pb-10 max-h-[70%]">
            <View className="flex-row justify-between items-center mb-5">
              <Text className="text-white text-base font-black">Blockierte Nutzer</Text>
              <TouchableOpacity onPress={() => setShowBlockedModal(false)} className="w-8 h-8 items-center justify-center">
                <Ionicons name="close" size={20} color="#94a3b8" />
              </TouchableOpacity>
            </View>

            {blockedLoading ? (
              <ActivityIndicator color="#22d3ee" />
            ) : blockedUsers.length === 0 ? (
              <View className="py-10 items-center">
                <Ionicons name="checkmark-circle-outline" size={32} color="#475569" />
                <Text className="text-slate-500 text-xs font-bold mt-2 text-center">
                  Du hast niemanden blockiert.
                </Text>
              </View>
            ) : (
              <ScrollView>
                {blockedUsers.map((blocked) => (
                  <View
                    key={blocked.id}
                    className="bg-slate-950/60 border border-white/5 rounded-2xl p-3.5 flex-row justify-between items-center mb-2.5"
                  >
                    <View className="flex-row items-center flex-1 mr-2">
                      <Avatar uri={blocked.avatar || undefined} name={blocked.username} size={32} className="border border-white/10" />
                      <Text className="text-white text-xs font-black ml-3 flex-1" numberOfLines={1}>
                        {blocked.username}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => handleUnblockUser(blocked)}
                      className="bg-white/5 border border-white/10 px-3 py-1.5 rounded-xl"
                    >
                      <Text className="text-slate-300 text-[10px] font-black uppercase">Aufheben</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}
