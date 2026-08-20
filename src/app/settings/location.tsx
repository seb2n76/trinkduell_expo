import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { triggerHaptic } from "@/services/haptics";
import { notify } from "@/services/dialogs";
import {
  LocationMode,
  DEFAULT_LOCATION_MODE,
  getLocationMode,
  setLocationMode,
  ensureLocationPermission,
  isLocationAvailableOnPlatform,
} from "@/services/location";
import { useThemeColors } from "@/services/theme";

const OPTIONS: {
  key: LocationMode;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  title: string;
  desc: string;
}[] = [
  {
    key: "auto",
    icon: "navigate",
    title: "Automatisch",
    desc: "Jedes geloggte Getränk speichert deinen Ort. So entsteht dein persönlicher Verlauf auf der Karte.",
  },
  {
    key: "manual",
    icon: "hand-left",
    title: "Nur bei Check-in",
    desc: "Getränke werden ohne Ort gespeichert. Du entscheidest per Check-in, wann dein Standort geteilt wird.",
  },
  {
    key: "off",
    icon: "close-circle",
    title: "Aus",
    desc: "Es werden keinerlei Standortdaten erfasst.",
  },
];

export default function LocationSettingsScreen() {
  const c = useThemeColors();
  const [mode, setMode] = useState<LocationMode>(DEFAULT_LOCATION_MODE);

  useEffect(() => {
    getLocationMode().then(setMode);
  }, []);

  const handleChange = async (next: LocationMode) => {
    await triggerHaptic("light");

    // Ask for the OS permission at the moment the user opts in, not on some
    // unrelated earlier screen — otherwise the prompt has no visible reason.
    if (next !== "off") {
      const granted = await ensureLocationPermission();
      if (!granted) {
        notify(
          "Standort nicht freigegeben",
          "Ohne Standort-Freigabe kann TrinkDuell deine Orte nicht speichern. Du kannst die Berechtigung in den Systemeinstellungen deines Geräts erteilen."
        );
        return;
      }
    }

    await setLocationMode(next);
    setMode(next);
  };

  return (
    <View className="flex-1 bg-bg">
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-5 pt-6 pb-16"
        showsVerticalScrollIndicator={false}
      >
        <View className="w-full self-center" style={{ maxWidth: 640 }}>
          <Text className="text-content-muted text-[11px] leading-relaxed mb-5">
            Dein Standort wird nur mit deinen Freunden und Mitgliedern deiner Gruppen geteilt —
            niemals mit Fremden. Du kannst das jederzeit hier ändern.
          </Text>

          {!isLocationAvailableOnPlatform() && (
            <View className="bg-warning/10 border border-warning/25 rounded-2xl p-3 mb-4">
              <Text className="text-warning text-[10px] font-bold leading-relaxed">
                Im Browser funktioniert die Standortbestimmung nur über eine gesicherte
                HTTPS-Verbindung. In der App funktioniert sie normal.
              </Text>
            </View>
          )}

          {OPTIONS.map((option) => {
            const isActive = mode === option.key;
            return (
              <TouchableOpacity
                key={option.key}
                onPress={() => handleChange(option.key)}
                accessibilityRole="radio"
                accessibilityState={{ selected: isActive }}
                accessibilityLabel={option.title}
                className={`p-4 rounded-2xl border mb-2.5 flex-row items-start ${
                  isActive ? "bg-accent/10 border-accent/40" : "bg-surface border-line"
                }`}
              >
                <Ionicons name={option.icon} size={18} color={isActive ? c.accent : c.contentFaint} />
                <View className="flex-1 ml-3">
                  <Text
                    className={`text-xs font-black mb-0.5 ${isActive ? "text-accent-ink" : "text-content"}`}
                  >
                    {option.title}
                  </Text>
                  <Text className="text-content-faint text-[10px] leading-relaxed">{option.desc}</Text>
                </View>
                {isActive && <Ionicons name="checkmark-circle" size={18} color={c.accent} />}
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}
