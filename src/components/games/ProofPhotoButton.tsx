import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator, Platform, Alert } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import { apiService } from "@/services/api";
import { uploadImage } from "@/services/upload";
import { triggerHaptic } from "@/services/haptics";

interface ProofPhotoButtonProps {
  /** Landet als Text über dem Bild im Feed, z. B. der Spielname. */
  context: string;
  /** Optional: Anzeigename dessen, der bestraft wurde. */
  playerName?: string;
}

/**
 * „Beweisfoto" für eine Bestrafung: Bild wählen, verkleinern, hochladen, im
 * Feed der Freunde ausspielen.
 *
 * Sitzt in GameShell und erscheint damit in jedem Lobby-Spiel — statt in jedem
 * Bestrafungs-Screen einzeln, wo er in der Hälfte der Spiele vergessen worden
 * wäre.
 *
 * Der Button erscheint nur, wenn der Server Uploads kann. Ein Knopf, der
 * zuverlässig in einen Fehler läuft, ist schlimmer als keiner — und ohne
 * R2-Zugangsdaten (lokale Entwicklung) ist genau das der Fall.
 */
export function ProofPhotoButton({ context, playerName }: ProofPhotoButtonProps) {
  const [uploadEnabled, setUploadEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    apiService
      .getUploadConfig()
      .then((config) => {
        if (active) setUploadEnabled(config.enabled);
      })
      .catch(() => {
        if (active) setUploadEnabled(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const notify = (title: string, message: string) => {
    // Alert.alert ist auf react-native-web ein No-op — ohne diesen Zweig
    // scheitert ein Upload im Browser sichtbar nach nichts.
    if (Platform.OS === "web") window.alert(message);
    else Alert.alert(title, message);
  };

  const handlePress = async () => {
    if (busy) return;
    await triggerHaptic("light");

    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      // Kamera abgelehnt? Dann die Galerie anbieten statt aufzugeben — auf
      // einer Party ist das Foto oft schon gemacht.
      const useLibrary = permission.status !== "granted";

      const result = useLibrary
        ? await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            quality: 1,
          })
        : await ImagePicker.launchCameraAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            quality: 1,
          });

      if (result.canceled || !result.assets?.[0]?.uri) return;

      setBusy(true);

      // quality: 1 oben ist Absicht: verkleinert und neu kodiert wird in
      // uploadImage(), und genau dieses Neukodieren entfernt die EXIF-Daten
      // mitsamt GPS-Koordinaten. Zweimal komprimieren würde nur Qualität
      // kosten, ohne etwas zu gewinnen.
      const publicUrl = await uploadImage(result.assets[0].uri, "proof");

      const me = await apiService.getCurrentUser();
      const text = playerName
        ? `📸 Beweisfoto: ${playerName} bei „${context}"`
        : `📸 Beweisfoto aus „${context}"`;

      await apiService.createPost(text, "friends", me.id, publicUrl);

      await triggerHaptic("success");
      notify("Hochgeladen", "Das Beweisfoto ist im Feed deiner Freunde.");
    } catch (e) {
      await triggerHaptic("error");
      notify("Fehler", e instanceof Error ? e.message : "Foto konnte nicht hochgeladen werden.");
    } finally {
      setBusy(false);
    }
  };

  if (!uploadEnabled) return null;

  return (
    <TouchableOpacity
      onPress={handlePress}
      disabled={busy}
      accessibilityLabel="Beweisfoto aufnehmen"
      className="flex-row items-center justify-center py-2.5 px-4 rounded-2xl bg-fuchsia-500/10 border border-fuchsia-400/30 active:scale-95 disabled:opacity-50"
    >
      {busy ? (
        <ActivityIndicator color="#d946ef" size="small" />
      ) : (
        <>
          <Ionicons name="camera-outline" size={15} color="#d946ef" />
          <Text className="text-fuchsia-400 text-[10px] font-black uppercase tracking-wider ml-2">
            Beweisfoto
          </Text>
        </>
      )}
    </TouchableOpacity>
  );
}

/** Platzhalter mit gleicher Höhe, damit das Layout ohne Uploads nicht springt. */
export function ProofPhotoSpacer() {
  return <View className="h-0" />;
}
