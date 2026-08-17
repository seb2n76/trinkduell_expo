import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { triggerHaptic } from "@/services/haptics";
import { Intensity, INTENSITY_LABELS } from "@/games/content";
import { ProofPhotoButton } from "./ProofPhotoButton";

interface GameShellProps {
  title: string;
  accent: string;
  onCancel: () => void;
  onMinimize: () => void;
  /** Optional intensity switcher shown under the header. */
  intensity?: Intensity;
  onIntensityChange?: (next: Intensity) => void;
  children: React.ReactNode;
}

/**
 * Shared frame for the party games: consistent header with cancel/minimize
 * and an optional intensity switch, so each game only has to implement its
 * actual gameplay.
 */
export function GameShell({
  title,
  accent,
  onCancel,
  onMinimize,
  intensity,
  onIntensityChange,
  children,
}: GameShellProps) {
  return (
    <View className="flex-1 bg-slate-950 pt-14 px-5">
      <View className="flex-row items-center justify-between mb-4">
        <TouchableOpacity onPress={onCancel} className="flex-row items-center p-1">
          <Ionicons name="close-circle-outline" size={20} color="#fb923c" />
          <Text className="text-orange-400 text-xs font-black uppercase ml-1">Beenden</Text>
        </TouchableOpacity>

        <Text className="text-white text-sm font-black uppercase tracking-wider">{title}</Text>

        <TouchableOpacity onPress={onMinimize} className="flex-row items-center p-1">
          <Ionicons name="home-outline" size={18} color="#64748b" />
          <Text className="text-slate-500 text-[10px] font-black uppercase ml-1">Pause</Text>
        </TouchableOpacity>
      </View>

      {/* Beweisfoto für eine Bestrafung. Hier statt in jedem einzelnen
          Bestrafungs-Screen: so erscheint es in allen Spielen, ohne dass es
          bei der Hälfte vergessen wird. Rendert sich selbst weg, wenn der
          Server keine Uploads kann. */}
      <View className="items-center mb-4">
        <ProofPhotoButton context={title} />
      </View>

      {intensity && onIntensityChange && (
        <View className="flex-row bg-slate-900 border border-white/5 rounded-2xl p-1 mb-5">
          {(["harmlos", "party", "spicy"] as Intensity[]).map((level) => {
            const isActive = intensity === level;
            return (
              <TouchableOpacity
                key={level}
                onPress={() => {
                  triggerHaptic("light");
                  onIntensityChange(level);
                }}
                className={`flex-1 py-2 rounded-xl items-center ${
                  isActive ? "bg-white/10 border border-white/10" : ""
                }`}
              >
                <Text
                  style={isActive ? { color: accent } : undefined}
                  className={`text-[10px] font-black uppercase tracking-wider ${
                    isActive ? "" : "text-slate-500"
                  }`}
                >
                  {INTENSITY_LABELS[level]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {children}
    </View>
  );
}

/** Large tappable card used by the text-prompt games. */
export function PromptCard({
  text,
  hint,
  accent,
}: {
  text: string;
  hint?: string;
  accent: string;
}) {
  return (
    <View className="flex-1 items-center justify-center">
      <View
        style={{ borderColor: accent }}
        className="w-full bg-slate-900 border-2 rounded-3xl p-8 items-center shadow-2xl"
      >
        <Text className="text-white text-xl font-black text-center leading-relaxed">{text}</Text>
        {hint && (
          <Text className="text-slate-500 text-[11px] font-bold text-center mt-5 leading-relaxed">
            {hint}
          </Text>
        )}
      </View>
    </View>
  );
}

/** Primary action button at the bottom of a game screen. */
export function GameButton({
  label,
  icon,
  accent,
  onPress,
  disabled,
}: {
  label: string;
  icon?: string;
  accent: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={{ backgroundColor: disabled ? "#1e293b" : accent }}
      className="w-full py-4 rounded-2xl items-center justify-center flex-row mb-8 active:scale-95"
    >
      {icon && <Ionicons name={icon as any} size={18} color={disabled ? "#64748b" : "#020617"} />}
      <Text
        className={`font-black text-xs uppercase tracking-wider ml-2 ${
          disabled ? "text-slate-500" : "text-slate-950"
        }`}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}
