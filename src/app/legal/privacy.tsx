// NOTE FOR THE DEVELOPER: this is a draft privacy policy tailored to what
// TrinkDuell actually collects today. It is NOT legal advice and must be
// reviewed by a qualified lawyer (DSGVO/GDPR, German TMG/DDG) before this app
// is published for real users. Placeholders like [Name/Adresse] must be
// filled in, and this text also needs to be hosted at a public URL (both app
// stores require a privacy policy link in the submission form, not just
// in-app text).
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
      "[Name/Firma des Betreibers]\n[Anschrift]\n[E-Mail-Adresse für Datenschutzanfragen]\n\n" +
      "Dieser Abschnitt muss vor Veröffentlichung mit den echten Kontaktdaten des Betreibers ausgefüllt werden.",
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
      "Standort: Das Datenmodell unterstützt optionale GPS-Koordinaten zu einem Getränke-Eintrag für eine " +
      "künftige Karten-Funktion. Diese Funktion ist aktuell deaktiviert — es werden derzeit keine " +
      "Standortdaten erhoben. Dieser Abschnitt muss aktualisiert werden, sobald die Karten-Funktion aktiviert wird.",
  },
  {
    title: "3. Wofür wir die Daten nutzen",
    body:
      "Ausschließlich, um die Funktionen der App bereitzustellen: Anmeldung, Anzeige deiner Statistiken und " +
      "Rangliste, Trinkspiele/Duelle, Freundes- und Gruppenfunktionen, Chat. Wir verkaufen deine Daten nicht " +
      "und nutzen sie nicht für Werbezwecke. Es sind aktuell keine Analyse- oder Tracking-Dienste Dritter " +
      "(z. B. Firebase Analytics) in die App eingebunden.",
  },
  {
    title: "4. Rechtsgrundlage",
    body:
      "Die Verarbeitung erfolgt zur Erfüllung des Nutzungsvertrags mit dir (Art. 6 Abs. 1 lit. b DSGVO), " +
      "z. B. um dir dein Konto und die App-Funktionen bereitzustellen.",
  },
  {
    title: "5. Weitergabe an Dritte",
    body:
      "Server-Hosting und Erreichbarkeit der App laufen über [Proxmox-Server-Standort] und werden über " +
      "Cloudflare (Tunnel/DNS) öffentlich erreichbar gemacht. Cloudflare verarbeitet dabei technisch " +
      "Verbindungsdaten als Auftragsverarbeiter. Ein entsprechender Auftragsverarbeitungsvertrag (AVV) mit " +
      "Cloudflare ist vor Veröffentlichung zu prüfen/abzuschließen. Eine darüber hinausgehende Weitergabe " +
      "deiner Daten an Dritte findet nicht statt.",
  },
  {
    title: "6. Speicherdauer & Löschung",
    body:
      "Deine Daten werden gespeichert, solange dein Konto besteht. Du kannst dein Konto jederzeit direkt in " +
      "der App unwiderruflich löschen (Menü → \"Konto endgültig löschen\"). Dabei werden dein Profil, deine " +
      "Getränke-Einträge, Beiträge, Duelle, Nachrichten und Freundschaften entfernt.",
  },
  {
    title: "7. Deine Rechte",
    body:
      "Du hast nach der DSGVO das Recht auf Auskunft (Art. 15), Berichtigung (Art. 16), Löschung (Art. 17), " +
      "Einschränkung der Verarbeitung (Art. 18), Datenübertragbarkeit (Art. 20) sowie Widerspruch (Art. 21) " +
      "gegen die Verarbeitung deiner Daten. Zudem hast du das Recht, dich bei einer Datenschutz-" +
      "Aufsichtsbehörde zu beschweren.",
  },
  {
    title: "8. Kontakt",
    body: "Bei Fragen zum Datenschutz wende dich an: [Kontakt-E-Mail-Adresse].",
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
    <View className="flex-1 bg-slate-950 px-6 pt-6">
      <ScrollView showsVerticalScrollIndicator={false} className="flex-1">
        <Text className="text-white text-xl font-black tracking-wide mb-1">Datenschutzerklärung</Text>
        <Text className="text-cyan-400 text-[10px] font-bold uppercase tracking-widest mb-6">TrinkDuell</Text>

        {SECTIONS.map((section) => (
          <View key={section.title} className="mb-6">
            <Text className="text-cyan-400 text-sm font-black mb-2">{section.title}</Text>
            <Text className="text-slate-300 text-xs leading-relaxed">{section.body}</Text>
          </View>
        ))}

        <View className="h-16" />
      </ScrollView>
    </View>
  );
}
