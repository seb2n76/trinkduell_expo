import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { apiService } from "@/services/api";
import { triggerHaptic } from "@/services/haptics";
import { Ionicons } from "@expo/vector-icons";

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [successCode, setSuccessCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRequestReset = async () => {
    if (!email.trim()) {
      await triggerHaptic("error");
      setError("Bitte gib deine E-Mail Adresse ein!");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccessCode(null);
    try {
      await triggerHaptic("success");
      const res = await apiService.forgotPassword(email.trim());
      if (res.code) {
        setSuccessCode(res.code);
      } else {
        setSuccessCode("SENT"); // Fallback if server runs in real mode
      }
    } catch (e: any) {
      await triggerHaptic("error");
      setError(e.message || "E-Mail konnte nicht gesendet werden.");
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
              Gib deine E-Mail-Adresse ein, um einen Reset-Code zu erhalten.
            </Text>
          </View>

          {/* Form Card */}
          <View className="bg-white/5 border border-white/10 rounded-3xl p-6 shadow-2xl">
            {successCode ? (
              <View className="items-center py-4">
                <View className="bg-emerald-400/20 p-3 rounded-full mb-4">
                  <Ionicons name="mail-open-outline" size={28} color="#34d399" />
                </View>
                <Text className="text-white text-base font-black tracking-wide mb-2 text-center">Reset-Code gesendet!</Text>
                <Text className="text-slate-300 text-xs text-center mb-6 leading-relaxed">
                  Wir haben dir einen vierstelligen Bestätigungscode an <Text className="text-cyan-400 font-bold">{email}</Text> gesendet.
                </Text>

                {successCode !== "SENT" && (
                  <View className="bg-white/5 border border-emerald-400/30 rounded-2xl p-5 items-center mb-6 w-full">
                    <Text className="text-slate-400 text-[10px] font-black uppercase tracking-wider mb-2">Simulierter Reset-Code</Text>
                    <Text className="text-emerald-400 text-3xl font-black tracking-[8px]">{successCode}</Text>
                  </View>
                )}

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
            ) : (
              <View>
                {error && (
                  <View className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-3 mb-5 flex-row items-center space-x-2">
                    <Ionicons name="alert-circle" size={18} color="#f43f5e" />
                    <Text className="text-rose-400 text-xs font-semibold flex-1 ml-2">{error}</Text>
                  </View>
                )}

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
                      className="flex-1 text-white font-bold text-sm ml-3"
                    />
                  </View>
                </View>

                {/* Send Button */}
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
          </View>

        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
