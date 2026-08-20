import React, { useState, useEffect, useRef } from "react";
import { Tabs, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  View,
  Text,
  TouchableOpacity,
  Dimensions,
  Animated,
  ScrollView,
} from "react-native";
import { apiService } from "@/services/api";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { triggerHaptic } from "@/services/haptics";
import { User } from "@/services/mockData";
import { Avatar } from "@/components/Avatar";
import { useUnread } from "@/components/UnreadProvider";
import { useThemeColors } from "@/services/theme";

const { width: screenWidth } = Dimensions.get("window");
const drawerWidth = screenWidth < 800 ? Math.min(screenWidth * 0.8, 340) : screenWidth * 0.35;

/**
 * Ein Eintrag im Menü. Führt auf einen eigenen Screen — mehr tut er nicht.
 */
function DrawerLink({
  icon,
  color,
  label,
  hint,
  badge,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  color: string;
  label: string;
  hint: string;
  badge?: number;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={label}
      className="bg-surface border border-line p-4 rounded-3xl mb-3 flex-row items-center active:scale-95"
    >
      <View
        style={{ backgroundColor: `${color}1a`, borderColor: `${color}33` }}
        className="w-10 h-10 rounded-xl border items-center justify-center"
      >
        <Ionicons name={icon} size={19} color={color} />
      </View>
      <View className="flex-1 ml-3.5">
        <Text className="text-content text-xs font-black">{label}</Text>
        <Text className="text-content-faint text-[9px] font-semibold mt-0.5">{hint}</Text>
      </View>
      {badge && badge > 0 ? (
        <View
          style={{ backgroundColor: color }}
          className="min-w-[20px] h-[20px] rounded-full items-center justify-center px-1.5 mr-1.5"
        >
          <Text className="text-[10px] font-black text-on-accent">
            {badge > 99 ? "99+" : badge}
          </Text>
        </View>
      ) : null}
      <Ionicons name="chevron-forward" size={16} color={color} />
    </TouchableOpacity>
  );
}

/**
 * Tab-Leiste plus Menü.
 *
 * Das Menü ist bewusst nur noch ein Sprungbrett: je ein Eintrag pro Bereich,
 * jeder führt auf einen eigenen Screen. Vorher lagen Profil, Freunde,
 * Erfolge, Konsum-Verlauf, Standort, Rechtstexte, Passwort, Abmelden und
 * Kontolöschung als eine flache Reihe in genau diesem Overlay — zusammen mit
 * vierzehn Dialogen, die sich gegenseitig überlagerten und deshalb in einer
 * bestimmten JSX-Reihenfolge stehen mussten.
 */
