import { StoryGameDefinition, StoryPlayer, RoleAssignment } from "../storyEngine/types";

/**
 * 👑 DER VERRAT AM KÖNIGSHOF
 * Ein intrigenreiches Game-of-Thrones-Rollenspiel für 3–12 Spieler.
 * Mörder, Inquisitor, Hofalchemist, Spion, Hofnarr und Adlige Häuser.
 */
export const courtTreasonGame: StoryGameDefinition = {
  id: "court_treason",
  title: "Der Verrat am Königshof",
  subtitle: "Game of Thrones trifft Social Deduction & Trink-Diplomatie",
  genre: "Intrigen & Rollenspiel",
  durationMinutes: 25,
  minPlayers: 3,
  maxPlayers: 12,
  themeColor: "#b45309",
  accentColor: "#fbbf24",
  icon: "crown",
  tagline: "Wer goss das Gift in den königlichen Kelch?",
  description:
    "Der König liegt vergiftet auf dem Thronsaal. Ein Attentäter sitzt mit am Tisch! Schafft es der Inquisitor, die Wahrheit ans Licht zu bringen, oder verurteilt der Kronrat die Falschen?",

  assignRoles: (players: StoryPlayer[]): RoleAssignment[] => {
    const shuffled = [...players].sort(() => Math.random() - 0.5);
    const assignments: RoleAssignment[] = [];

    // Player 0: Mörder
    assignments.push({
      playerId: shuffled[0].id,
      role: "Attentäter 🗡️",
      secretPrompt: `Du hast den König vergiftet! Dein Ziel: Lenke den Verdacht unauffällig auf ${shuffled[1]?.name || "andere"} oder ${shuffled[2]?.name || "deine Nachbarn"}. Lass dich beim Tribunal um keinen Preis wählen!`,
    });

    // Player 1: Inquisitor
    assignments.push({
      playerId: shuffled[1].id,
      role: "Großinquisitor ⚖️",
      secretPrompt: "Du leitest die königliche Untersuchung. Beobachte genau, wer nervös trinkt, zögert oder Ausflüchte sucht. Deine Stimme wiegt im Kronrat schwer!",
    });

    // Player 2 (if >= 3): Hofalchemist
    if (shuffled[2]) {
      assignments.push({
        playerId: shuffled[2].id,
        role: "Hofalchemist 🧪",
        secretPrompt: "Du kennst alle Gifte des Reiches. Du darfst im Rat eine Person auswählen und sie zwingen, ihren Trinkbecher vorzukosten.",
      });
    }

    // Player 3 (if >= 4): Hofnarr oder Spion
    if (shuffled[3]) {
      assignments.push({
        playerId: shuffled[3].id,
        role: "Der Hofnarr 🃏",
        secretPrompt: "Du genießt Narrenfreiheit! Verwirre die anderen mit kühnen Thesen und mache die Runde betrunken.",
      });
    }

    // Remaining: Adlige Fürstenhäuser
    const nobleHouses = [
      "Haus Löwenstein 🦁",
      "Haus Drachenfels 🐉",
      "Haus Schattenwacht 🦅",
      "Haus Silberquell 🌊",
      "Haus Nachtdorn 🌹",
      "Haus Sonnenfels ☀️",
      "Haus Eisengard 🛡️",
      "Haus Rabenkron 🐦",
    ];

    for (let i = 4; i < shuffled.length; i++) {
      const house = nobleHouses[(i - 4) % nobleHouses.length];
      assignments.push({
        playerId: shuffled[i].id,
        role: `${house}`,
        secretPrompt: `Du bist das stolze Oberhaupt von ${house}. Schließe Allianzen, verteidige dein Haus und stimme im Tribunal weise ab!`,
      });
    }

    return assignments;
  },

  chapters: [
    {
      id: "act_1_poison",
      act: 1,
      title: "Akt I: Der goldene Kelch",
      atmosphereHint: "Der Thronsaal verstummt. Die Hofwache verriegelt mit lautem Rasseln die Flügeltüren.",
      generateText: (players) => {
        const p1 = players[0]?.name || "Ein Adliger";
        const p2 = players[1]?.name || "Ein Gast";
        const p3 = players[2]?.name || "Der Mundschenk";
        const poisons = ["Nachtschatten-Extrakt", "Basilisken-Träne", "Zyankali-Wein", "Schlangengift"];
        const poison = poisons[Math.floor(Math.random() * poisons.length)];
        return `Das Festmahl war auf dem Höhepunkt, als der König plötzlich nach seiner Kehle griff und zu Boden sank!
${p1} war der Letzte, der am Weinfass gesehen wurde. ${p2} schwört jedoch, dass ${p3} kurz zuvor mit einem Fläschchen ${poison} hantierte.
Die Hofwache riegelt alle Burgtore ab: Niemand verlässt den Saal, bis der Mörder überführt ist!`;
      },
      interactivePrompt: {
        title: "Das kaiserliche Dekret",
        description: "Wie reagierst du auf das Entsetzen im Thronsaal?",
        choices: [
          {
            id: "toast_king",
            label: "Auf den gefallenen König anstoßen (1 Schluck)",
            outcomeText: "Du hebst deinen Kelch und beweist deine scheinbare Treue zum Thron.",
            sips: 1,
            rewardPoints: 10,
          },
          {
            id: "blame_other",
            label: "Laut Verdacht gegen die Tischnachbarn erheben",
            outcomeText: "Du lenkst die Blicke geschickt von dir ab auf die anderen!",
            rewardPoints: 15,
          },
          {
            id: "swear_oath",
            label: "Einen heiligen Treueeid schwören (Verteile 1 Schluck)",
            outcomeText: "Deine feierlichen Worte überzeugen die Wachen – du darfst 1 Schluck verteilen!",
            rewardPoints: 20,
          },
        ],
      },
    },
    {
      id: "act_2_investigation",
      act: 2,
      title: "Akt II: Das Kreuzverhör im Kronrat",
      atmosphereHint: "Fackellicht flackert an den kalten Steinmauern. Die Gesichter spiegeln Misstrauen wider.",
      generateText: (players) => {
        const pSuspect = players[Math.floor(Math.random() * players.length)]?.name || "Jemand";
        const pWitness = players[(players.length - 1)]?.name || "Ein Zeuge";
        return `Der Großinquisitor tritt mit gezogenem Richtschwert vor den Rat!
${pWitness} meldet sich mit zittriger Stimme: "Ich habe gesehen, wie ${pSuspect} heimlich Pulver in den Pokal streute!"
Die Stimmung kippt bedrohlich. Wer die Wahrheit spricht, weiß niemand – doch die Gläser füllen sich für die nächsten Anschuldigungen!`;
      },
      interactivePrompt: {
        title: "Geheime Verhöre & Bestechung",
        description: "Wähle deine Taktik vor den Inquisitoren:",
        choices: [
          {
            id: "bribe_council",
            label: "Kronrat bestechen (Verteile 2 Schlucke)",
            outcomeText: "Mit gezielten Anschuldigungen verteilst du 2 Strafschlucke an einen Mitspieler!",
            sips: 0,
            targetRequired: true,
            rewardPoints: 20,
          },
          {
            id: "drink_proof",
            label: "Unschuldstrunk leeren (1 Schluck)",
            outcomeText: "Du trinkst deinen Becher zügig und beweist deinen unschuldigen Magen.",
            sips: 1,
            rewardPoints: 15,
          },
          {
            id: "demand_silence",
            label: "Zum Schweigen verdonnern (Alle trinken 1 Schluck)",
            outcomeText: "Du rufst nach Ruhe im Saal – die gesamte Runde trinkt gemeinsam 1 Schluck!",
            sips: 1,
            rewardPoints: 25,
          },
        ],
      },
    },
    {
      id: "act_3_tribunal",
      act: 3,
      title: "Akt III: Das Tribunal des Schafotts",
      atmosphereHint: "Die Henkersaxt wird geschliffen. Alle Augen richten sich aufeinander.",
      generateText: () => {
        return `Die Stunde des Urteils ist da!
Jeder Adlige am Tisch muss nun Farbe bekennen. Wer ist der wahre Mörder des Königs?
Wählt jetzt auf eurem Smartphone die Person, die ihr auf das Schafott schickt!`;
      },
      hasVoting: true,
      votingPrompt: "Wen verdächtigst du als Attentäter des Königs?",
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
      }
    }

    // Filter top voted
    const topVotedIds = Object.keys(voteCounts).filter((id) => voteCounts[id] === maxVotes);
    highestVoteId = topVotedIds[0] || "";

    const condemned = players.find((p) => p.id === highestVoteId);
    const assassin = players.find((p) => p.role?.includes("Attentäter"));

    const isAssassinCaught = condemned && assassin && condemned.id === assassin.id;

    if (isAssassinCaught) {
      return {
        winnerTeam: "Die Getreuen der Krone 👑",
        title: "Gerechtigkeit siegt!",
        summary: `Der Kronrat hat ${assassin.name} als wahren Attentäter überführt! Der Verrat ist gerächt und das Reich gerettet.`,
        drinkPenalties: [
          { playerName: assassin.name, sips: 4, reason: "Als entlarvter Attentäter auf dem Schafott!" },
        ],
      };
    } else {
      const innocentName = condemned ? condemned.name : "Niemand";
      const assassinName = assassin ? assassin.name : "Der Schatten";
      return {
        winnerTeam: "Der Attentäter 🗡️",
        title: "Der Verrat war vollkommen!",
        summary: `Der Kronrat hat fälschlicherweise ${innocentName} verurteilt, während ${assassinName} triumphierend im Schatten lacht!`,
        drinkPenalties: [
          { playerName: innocentName, sips: 3, reason: "Unschuldig auf dem Schafott gelandet!" },
          ...players
            .filter((p) => p.id !== assassin?.id && p.id !== condemned?.id)
            .map((p) => ({ playerName: p.name, sips: 2, reason: "Auf die Intrige des Attentäters hereingefallen!" })),
        ],
      };
    }
  },
};
