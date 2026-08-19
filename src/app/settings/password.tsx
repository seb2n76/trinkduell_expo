import React, { useEffect, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../_layout";
import { triggerHaptic } from "@/services/haptics";

export default function ChangePasswordScreen() {
  const router = useRouter();
  const { changePassword } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  // Klartext-Passwörter nicht im State liegen lassen, wenn der Screen
  // verschwindet.
  useEffect(() => {
    return () => {
      setCurrentPassword("");
      setNewPassword("");
      setRepeatPassword("");
    };
  }, []);

  const handleChangePassword = async () => {
    setError("");

    // Die Wiederholung prüft nur der Client: der Server kennt sie nicht und
    // soll sie auch nicht kennen. Länge und Gleichheit prüft er trotzdem
    // selbst noch einmal — das hier erspart nur den Rundweg.
    if (newPassword !== repeatPassword) {
      setError("Die beiden neuen Passwörter stimmen nicht überein.");
      return;
    }
    if (newPassword.length < 8) {
      setError("Das neue Passwort muss mindestens 8 Zeichen lang sein.");
      return;
    }
    if (newPassword === currentPassword) {
      setError("Das neue Passwort muss sich vom alten unterscheiden.");
      return;
    }

    setSaving(true);
    try {
      await changePassword(currentPassword, newPassword);
      await triggerHaptic("success");
      setDone(true);
      setCurrentPassword("");
      setNewPassword("");
      setRepeatPassword("");
    } catch (e) {
      await triggerHaptic("error");
      // Der Interceptor hat die deutsche Servermeldung schon in `message`
      // gelegt („Das aktuelle Passwort ist falsch.", Rate-Limit, …).
      setError(
        e instanceof Error && e.message
          ? e.message
          : "Passwort konnte nicht geändert werden. Bist du mit dem Internet verbunden?"
      );
    } finally {
      setSaving(false);
    }
  };

  const unvollstaendig = !currentPassword || !newPassword || !repeatPassword;

  return (
    <View className="flex-1 bg-slate-950">
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-5 pt-6 pb-16"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View className="w-full self-center" style={{ maxWidth: 640 }}>
          {done ? (
            <>
              <View className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-4 mb-5">
                <View className="flex-row items-center mb-2">
                  <Ionicons name="checkmark-circle" size={18} color="#34d399" />
                  <Text className="text-emerald-400 text-xs font-black uppercase tracking-wider ml-2">
                    Passwort geändert
                  </Text>
                </View>
                <Text className="text-emerald-300/80 text-[11px] leading-relaxed">
                  Auf diesem Gerät bleibst du angemeldet. Alle anderen Geräte wurden abgemeldet
                  und brauchen ab jetzt das neue Passwort.
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => router.back()}
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
                Zur Sicherheit brauchen wir dein aktuelles Passwort. Danach werden alle anderen
                Geräte abgemeldet — auf diesem bleibst du eingeloggt.
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

              {error ? (
                <View className="bg-rose-500/10 border border-rose-500/30 rounded-2xl p-3 mb-3 flex-row items-start">
                  <Ionicons name="alert-circle" size={15} color="#f43f5e" />
                  <Text className="text-rose-400 text-[11px] leading-4 ml-2 flex-1">{error}</Text>
                </View>
              ) : null}

              <TouchableOpacity
                onPress={handleChangePassword}
                disabled={saving || unvollstaendig}
                className={`rounded-2xl py-3.5 items-center ${
                  saving || unvollstaendig ? "bg-slate-800" : "bg-cyan-500"
                }`}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#0f172a" />
                ) : (
                  <Text
                    className={`text-xs font-black uppercase tracking-wider ${
                      unvollstaendig ? "text-slate-600" : "text-slate-950"
                    }`}
                  >
                    Passwort ändern
                  </Text>
                )}
              </TouchableOpacity>
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
