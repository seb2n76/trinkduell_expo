import React from "react";
import { View, Text, Image } from "react-native";
import { useThemeColors } from "@/services/theme";

interface AvatarProps {
  uri?: string | null;
  name?: string | null;
  size?: number;
  /** Extra classes for the border/ring, e.g. "border-2 border-accent". */
  className?: string;
}

// Deterministic colour per user so the same person always gets the same
// placeholder — makes people recognisable at a glance even without a photo.
const PLACEHOLDER_COLORS = [
  "#0e7490", // cyan
  "#a21caf", // fuchsia
  "#b45309", // amber
  "#15803d", // green
  "#b91c1c", // red
  "#4338ca", // indigo
];

function colorForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return PLACEHOLDER_COLORS[hash % PLACEHOLDER_COLORS.length];
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/[\s_.-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/**
 * Profile picture with an initials fallback.
 *
 * Replaces the previous behaviour of showing a stock photo of a random
 * stranger for anyone without a picture, which made it look like those
 * accounts had a real (and misleading) profile photo.
 */
export function Avatar({ uri, name, size = 40, className = "" }: AvatarProps) {
  const c = useThemeColors();
  const displayName = (name || "").trim();

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        className={className}
      />
    );
  }

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: displayName ? colorForName(displayName) : c.lineStrong,
        alignItems: "center",
        justifyContent: "center",
      }}
      className={className}
    >
      <Text
        // Immer weiss, unabhaengig vom Schema: der Kreis darunter ist stets
        // ein kraeftiger, dunkler Farbton aus PLACEHOLDER_COLORS. Mit
        // c.content waeren die Initialen im Hell-Modus dunkel auf dunkel.
        style={{ fontSize: Math.max(9, size * 0.38), fontWeight: "900", color: "#ffffff" }}
      >
        {displayName ? initialsFor(displayName) : "?"}
      </Text>
    </View>
  );
}

export default Avatar;
