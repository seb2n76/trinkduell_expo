import React, { useState } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { triggerHaptic } from "@/services/haptics";
import { useThemeColors } from "@/services/theme";
import { KeyboardSafe } from "@/components/KeyboardSafe";
import { apiService } from "@/services/api";

interface JoinRoomModalProps {
  visible: boolean;
  onClose: () => void;
  onJoined: (roomData: { code: string; playerId: string; playerToken: string; room: any }) => void;
  defaultPlayerName?: string;
  defaultPlayerAvatar?: string | null;
}

export function JoinRoomModal({
  visible,
  onClose,
  onJoined,
  defaultPlayerName = "",
  defaultPlayerAvatar = null,
}: JoinRoomModalProps) {
  const c = useThemeColors();
  const [code, setCode] = useState("");
  const [name, setName] = useState(defaultPlayerName);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleJoin = async () => {
    const trimmedCode = code.trim().toUpperCase();
    const trimmedName = name.trim() || defaultPlayerName || "Spieler";

    if (trimmedCode.length !== 4) {
      setErrorMessage("Der Raum-Code muss genau 4 Buchstaben lang sein.");
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      triggerHaptic("medium");
      const res = await apiService.joinGameRoom(trimmedCode, trimmedName, defaultPlayerAvatar);
      if (res && res.success) {
        triggerHaptic("success");
        onJoined(res);
        onClose();
        setCode("");
      } else {
        setErrorMessage("Beitritt fehlgeschlagen. Bitte Code prüfen.");
      }
    } catch (err: any) {
      triggerHaptic("error");
      const msg = err.response?.data?.error || err.message || "Raum nicht gefunden.";
      setErrorMessage(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      {/* Der Dialog sitzt mittig — ohne diesen Rahmen schiebt die Tastatur
          das Eingabefeld fuer den Raum-Code unter den Bildschirmrand. */}
      <KeyboardSafe>
      <View className="flex-1 bg-black/80 justify-center items-center px-4">
        <View className="w-full max-w-sm bg-surface border border-line p-6 rounded-3xl shadow-2xl">
          {/* Header */}
          <View className="flex-row items-center justify-between mb-4">
            <View className="flex-row items-center">
              <View className="w-8 h-8 rounded-xl bg-accent/20 border border-accent/30 items-center justify-center mr-2.5">
                <Ionicons name="phone-portrait-outline" size={16} color={c.accent} />
              </View>
              <Text className="text-content text-base font-black tracking-wide">
                Lobby beitreten
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} className="p-1">
              <Ionicons name="close-circle-outline" size={22} color={c.contentFaint} />
            </TouchableOpacity>
          </View>

          <Text className="text-content-faint text-xs font-medium mb-5 leading-relaxed">
            Gib den 4-stelligen Raum-Code ein, der auf dem Bildschirm des Hosts angezeigt wird:
          </Text>

          {/* Code Input */}
          <View className="mb-4">
            <Text className="text-content-faint text-[10px] font-black uppercase tracking-wider mb-1.5">
              4-Stelliger Raum-Code
            </Text>
            <TextInput
              value={code}
              onChangeText={(t) => {
                setCode(t.toUpperCase());
                setErrorMessage(null);
              }}
              placeholder="z. B. BIER"
              placeholderTextColor={c.contentFaint}
              maxLength={4}
              autoCapitalize="characters"
              autoCorrect={false}
              className="bg-bg border border-line text-content text-2xl font-black tracking-widest text-center py-3.5 rounded-2xl"
            />
          </View>

          {/* Name Input */}
          <View className="mb-4">
            <Text className="text-content-faint text-[10px] font-black uppercase tracking-wider mb-1.5">
              Dein Spielername
            </Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Dein Name"
              placeholderTextColor={c.contentFaint}
              maxLength={20}
              className="bg-bg border border-line text-content text-sm font-bold px-4 py-3 rounded-xl"
            />
          </View>

          {/* Error Message */}
          {errorMessage && (
            <View className="bg-danger/10 border border-danger/30 p-2.5 rounded-xl mb-4 flex-row items-center">
              <Ionicons name="alert-circle-outline" size={16} color={c.danger} />
              <Text className="text-danger text-xs font-bold ml-2 flex-1">{errorMessage}</Text>
            </View>
          )}

          {/* Submit Button */}
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={handleJoin}
            disabled={loading || code.trim().length !== 4}
            className="w-full bg-accent py-3.5 rounded-xl items-center justify-center flex-row disabled:opacity-40"
          >
            {loading ? (
              <ActivityIndicator size="small" color={c.onAccent} />
            ) : (
              <>
                <Ionicons name="arrow-forward-circle" size={18} color={c.onAccent} />
                <Text className="text-on-accent font-black text-xs uppercase tracking-wider ml-2">
                  Dem Raum beitreten
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
      </KeyboardSafe>
    </Modal>
  );
}
