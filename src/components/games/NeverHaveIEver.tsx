import React, { useState } from "react";
import { Text } from "react-native";
import { triggerHaptic } from "@/services/haptics";
import { GameShell, PromptCard, GameButton } from "./GameShell";
import { Intensity, NEVER_HAVE_I_EVER, pickRandom } from "@/games/content";

const ACCENT = "#38bdf8";

export function NeverHaveIEver({
  onCancel,
  onMinimize,
}: {
  onCancel: () => void;
  onMinimize: () => void;
}) {
  const [intensity, setIntensity] = useState<Intensity>("party");
  const [prompt, setPrompt] = useState(() => pickRandom(NEVER_HAVE_I_EVER.party));
  const [round, setRound] = useState(1);

  const next = (level: Intensity = intensity) => {
    triggerHaptic("medium");
    setPrompt(pickRandom(NEVER_HAVE_I_EVER[level], prompt));
    setRound((r) => r + 1);
  };

  const changeIntensity = (level: Intensity) => {
    setIntensity(level);
    setPrompt(pickRandom(NEVER_HAVE_I_EVER[level], prompt));
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
      <Text className="text-slate-500 text-[10px] font-black uppercase tracking-widest text-center mb-2">
        Runde {round}
      </Text>

      <PromptCard
        text={`Ich hab noch nie ${prompt}`}
        hint="Wer es schon gemacht hat, nimmt einen Schluck — Wasser zählt genauso."
        accent={ACCENT}
      />

      <GameButton label="Nächste Karte" icon="arrow-forward" accent={ACCENT} onPress={() => next()} />
    </GameShell>
  );
}

export default NeverHaveIEver;
