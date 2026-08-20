import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { triggerHaptic } from "@/services/haptics";
import { Intensity, INTENSITY_LABELS } from "@/games/content";
import { ProofPhotoButton } from "./ProofPhotoButton";
import { SessionBar } from "./SessionBar";
import { useThemeColors } from "@/services/theme";

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
  const c = useThemeColors();
  return (
    <View className="flex-1 bg-bg pt-14 px-5">
      <View className="flex-row items-center justify-between mb-4">
        <TouchableOpacity onPress={onCancel} className="flex-row items-center p-1">
          <Ionicons name="close-circle-outline" size={20} color={c.warning} />
          <Text className="text-warning text-xs font-black uppercase ml-1">Beenden</Text>
        </TouchableOpacity>

        <Text className="text-content text-sm font-black uppercase tracking-wider">{title}</Text>

        <TouchableOpacity onPress={onMinimize} className="flex-row items-center p-1">
          <Ionicons name="home-outline" size={18} color={c.contentFaint} />
          <Text className="text-content-faint text-[10px] font-black uppercase ml-1">Pause</Text>
        </TouchableOpacity>
      </View>

      {/* Beweisfoto für eine Bestrafung. Hier statt in jedem einzelnen
          Bestrafungs-Screen: so erscheint es in allen Spielen, ohne dass es
          bei der Hälfte vergessen wird. Rendert sich selbst weg, wenn der
          Server keine Uploads kann. */}
      <View className="items-center mb-4">
        <ProofPhotoButton context={title} />
      </View>

      {/* Der Rahmen der laufenden Nacht. Rendert sich selbst weg, wenn keine
          Session läuft — dann verhalten sich die Spiele wie vorher. */}
      <SessionBar />

      {intensity && onIntensityChange && (
        <View className="flex-row bg-surface border border-line rounded-2xl p-1 mb-5">
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
                  isActive ? "bg-surface border border-line" : ""
                }`}
              >
                <Text
                  style={isActive ? { color: accent } : undefined}
                  className={`text-[10px] font-black uppercase tracking-wider ${
                    isActive ? "" : "text-content-faint"
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
        className="w-full bg-surface border-2 rounded-3xl p-8 items-center shadow-2xl"
      >
        <Text className="text-content text-xl font-black text-center leading-relaxed">{text}</Text>
        {hint && (
          <Text className="text-content-faint text-[11px] font-bold text-center mt-5 leading-relaxed">
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
  const c = useThemeColors();
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={{ backgroundColor: disabled ? c.line : accent }}
      className="w-full py-4 rounded-2xl items-center justify-center flex-row mb-8 active:scale-95"
    >
      {icon && <Ionicons name={icon as any} size={18} color={disabled ? c.contentFaint : c.onAccent} />}
      <Text
        className={`font-black text-xs uppercase tracking-wider ml-2 ${
          disabled ? "text-content-faint" : "text-on-accent"
        }`}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}
