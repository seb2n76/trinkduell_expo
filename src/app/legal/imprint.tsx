// Impressum nach § 5 DDG (bis 2024: § 5 TMG).
//
// In Deutschland brauchen "geschäftsmäßige, in der Regel gegen Entgelt
// angebotene" Telemedien ein Impressum. Die Rechtsprechung legt das weit aus:
// sobald eine App in einem Store steht — auch kostenlos — wird sie in der
// Regel als geschäftsmäßig eingestuft. Ein rein privater Test im
// Freundeskreis fällt eher nicht darunter, die Grenze ist aber unscharf.
// Deshalb steht das Impressum hier ab der Beta.
//
// Pflichtangaben sind Name, ladungsfähige Anschrift (kein Postfach) und eine
// Angabe zur schnellen elektronischen Kontaktaufnahme — dafür genügt eine
// E-Mail-Adresse. Eine Telefonnummer ist NICHT vorgeschrieben. Sie steht hier
// nur, weil der Betreiber sie ausdrücklich angegeben hat, und kann jederzeit
// entfernt werden, ohne dass die Pflichtangaben unvollständig würden.
//
// Dies ist keine Rechtsberatung.
import React from "react";
import { View, Text, ScrollView } from "react-native";

interface Section {
  title: string;
  body: string;
}

const SECTIONS: Section[] = [
  {
    title: "Angaben gemäß § 5 DDG",
    body:
      "Sebastian Scheck\n" +
      "Hinter den Gärten 4\n" +
      "76448 Durmersheim\n" +
      "Deutschland",
  },
  {
    title: "Kontakt",
    body:
      "E-Mail: sebastianscheck2@googlemail.com\n" +
      "Telefon: +49 172 9214233",
  },
  {
    title: "Verantwortlich für den Inhalt",
    body:
      "Sebastian Scheck, Anschrift wie oben.\n\n" +
      "TrinkDuell ist ein privat betriebenes Projekt. Es steht in keiner " +
      "Verbindung zu Herstellern der in der App genannten Getränke oder Marken.",
  },
  {
    title: "Streitbeilegung",
    body:
      "Die Europäische Kommission stellt eine Plattform zur Online-Streit" +
      "beilegung (OS) bereit: https://ec.europa.eu/consumers/odr\n\n" +
      "Wir sind nicht bereit und nicht verpflichtet, an Streitbeilegungs" +
      "verfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.",
  },
  {
    title: "Haftung für Inhalte",
    body:
      "Als Diensteanbieter sind wir für eigene Inhalte in dieser App nach den " +
      "allgemeinen Gesetzen verantwortlich. Wir sind jedoch nicht verpflichtet, " +
      "übermittelte oder gespeicherte fremde Informationen zu überwachen oder " +
      "nach Umständen zu forschen, die auf eine rechtswidrige Tätigkeit " +
      "hinweisen.\n\n" +
      "Inhalte, die Nutzerinnen und Nutzer selbst einstellen (Beiträge, Fotos, " +
      "Chat-Nachrichten, Profilangaben), sind fremde Inhalte. Sobald uns eine " +
      "konkrete Rechtsverletzung bekannt wird, entfernen wir die betroffenen " +
      "Inhalte umgehend. Meldungen sind direkt in der App möglich " +
      "(Melde-Funktion an jedem Beitrag) oder per E-Mail an die oben genannte " +
      "Adresse.",
  },
  {
    title: "Urheberrecht",
    body:
      "Die durch den Betreiber erstellten Inhalte und Werke in dieser App " +
      "unterliegen dem deutschen Urheberrecht. Beiträge Dritter bleiben deren " +
      "Urheberrecht unterworfen.\n\n" +
      "Eine Übersicht der verwendeten freien Software findest du unter " +
      "Einstellungen → Lizenzen & Open Source.",
  },
  {
    title: "Altersfreigabe",
    body:
      "TrinkDuell richtet sich ausschließlich an Personen ab 18 Jahren. Die App " +
      "fordert nicht zum Alkoholkonsum auf: In allen Spielen ist Trinken " +
      "freiwillig, es gibt immer eine gleichwertige Alternative, und " +
      "alkoholfreie Getränke zählen ebenso.",
  },
];

export default function ImprintScreen() {
  return (
    <View className="flex-1 bg-bg px-6 pt-6">
      <ScrollView showsVerticalScrollIndicator={false} className="flex-1">
        <Text className="text-content text-xl font-black tracking-wide mb-1">Impressum</Text>
        <Text className="text-accent-ink text-[10px] font-bold uppercase tracking-widest mb-6">
          TrinkDuell
        </Text>

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
