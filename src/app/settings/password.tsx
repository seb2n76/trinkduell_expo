import React, { useEffect, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../_layout";
import { triggerHaptic } from "@/services/haptics";
import { useThemeColors } from "@/services/theme";

export default function ChangePasswordScreen() {
  const c = useThemeColors();
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
    <View className="flex-1 bg-bg">
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-5 pt-6 pb-16"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View className="w-full self-center" style={{ maxWidth: 640 }}>
          {done ? (
            <>
              <View className="bg-success/10 border border-success/30 rounded-2xl p-4 mb-5">
                <View className="flex-row items-center mb-2">
                  <Ionicons name="checkmark-circle" size={18} color={c.success} />
                  <Text className="text-success text-xs font-black uppercase tracking-wider ml-2">
                    Passwort geändert
                  </Text>
                </View>
                <Text className="text-success text-[11px] leading-relaxed">
                  Auf diesem Gerät bleibst du angemeldet. Alle anderen Geräte wurden abgemeldet
                  und brauchen ab jetzt das neue Passwort.
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => router.back()}
                className="bg-accent rounded-2xl py-3.5 items-center"
              >
                <Text className="text-on-accent text-xs font-black uppercase tracking-wider">
                  Fertig
                </Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text className="text-content-muted text-[11px] leading-relaxed mb-5">
                Zur Sicherheit brauchen wir dein aktuelles Passwort. Danach werden alle anderen
                Geräte abgemeldet — auf diesem bleibst du eingeloggt.
              </Text>

              <TextInput
                value={currentPassword}
                onChangeText={setCurrentPassword}
                placeholder="Aktuelles Passwort"
                placeholderTextColor={c.contentFaint}
                secureTextEntry
                autoCapitalize="none"
                autoComplete="current-password"
                textContentType="password"
                className="bg-surface border border-line rounded-2xl px-4 py-3.5 text-content text-sm mb-2.5"
              />
              <TextInput
                value={newPassword}
                onChangeText={setNewPassword}
                placeholder="Neues Passwort (min. 8 Zeichen)"
                placeholderTextColor={c.contentFaint}
                secureTextEntry
                autoCapitalize="none"
                autoComplete="new-password"
                textContentType="newPassword"
                className="bg-surface border border-line rounded-2xl px-4 py-3.5 text-content text-sm mb-2.5"
              />
              <TextInput
                value={repeatPassword}
                onChangeText={setRepeatPassword}
                placeholder="Neues Passwort wiederholen"
                placeholderTextColor={c.contentFaint}
                secureTextEntry
                autoCapitalize="none"
                autoComplete="new-password"
                textContentType="newPassword"
                onSubmitEditing={handleChangePassword}
                className="bg-surface border border-line rounded-2xl px-4 py-3.5 text-content text-sm mb-3"
              />

              {error ? (
                <View className="bg-danger/10 border border-danger/30 rounded-2xl p-3 mb-3 flex-row items-start">
                  <Ionicons name="alert-circle" size={15} color={c.danger} />
                  <Text className="text-danger text-[11px] leading-4 ml-2 flex-1">{error}</Text>
                </View>
              ) : null}

              <TouchableOpacity
                onPress={handleChangePassword}
                disabled={saving || unvollstaendig}
                className={`rounded-2xl py-3.5 items-center ${
                  saving || unvollstaendig ? "bg-surface-alt" : "bg-accent"
                }`}
              >
                {saving ? (
                  <ActivityIndicator size="small" color={c.onAccent} />
                ) : (
                  <Text
                    className={`text-xs font-black uppercase tracking-wider ${
                      unvollstaendig ? "text-content-faint" : "text-on-accent"
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
