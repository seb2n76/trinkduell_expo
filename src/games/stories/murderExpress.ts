import { StoryGameDefinition, StoryPlayer, RoleAssignment } from "../storyEngine/types";

/**
 * 🕵️‍♂️ MORD IM MITTERNACHTS-EXPRESS
 * Ein 1920er-Jahre Noir-Krimi im Luxuszug für 4–10 Spieler.
 * Täter, Meisterdetektiv, betrogene Erbin, Leibarzt und Passagiere.
 */
export const murderExpressGame: StoryGameDefinition = {
  id: "murder_express",
  title: "Mord im Mitternachts-Express",
  subtitle: "1920s Noir Whodunnit & Kreuzverhör",
  genre: "Krimi & Social Deduction",
  durationMinutes: 25,
  minPlayers: 3,
  maxPlayers: 10,
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
      secretPrompt: `Du hast den Baron ermordet! Schiebe die Schuld auf ${shuffled[1].name} oder ${shuffled[2]?.name || "andere"}. Wenn du das Kreuzverhör überstehst, gewinnst du!`,
    });

    // Player 1: Meisterdetektiv
    assignments.push({
      playerId: shuffled[1].id,
      role: "Meisterdetektiv 🕵️‍♂️",
      secretPrompt: "Du leitest die Ermittlungen. Stelle gezielte Fragen, achte auf Widersprüche und entlarve den Mörder im Schlafwagen!",
    });

    // Player 2: Betrogene Erbin
    if (shuffled[2]) {
      assignments.push({
        playerId: shuffled[2].id,
        role: "Die Erbin 💎",
        secretPrompt: "Der Baron schuldete dir ein Vermögen. Du bist unschuldig, wirkst aber extrem verdächtig! Trinke unauffällig.",
      });
    }

    // Remaining: Passagiere
    const passengerRoles = ["Leibarzt 🩺", "Schaffner 🎫", "Schmuggler 💼", "Journalist 📰", "Baroness 👒"];
    for (let i = 3; i < shuffled.length; i++) {
      const pRole = passengerRoles[(i - 3) % passengerRoles.length];
      assignments.push({
        playerId: shuffled[i].id,
        role: pRole,
        secretPrompt: `Du reist als ${pRole} im Zug. Verstricke dich nicht in Lügen und hilf dem Detektiv!`,
      });
    }

    return assignments;
  },

  chapters: [
    {
      id: "act_1_blackout",
      act: 1,
      title: "Akt I: Der Schrei im Tunnel",
      atmosphereHint: "Der Zug rast in die Dunkelheit. Die Scheinwerfer flackern.",
      generateText: (players) => {
        const p1 = players[0]?.name || "Ein Passagier";
        const p2 = players[1]?.name || "Eine Dame";
        return `Draußen tobt der Schneesturm, als der Express plötzlich in den Gotthardtunnel einfährt.
Ein gellender Schrei zerreißt die Stille! Als das Licht wieder aufflackert, liegt Baron von Falkenstein leblos über dem Schachtisch.
${p1} hält ein blutbeflecktes Taschentuch in der Hand, während ${p2} bleich auf die Tür starrt!`;
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
            label: "Tatort absuchen",
            outcomeText: "Du sicherst verdächtige Spuren auf dem Teppich!",
            rewardPoints: 15,
          },
        ],
      },
    },
    {
      id: "act_2_interrogation",
      act: 2,
      title: "Akt II: Das eisige Kreuzverhör",
      atmosphereHint: "Der Schnee türmt sich meterhoch. Die Heizung fällt aus.",
      generateText: (players) => {
        const pRandom = players[Math.floor(Math.random() * players.length)]?.name || "Jemand";
        return `Der Detektiv trommelt alle im Speisewagen zusammen.
"Niemand verlässt den Zug! Die Bremsen wurden sabotiert!"
${pRandom} wird plötzlich nach dem Alibi gefragt. Die Spannung am Tisch ist zum Schneiden dick.`;
      },
      interactivePrompt: {
        title: "Alibi & Verdächtigung",
        description: "Gib dein Alibi ab oder belaste einen Mitreisenden:",
        choices: [
          {
            id: "blame_target",
            label: "Verdacht aussprechen (Verteile 2 Schlucke)",
            outcomeText: "Du zeigst mit dem Finger auf einen verdächtigen Mitspieler!",
            sips: 0,
            targetRequired: true,
            rewardPoints: 20,
          },
          {
            id: "silent_defense",
            label: "Die Aussage verweigern (2 Schlucke)",
            outcomeText: "Du schweigst eisern und trinkst.",
            sips: 2,
            rewardPoints: 25,
          },
        ],
      },
    },
    {
      id: "act_3_finale",
      act: 3,
      title: "Akt III: Die Entlarvung vor der Endstation",
      atmosphereHint: "Der Zug rollt langsam in den Bahnhof. Die Polizei wartet am Gleis.",
      generateText: () => {
        return `Die Notbremse greift! Der Zug kommt zum Stehen.
Die Handschellen liegen bereit. Wer hat Baron von Falkenstein auf dem Gewissen?
Wählt auf eurem Smartphone den Haupttäter!`;
      },
      hasVoting: true,
      votingPrompt: "Wer ist der Mörder im Mitternachts-Express?",
    },
  ],

  evaluateFinale: (players, votes) => {
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
        summary: `Hervorragende Deduktion! ${murderer.name} wurde mit der Tatwaffe auf frischer Tat ertappt!`,
        drinkPenalties: [
          { playerName: murderer.name, sips: 4, reason: "Als Mörder verhaftet!" },
        ],
      };
    } else {
      const innocentName = condemned ? condemned.name : "Niemand";
      const murdererName = murderer ? murderer.name : "Der Schatten";
      return {
        winnerTeam: "Der Mörder 🪓",
        title: "Der Täter entkommt unerkannt!",
        summary: `${murdererName} steigt unbemerkt aus dem Zug, während die unschuldige Person ${innocentName} in Handschellen abgeführt wird!`,
        drinkPenalties: [
          { playerName: innocentName, sips: 3, reason: "Unschuldig im Gefängnis gelandet!" },
          ...players
            .filter((p) => p.id !== murderer?.id && p.id !== condemned?.id)
            .map((p) => ({ playerName: p.name, sips: 2, reason: "Den echten Mörder entwischen lassen!" })),
        ],
      };
    }
  },
};
