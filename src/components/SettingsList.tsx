import React from "react";
import { View, Text, TouchableOpacity, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";

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
      <Text className="text-white/40 text-[10px] font-black uppercase tracking-widest mb-2.5 px-1">
        {title}
      </Text>
      <View className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden">
        {children}
      </View>
      {footer ? (
        <Text className="text-slate-600 text-[10px] leading-4 mt-2 px-1">{footer}</Text>
      ) : null}
    </View>
  );
}

export function SettingsRow({
  icon,
  iconColor = "#22d3ee",
  label,
  /** Aktueller Wert oder Kurzbeschreibung — rechts bzw. unter dem Label. */
  value,
  hint,
  onPress,
  /** Rot statt weiß. Für Abmelden und Konto löschen. */
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
  const farbe = danger ? "#f43f5e" : iconColor;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || busy || !onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      className={`flex-row items-center px-4 py-3.5 ${last ? "" : "border-b border-slate-800"} ${
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
        <Text className={`text-xs font-black ${danger ? "text-rose-400" : "text-white"}`}>
          {label}
        </Text>
        {hint ? (
          <Text className="text-slate-500 text-[10px] font-semibold mt-0.5 leading-4">{hint}</Text>
        ) : null}
      </View>

      {busy ? (
        <ActivityIndicator size="small" color={farbe} />
      ) : (
        <>
          {value ? (
            <Text className="text-slate-400 text-[11px] font-bold mr-1.5" numberOfLines={1}>
              {value}
            </Text>
          ) : null}
          {onPress ? <Ionicons name="chevron-forward" size={15} color="#475569" /> : null}
        </>
      )}
    </TouchableOpacity>
  );
}
