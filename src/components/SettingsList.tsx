import React from "react";
import { View, Text, TouchableOpacity, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useThemeColors } from "@/services/theme";

/**
 * Bausteine für gruppierte Listen (Einstellungen, Profil, Hilfe).
 *
 * Der Punkt ist die Gruppierung: eine Überschrift, darunter ein Block
 * zusammengehöriger Zeilen. Vorher lagen Konto-, Datenschutz- und
 * Rechtstexte-Einträge als eine einzige flache Reihe untereinander, in der
 * nichts erkennen ließ, was womit zu tun hat.
 */

export function SettingsSection({
  title,
  footer,
  children,
}: {
  title: string;
  /** Erklärung unter der Gruppe, für Folgen, die man vorher wissen will. */
  footer?: string;
  children: React.ReactNode;
}) {
  return (
    <View className="mb-7">
      <Text className="text-content-faint text-[10px] font-black uppercase tracking-widest mb-2.5 px-1">
        {title}
      </Text>
      <View className="bg-surface border border-line rounded-3xl overflow-hidden">{children}</View>
      {footer ? (
        <Text className="text-content-faint text-[10px] leading-4 mt-2 px-1">{footer}</Text>
      ) : null}
    </View>
  );
}

export function SettingsRow({
  icon,
  /** Eigene Farbe statt des Akzents — für Zeilen, die sich abheben sollen. */
  iconColor,
  label,
  /** Aktueller Wert oder Kurzbeschreibung — rechts bzw. unter dem Label. */
  value,
  hint,
  onPress,
  /** Rot statt normal. Für Abmelden und Konto löschen. */
  danger,
  busy,
  /** Letzte Zeile einer Gruppe bekommt keine Trennlinie. */
  last,
  disabled,
  accessibilityLabel,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  iconColor?: string;
  label: string;
  value?: string;
  hint?: string;
  onPress?: () => void;
  danger?: boolean;
  busy?: boolean;
  last?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const c = useThemeColors();
  const farbe = danger ? c.danger : iconColor || c.accent;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || busy || !onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      className={`flex-row items-center px-4 py-3.5 ${last ? "" : "border-b border-line"} ${
        disabled ? "opacity-40" : ""
      }`}
    >
      <View
        style={{ backgroundColor: `${farbe}1a`, borderColor: `${farbe}33` }}
        className="w-9 h-9 rounded-xl border items-center justify-center"
      >
        <Ionicons name={icon} size={17} color={farbe} />
      </View>

      <View className="flex-1 ml-3.5">
        <Text className={`text-xs font-black ${danger ? "text-danger" : "text-content"}`}>
          {label}
        </Text>
        {hint ? (
          <Text className="text-content-faint text-[10px] font-semibold mt-0.5 leading-4">
            {hint}
          </Text>
        ) : null}
      </View>

      {busy ? (
        <ActivityIndicator size="small" color={farbe} />
      ) : (
        <>
          {value ? (
            <Text className="text-content-muted text-[11px] font-bold mr-1.5" numberOfLines={1}>
              {value}
            </Text>
          ) : null}
          {onPress ? <Ionicons name="chevron-forward" size={15} color={c.contentFaint} /> : null}
        </>
      )}
    </TouchableOpacity>
  );
}

/**
 * Eine Zeile mit mehreren Möglichkeiten, von denen genau eine gilt.
 *
 * Für Einstellungen, deren Optionen so kurz sind, dass ein eigener Unterschirm
 * mehr Weg als Nutzen wäre — die Wahl des Farbschemas etwa.
 */
export function SettingsChoice<T extends string>({
  options,
  value,
  onChange,
  last,
}: {
  options: { key: T; label: string; icon: React.ComponentProps<typeof Ionicons>["name"] }[];
  value: T;
  onChange: (next: T) => void;
  last?: boolean;
}) {
  const c = useThemeColors();

  return (
    <View className={`px-4 py-3.5 ${last ? "" : "border-b border-line"}`}>
      <View className="flex-row" style={{ gap: 8 }}>
        {options.map((option) => {
          const aktiv = option.key === value;
          return (
            <TouchableOpacity
              key={option.key}
              onPress={() => onChange(option.key)}
              accessibilityRole="radio"
              accessibilityState={{ selected: aktiv }}
              accessibilityLabel={option.label}
              style={
                aktiv
                  ? { backgroundColor: `${c.accent}1a`, borderColor: `${c.accent}66` }
                  : { borderColor: c.line }
              }
              className={`flex-1 items-center py-3 rounded-2xl border ${aktiv ? "" : "bg-surface-alt"}`}
            >
              <Ionicons
                name={option.icon}
                size={17}
                color={aktiv ? c.accent : c.contentFaint}
              />
              <Text
                className={`text-[10px] font-black uppercase tracking-wider mt-1.5 ${
                  aktiv ? "text-accent-ink" : "text-content-faint"
                }`}
              >
                {option.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}
