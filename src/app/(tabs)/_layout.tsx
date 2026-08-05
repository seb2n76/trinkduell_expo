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
import { apiService } from "@/services/api";
import { useAuth } from "../_layout";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { triggerHaptic } from "@/services/haptics";
import { User, Drink, DrinkLog, DirectMessage, Group } from "@/services/mockData";
import * as ImagePicker from "expo-image-picker";

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
  const { logout: authLogout, updateUserContext } = useAuth();
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

  // Friends & Live Search states
  const [showFriendsModal, setShowFriendsModal] = useState(false);
  const [friendsList, setFriendsList] = useState<User[]>([]);
  const [pendingRequests, setPendingRequests] = useState<User[]>([]);
  const [friendSearchQuery, setFriendSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [friendsLoading, setFriendsLoading] = useState(false);

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
    } catch (e) {
      console.error("Failed to load friends in layout modal:", e);
    } finally {
      setFriendsLoading(false);
    }
  };

  const handleSendFriendRequest = async (targetUsername?: string) => {
    const receiver = targetUsername || friendSearchQuery.trim();
    if (!dbUser || !receiver) return;
    if (receiver.toLowerCase() === dbUser.name.toLowerCase()) {
      Alert.alert("Fehler", "Du kannst dir nicht selbst eine Anfrage schicken!");
      return;
    }

    try {
      await triggerHaptic("success");
      await apiService.sendFriendRequest(dbUser.name, receiver);
      Alert.alert("Erfolg", `Freundschaftsanfrage an ${receiver} gesendet!`);
      setFriendSearchQuery("");
      setSearchResults([]);
      await loadFriendsData();
    } catch (e) {
      await triggerHaptic("error");
      const msg = e instanceof Error ? e.message : "Anfrage konnte nicht gesendet werden.";
      Alert.alert("Fehler", msg);
    }
  };

  const handleAcceptFriendRequest = async (senderName: string) => {
    if (!dbUser) return;
    try {
      await triggerHaptic("success");
      await apiService.acceptFriendRequest(senderName, dbUser.name);
      Alert.alert("Erfolg", `Freundschaftsanfrage von ${senderName} angenommen!`);
      await loadFriendsData();
    } catch (e) {
      await triggerHaptic("error");
      const msg = e instanceof Error ? e.message : "Anfrage konnte nicht angenommen werden.";
      Alert.alert("Fehler", msg);
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
      Alert.alert("Fehler", "Nachricht konnte nicht gesendet werden.");
    }
  };

  // Group Creation
  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) {
      Alert.alert("Fehler", "Bitte gib einen Gruppen-Namen ein!");
      return;
    }
    try {
      await triggerHaptic("success");
      await apiService.createGroup(newGroupName.trim(), selectedMemberIds);
      Alert.alert("Erfolg", `Gruppe "${newGroupName.trim()}" wurde erstellt!`);
      setShowCreateGroupModal(false);
      setNewGroupName("");
      setSelectedMemberIds([]);
    } catch (e) {
      Alert.alert("Fehler", "Gruppe konnte nicht erstellt werden.");
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

        const uploadResult = await apiService.uploadAvatar(dbUser.id, pickedUri, base64Data || undefined);
        const updatedUser = { ...dbUser, avatar: uploadResult.avatarUrl };
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
      alert("Name darf nicht leer sein!");
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
                        <Image
                          source={{ uri: dbUser.avatar || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&q=80" }}
                          className="w-16 h-16 rounded-full border border-slate-700"
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

            {/* Friend Request & Live User Search Input */}
            <View className="bg-slate-950/80 border border-white/5 rounded-2xl p-4 mb-4">
              <Text className="text-slate-400 text-[9px] font-black uppercase mb-2">Nutzer oder @username suchen</Text>
              <View className="flex-row space-x-2">
                <TextInput
                  placeholder="Name oder @username eingeben..."
                  placeholderTextColor="#475569"
                  value={friendSearchQuery}
                  onChangeText={setFriendSearchQuery}
                  className="flex-1 bg-slate-900 border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs font-bold"
                />
                {isSearching ? (
                  <View className="px-3 items-center justify-center">
                    <ActivityIndicator size="small" color="#c084fc" />
                  </View>
                ) : (
                  <TouchableOpacity
                    onPress={() => handleSendFriendRequest()}
                    className="bg-purple-500 px-4 rounded-xl items-center justify-center active:scale-95"
                  >
                    <Ionicons name="person-add" size={14} color="#020617" />
                  </TouchableOpacity>
                )}
              </View>
            </View>

            <ScrollView className="flex-1 mb-2" showsVerticalScrollIndicator={false}>
              {/* Live Search Results Section */}
              {searchResults.length > 0 && (
                <View className="mb-6">
                  <Text className="text-cyan-400 text-[10px] font-black uppercase tracking-wider mb-3">
                    Suchergebnisse ({searchResults.length})
                  </Text>
                  {searchResults.map((resUser) => (
                    <View
                      key={resUser.id}
                      className="bg-slate-950/80 border border-cyan-500/20 rounded-2xl p-3 flex-row justify-between items-center mb-2"
                    >
                      <View className="flex-row items-center space-x-3 flex-1 mr-2">
                        {resUser.avatar ? (
                          <Image source={{ uri: resUser.avatar }} className="w-9 h-9 rounded-full border border-white/10" />
                        ) : (
                          <View className="w-9 h-9 rounded-full bg-slate-900 border border-white/10 items-center justify-center">
                            <Text className="text-cyan-400 font-black text-xs">
                              {resUser.name.substring(0, 2).toUpperCase()}
                            </Text>
                          </View>
                        )}
                        <View className="flex-1">
                          <Text className="text-white text-xs font-black" numberOfLines={1}>{resUser.name}</Text>
                          <Text className="text-cyan-400/90 text-[10px] font-bold">
                            @{resUser.name.toLowerCase().replace(/\s+/g, "_")}
                          </Text>
                        </View>
                      </View>
                      <TouchableOpacity
                        onPress={() => handleSendFriendRequest(resUser.name)}
                        className="bg-cyan-400 px-3 py-1.5 rounded-xl flex-row items-center space-x-1"
                      >
                        <Ionicons name="person-add" size={12} color="#020617" />
                        <Text className="text-slate-950 font-black text-[10px] uppercase">Anfragen</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
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
                            {req.avatar ? (
                              <Image source={{ uri: req.avatar }} className="w-8 h-8 rounded-full border border-white/10" />
                            ) : (
                              <View className="w-8 h-8 rounded-full bg-slate-900 border border-white/5 items-center justify-center">
                                <Text className="text-white text-xs font-black">
                                  {req.name.substring(0, 2).toUpperCase()}
                                </Text>
                              </View>
                            )}
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
                          {friend.avatar ? (
                            <Image source={{ uri: friend.avatar }} className="w-9 h-9 rounded-full border border-white/10" />
                          ) : (
                            <View className="w-9 h-9 rounded-full bg-slate-900 border border-white/5 items-center justify-center">
                              <Text className="text-white text-xs font-black">
                                {friend.name.substring(0, 2).toUpperCase()}
                              </Text>
                            </View>
                          )}
                          <View className="flex-1">
                            <Text className="text-white text-xs font-black" numberOfLines={1}>{friend.name}</Text>
                            <Text className="text-cyan-400 text-[9px] font-bold mt-0.5">@{friend.name.toLowerCase().replace(/\s+/g, "_")}</Text>
                          </View>
                        </View>

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
                      </View>
                    ))
                  )}
                </>
              )}
            </ScrollView>
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
                {chatTargetUser?.avatar ? (
                  <Image source={{ uri: chatTargetUser.avatar }} className="w-9 h-9 rounded-full border border-cyan-400" />
                ) : (
                  <View className="w-9 h-9 rounded-full bg-slate-900 border border-cyan-400 items-center justify-center">
                    <Text className="text-cyan-400 font-black text-xs">
                      {(chatTargetUser?.name || chatTargetGroup?.name || "C").substring(0, 2).toUpperCase()}
                    </Text>
                  </View>
                )}
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
    </View>
  );
}
