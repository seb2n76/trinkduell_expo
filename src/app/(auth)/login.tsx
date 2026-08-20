import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "../_layout";
import { triggerHaptic } from "@/services/haptics";
import { Ionicons } from "@expo/vector-icons";
import { useThemeColors } from "@/services/theme";

export default function LoginScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const { login } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    if (!identifier.trim() || !password.trim()) {
      await triggerHaptic("error");
      setError("Bitte fülle alle Felder aus!");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await triggerHaptic("success");

      // 10-second timeout race condition for slow network / backend cold start
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error("Zeitüberschreitung beim Server-Kaltstart (10s). Bitte versuche es erneut."));
        }, 10000);
      });

      await Promise.race([login(identifier.trim(), password), timeoutPromise]);
    } catch (e: unknown) {
      await triggerHaptic("error");
      const errorMsg = e instanceof Error ? e.message : "Anmeldung fehlgeschlagen.";
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      className="flex-1 bg-bg"
    >
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        <View className="flex-1 justify-center px-6 py-12">
          
          {/* Logo / Title */}
          <View className="items-center mb-10">
            <View className="bg-gradient-to-tr from-cyan-400 to-fuchsia-500 p-4 rounded-3xl mb-4 shadow-lg">
              <Ionicons name="beer" size={40} color={c.content} />
            </View>
            <Text className="text-content text-3xl font-black tracking-widest text-center">
              TRINK<Text className="text-accent-ink">DUELL</Text>
            </Text>
            <Text className="text-content-muted text-xs font-semibold uppercase tracking-widest mt-2 text-center">
              Der gamifizierte Party-Tracker
            </Text>
          </View>

          {/* Form Card */}
          <View className="bg-surface border border-line rounded-3xl p-6 shadow-2xl">
            <Text className="text-content text-lg font-black tracking-wide mb-6">Willkommen zurück!</Text>

            {error && (
              <View className="bg-danger/10 border border-danger/20 rounded-xl p-3 mb-5 flex-row items-center space-x-2">
                <Ionicons name="alert-circle" size={18} color={c.danger} />
                <Text className="text-danger text-xs font-semibold flex-1 ml-2">{error}</Text>
              </View>
            )}

            {/* Input E-Mail/Username */}
            <View className="mb-4">
              <Text className="text-content-muted text-[10px] font-black uppercase tracking-wider mb-2">Username oder E-Mail</Text>
              <View className="bg-surface border border-line rounded-2xl flex-row items-center px-4 py-3">
                <Ionicons name="person-outline" size={18} color="rgba(255,255,255,0.4)" />
                <TextInput
                  placeholder="dein.name@domain.de oder max_muster"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  value={identifier}
                  onChangeText={setIdentifier}
                  autoCapitalize="none"
                  editable={!loading}
                  className="flex-1 text-content font-bold text-sm ml-3"
                />
              </View>
            </View>

            {/* Input Password */}
            <View className="mb-6">
              <Text className="text-content-muted text-[10px] font-black uppercase tracking-wider mb-2">Passwort</Text>
              <View className="bg-surface border border-line rounded-2xl flex-row items-center px-4 py-3">
                <Ionicons name="lock-closed-outline" size={18} color="rgba(255,255,255,0.4)" />
                <TextInput
                  placeholder="••••••••"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoCapitalize="none"
                  editable={!loading}
                  className="flex-1 text-content font-bold text-sm ml-3"
                />
              </View>
            </View>

            {/* Login Button */}
            <TouchableOpacity
              onPress={handleLogin}
              disabled={loading}
              className={`rounded-2xl py-4 items-center justify-center shadow-lg active:scale-95 ${
                loading ? "bg-accent/50 opacity-70" : "bg-accent"
              }`}
            >
              {loading ? (
                <View className="flex-row items-center space-x-2">
                  <ActivityIndicator color={c.content} size="small" />
                  <Text className="text-content text-xs font-black uppercase tracking-wider ml-2">Anmeldung läuft...</Text>
                </View>
              ) : (
                <Text className="text-content text-sm font-black uppercase tracking-wider">Einloggen</Text>
              )}
            </TouchableOpacity>

            {/* Forgot Password Link */}
            <TouchableOpacity
              onPress={() => {
                triggerHaptic("light");
                router.push("/(auth)/forgot-password");
              }}
              disabled={loading}
              className="mt-4 align-center self-center"
            >
              <Text className="text-accent-ink text-xs font-black tracking-wide">Passwort vergessen?</Text>
            </TouchableOpacity>
          </View>

          {/* Foot Links */}
          <View className="flex-row justify-center mt-8 space-x-2">
            <Text className="text-content-muted text-xs font-semibold">Noch kein Konto?</Text>
            <TouchableOpacity
              onPress={() => {
                triggerHaptic("light");
                router.push("/(auth)/register");
              }}
              disabled={loading}
            >
              <Text className="text-accent-2-ink text-xs font-black ml-1">Jetzt registrieren</Text>
            </TouchableOpacity>
          </View>

        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
