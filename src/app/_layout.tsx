import "../../global.css";
import React, { createContext, useContext, useState, useEffect } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { apiService, cacheUser, setUnauthorizedHandler } from "@/services/api";
import { User } from "@/services/mockData";
import { ActivityIndicator, View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import NetInfo from "@react-native-community/netinfo";
import { SyncService } from "@/services/sync";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { registerForPushNotificationsAsync, getRouteForNotificationData } from "@/services/notifications";
import { setupPwa } from "@/services/pwa";
import * as Notifications from "expo-notifications";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { UnreadProvider } from "@/components/UnreadProvider";

const AGE_GATE_KEY = "trinkduell_age_18_confirmed";

/**
 * Eine dunkle Kopfzeile für alle Stack-Screens. Sie zwölfmal auszuschreiben
 * war der einzige Grund, warum die beiden Rechtstexte-Screens bisher so
 * ausführlich dastanden.
 */
const SCREEN_HEADER = {
  headerShown: true,
  headerStyle: { backgroundColor: "#020617" },
  headerTintColor: "#22d3ee",
  headerTitleStyle: { color: "#ffffff" },
} as const;

function AgeGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<"checking" | "confirmed" | "pending" | "declined">("checking");

  useEffect(() => {
    (async () => {
      try {
        const confirmed = await AsyncStorage.getItem(AGE_GATE_KEY);
        setStatus(confirmed === "true" ? "confirmed" : "pending");
      } catch {
        setStatus("pending");
      }
    })();
  }, []);

  const handleConfirm = async () => {
    await AsyncStorage.setItem(AGE_GATE_KEY, "true");
    setStatus("confirmed");
  };

  if (status === "checking") {
    return (
      <View className="flex-1 bg-slate-950 items-center justify-center">
        <ActivityIndicator size="large" color="#22d3ee" />
      </View>
    );
  }

  if (status === "confirmed") {
    return <>{children}</>;
  }

  if (status === "declined") {
    return (
      <View className="flex-1 bg-slate-950 items-center justify-center px-8">
        <View className="bg-slate-900 border border-slate-800 p-4 rounded-3xl mb-6">
          <Ionicons name="lock-closed" size={40} color="#64748b" />
        </View>
        <Text className="text-white text-lg font-black text-center mb-3">Zugang nicht möglich</Text>
        <Text className="text-slate-400 text-sm text-center leading-relaxed">
          TrinkDuell dreht sich um alkoholische Getränke und ist ausschließlich für Erwachsene ab 18 Jahren
          gedacht. Du kannst die App leider nicht nutzen.
        </Text>
      </View>
    );
  }

  // status === "pending"
  return (
    <View className="flex-1 bg-slate-950 items-center justify-center px-6">
      <View className="w-full max-w-sm bg-white/5 border border-white/10 rounded-3xl p-6 shadow-2xl">
        <View className="items-center mb-5">
          <View className="bg-gradient-to-tr from-cyan-400 to-fuchsia-500 p-3.5 rounded-3xl mb-4 shadow-lg shadow-cyan-500/20">
            <Ionicons name="beer" size={32} color="#ffffff" />
          </View>
          <Text className="text-white text-xl font-black text-center tracking-wide">Altersbestätigung</Text>
        </View>

        <Text className="text-slate-300 text-sm text-center leading-relaxed mb-4">
          TrinkDuell dreht sich um alkoholische Getränke und ist nur für Erwachsene gedacht.
          Bist du <Text className="text-cyan-400 font-black">18 Jahre oder älter</Text>?
        </Text>

        <View className="bg-slate-950/60 border border-white/5 rounded-2xl p-4 mb-6">
          <Text className="text-slate-400 text-[11px] text-center leading-relaxed">
            Bitte trinke verantwortungsvoll. TrinkDuell soll Spaß mit Freunden fördern — nicht exzessiven
            Alkoholkonsum. Kenne deine Grenzen und die deiner Freunde.
          </Text>
        </View>

        <TouchableOpacity
          onPress={handleConfirm}
          className="w-full bg-cyan-400 py-4 rounded-2xl items-center shadow-lg shadow-cyan-500/20 active:scale-95 mb-3"
        >
          <Text className="text-slate-950 font-black text-sm uppercase tracking-wider">
            Ja, ich bin 18 Jahre oder älter
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setStatus("declined")}
          className="w-full py-3 rounded-2xl items-center"
        >
          <Text className="text-slate-500 font-bold text-xs uppercase tracking-wider">Nein</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// Define AuthContext type
interface AuthContextType {
  token: string | null;
  user: User | null;
  login: (emailOrUsername: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  isLoading: boolean;
  updateUserContext: (updatedUser: User) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

export default function RootLayout() {
  useEffect(() => {
    // Service Worker + Manifest (nur Web, sonst No-op)
    setupPwa();

    // Run initial sync on boot
    SyncService.processQueue();

    // Subscribe to network changes
    const unsubscribe = NetInfo.addEventListener((state) => {
      if (state.isConnected) {
        console.log("[RootLayout] Network connection restored/active, processing sync queue...");
        SyncService.processQueue();
      }
    });

    return () => unsubscribe();
  }, []);

  return (
    <SafeAreaProvider>
      <AgeGate>
        <AuthProvider>
          <NavigationLayout />
        </AuthProvider>
      </AgeGate>
    </SafeAreaProvider>
  );
}

function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Let the api layer end the session when the server rejects our token
  // (expired, account deleted, or a password reset ended every session).
  // Without this the app would keep rendering a logged-in shell whose every
  // request fails with 401.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setToken(null);
      setUser(null);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  // Load session on startup
  useEffect(() => {
    async function loadSession() {
      try {
        const session = await apiService.getSession();
        if (session) {
          setToken(session.token);
          setUser(session.user);
          registerForPushNotificationsAsync();
        }
      } catch (e) {
        console.warn("Failed to load session on start:", e);
      } finally {
        setIsLoading(false);
      }
    }
    loadSession();
  }, []);

  const login = async (emailOrUsername: string, password: string) => {
    const res = await apiService.login(emailOrUsername, password);
    await AsyncStorage.setItem("trinkduell_v2_jwt_token", res.token);
    setToken(res.token);
    setUser(res.user);
    registerForPushNotificationsAsync();
  };

  const register = async (username: string, email: string, password: string) => {
    const res = await apiService.register(username, email, password);
    await AsyncStorage.setItem("trinkduell_v2_jwt_token", res.token);
    setToken(res.token);
    setUser(res.user);
    registerForPushNotificationsAsync();
  };

  const logout = async () => {
    await apiService.logout();
    await AsyncStorage.removeItem("trinkduell_v2_jwt_token");
    setToken(null);
    setUser(null);
  };

  // Gehört hierher und nicht in den Passwort-Screen: die Änderung entwertet
  // serverseitig jeden bestehenden Token, auch den in AsyncStorage. Wird der
  // Austausch vergessen, ist die eigene Sitzung ab dem nächsten Request tot —
  // also liegt er an derselben Stelle wie bei login/register.
  const changePassword = async (currentPassword: string, newPassword: string) => {
    const res = await apiService.changePassword(currentPassword, newPassword);
    await AsyncStorage.setItem("trinkduell_v2_jwt_token", res.token);
    setToken(res.token);
  };

  const updateUserContext = (updatedUser: User) => {
    setUser(updatedUser);
    // Keep the session-restore cache current so a reload shortly after any
    // profile/stat change (drink logged, avatar changed, level up, ...)
    // shows the latest known state instead of a stale login-time snapshot.
    cacheUser(updatedUser);
  };

  return (
    <AuthContext.Provider
      value={{
        token,
        user,
        login,
        register,
        logout,
        changePassword,
        isLoading,
        updateUserContext,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

function NavigationLayout() {
  const { token, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  // Route a tapped notification to a relevant screen (e.g. a duel challenge
  // opens the games tab). No-op on web where this listener never fires.
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      router.push(getRouteForNotificationData(data));
    });
    return () => subscription.remove();
  }, [router]);

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === "(auth)";
    // Privacy policy / terms must stay reachable from the registration screen
    // even before login, so exempt them from the auth redirect.
    const isPublicRoute = inAuthGroup || segments[0] === "legal";

    // Short timeout to guarantee router mounting completes on all platforms
    const timer = setTimeout(() => {
      if (!token && !isPublicRoute) {
        router.replace("/(auth)/login");
      } else if (token && inAuthGroup) {
        router.replace("/(tabs)");
      }
    }, 1);

    return () => clearTimeout(timer);
  }, [token, isLoading, segments, router]);

  if (isLoading) {
    return (
      <View className="flex-1 bg-slate-950 items-center justify-center">
        <ActivityIndicator size="large" color="#22d3ee" />
      </View>
    );
  }

  return (
    <UnreadProvider enabled={!!token}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen
          name="notifications"
          options={{
            presentation: "modal",
            title: "Benachrichtigungen",
            headerShown: false
          }}
        />

        {/* Die Bereiche, die bisher als Dialoge im Tab-Layout lagen. Als
            eigene Routen haben sie einen Titel, einen Zurück-Weg und eine
            Adresse — und stapeln sich nicht mehr gegenseitig zu. */}
        <Stack.Screen name="profile" options={{ ...SCREEN_HEADER, title: "Profil" }} />
        <Stack.Screen name="friends/index" options={{ ...SCREEN_HEADER, title: "Freunde" }} />
        <Stack.Screen name="friends/group/[id]" options={{ ...SCREEN_HEADER, title: "Gruppe" }} />
        <Stack.Screen name="friends/quests/[id]" options={{ ...SCREEN_HEADER, title: "Quests" }} />
        <Stack.Screen name="chat/[id]" options={{ ...SCREEN_HEADER, title: "Chat" }} />
        <Stack.Screen name="settings/index" options={{ ...SCREEN_HEADER, title: "Einstellungen" }} />
        <Stack.Screen name="settings/password" options={{ ...SCREEN_HEADER, title: "Passwort ändern" }} />
        <Stack.Screen name="settings/location" options={{ ...SCREEN_HEADER, title: "Standort" }} />
        <Stack.Screen name="settings/licenses" options={{ ...SCREEN_HEADER, title: "Lizenzen" }} />
        <Stack.Screen name="settings/blocked" options={{ ...SCREEN_HEADER, title: "Blockierte Nutzer" }} />
        <Stack.Screen name="moderation" options={{ ...SCREEN_HEADER, title: "Meldungen" }} />
        <Stack.Screen name="help" options={{ ...SCREEN_HEADER, title: "Hilfe & Feedback" }} />
        <Stack.Screen name="map" options={{ ...SCREEN_HEADER, title: "Karte" }} />

        <Stack.Screen name="legal/privacy" options={{ ...SCREEN_HEADER, title: "Datenschutzerklärung" }} />
        <Stack.Screen name="legal/terms" options={{ ...SCREEN_HEADER, title: "Nutzungsbedingungen" }} />
      </Stack>
    </UnreadProvider>
  );
}

