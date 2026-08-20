// HINWEIS: Dieser Text beschreibt, was TrinkDuell tatsächlich erhebt, und die
// Kontaktdaten des Verantwortlichen sind eingetragen. Er ist trotzdem KEINE
// Rechtsberatung und sollte vor einer Store-Veröffentlichung anwaltlich
// geprüft werden (DSGVO, DDG).
//
// NOCH OFFEN vor der Store-Einreichung:
//   - Der Text muss zusätzlich unter einer öffentlichen URL erreichbar sein.
//     Beide Stores verlangen im Formular einen Link, nicht nur den Text in der
//     App. Anbieten würde sich https://webapp.trinkduell.com/legal/privacy.
//   - Der Auftragsverarbeitungsvertrag mit Cloudflare (Abschnitt 6) ist zu
//     prüfen bzw. abzuschließen.
import React from "react";
import { View, Text, ScrollView } from "react-native";

interface Section {
  title: string;
  body: string;
}

const SECTIONS: Section[] = [
  {
    title: "1. Verantwortlicher",
    body:
      "Verantwortlich für die Datenverarbeitung im Sinne der DSGVO ist:\n\n" +
      "Sebastian Scheck\n" +
      "Hinter den Gärten 4\n" +
      "76448 Durmersheim\n" +
      "Deutschland\n\n" +
      "E-Mail: sebastianscheck2@googlemail.com\n" +
      "Telefon: +49 172 9214233",
  },
  {
    title: "2. Welche Daten wir erheben",
    body:
      "Bei der Registrierung: Benutzername, E-Mail-Adresse, Passwort (wird ausschließlich als Hash gespeichert, " +
      "niemals im Klartext).\n\n" +
      "Bei der Nutzung: von dir eingetragene Getränke-Einträge (Getränkeart, Menge, Alkoholgehalt, Zeitpunkt), " +
      "Punkte- und Levelstand, freigeschaltete Erfolge, optional ein Profilbild, sowie Inhalte, die du aktiv " +
      "teilst (Status-Posts, Chat-Nachrichten an Freunde oder Gruppen, Gruppenzugehörigkeit, Freundschaften).\n\n" +
      "Technisch: dein JWT-Sitzungstoken zur Anmeldung (lokal auf deinem Gerät gespeichert).\n\n" +
      "Standort: TrinkDuell kann zu einem Getränke-Eintrag deinen Standort (GPS-Koordinaten) speichern, " +
      "damit du deinen persönlichen Verlauf auf der Karte siehst. Das ist standardmäßig AUS und muss von " +
      "dir aktiv eingeschaltet werden (Menü → Einstellungen → Standort). Du hast dort drei Möglichkeiten: \"Automatisch\" " +
      "(jedes geloggte Getränk speichert den Ort), \"Nur bei Check-in\" (nur wenn du es ausdrücklich " +
      "auslöst) und \"Aus\" (es werden keine Standortdaten erhoben). Du kannst die Einstellung jederzeit " +
      "ändern und die Berechtigung zusätzlich in den Systemeinstellungen deines Geräts widerrufen.",
  },
  {
    title: "3. Wer sieht deinen Standort?",
    body:
      "Deine gespeicherten Orte sind ausschließlich für Personen sichtbar, mit denen du eine bestätigte " +
      "Freundschaft hast, sowie für Mitglieder deiner Gruppen. Fremde Nutzer:innen sehen deine Standorte " +
      "nie — auch dann nicht, wenn sie zufällig in der Nähe sind.\n\n" +
      "Die Karte selbst wird über OpenStreetMap-Kartenmaterial (Kartenkacheln von CARTO) dargestellt. Beim " +
      "Laden der Karte werden dabei technisch bedingt Anfragen an diese Dienste gestellt; deine eigenen " +
      "Positionsdaten werden dabei nicht an OpenStreetMap oder CARTO übertragen.",
  },
  {
    title: "4. Wofür wir die Daten nutzen",
    body:
      "Ausschließlich, um die Funktionen der App bereitzustellen: Anmeldung, Anzeige deiner Statistiken und " +
      "Rangliste, Trinkspiele/Duelle, Freundes- und Gruppenfunktionen, Chat sowie — sofern von dir aktiviert " +
      "— die Karte mit deinem Verlauf. Wir verkaufen deine Daten nicht " +
      "und nutzen sie nicht für Werbezwecke. Es sind aktuell keine Analyse- oder Tracking-Dienste Dritter " +
      "(z. B. Firebase Analytics) in die App eingebunden.",
  },
  {
    title: "5. Rechtsgrundlage",
    body:
      "Die Verarbeitung erfolgt zur Erfüllung des Nutzungsvertrags mit dir (Art. 6 Abs. 1 lit. b DSGVO), " +
      "z. B. um dir dein Konto und die App-Funktionen bereitzustellen.",
  },
  {
    title: "6. Weitergabe an Dritte",
    body:
      "Die App-Daten liegen auf einem vom Verantwortlichen selbst betriebenen Server in Deutschland " +
      "(Privatanschrift des Verantwortlichen, siehe Abschnitt 1). Sie werden über " +
      "Cloudflare (Tunnel/DNS) öffentlich erreichbar gemacht. Cloudflare verarbeitet dabei technisch " +
      "Verbindungsdaten als Auftragsverarbeiter. Ein entsprechender Auftragsverarbeitungsvertrag (AVV) mit " +
      "Cloudflare ist vor Veröffentlichung zu prüfen/abzuschließen. Eine darüber hinausgehende Weitergabe " +
      "deiner Daten an Dritte findet nicht statt.",
  },
  {
    title: "7. Speicherdauer & Löschung",
    body:
      "Deine Daten werden gespeichert, solange dein Konto besteht. Du kannst dein Konto jederzeit direkt in " +
      "der App unwiderruflich löschen (Menü → Einstellungen → \"Konto endgültig löschen\"). Dabei werden dein Profil, deine " +
      "Getränke-Einträge, Beiträge, Duelle, Nachrichten und Freundschaften entfernt.",
  },
  {
    title: "8. Deine Rechte",
    body:
      "Du hast nach der DSGVO das Recht auf Auskunft (Art. 15), Berichtigung (Art. 16), Löschung (Art. 17), " +
      "Einschränkung der Verarbeitung (Art. 18), Datenübertragbarkeit (Art. 20) sowie Widerspruch (Art. 21) " +
      "gegen die Verarbeitung deiner Daten. Zudem hast du das Recht, dich bei einer Datenschutz-" +
      "Aufsichtsbehörde zu beschweren.",
  },
  {
    title: "9. Kontakt",
    body:
      "Bei Fragen zum Datenschutz oder zur Ausübung deiner Rechte wende dich an:\n\n" +
      "sebastianscheck2@googlemail.com\n\n" +
      "Wir antworten auf Auskunfts- und Löschanfragen innerhalb eines Monats (Art. 12 Abs. 3 DSGVO).",
  },
  {
    title: "Stand",
    body:
      "Entwurf, Stand August 2026 — noch nicht rechtlich geprüft. Diese Version dient der Beta-Phase mit " +
      "bekannten Testern und ersetzt keine anwaltliche Prüfung vor einer öffentlichen Veröffentlichung.",
  },
];

export default function PrivacyPolicyScreen() {
  return (
    <View className="flex-1 bg-bg px-6 pt-6">
      <ScrollView showsVerticalScrollIndicator={false} className="flex-1">
        <Text className="text-content text-xl font-black tracking-wide mb-1">Datenschutzerklärung</Text>
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