export default function TabsLayout() {
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { unread } = useUnread();

  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [dbUser, setDbUser] = useState<User | null>(null);
  const [notificationCount, setNotificationCount] = useState(0);

  const drawerAnim = useRef(new Animated.Value(0)).current;

  // Offene Beitrittsanfragen für die Glocke oben rechts. Die Glocke steht für
  // etwas anderes als der Punkt am Menü-Symbol (ungelesene Nachrichten).
  useEffect(() => {
    const loadNotificationCount = async () => {
      try {
        const userRes = await apiService.getCurrentUser();
        const groupsRes = await apiService.getGroups();
        const adminGroups = groupsRes.filter((g) => g.adminId === userRes.id);
        setNotificationCount(
          adminGroups.reduce((sum, g) => sum + (g.pendingUserIds?.length || 0), 0)
        );
      } catch (error) {
        console.error("Failed to load notifications count in layout:", error);
      }
    };

    loadNotificationCount();
    const interval = setInterval(loadNotificationCount, 15000);
    return () => clearInterval(interval);
  }, []);

  const openDrawer = async () => {
    setIsDrawerOpen(true);
    Animated.timing(drawerAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();

    // Nur so viel laden, wie das Menü selbst anzeigt: Name, Bild, Level und
    // ob der Moderations-Eintrag erscheinen soll. Alles Weitere holt sich der
    // jeweilige Screen.
    try {
      setDbUser(await apiService.getCurrentUser());
    } catch (e) {
      console.error("Failed to load user for drawer:", e);
    }
  };

  const closeDrawer = () => {
    Animated.timing(drawerAnim, {
      toValue: 0,
      duration: 250,
      useNativeDriver: true,
    }).start(() => setIsDrawerOpen(false));
  };

  const toggleDrawer = () => {
    if (isDrawerOpen) closeDrawer();
    else openDrawer();
  };

  /** Menü schließen und weiterspringen. */
  const goTo = (pfad: string) => {
    triggerHaptic("light");
    closeDrawer();
    router.push(pfad as never);
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
    <View className="flex-1 bg-bg">
      <Tabs
        screenOptions={{
          tabBarStyle: {
            backgroundColor: c.bg,
            borderTopWidth: 1,
            borderTopColor: "rgba(255, 255, 255, 0.08)",
            height: insets.bottom > 0 ? 56 + insets.bottom : 64,
            paddingBottom: insets.bottom > 0 ? insets.bottom : 8,
            paddingTop: 8,
          },
          tabBarActiveTintColor: c.accent,
          tabBarInactiveTintColor: c.contentFaint,
          headerStyle: {
            backgroundColor: c.bg,
            borderBottomWidth: 1,
            borderBottomColor: "rgba(255, 255, 255, 0.08)",
          },
          headerTitleStyle: {
            color: c.content,
            fontWeight: "900",
            letterSpacing: 1.2,
          },
          headerLeft: () => (
            <TouchableOpacity
              onPress={toggleDrawer}
              accessibilityLabel="Menü öffnen"
              className="ml-4 p-1.5 relative active:scale-95"
            >
              <Ionicons name="menu-outline" size={26} color={c.accent} />
              {/* Ungelesene Nachrichten. Sitzt am Menü-Symbol, weil die Chats
                  über das Menü erreichbar sind — die Glocke rechts steht fuer
                  etwas anderes (offene Beitrittsanfragen). */}
              {unread.total > 0 && (
                <View className="absolute top-0 right-0 bg-accent min-w-[18px] h-[18px] rounded-full items-center justify-center border border-surface-alt px-1">
                  <Text className="text-[10px] font-black text-on-accent text-center">
                    {unread.total > 99 ? "99+" : unread.total}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          ),
          headerRight: () => (
            <TouchableOpacity
              onPress={() => router.push("/notifications")}
              accessibilityLabel="Benachrichtigungen"
              className="mr-4 relative p-1.5 active:scale-90"
            >
              <Ionicons name="notifications" size={24} color={c.accent} />
              {notificationCount > 0 && (
                <View className="absolute top-0 right-0 bg-danger min-w-[18px] h-[18px] rounded-full items-center justify-center border border-surface-alt px-1">
                  {/* Fest weiss: ein Warnabzeichen ist in beiden Schemata ein
                      kraeftiges Rot, auf dem dunkle Ziffern untergehen. */}
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
              <Ionicons
                name={focused ? "game-controller" : "game-controller-outline"}
                size={size}
                color={color}
              />
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
          MENÜ — Sprungbrett, keine Inhalte
          ========================================== */}
      {isDrawerOpen && (
        <View
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 999 }}
          pointerEvents="auto"
        >
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

          <Animated.View
            style={{
              transform: [{ translateX: drawerTranslateX }],
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: drawerWidth,
            }}
            className="bg-surface-alt border-r border-line"
          >
            <View className="flex-1 pt-12 pb-6 px-5 bg-surface-alt">
              <View className="flex-row justify-between items-center mb-6">
                <Text className="text-content text-lg font-black tracking-widest uppercase">
                  TrinkDuell
                </Text>
                <TouchableOpacity
                  onPress={closeDrawer}
                  accessibilityLabel="Menü schließen"
                  className="p-1"
                >
                  <Ionicons name="close-outline" size={24} color={c.contentFaint} />
                </TouchableOpacity>
              </View>

              <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
                {/* Der Kopf ist zugleich der Weg ins Profil — Bild und Name
                    sind das, worauf man dafür ohnehin tippt. */}
                <TouchableOpacity
                  onPress={() => goTo("/profile")}
                  accessibilityRole="link"
                  accessibilityLabel="Profil öffnen"
                  className="flex-row items-center bg-surface border border-line p-4 rounded-3xl mb-6 active:scale-95"
                >
                  <Avatar
                    uri={dbUser?.avatar}
                    name={dbUser?.name}
                    size={48}
                    className="border border-line-strong"
                  />
                  <View className="flex-1 ml-3.5">
                    <Text className="text-content text-sm font-black" numberOfLines={1}>
                      {dbUser?.name || "Gast"}
                    </Text>
                    <Text className="text-accent-ink text-[9px] font-black uppercase tracking-widest mt-0.5">
                      Level {dbUser?.currentLevel || dbUser?.level || 1} ·{" "}
                      {dbUser?.title || "Neuling"}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={c.accent} />
                </TouchableOpacity>

                <DrawerLink
                  icon="people-outline"
                  color={c.accent2}
                  label="Freunde"
                  hint="Freunde, Gruppen & Events"
                  badge={unread.total}
                  onPress={() => goTo("/friends")}
                />

                <DrawerLink
                  icon="settings-outline"
                  color={c.accent}
                  label="Einstellungen"
                  hint="Konto, Datenschutz, Rechtliches"
                  onPress={() => goTo("/settings")}
                />

                <DrawerLink
                  icon="help-circle-outline"
                  color={c.success}
                  label="Hilfe & Feedback"
                  hint="Häufige Fragen und Kontakt"
                  onPress={() => goTo("/help")}
                />

                {/* Nur fuer Moderatoren (ADMIN_USER_IDS auf dem Server).
                    Reine Anzeigehilfe: die Routen pruefen unabhaengig davon. */}
                {dbUser?.isModerator && (
                  <DrawerLink
                    icon="shield-outline"
                    color={c.warning}
                    label="Meldungen"
                    hint="Gemeldete Inhalte bearbeiten"
                    onPress={() => goTo("/moderation")}
                  />
                )}
              </ScrollView>
            </View>
          </Animated.View>
        </View>
      )}
    </View>
  );
}
