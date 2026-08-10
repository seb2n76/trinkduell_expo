import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { apiService } from "@/services/api";
import { triggerHaptic } from "@/services/haptics";
import { Ionicons } from "@expo/vector-icons";

type Step = "request" | "reset" | "done";

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("request");

  const [email, setEmail] = useState("");
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRequestReset = async () => {
    if (!email.trim()) {
      await triggerHaptic("error");
      setError("Bitte gib deine E-Mail Adresse ein!");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await triggerHaptic("success");
      const res = await apiService.forgotPassword(email.trim());
      // The server answers the same way whether or not the address exists, and
      // never sends the code itself — so there is nothing to display here
      // beyond its message.
      setInfoMessage(res.message || null);
      setStep("reset");
    } catch (e: any) {
      await triggerHaptic("error");
      setError(e.message || "E-Mail konnte nicht gesendet werden.");
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!code.trim() || !newPassword || !confirmPassword) {
      await triggerHaptic("error");
      setError("Bitte fülle alle Felder aus!");
      return;
    }
    if (newPassword !== confirmPassword) {
      await triggerHaptic("error");
      setError("Die Passwörter stimmen nicht überein!");
      return;
    }
    // Must match the server's minimum (LIMITS.password in server/index.js).
    if (newPassword.length < 8) {
      await triggerHaptic("error");
      setError("Das Passwort muss mindestens 8 Zeichen lang sein!");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await apiService.resetPassword(email.trim(), code.trim(), newPassword);
      await triggerHaptic("success");
      setStep("done");
    } catch (e: any) {
      await triggerHaptic("error");
      setError(e.message || "Passwort konnte nicht zurückgesetzt werden.");
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

          {/* Back Button */}
          <TouchableOpacity
            onPress={() => {
              triggerHaptic("light");
              router.back();
            }}
            className="absolute top-12 left-6 bg-white/5 border border-white/10 rounded-full w-10 h-10 items-center justify-center active:scale-90 z-50"
          >
            <Ionicons name="arrow-back" size={20} color="#ffffff" />
          </TouchableOpacity>

          {/* Logo / Title */}
          <View className="items-center mb-10">
            <View className="bg-gradient-to-tr from-cyan-400 to-fuchsia-500 p-4 rounded-3xl mb-4 shadow-lg shadow-cyan-500/20">
              <Ionicons name="key-outline" size={40} color="#ffffff" />
            </View>
            <Text className="text-white text-2xl font-black tracking-widest text-center">
              PASSWORT<Text className="text-cyan-400"> VERGESSEN</Text>
            </Text>
            <Text className="text-slate-400 text-xs font-semibold mt-2 text-center max-w-[280px]">
              {step === "request" && "Gib deine E-Mail-Adresse ein, um einen Reset-Code zu erhalten."}
              {step === "reset" && "Gib den Code und dein neues Passwort ein."}
              {step === "done" && "Dein Passwort wurde erfolgreich geändert."}
            </Text>
          </View>

          {/* Form Card */}
          <View className="bg-white/5 border border-white/10 rounded-3xl p-6 shadow-2xl">
            {error && (
              <View className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-3 mb-5 flex-row items-center space-x-2">
                <Ionicons name="alert-circle" size={18} color="#f43f5e" />
                <Text className="text-rose-400 text-xs font-semibold flex-1 ml-2">{error}</Text>
              </View>
            )}

            {step === "request" && (
              <View>
                {/* Input E-Mail */}
                <View className="mb-6">
                  <Text className="text-slate-400 text-[10px] font-black uppercase tracking-wider mb-2">Deine E-Mail Adresse</Text>
                  <View className="bg-white/5 border border-white/10 rounded-2xl flex-row items-center px-4 py-3">
                    <Ionicons name="mail-outline" size={18} color="rgba(255,255,255,0.4)" />
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

                <TouchableOpacity
                  onPress={handleRequestReset}
                  disabled={loading}
                  className="bg-gradient-to-r from-cyan-500 to-fuchsia-500 rounded-2xl py-4 items-center justify-center shadow-lg shadow-cyan-500/20 active:scale-95"
                >
                  {loading ? (
                    <ActivityIndicator color="#ffffff" />
                  ) : (
                    <Text className="text-white text-sm font-black uppercase tracking-wider">Reset-Code anfordern</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}

            {step === "reset" && (
              <View>
                {infoMessage && (
                  <View className="bg-white/5 border border-cyan-400/30 rounded-2xl p-4 mb-6 w-full">
                    <Text className="text-slate-300 text-xs font-semibold leading-5">{infoMessage}</Text>
                  </View>
                )}

                <Text className="text-slate-400 text-[10px] font-black uppercase tracking-wider mb-2">Reset-Code</Text>
                <View className="bg-white/5 border border-white/10 rounded-2xl flex-row items-center px-4 py-3 mb-4">
                  <Ionicons name="keypad-outline" size={18} color="rgba(255,255,255,0.4)" />
                  <TextInput
                    placeholder="6-stelliger Code"
                    placeholderTextColor="rgba(255,255,255,0.3)"
                    value={code}
                    onChangeText={setCode}
                    keyboardType="number-pad"
                    maxLength={6}
                    editable={!loading}
                    className="flex-1 text-white font-bold text-sm ml-3"
                  />
                </View>

                <Text className="text-slate-400 text-[10px] font-black uppercase tracking-wider mb-2">Neues Passwort</Text>
                <View className="bg-white/5 border border-white/10 rounded-2xl flex-row items-center px-4 py-3 mb-4">
                  <Ionicons name="lock-closed-outline" size={18} color="rgba(255,255,255,0.4)" />
                  <TextInput
                    placeholder="••••••••"
                    placeholderTextColor="rgba(255,255,255,0.3)"
                    value={newPassword}
                    onChangeText={setNewPassword}
                    secureTextEntry
                    autoCapitalize="none"
                    editable={!loading}
                    className="flex-1 text-white font-bold text-sm ml-3"
                  />
                </View>

                <Text className="text-slate-400 text-[10px] font-black uppercase tracking-wider mb-2">Neues Passwort bestätigen</Text>
                <View className="bg-white/5 border border-white/10 rounded-2xl flex-row items-center px-4 py-3 mb-6">
                  <Ionicons name="lock-closed-outline" size={18} color="rgba(255,255,255,0.4)" />
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

                <TouchableOpacity
                  onPress={handleResetPassword}
                  disabled={loading}
                  className="bg-gradient-to-r from-cyan-500 to-fuchsia-500 rounded-2xl py-4 items-center justify-center shadow-lg shadow-cyan-500/20 active:scale-95"
                >
                  {loading ? (
                    <ActivityIndicator color="#ffffff" />
                  ) : (
                    <Text className="text-white text-sm font-black uppercase tracking-wider">Passwort zurücksetzen</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}

            {step === "done" && (
              <View className="items-center py-4">
                <View className="bg-emerald-400/20 p-3 rounded-full mb-4">
                  <Ionicons name="checkmark-circle-outline" size={28} color="#34d399" />
                </View>
                <Text className="text-white text-base font-black tracking-wide mb-2 text-center">Passwort geändert!</Text>
                <Text className="text-slate-300 text-xs text-center mb-6 leading-relaxed">
                  Du kannst dich jetzt mit deinem neuen Passwort anmelden.
                </Text>

                <TouchableOpacity
                  onPress={() => {
                    triggerHaptic("light");
                    router.replace("/(auth)/login");
                  }}
                  className="bg-cyan-400 rounded-2xl py-3.5 px-6 items-center justify-center active:scale-95 w-full"
                >
                  <Text className="text-slate-950 text-sm font-black uppercase tracking-wider">Zurück zum Login</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
