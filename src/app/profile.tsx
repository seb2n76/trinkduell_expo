import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { apiService } from "@/services/api";
import { useAuth } from "./_layout";
import { User, Drink, DrinkLog } from "@/services/mockData";
import { Avatar } from "@/components/Avatar";
import { uploadImage } from "@/services/upload";
import { triggerHaptic } from "@/services/haptics";
import { notify } from "@/services/dialogs";
import { ACHIEVEMENTS } from "@/services/achievements";
import { useThemeColors } from "@/services/theme";
import { KeyboardSafe } from "@/components/KeyboardSafe";

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

export default function ProfileScreen() {
  const c = useThemeColors();
  const { updateUserContext } = useAuth();
  const [dbUser, setDbUser] = useState<User | null>(null);
  const [logs, setLogs] = useState<DrinkLog[]>([]);
  const [drinks, setDrinks] = useState<Drink[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const currentUser = await apiService.getCurrentUser();
      if (!currentUser) {
        console.warn("User not found on profile screen, aborting.");
        return;
      }
      const [allLogs, allDrinks] = await Promise.all([
        apiService.getDrinkLogs(),
        apiService.getDrinks(),
      ]);

      setDbUser(currentUser);
      setEditedName(currentUser.name);
      setLogs(
        allLogs
          .filter((l) => l.userId === currentUser.id)
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      );
      setDrinks(allDrinks);
    } catch (e) {
      console.error("Failed to load profile data:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Helper to convert local URI to Base64 (AsyncStorage persistence)
  const uriToBase64 = async (uri: string): Promise<string> => {
    const response = await fetch(uri);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve((reader.result as string).split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const handlePickAvatar = async () => {
    if (!dbUser) return;
    await triggerHaptic("light");

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      notify("Galerie", "Galerie-Rechte werden benötigt, um ein Profilbild zu ändern!");
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

      if (result.canceled) return;

      setLoading(true);
      const pickedUri = result.assets[0].uri;

      // Bevorzugt in den Objektspeicher: bisher landete jedes Profilbild
      // als Base64-Block in der Datenbank und wurde damit in JEDER
      // Nutzerliste mitgeschleppt. Kann der Server das nicht (keine
      // R2-Zugangsdaten), bleibt der alte Weg als Rückfall — sonst hätten
      // Bestandsserver plötzlich keine Profilbilder mehr.
      let avatarUrl: string;
      const uploadConfig = await apiService.getUploadConfig();

      if (uploadConfig.enabled) {
        const publicUrl = await uploadImage(pickedUri, "avatar");
        const saved = await apiService.setAvatarUrl(dbUser.id, publicUrl);
        avatarUrl = saved.avatarUrl;
      } else {
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

        const uploadResult = await apiService.uploadAvatar(
          dbUser.id,
          pickedUri,
          base64Data || undefined
        );
        avatarUrl = uploadResult.avatarUrl;
      }

      const updatedUser = { ...dbUser, avatar: avatarUrl };
      setDbUser(updatedUser);
      updateUserContext(updatedUser);
    } catch (error) {
      console.error("Avatar pick failed:", error);
      await triggerHaptic("error");
      // Vorher endete der Fehler NUR in der Konsole: die App zeigte nichts an,
      // das Bild blieb einfach beim alten. Aus Nutzersicht "geht nicht", ohne
      // jeden Hinweis worauf.
      notify(
        "Profilbild",
        error instanceof Error && error.message
          ? error.message
          : "Das Bild konnte nicht gespeichert werden. Bist du mit dem Internet verbunden?"
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSaveName = async () => {
    if (!editedName.trim() || !dbUser) {
      await triggerHaptic("error");
      notify("Fehler", "Name darf nicht leer sein!");
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
      // The server rejects a name that is already taken, too short/long, or
      // contains disallowed characters. Without this the rename just silently
      // did nothing and the old name stayed on screen.
      notify("Fehler", e instanceof Error ? e.message : "Name konnte nicht geändert werden.");
    }
  };

  const handleDeleteLog = async (logId: string) => {
    try {
      await triggerHaptic("medium");
      await apiService.deleteDrinkLog(logId);

      const currentUser = await apiService.getCurrentUser();
      const allLogs = await apiService.getDrinkLogs();
      setDbUser(currentUser);
      updateUserContext(currentUser);
      setLogs(
        allLogs
          .filter((l) => l.userId === currentUser.id)
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      );
    } catch (e) {
      console.error("Failed to delete log:", e);
    }
  };

  if (loading && !dbUser) {
    return (
      <View className="flex-1 bg-bg items-center justify-center">
        <ActivityIndicator size="large" color={c.accent} />
      </View>
    );
  }

  if (!dbUser) {
    return (
      <View className="flex-1 bg-bg items-center justify-center px-8">
        <Ionicons name="person-outline" size={32} color={c.contentFaint} />
        <Text className="text-content-faint text-xs font-bold mt-3 text-center">
          Dein Profil konnte nicht geladen werden.
        </Text>
      </View>
    );
  }

  return (
    <KeyboardSafe>
    <View className="flex-1 bg-bg">
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-5 pt-5 pb-16"
        showsVerticalScrollIndicator={false}
      >
        <View className="w-full self-center" style={{ maxWidth: 640 }}>
          {/* Profilkarte */}
          <View className="items-center bg-surface border border-line p-5 rounded-3xl mb-7">
            <TouchableOpacity
              onPress={handlePickAvatar}
              accessibilityLabel="Profilbild ändern"
              className="relative active:scale-95 mb-3"
            >
              <Avatar
                uri={dbUser.avatar}
                name={dbUser.name}
                size={80}
                className="border border-line-strong"
              />
              <View className="absolute bottom-0 right-0 bg-accent p-1.5 rounded-full border border-surface">
                <Ionicons name="camera" size={13} color={c.onAccent} />
              </View>
            </TouchableOpacity>

            {isEditingName ? (
              <View className="flex-row items-center px-4 mb-2 w-full" style={{ gap: 8 }}>
                <TextInput
                  value={editedName}
                  onChangeText={setEditedName}
                  maxLength={20}
                  autoFocus
                  onSubmitEditing={handleSaveName}
                  accessibilityLabel="Anzeigename"
                  className="bg-surface-alt border border-accent/50 rounded-xl px-3 py-2 text-content font-bold text-center flex-1"
                />
                <TouchableOpacity
                  onPress={handleSaveName}
                  accessibilityLabel="Namen speichern"
                  className="bg-accent p-2.5 rounded-xl"
                >
                  <Ionicons name="checkmark" size={15} color={c.onAccent} />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                onPress={() => setIsEditingName(true)}
                accessibilityLabel="Anzeigename ändern"
                className="flex-row items-center active:scale-95"
                style={{ gap: 6 }}
              >
                <Text className="text-content text-lg font-black">{dbUser.name || "Gast"}</Text>
                <Ionicons name="pencil" size={13} color={c.accent} />
              </TouchableOpacity>
            )}

            <Text className="text-accent-ink text-xs font-black tracking-wide mb-2.5">
              @{(dbUser.name || "gast").toLowerCase().replace(/\s+/g, "_")}
            </Text>

            <View className="bg-surface-alt border border-line px-3 py-1.5 rounded-full">
              <Text className="text-[9px] font-black text-accent-ink uppercase tracking-widest">
                Level {dbUser.currentLevel || dbUser.level || 1} • {dbUser.title || "Neuling"}
              </Text>
            </View>
          </View>

          {/* Erfolge */}
          <Text className="text-content-faint text-[10px] font-black uppercase tracking-widest mb-3">
            Erfolge & Badges
          </Text>
          <View className="flex-row flex-wrap mb-7" style={{ gap: 8 }}>
            {ACHIEVEMENTS.map((ach) => {
              const isUnlocked = (dbUser.achievements || []).some((a) => a.id === ach.id);
              return (
                <View
                  key={ach.id}
                  className={`w-[47%] p-3 rounded-2xl border border-line bg-surface flex-col items-center justify-center ${
                    isUnlocked ? "" : "opacity-30"
                  }`}
                >
                  <Ionicons
                    name={ach.icon as any}
                    size={20}
                    color={isUnlocked ? ach.colorHex : c.contentFaint}
                  />
                  <Text
                    className={`text-[10px] font-bold text-center mt-1.5 mb-0.5 ${
                      isUnlocked ? "text-content" : "text-content-faint"
                    }`}
                  >
                    {ach.name}
                  </Text>
                  <Text
                    className="text-[7px] text-content-faint text-center font-medium leading-normal"
                    numberOfLines={2}
                  >
                    {ach.criteria}
                  </Text>
                </View>
              );
            })}
          </View>

          {/* Konsum-Verlauf */}
          <Text className="text-content-faint text-[10px] font-black uppercase tracking-widest mb-3">
            Konsum-Verlauf
          </Text>
          {logs.length === 0 ? (
            <Text className="text-content-faint text-xs italic">Noch keine Getränke geloggt.</Text>
          ) : (
            logs.slice(0, 15).map((log) => {
              const drink = drinks.find((d) => d.id === log.drinkId);
              if (!drink) return null;
              const logTime = new Date(log.timestamp);
              const formattedTime = `${logTime.getHours().toString().padStart(2, "0")}:${logTime
                .getMinutes()
                .toString()
                .padStart(2, "0")}`;

              return (
                <View
                  key={log.id}
                  className="bg-surface border border-line rounded-2xl p-3.5 mb-2 flex-row justify-between items-center"
                >
                  <View className="flex-row items-center flex-1" style={{ gap: 10 }}>
                    <Ionicons
                      name={getCategoryIcon(drink.category)}
                      size={15}
                      color={drink.abv > 0 ? c.danger : c.success}
                    />
                    <View className="flex-1">
                      <Text className="text-content text-xs font-bold" numberOfLines={1}>
                        {drink.name}
                      </Text>
                      <Text className="text-content-faint text-[9px] mt-0.5">
                        {drink.volume}ml • {drink.abv}% • {formattedTime} Uhr
                      </Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    onPress={() => handleDeleteLog(log.id)}
                    accessibilityLabel={`${drink.name} aus dem Verlauf löschen`}
                    className="p-1.5 active:scale-90"
                  >
                    <Ionicons name="trash-outline" size={15} color={c.danger} />
                  </TouchableOpacity>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
    </View>
    </KeyboardSafe>
  );
}
