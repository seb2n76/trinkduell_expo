import "../../global.css";
import React, { createContext, useContext, useState, useEffect } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { apiService } from "@/services/api";
import { User } from "@/services/mockData";
import { ActivityIndicator, View } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { SyncService } from "@/services/sync";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Define AuthContext type
interface AuthContextType {
  token: string | null;
  user: User | null;
  login: (emailOrUsername: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
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

import { SafeAreaProvider } from "react-native-safe-area-context";

export default function RootLayout() {
  useEffect(() => {
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
      <AuthProvider>
        <NavigationLayout />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load session on startup
  useEffect(() => {
    async function loadSession() {
      try {
        const session = await apiService.getSession();
        if (session) {
          setToken(session.token);
          setUser(session.user);
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
  };

  const register = async (username: string, email: string, password: string) => {
    const res = await apiService.register(username, email, password);
    await AsyncStorage.setItem("trinkduell_v2_jwt_token", res.token);
    setToken(res.token);
    setUser(res.user);
  };

  const logout = async () => {
    await apiService.logout();
    await AsyncStorage.removeItem("trinkduell_v2_jwt_token");
    setToken(null);
    setUser(null);
  };

  const updateUserContext = (updatedUser: User) => {
    setUser(updatedUser);
  };

  return (
    <AuthContext.Provider
      value={{
        token,
        user,
        login,
        register,
        logout,
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

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === "(auth)";

    // Short timeout to guarantee router mounting completes on all platforms
    const timer = setTimeout(() => {
      if (!token && !inAuthGroup) {
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
    </Stack>
  );
}

