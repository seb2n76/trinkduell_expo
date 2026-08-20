import { StoryGameDefinition, StoryPlayer, RoleAssignment } from "../storyEngine/types";

/**
 * 🕵️‍♂️ MORD IM MITTERNACHTS-EXPRESS
 * Ein 1920er-Jahre Noir-Krimi im Luxuszug für 3–12 Spieler.
 * Täter, Meisterdetektiv, betrogene Erbin, Leibarzt, Schaffner, Schmuggler und Barone.
 */
export const murderExpressGame: StoryGameDefinition = {
  id: "murder_express",
  title: "Mord im Mitternachts-Express",
  subtitle: "1920s Noir Whodunnit & Kreuzverhör",
  genre: "Krimi & Social Deduction",
  durationMinutes: 25,
  minPlayers: 3,
  maxPlayers: 12,
  themeColor: "#0284c7",
  accentColor: "#38bdf8",
  icon: "train",
  tagline: "Ein Schneesturm, ein Toter und kein Alibi.",
  description:
    "Der Luxuszug steht tief im Gebirge still. Baron von Falkenstein liegt tot im Salonwagen! Jeder Passagier verbirgt ein dunkles Geheimnis.",

  assignRoles: (players: StoryPlayer[]): RoleAssignment[] => {
    const shuffled = [...players].sort(() => Math.random() - 0.5);
    const assignments: RoleAssignment[] = [];

    // Player 0: Mörder
    assignments.push({
      playerId: shuffled[0].id,
      role: "Der Mörder 🪓",
      secretPrompt: `Du hast den Baron ermordet! Schiebe die Schuld auf ${shuffled[1]?.name || "den Detektiv"} oder ${shuffled[2]?.name || "die anderen Passagiere"}. Wenn du das Kreuzverhör überstehst, entkommst du unerkannt!`,
    });

    // Player 1: Meisterdetektiv
    assignments.push({
      playerId: shuffled[1].id,
      role: "Meisterdetektiv 🕵️‍♂️",
      secretPrompt: "Du leitest die Ermittlung im Zug. Achte genau auf Widersprüche, Alibis und wer nervös am Glas nippt. Deine Stimme hat Gewicht!",
    });

    // Player 2: Betrogene Erbin
    if (shuffled[2]) {
      assignments.push({
        playerId: shuffled[2].id,
        role: "Die Erbin 💎",
        secretPrompt: "Der Baron schuldete dir ein Vermögen. Du bist unschuldig, hast aber ein starkes Motiv! Trinke unauffällig und wirke nicht verdächtig.",
      });
    }

    // Player 3: Leibarzt
    if (shuffled[3]) {
      assignments.push({
        playerId: shuffled[3].id,
        role: "Der Leibarzt 🩺",
        secretPrompt: "Du hast die Leiche untersucht. Du darfst im Salonwagen eine Person zwingen, ihren Schluck auf Ex zu trinken.",
      });
    }

    // Remaining: Bunte Passagiere
    const passengerRoles = [
      "Der Schaffner 🎫",
      "Der Schmuggler 💼",
      "Die Reporterin 📰",
      "Die Baroness 👒",
      "Der Casino-Betrüger 🃏",
      "Der Geheimagent 🕶️",
      "Der Opernsänger 🎭",
      "Die Wahrsagerin 🔮",
    ];

    for (let i = 4; i < shuffled.length; i++) {
      const pRole = passengerRoles[(i - 4) % passengerRoles.length];
      assignments.push({
        playerId: shuffled[i].id,
        role: pRole,
        secretPrompt: `Du reist als ${pRole} im Mitternachtsexpress. Hilf dem Detektiv, den echten Mörder zu fassen, bevor der Zug weiterfährt!`,
      });
    }

    return assignments;
  },

  chapters: [
    {
      id: "act_1_blackout",
      act: 1,
      title: "Akt I: Der Schrei im Tunnel",
      atmosphereHint: "Der Zug rast in die Dunkelheit. Die Scheinwerfer flackern unheilsam.",
      generateText: (players) => {
        const p1 = players[0]?.name || "Ein Passagier";
        const p2 = players[1]?.name || "Eine Dame";
        const weapons = ["einem schweren Schürhaken", "einem Seidenschal", "einem goldenen Brieföffner", "einer Dosis Arsen"];
        const weapon = weapons[Math.floor(Math.random() * weapons.length)];
        return `Draußen tobt der Schneesturm, als der Express plötzlich mit quietschenden Bremsen im Tunnel anhält.
Ein gellender Schrei zerreißt die Stille! Als das Notlicht aufflackert, liegt Baron von Falkenstein leblos über dem Schachtisch – ermordet mit ${weapon}!
${p1} hält ein blutbeflecktes Tuch in der Hand, während ${p2} bleich auf die Schlafwagen-Tür starrt!`;
      },
      interactivePrompt: {
        title: "Schock im Salonwagen",
        description: "Wie verhältst du dich beim Fund der Leiche?",
        choices: [
          {
            id: "drink_shock",
            label: "Einen Schluck zur Beruhigung nehmen (1 Schluck)",
            outcomeText: "Du nimmst einen kräftigen Schluck gegen das Zittern.",
            sips: 1,
            rewardPoints: 10,
          },
          {
            id: "inspect_scene",
            label: "Tatort absuchen & Spuren sichern",
            outcomeText: "Du findest eine zerrissene Fahrkarte mit verdächtigen Initialen!",
            rewardPoints: 15,
          },
          {
            id: "fake_alibi",
            label: "Lautstark dein Alibi beteuern",
            outcomeText: "Du erklärst allen, dass du die ganze Zeit am Buffet standest.",
            rewardPoints: 12,
          },
        ],
      },
    },
    {
      id: "act_2_interrogation",
      act: 2,
      title: "Akt II: Das eisige Kreuzverhör",
      atmosphereHint: "Eisblumen wachsen an den Scheiben. Jeder Blick ist voller Argwohn.",
      generateText: (players) => {
        const pSuspect = players[Math.floor(Math.random() * players.length)]?.name || "Jemand";
        const pWitness = players[(players.length - 1)]?.name || "Der Schaffner";
        return `Der Meisterdetektiv lässt alle Abteile durchsuchen!
${pWitness} tritt vor: "Ich habe ${pSuspect} kurz vor dem Stromausfall beim Salonwagen herumschleichen sehen!"
Die Passagiere verlangen Antworten. Wer nicht redet, muss trinken!`;
      },
      interactivePrompt: {
        title: "Verdächtigungen & Verhöre",
        description: "Wie reagierst du auf das Kreuzverhör?",
        choices: [
          {
            id: "accuse_player",
            label: "Gegenbeschuldigung erheben (Verteile 2 Schlucke)",
            outcomeText: "Du greifst einen anderen Passagier an und verteilst 2 Strafschlucke!",
            sips: 0,
            targetRequired: true,
            rewardPoints: 20,
          },
          {
            id: "drink_whiskey",
            label: "Ein Glas Whiskey leeren (1 Schluck)",
            outcomeText: "Du bleibst betont gelassen und genießt deinen Drink.",
            sips: 1,
            rewardPoints: 15,
          },
          {
            id: "team_toast",
            label: "Auf die Wahrheit anstoßen (Alle trinken 1 Schluck)",
            outcomeText: "Du erhebst das Glas – alle Passagiere trinken gemeinsam!",
            sips: 1,
            rewardPoints: 20,
          },
        ],
      },
    },
    {
      id: "act_3_verdict",
      act: 3,
      title: "Akt III: Die Entlarvung des Mörders",
      atmosphereHint: "Der Zug setzt sich langsam wieder in Bewegung. Die Endstation naht.",
      generateText: () => {
        return `Der Detektiv versammelt alle Überlebenden im Speisewagen!
Es gibt kein Entkommen mehr. Wer von euch ist der kaltblütige Mörder des Barons?
Stimmt jetzt auf eurem Smartphone ab und überführt den Täter!`;
      },
      hasVoting: true,
      votingPrompt: "Wer ist der Mörder im Mitternachtsexpress?",
    },
  ],

  evaluateFinale: (players, votes) => {
    // Count votes
    const voteCounts: Record<string, number> = {};
    for (const targetId of Object.values(votes)) {
      if (targetId) {
        voteCounts[targetId] = (voteCounts[targetId] || 0) + 1;
      }
    }

    let highestVoteId = "";
    let maxVotes = 0;
    for (const [pId, count] of Object.entries(voteCounts)) {
      if (count > maxVotes) {
        maxVotes = count;
        highestVoteId = pId;
      }
    }

    const condemned = players.find((p) => p.id === highestVoteId);
    const murderer = players.find((p) => p.role?.includes("Mörder"));

    const isMurdererCaught = condemned && murderer && condemned.id === murderer.id;

    if (isMurdererCaught) {
      return {
        winnerTeam: "Die Passagiere & der Detektiv 🕵️‍♂️",
        title: "Fall gelöst!",
        summary: `Hervorragende Deduktion! ${murderer.name} wurde als Mörder entlarvt und an der nächsten Station der Polizei übergeben.`,
        drinkPenalties: [
          { playerName: murderer.name, sips: 4, reason: "Als überführter Mörder im Express!" },
        ],
      };
    } else {
      const innocentName = condemned ? condemned.name : "Niemand";
      const murdererName = murderer ? murderer.name : "Der Mörder";
      return {
        winnerTeam: "Der Mörder 🪓",
        title: "Der Mörder entkommt!",
        summary: `Fatale Fehlentscheidung! ${innocentName} wurde fälschlicherweise beschuldigt, während ${murdererName} mit den Juwelen des Barons unerkannt entkommt!`,
        drinkPenalties: [
          { playerName: innocentName, sips: 3, reason: "Unschuldig im Zug verhaftet!" },
          ...players
            .filter((p) => p.id !== murderer?.id && p.id !== condemned?.id)
            .map((p) => ({ playerName: p.name, sips: 2, reason: "Den echten Täter entkommen lassen!" })),
        ],
      };
    }
  },
};
