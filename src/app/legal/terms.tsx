// NOTE FOR THE DEVELOPER: draft terms of service, not legal advice. Needs
// review by a qualified lawyer before publishing, and public hosting (see
// the note in legal/privacy.tsx for details).
import React from "react";
import { View, Text, ScrollView } from "react-native";

interface Section {
  title: string;
  body: string;
}

const SECTIONS: Section[] = [
  {
    // Ohne benannten Vertragspartner ist unklar, mit WEM der Nutzungsvertrag
    // zustande kommt — und genau darauf verweist Abschnitt 8 (anwendbares
    // Recht und Gerichtsstand).
    title: "0. Anbieter",
    body:
      "Anbieter und Vertragspartner ist:\n\n" +
      "Sebastian Scheck\n" +
      "Hinter den Gärten 4\n" +
      "76448 Durmersheim\n" +
      "Deutschland\n\n" +
      "E-Mail: sebastianscheck2@googlemail.com\n\n" +
      "Die vollständigen Anbieterangaben findest du im Impressum " +
      "(Einstellungen → Impressum).",
  },
  {
    title: "1. Zweck der App",
    body:
      "TrinkDuell ist eine Unterhaltungs-App zum spielerischen Festhalten von Getränke-Konsum mit Freunden " +
      "(Rangliste, Trinkspiele, Erfolge). Sie ersetzt keine medizinische Beratung und ist kein Werkzeug zur " +
      "Blutalkoholberechnung — angezeigte Werte sind grobe Schätzungen und nicht für sicherheitsrelevante " +
      "Entscheidungen (z. B. Fahrtauglichkeit) geeignet.",
  },
  {
    title: "2. Altersvoraussetzung",
    body:
      "Die Nutzung ist ausschließlich Personen ab 18 Jahren gestattet. Mit der Registrierung bestätigst du, " +
      "dass du mindestens 18 Jahre alt bist.",
  },
  {
    title: "3. Verantwortungsvoller Umgang mit Alkohol",
    body:
      "TrinkDuell soll Spaß beim gemeinsamen Feiern fördern — nicht exzessiven oder gesundheitsschädlichen " +
      "Alkoholkonsum. Kenne deine eigenen Grenzen und die deiner Mitspieler:innen. Trinke niemals, wenn du " +
      "anschließend ein Fahrzeug führen musst, schwanger bist oder aus gesundheitlichen Gründen auf Alkohol " +
      "verzichten solltest. Bei Anzeichen von Alkoholmissbrauch bei dir oder anderen: Hilfsangebote wie die " +
      "Sucht&Drogen-Hotline (Deutschland: 01806 313031) nutzen.",
  },
  {
    title: "4. Registrierung & Konto",
    body:
      "Du bist für die Richtigkeit deiner Angaben und die Geheimhaltung deines Passworts verantwortlich. Ein " +
      "Konto ist persönlich und nicht übertragbar. Du kannst dein Konto jederzeit in der App unter Menü → " +
      "Einstellungen → \"Konto endgültig löschen\" dauerhaft entfernen.",
  },
  {
    title: "5. Nutzerinhalte",
    body:
      "Beiträge, Chat-Nachrichten und Profilbilder, die du postest, müssen frei von rechtswidrigen, " +
      "beleidigenden, diskriminierenden oder anderweitig unangemessenen Inhalten sein. Wir behalten uns vor, " +
      "Inhalte zu entfernen und Konten bei Verstößen zu sperren.",
  },
  {
    title: "6. Haftungsausschluss",
    body:
      "Die Nutzung der App erfolgt auf eigene Verantwortung. Für Schäden, die aus dem Konsum von Alkohol " +
      "oder aus Entscheidungen resultieren, die auf Basis von in der App angezeigten Werten getroffen werden, " +
      "wird keine Haftung übernommen, soweit gesetzlich zulässig.",
  },
  {
    title: "7. Änderungen",
    body:
      "Diese Nutzungsbedingungen können angepasst werden, z. B. wenn neue Funktionen hinzukommen. Über " +
      "wesentliche Änderungen wirst du in der App informiert.",
  },
  {
    title: "8. Anwendbares Recht",
    body: "Es gilt deutsches Recht.",
  },
  {
    title: "Stand",
    body:
      "Entwurf, Stand August 2026 — noch nicht rechtlich geprüft. Diese Version dient der Beta-Phase mit " +
      "bekannten Testern und ersetzt keine anwaltliche Prüfung vor einer öffentlichen Veröffentlichung.",
  },
];

export default function TermsScreen() {
  return (
    <View className="flex-1 bg-bg px-6 pt-6">
      <ScrollView showsVerticalScrollIndicator={false} className="flex-1">
        <Text className="text-content text-xl font-black tracking-wide mb-1">Nutzungsbedingungen</Text>
        <Text className="text-accent-ink text-[10px] font-bold uppercase tracking-widest mb-6">TrinkDuell</Text>

        {SECTIONS.map((section) => (
          <View key={section.title} className="mb-6">
            <Text className="text-accent-ink text-sm font-black mb-2">{section.title}</Text>
            <Text className="text-content-muted text-xs leading-relaxed">{section.body}</Text>
          </View>
        ))}

        <View className="h-16" />
      </ScrollView>
    </View>
  );
}
