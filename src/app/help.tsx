import React, { useState } from "react";
import { View, Text, TouchableOpacity, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { triggerHaptic } from "@/services/haptics";

/**
 * Hilfe & FAQ.
 *
 * ACHTUNG (Entwickler): Der Kontaktabschnitt enthält einen Platzhalter für die
 * Support-Adresse. Der muss vor einer Veröffentlichung durch eine echte,
 * erreichbare Adresse ersetzt werden — die Stores verlangen einen
 * Support-Kontakt, und die Datenschutzerklärung verweist ebenfalls auf eine.
 */
const SUPPORT_ADRESSE = "[support@deine-domain.example]";

interface FaqItem {
  frage: string;
  antwort: string;
}

const FAQ: FaqItem[] = [
  {
    frage: "Wie füge ich Freunde hinzu?",
    antwort:
      "Menü → Freunde → Reiter „Freunde“. Gib oben den Namen ein, unter dem sich die Person registriert hat. " +
      "Die Suche findet nur exakte Schreibweisen — ein Tippfehler sieht aus wie „nicht vorhanden“. " +
      "Die Anfrage muss die andere Person annehmen, dann seht ihr gegenseitig Aktivitäten und Standorte.",
  },
  {
    frage: "Was ist der Unterschied zwischen Gruppe und Event?",
    antwort:
      "Eine Gruppe ist dauerhaft: Stammtisch, Festival-Crew, WG. Sie hat einen Chat, Mitglieder und Quests.\n\n" +
      "Ein Event ist ein einzelner Abend mit festem Ende (4 bis 168 Stunden). Danach läuft es von selbst aus. " +
      "Beides betritt man über einen Einladungscode — durchsuchen lassen sich weder Gruppen noch Events, das ist Absicht.",
  },
  {
    frage: "Warum findet mich niemand über die Suche?",
    antwort:
      "Gesucht wird nach dem Benutzernamen aus der Registrierung, nicht nach der E-Mail-Adresse. " +
      "Wer dich blockiert hat, findet dich ebenfalls nicht — und du ihn nicht.",
  },
  {
    frage: "Wer sieht meinen Standort?",
    antwort:
      "Nur deine Freunde und die Mitglieder deiner Gruppen — niemals Fremde. " +
      "Standardmäßig ist die Standorterfassung AUS.\n\n" +
      "Unter Einstellungen → Standort hast du drei Möglichkeiten: „Automatisch“ (jedes geloggte Getränk " +
      "speichert den Ort), „Nur bei Check-in“ (nur wenn du es ausdrücklich auslöst) und „Aus“ (es werden " +
      "keine Standortdaten erhoben). Zusätzlich kannst du die Berechtigung jederzeit in den " +
      "Systemeinstellungen deines Geräts widerrufen.",
  },
  {
    frage: "Im Browser funktioniert der Standort nicht.",
    antwort:
      "Browser geben Standortdaten nur über eine gesicherte HTTPS-Verbindung heraus. " +
      "In der installierten App funktioniert es normal. Push-Benachrichtigungen sind aus demselben " +
      "Grund im Browser eingeschränkt.",
  },
  {
    frage: "Wie werde ich jemanden los?",
    antwort:
      "Freunde → das Drei-Punkte-Menü neben der Person. Dort kannst du sie entfernen, melden oder blockieren.\n\n" +
      "Blockieren ist die stärkste Stufe: Ihr seht euch danach gegenseitig nirgends mehr — weder im Feed, " +
      "auf der Karte noch in der Rangliste. Eine bestehende Freundschaft wird dabei aufgelöst. " +
      "Rückgängig machen kannst du das unter Einstellungen → Blockierte Nutzer.",
  },
  {
    frage: "Ich habe ein Getränk falsch eingetragen.",
    antwort:
      "Auf dem Dashboard lassen sich die letzten Einträge direkt löschen. Den vollständigen Verlauf " +
      "findest du unter Menü → Profil ganz unten; auch dort ist jeder Eintrag einzeln löschbar. " +
      "Punkte und Level werden dabei neu berechnet.",
  },
  {
    frage: "Ich habe mein Passwort vergessen.",
    antwort:
      "Auf dem Anmeldebildschirm über „Passwort vergessen“. Du bekommst einen Code per E-Mail an die " +
      "Adresse, mit der du dich registriert hast.\n\n" +
      "Wenn du eingeloggt bist und es nur ändern willst: Einstellungen → Passwort ändern. " +
      "Achtung, das meldet alle anderen Geräte ab.",
  },
  {
    frage: "Wie lösche ich mein Konto?",
    antwort:
      "Einstellungen → ganz unten unter „Gefahrenzone“. Die Löschung entfernt Statistiken, " +
      "Freundschaften und Nachrichten unwiderruflich und lässt sich nicht rückgängig machen.",
  },
];

export default function HelpScreen() {
  const router = useRouter();
  const [offen, setOffen] = useState<number | null>(null);

  return (
    <View className="flex-1 bg-slate-950">
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pt-5 pb-16"
        showsVerticalScrollIndicator={false}
      >
        <View className="w-full self-center" style={{ maxWidth: 640 }}>
          <Text className="text-white/40 text-[10px] font-black uppercase tracking-widest mb-2.5 px-1">
            Häufige Fragen
          </Text>

          <View className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden mb-7">
            {FAQ.map((item, index) => {
              const istOffen = offen === index;
              const letzte = index === FAQ.length - 1;
              return (
                <View key={item.frage} className={letzte && !istOffen ? "" : "border-b border-slate-800"}>
                  <TouchableOpacity
                    onPress={() => {
                      triggerHaptic("light");
                      setOffen(istOffen ? null : index);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: istOffen }}
                    className="flex-row items-center px-4 py-3.5"
                  >
                    <Text className="text-white text-xs font-black flex-1 mr-3 leading-4">
                      {item.frage}
                    </Text>
                    <Ionicons
                      name={istOffen ? "chevron-up" : "chevron-down"}
                      size={15}
                      color="#475569"
                    />
                  </TouchableOpacity>
                  {istOffen && (
                    <View className="px-4 pb-4 -mt-1">
                      <Text className="text-slate-400 text-[11px] leading-5">{item.antwort}</Text>
                    </View>
                  )}
                </View>
              );
            })}
          </View>

          <Text className="text-white/40 text-[10px] font-black uppercase tracking-widest mb-2.5 px-1">
            Weiter nicht geholfen?
          </Text>
          <View className="bg-slate-900 border border-slate-800 rounded-3xl p-4 mb-7">
            <Text className="text-slate-400 text-[11px] leading-5 mb-3">
              Schreib uns, was nicht funktioniert hat — am besten mit dem, was du getan hast und was
              stattdessen passiert ist.
            </Text>
            <Text selectable className="text-cyan-400 text-xs font-black">
              {SUPPORT_ADRESSE}
            </Text>
          </View>

          <Text className="text-white/40 text-[10px] font-black uppercase tracking-widest mb-2.5 px-1">
            Rechtliches
          </Text>
          <View className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden mb-7">
            <TouchableOpacity
              onPress={() => router.push("/legal/privacy")}
              className="flex-row items-center px-4 py-3.5 border-b border-slate-800"
            >
              <Ionicons name="shield-checkmark-outline" size={16} color="#22d3ee" />
              <Text className="text-white text-xs font-black flex-1 ml-3">Datenschutzerklärung</Text>
              <Ionicons name="chevron-forward" size={15} color="#475569" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.push("/legal/terms")}
              className="flex-row items-center px-4 py-3.5"
            >
              <Ionicons name="reader-outline" size={16} color="#22d3ee" />
              <Text className="text-white text-xs font-black flex-1 ml-3">Nutzungsbedingungen</Text>
              <Ionicons name="chevron-forward" size={15} color="#475569" />
            </TouchableOpacity>
          </View>

          <View className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-4">
            <View className="flex-row items-center mb-1.5">
              <Ionicons name="warning-outline" size={15} color="#fbbf24" />
              <Text className="text-amber-400 text-[10px] font-black uppercase tracking-wider ml-2">
                Trink verantwortungsvoll
              </Text>
            </View>
            <Text className="text-amber-200/60 text-[11px] leading-5">
              TrinkDuell ist ein Spiel. Kein Punktestand ist es wert, dass du oder jemand anderes zu
              Schaden kommt. Fahr nicht, wenn du getrunken hast, und pass auf deine Leute auf.
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
