import React, { useEffect } from "react";
import { View, Text, TouchableOpacity, Modal, StyleSheet } from "react-native";
import Animated, { ZoomIn, ZoomOut, FadeIn, FadeOut } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { triggerHaptic } from "@/services/haptics";

export interface AchievementInfo {
  id: string;
  title: string;
  description: string;
  icon: string;
}

export const ACHIEVEMENTS_METADATA: Record<string, Omit<AchievementInfo, "id">> = {
  FIRST_DRINK: {
    title: "Erster Schluck! 🍻",
    description: "Du hast dein allererstes Getränk in TrinkDuell eingetragen. Prost!",
    icon: "🏆",
  },
  SOMMELIER: {
    title: "Sommelier 🍷",
    description: "Respekt! Du hast Getränke aus mindestens 3 verschiedenen Kategorien probiert.",
    icon: "🍇",
  },
  NACHTEULE: {
    title: "Nachteule 🦉",
    description: "Zu später Stunde unterwegs! Du hast einen Drink zwischen 2 und 5 Uhr nachts geloggt.",
    icon: "🌙",
  },
  BRAUMEISTER: {
    title: "Braumeister 🍺",
    description: "Ein echter Bierliebhaber! Du hast bereits 5 Biere geloggt.",
    icon: "🌾",
  },
  STAMMGAST: {
    title: "Stammgast Elite 👑",
    description: "Legendenstatus! Du hast über 50 Biere eingetragen.",
    icon: "🎖️",
  },
  FRUEHSCHOPPEN: {
    title: "Frühschoppen 🌅",
    description: "Kein Bier vor vier? Von wegen! Alkohol vor 12 Uhr mittags geloggt.",
    icon: "🍳",
  },
  SAMMLER: {
    title: "Der Sammler 📊",
    description: "Vielfalt ist dein Ding! Du hast 10 verschiedene Getränkesorten ausprobiert.",
    icon: "🧪",
  },
  ANFUEHRER: {
    title: "Der Anführer 🎖️",
    description: "Du bist Admin einer Gruppe und hast die Zügel fest in der Hand.",
    icon: "📣",
  },
};

interface AchievementModalProps {
  achievementId: string | null;
  onClose: () => void;
}

export function AchievementModal({ achievementId, onClose }: AchievementModalProps) {
  const visible = !!achievementId;
  const metadata = achievementId ? ACHIEVEMENTS_METADATA[achievementId] : null;

  useEffect(() => {
    if (visible) {
      // Trigger a special achievement haptic success pattern
      triggerHaptic("success");
    }
  }, [visible]);

  if (!visible || !metadata) return null;

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onClose}>
      {/* Dimmed backdrop with fade-in */}
      <Animated.View 
        entering={FadeIn.duration(200)}
        exiting={FadeOut.duration(200)}
        style={styles.backdrop}
      >
        <TouchableOpacity 
          activeOpacity={1} 
          style={StyleSheet.absoluteFill} 
          onPress={onClose} 
        />
        
        {/* Animated modal card using spring zoom */}
        <Animated.View 
          entering={ZoomIn.springify().damping(12).stiffness(100)}
          exiting={ZoomOut.duration(150)}
          className="w-11/12 max-w-sm bg-slate-900 border-2 border-fuchsia-500 rounded-3xl p-6 items-center shadow-2xl relative overflow-hidden"
        >
          {/* Neon backglow effects */}
          <View className="absolute -top-24 -left-24 w-48 h-48 bg-fuchsia-500/10 rounded-full blur-3xl" />
          <View className="absolute -bottom-24 -right-24 w-48 h-48 bg-cyan-500/10 rounded-full blur-3xl" />

          {/* Close button */}
          <TouchableOpacity 
            onPress={onClose}
            className="absolute top-4 right-4 bg-slate-800/80 p-2 rounded-full border border-white/10 active:scale-90"
          >
            <Ionicons name="close" size={18} color="#f5f5f7" />
          </TouchableOpacity>

          {/* Achievement Trophy Icon */}
          <View className="w-20 h-20 bg-gradient-to-tr from-fuchsia-500/20 to-cyan-500/20 border-2 border-cyan-400 rounded-full items-center justify-center mb-4 mt-2 shadow-lg shadow-cyan-500/50">
            <Text className="text-4xl">{metadata.icon}</Text>
          </View>

          {/* Success Label */}
          <Text className="text-cyan-400 text-xs font-black uppercase tracking-widest mb-1">
            Erfolg Freigeschaltet!
          </Text>

          {/* Title */}
          <Text className="text-white text-xl font-black text-center mb-2 px-2">
            {metadata.title}
          </Text>

          {/* Description */}
          <Text className="text-slate-300 text-xs text-center leading-relaxed mb-6 px-4">
            {metadata.description}
          </Text>

          {/* Action button */}
          <TouchableOpacity 
            onPress={onClose}
            className="w-full bg-fuchsia-500 py-3 rounded-2xl items-center shadow-md active:scale-95 active:bg-fuchsia-600"
          >
            <Text className="text-white font-black text-xs tracking-widest uppercase">
              Sehr Geil!
            </Text>
          </TouchableOpacity>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(2, 6, 23, 0.85)", // dark slate glassmorphism base
    alignItems: "center",
    justifyContent: "center",
  },
});
