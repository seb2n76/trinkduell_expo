import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "../_layout";
import { triggerHaptic } from "@/services/haptics";
import { Ionicons } from "@expo/vector-icons";

export default function RegisterScreen() {
  const router = useRouter();
  const { register } = useAuth();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRegister = async () => {
    if (!username.trim() || !email.trim() || !password || !confirmPassword) {
      await triggerHaptic("error");
      setError("Bitte fülle alle Felder aus!");
      return;
    }

    if (password !== confirmPassword) {
      await triggerHaptic("error");
      setError("Die Passwörter stimmen nicht überein!");
      return;
    }

    if (password.length < 6) {
      await triggerHaptic("error");
      setError("Das Passwort muss mindestens 6 Zeichen lang sein!");
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

      await Promise.race([register(username.trim(), email.trim(), password), timeoutPromise]);
    } catch (e: unknown) {
      await triggerHaptic("error");
      const errorMsg = e instanceof Error ? e.message : "Registrierung fehlgeschlagen.";
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      className="flex-1 bg-slate-950"
    >
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        <View className="flex-1 justify-center px-6 py-12">
          
          {/* Logo / Title */}
          <View className="items-center mb-8">
            <View className="bg-gradient-to-tr from-cyan-400 to-fuchsia-500 p-3.5 rounded-3xl mb-3 shadow-lg shadow-cyan-500/20">
              <Ionicons name="beer" size={36} color="#ffffff" />
            </View>
            <Text className="text-white text-2xl font-black tracking-widest text-center">
              TRINK<Text className="text-cyan-400">DUELL</Text>
            </Text>
            <Text className="text-slate-400 text-[10px] font-semibold uppercase tracking-widest mt-1.5 text-center">
              Account erstellen
            </Text>
          </View>

          {/* Form Card */}
          <View className="bg-white/5 border border-white/10 rounded-3xl p-6 shadow-2xl">
            <Text className="text-white text-base font-black tracking-wide mb-5">Erstelle dein Profil</Text>

            {error && (
              <View className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-3 mb-4 flex-row items-center space-x-2">
                <Ionicons name="alert-circle" size={18} color="#f43f5e" />
                <Text className="text-rose-400 text-xs font-semibold flex-1 ml-2">{error}</Text>
              </View>
            )}

            {/* Input Username */}
            <View className="mb-3">
              <Text className="text-slate-400 text-[9px] font-black uppercase tracking-wider mb-1.5">Username</Text>
              <View className="bg-white/5 border border-white/10 rounded-2xl flex-row items-center px-4 py-2.5">
                <Ionicons name="person-outline" size={16} color="rgba(255,255,255,0.4)" />
                <TextInput
                  placeholder="z. B. max_muster"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  value={username}
                  onChangeText={setUsername}
                  autoCapitalize="none"
                  editable={!loading}
                  className="flex-1 text-white font-bold text-sm ml-3"
                />
              </View>
            </View>

            {/* Input E-Mail */}
            <View className="mb-3">
              <Text className="text-slate-400 text-[9px] font-black uppercase tracking-wider mb-1.5">E-Mail Adresse</Text>
              <View className="bg-white/5 border border-white/10 rounded-2xl flex-row items-center px-4 py-2.5">
                <Ionicons name="mail-outline" size={16} color="rgba(255,255,255,0.4)" />
                <TextInput
                  placeholder="dein.name@domain.de"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  editable={!loading}
                  className="flex-1 text-white font-bold text-sm ml-3"
                />
              </View>
            </View>

            {/* Input Password */}
            <View className="mb-3">
              <Text className="text-slate-400 text-[9px] font-black uppercase tracking-wider mb-1.5">Passwort</Text>
              <View className="bg-white/5 border border-white/10 rounded-2xl flex-row items-center px-4 py-2.5">
                <Ionicons name="lock-closed-outline" size={16} color="rgba(255,255,255,0.4)" />
                <TextInput
                  placeholder="••••••••"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoCapitalize="none"
                  editable={!loading}
                  className="flex-1 text-white font-bold text-sm ml-3"
                />
              </View>
            </View>

            {/* Input Password Confirmation */}
            <View className="mb-5">
              <Text className="text-slate-400 text-[9px] font-black uppercase tracking-wider mb-1.5">Passwort bestätigen</Text>
              <View className="bg-white/5 border border-white/10 rounded-2xl flex-row items-center px-4 py-2.5">
                <Ionicons name="lock-closed-outline" size={16} color="rgba(255,255,255,0.4)" />
                <TextInput
                  placeholder="••••••••"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry
                  autoCapitalize="none"
                  editable={!loading}
                  className="flex-1 text-white font-bold text-sm ml-3"
                />
              </View>
            </View>

            {/* Register Button */}
            <TouchableOpacity
              onPress={handleRegister}
              disabled={loading}
              className={`rounded-2xl py-4 items-center justify-center shadow-lg shadow-fuchsia-500/20 active:scale-95 ${
                loading ? "bg-fuchsia-500/50 opacity-70" : "bg-fuchsia-500"
              }`}
            >
              {loading ? (
                <View className="flex-row items-center space-x-2">
                  <ActivityIndicator color="#ffffff" size="small" />
                  <Text className="text-white text-xs font-black uppercase tracking-wider ml-2">Registrierung läuft...</Text>
                </View>
              ) : (
                <Text className="text-white text-sm font-black uppercase tracking-wider">Registrieren & Starten</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Foot Links */}
          <View className="flex-row justify-center mt-6 space-x-2">
            <Text className="text-slate-400 text-xs font-semibold">Bereits ein Konto?</Text>
            <TouchableOpacity
              onPress={() => {
                triggerHaptic("light");
                router.push("/(auth)/login");
              }}
              disabled={loading}
            >
              <Text className="text-cyan-400 text-xs font-black ml-1">Hier einloggen</Text>
            </TouchableOpacity>
          </View>

        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
