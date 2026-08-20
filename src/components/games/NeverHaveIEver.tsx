import React, { useState } from "react";
import { View, Text, TouchableOpacity, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { triggerHaptic } from "@/services/haptics";
import { GameShell, PromptCard, GameButton } from "./GameShell";
import { Intensity, NEVER_HAVE_I_EVER, pickRandom } from "@/games/content";
import { useNightSession } from "@/games/session";
import { useThemeColors } from "@/services/theme";

// Kennfarbe des Spiels — Identitaet, kein semantischer UI-Ton.
const ACCENT = "#38bdf8";

/**
 * „Ich hab noch nie" mit Minderheitswertung.
 *
 * Vorher war das ein Kartenstapel: Text lesen, Knopf, nächster Text. Der Reiz
 * des Spiels liegt aber nicht in der Frage, sondern in der Person, die als
 * Einzige die Hand hebt — und genau die wurde nirgends belohnt.
 *
 * Jetzt tippt die Runde, wer es getan hat. Wer als Einziger dasteht, erzählt
 * die Geschichte und kassiert den vollen Punktwert; ist die Mehrheit dabei,
 * ist es eben nichts Besonderes. Jedes Geständnis landet im Dossier und kann
 * später wieder auftauchen.
 */
export function NeverHaveIEver({
  onCancel,
  onMinimize,
}: {
  onCancel: () => void;
  onMinimize: () => void;
}) {
  const c = useThemeColors();
  const session = useNightSession();
  const [intensity, setIntensity] = useState<Intensity>("party");
  const [prompt, setPrompt] = useState(() => pickRandom(NEVER_HAVE_I_EVER.party));
  const [round, setRound] = useState(1);
  const [tapped, setTapped] = useState<string[]>([]);
  const [revealed, setRevealed] = useState(false);

  const players = session?.players || [];
  const hatRunde = session?.active && players.length >= 2;

  const alleine = tapped.length === 1;
  const mehrheit = tapped.length > players.length / 2;

  const next = (level: Intensity = intensity) => {
    triggerHaptic("medium");
    setPrompt(pickRandom(NEVER_HAVE_I_EVER[level], prompt));
    setRound((r) => r + 1);
    setTapped([]);
    setRevealed(false);
  };

  const changeIntensity = (level: Intensity) => {
    setIntensity(level);
    setPrompt(pickRandom(NEVER_HAVE_I_EVER[level], prompt));
    setTapped([]);
    setRevealed(false);
  };

  const toggle = (id: string) => {
    if (revealed) return;
    triggerHaptic("light");
    setTapped((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  };

  const reveal = () => {
    triggerHaptic("success");
    setRevealed(true);
    if (!session) return;

    // Alleine dastehen ist die Pointe des Spiels — und wird entsprechend
    // bezahlt. In der Mehrheit ist es nichts Besonderes.
    for (const id of tapped) {
      session.award(id, alleine ? 30 : mehrheit ? 5 : 15);
      session.remember(
        id,
        "zugegeben",
        `hat zugegeben: „${prompt.replace(/^…/, "").trim()}"`
      );
    }
    // Wer als Einziger nicht dabei war, ist auch eine Geschichte wert.
    if (tapped.length === players.length - 1 && players.length > 2) {
      const einziger = players.find((p) => !tapped.includes(p.id));
      if (einziger) session.award(einziger.id, 20);
    }
    session.countRound();
  };

  return (
    <GameShell
      title="Ich hab noch nie"
      accent={ACCENT}
      onCancel={onCancel}
      onMinimize={onMinimize}
      intensity={intensity}
      onIntensityChange={changeIntensity}
    >
      <Text className="text-content-faint text-[10px] font-black uppercase tracking-widest text-center mb-2">
        Runde {round}
      </Text>

      {!hatRunde ? (
        // Ohne Runde bleibt es der alte Kartenstapel — besser als gar nichts.
        <>
          <PromptCard
            text={`Ich hab noch nie ${prompt}`}
            hint="Wer es schon gemacht hat, nimmt einen Schluck — Wasser zählt genauso."
            accent={ACCENT}
          />
          <GameButton
            label="Nächste Karte"
            icon="arrow-forward"
            accent={ACCENT}
            onPress={() => next()}
          />
        </>
      ) : (
        <>
          <View
            style={{ borderColor: ACCENT }}
            className="bg-surface border-2 rounded-3xl p-5 mb-4"
          >
            <Text className="text-content text-base font-black text-center leading-relaxed">
              Ich hab noch nie {prompt}
            </Text>
          </View>

          <Text className="text-content-faint text-[10px] font-black uppercase tracking-widest text-center mb-3">
            {revealed
              ? alleine
                ? "Ganz allein — erzähl!"
                : mehrheit
                  ? "Die halbe Runde. Also nichts Besonderes."
                  : "Ergebnis"
              : "Wer hat's getan? Antippen."}
          </Text>

          <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
            <View className="gap-2">
              {players.map((p) => {
                const dabei = tapped.includes(p.id);
                return (
                  <TouchableOpacity
                    key={p.id}
                    onPress={() => toggle(p.id)}
                    disabled={revealed}
                    style={dabei ? { borderColor: ACCENT } : undefined}
                    className={`flex-row items-center justify-between p-3 rounded-2xl border ${
                      dabei ? "bg-accent/10" : "bg-surface border-line"
                    }`}
                  >
                    <Text className="text-content text-xs font-black">{p.name}</Text>
                    {dabei ? (
                      <Ionicons name="checkmark-circle" size={18} color={ACCENT} />
                    ) : (
                      <Ionicons name="ellipse-outline" size={18} color={c.contentFaint} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>

            {revealed && (
              <View className="bg-surface border border-line rounded-2xl p-3.5 mt-4">
                <Text className="text-content-faint text-[11px] font-medium leading-relaxed">
                  {tapped.length === 0
                    ? "Niemand? Dann trinkt, wer lügt."
                    : alleine
                      ? "Alleiniges Geständnis: volle Punktzahl — dafür will die Runde jetzt die ganze Geschichte hören. Wer nicht erzählen will, nimmt stattdessen einen Schluck."
                      : "Alle, die getippt haben, nehmen einen Schluck — oder eben nicht. Wasser zählt genauso."}
                </Text>
              </View>
            )}
            <View className="h-4" />
          </ScrollView>

          {revealed ? (
            <GameButton
              label="Nächste Karte"
              icon="arrow-forward"
              accent={ACCENT}
              onPress={() => next()}
            />
          ) : (
            <GameButton label="Auflösen" icon="eye" accent={ACCENT} onPress={reveal} />
          )}
        </>
      )}
    </GameShell>
  );
}

export default NeverHaveIEver;
