import React, { useCallback, useState } from "react";
import { View, ScrollView, Text } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { apiService } from "@/services/api";
import { useAuth } from "../_layout";
import { triggerHaptic } from "@/services/haptics";
import { notify, confirmAction } from "@/services/dialogs";
import { SettingsSection, SettingsRow } from "@/components/SettingsList";
import {
  LocationMode,
  DEFAULT_LOCATION_MODE,
  getLocationMode,
} from "@/services/location";

const LOCATION_LABELS: Record<LocationMode, string> = {
  auto: "Automatisch",
  manual: "Nur Check-in",
  off: "Aus",
};

export default function SettingsScreen() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [locationMode, setLocationModeState] = useState<LocationMode>(DEFAULT_LOCATION_MODE);
  const [deleting, setDeleting] = useState(false);

  // Bei jedem Betreten neu lesen: der Modus wird auf dem Unterschirm geändert
  // und der Wert steht hier in der Zeile.
  useFocusEffect(
    useCallback(() => {
      getLocationMode().then(setLocationModeState);
    }, [])
  );

  const handleLogout = () => {
    confirmAction(
      "Abmelden?",
      "Möchtest du dich wirklich abmelden?",
      async () => {
        try {
          await triggerHaptic("medium");
          await logout();
        } catch (error) {
          await triggerHaptic("error");
          console.error("Failed to logout:", error);
        }
      },
      "Abmelden"
    );
  };

  const handleDeleteAccount = () => {
    confirmAction(
      "Konto endgültig löschen?",
      "Dein Konto und alle zugehörigen Daten (Statistiken, Freundschaften, Nachrichten) werden unwiderruflich gelöscht. Das kann nicht rückgängig gemacht werden.",
      async () => {
        // Die eigene Id kommt aus der Sitzung; ist sie aus irgendeinem Grund
        // nicht da, lieber einmal nachfragen als eine kaputte URL schicken.
        const userId = user?.id || (await apiService.getCurrentUser().catch(() => null))?.id;
        if (!userId) {
          notify("Fehler", "Dein Konto konnte nicht ermittelt werden. Bitte melde dich neu an.");
          return;
        }

        setDeleting(true);
        try {
          await triggerHaptic("medium");
          await apiService.deleteAccount(userId);
          await logout();
        } catch (error) {
          await triggerHaptic("error");
          notify(
            "Fehler",
            "Konto konnte nicht gelöscht werden. Bitte stelle sicher, dass du mit dem Internet verbunden bist, und versuche es erneut."
          );
          console.error("Failed to delete account:", error);
        } finally {
          setDeleting(false);
        }
      },
      "Endgültig löschen"
    );
  };

  return (
    <View className="flex-1 bg-slate-950">
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pt-5 pb-16"
        showsVerticalScrollIndicator={false}
      >
        <View className="w-full self-center" style={{ maxWidth: 640 }}>
          <SettingsSection title="Konto">
            <SettingsRow
              icon="person-outline"
              label="Profil bearbeiten"
              hint="Profilbild, Anzeigename, Erfolge"
              onPress={() => {
                triggerHaptic("light");
                router.push("/profile");
              }}
            />
            <SettingsRow
              icon="key-outline"
              label="Passwort ändern"
              hint="Meldet alle anderen Geräte ab"
              last
              onPress={() => {
                triggerHaptic("light");
                router.push("/settings/password");
              }}
            />
          </SettingsSection>

          <SettingsSection
            title="Datenschutz & Standort"
            footer="Dein Standort wird nur mit deinen Freunden und Mitgliedern deiner Gruppen geteilt — niemals mit Fremden."
          >
            <SettingsRow
              icon="location-outline"
              label="Standort"
              value={LOCATION_LABELS[locationMode]}
              onPress={() => {
                triggerHaptic("light");
                router.push("/settings/location");
              }}
            />
            <SettingsRow
              icon="ban-outline"
              iconColor="#94a3b8"
              label="Blockierte Nutzer"
              hint="Blockierungen ansehen und aufheben"
              onPress={() => {
                triggerHaptic("light");
                router.push("/settings/blocked");
              }}
            />
            <SettingsRow
              icon="shield-checkmark-outline"
              label="Datenschutzerklärung"
              last
              onPress={() => {
                triggerHaptic("light");
                router.push("/legal/privacy");
              }}
            />
          </SettingsSection>

          <SettingsSection title="Rechtliches">
            <SettingsRow
              icon="reader-outline"
              label="Nutzungsbedingungen"
              onPress={() => {
                triggerHaptic("light");
                router.push("/legal/terms");
              }}
            />
            <SettingsRow
              icon="document-text-outline"
              label="Lizenzen & Open Source"
              hint="Verwendete freie Software"
              last
              onPress={() => {
                triggerHaptic("light");
                router.push("/settings/licenses");
              }}
            />
          </SettingsSection>

          <SettingsSection
            title="Darstellung"
            footer="Themes und Anzeigeoptionen kommen in einem späteren Schritt."
          >
            <SettingsRow
              icon="color-palette-outline"
              iconColor="#64748b"
              label="Design"
              hint="Aktuell nur dunkel"
              value="Dunkel"
              disabled
              last
            />
          </SettingsSection>

          {/* Abgesetzt und visuell abgegrenzt: beides ist nicht rückgängig zu
              machen — die Abmeldung kostet nur einen neuen Login, die Löschung
              alles. Sie stehen deshalb ganz unten und nicht zwischen den
              harmlosen Zeilen. */}
          <View className="border-t border-slate-800 pt-7 mt-1">
            <SettingsSection
              title="Gefahrenzone"
              footer="Das Löschen entfernt Statistiken, Freundschaften und Nachrichten unwiderruflich."
            >
              <SettingsRow
                icon="log-out-outline"
                label="Abmelden"
                danger
                onPress={handleLogout}
              />
              <SettingsRow
                icon="trash-outline"
                label="Konto endgültig löschen"
                danger
                busy={deleting}
                last
                onPress={handleDeleteAccount}
              />
            </SettingsSection>
          </View>

          <Text className="text-slate-700 text-[10px] font-bold text-center">
            TrinkDuell · Bitte trink verantwortungsvoll
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
