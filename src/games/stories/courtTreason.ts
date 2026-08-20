import { StoryGameDefinition, StoryPlayer, RoleAssignment } from "../storyEngine/types";

/**
 * 👑 DER VERRAT AM KÖNIGSHOF
 * Ein intrigenreiches Game-of-Thrones-Rollenspiel für 4–12 Spieler.
 * Einer ist der Attentäter, einer der Inquisitor, die anderen Adlige & Höflinge.
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
      secretPrompt: `Du hast den König vergiftet! Dein Ziel: Lenke den Verdacht unauffällig auf ${shuffled[1].name} oder ${shuffled[2]?.name || "andere"}. Lass dich beim Tribunal nicht wählen!`,
    });

    // Player 1: Inquisitor
    assignments.push({
      playerId: shuffled[1].id,
      role: "Großinquisitor ⚖️",
      secretPrompt: "Du leitest die Untersuchung. Beobachte genau, wer nervös trinkt oder sich in Ausreden verstrickt. Deine Stimme zählt im Zweifel doppelt!",
    });

    // Player 2 (if >= 3): Kanzler / Hofalchemist
    if (shuffled[2]) {
      assignments.push({
        playerId: shuffled[2].id,
        role: "Hofalchemist 🧪",
        secretPrompt: "Du erkennst Gifte! Du darfst in Kapitel 2 eine Person wählen und sie zwingen, ihren Kelch vorzuschmecken.",
      });
    }

    // Remaining: Adlige Häuser
    const nobleHouses = ["Haus Löwenstein 🦁", "Haus Drachenfels 🐉", "Haus Schattenwacht 🦅", "Haus Silberquell 🌊", "Haus Nachtdorn 🌹"];
    for (let i = 3; i < shuffled.length; i++) {
      const house = nobleHouses[(i - 3) % nobleHouses.length];
      assignments.push({
        playerId: shuffled[i].id,
        role: `${house}`,
        secretPrompt: `Du bist ein mächtiger Fürst von ${house}. Bilde Allianzen, beschütze deine Familie und stimme im Tribunal weise ab!`,
      });
    }

    return assignments;
  },

  chapters: [
    {
      id: "act_1_poison",
      act: 1,
      title: "Akt I: Der goldene Kelch",
      atmosphereHint: "Der Thronsaal verstummt. Die Hofwache verriegelt die Flügeltüren.",
      generateText: (players) => {
        const p1 = players[0]?.name || "Ein Adliger";
        const p2 = players[1]?.name || "Ein Gast";
        const p3 = players[2]?.name || "Der Mundschenk";
        return `Das Festmahl war im vollen Gange, als der König plötzlich nach seiner Kehle griff und zu Boden sank!
${p1} war der Letzte, der am Buffet gesehen wurde. ${p2} schwört jedoch, dass ${p3} kurz zuvor mit einem verdächtigen Silberfläschchen hantierte.
Die Hofwache riegelt alle Tore ab: Niemand verlässt diese Burg, bis das Gift identifiziert ist!`;
      },
      interactivePrompt: {
        title: "Das kaiserliche Dekret",
        description: "Wie reagierst du auf das Entsetzen im Saal?",
        choices: [
          {
            id: "toast_king",
            label: "Auf den gefallenen König anstoßen (1 Schluck)",
            outcomeText: "Du hebst deinen Kelch und beweist deine scheinbare Treue.",
            sips: 1,
            rewardPoints: 10,
          },
          {
            id: "blame_other",
            label: "Laut Verdacht ausrufen",
            outcomeText: "Du lenkst die Blicke auf deine Tischnachbarn!",
            rewardPoints: 15,
          },
        ],
      },
    },
    {
      id: "act_2_investigation",
      act: 2,
      title: "Akt II: Die Verhöre & Alibis",
      atmosphereHint: "Fackellicht flackert an den Wänden. Die Schatten werden länger.",
      generateText: (players) => {
        const pSuspect = players[Math.floor(Math.random() * players.length)]?.name || "Jemand";
        const pWitness = players[(players.length - 1)]?.name || "Ein Zeuge";
        return `Der Großinquisitor tritt vor den Kronrat!
${pWitness} meldet sich zitternd zu Wort: "Ich habe gesehen, wie ${pSuspect} vor dem Festmahl im Gemach des Königs war!"
Es herrscht Aufruhr. Wer die Wahrheit sagt, bleibt im Dunkeln — doch die Gläser füllen sich mit bitterem Ernst.`;
      },
      interactivePrompt: {
        title: "Geheime Beichte & Bestechung",
        description: "Wähle deine Taktik vor dem Kronrat:",
        choices: [
          {
            id: "bribe_council",
            label: "Einfluss sichern (Verteile 2 Schlucke)",
            outcomeText: "Du verteilst 2 Strafschlucke an einen verdächtigen Spieler!",
            sips: 0,
            targetRequired: true,
            rewardPoints: 20,
          },
          {
            id: "drink_proof",
            label: "Unschuldstrunk nehmen (1 Schluck)",
            outcomeText: "Du beweist durch schnelles Trinken deinen reinen Magen.",
            sips: 1,
            rewardPoints: 15,
          },
        ],
      },
    },
    {
      id: "act_3_tribunal",
      act: 3,
      title: "Akt III: Das Tribunal des Schafotts",
      atmosphereHint: "Die Henkersaxt wird poliert. Alle Blicke kreuzen sich.",
      generateText: () => {
        return `Die Stunde des Urteils ist gekommen!
Jeder Adlige am Tisch muss nun Farbe bekennen. Wer ist der wahre Mörder des Königs?
Wählt auf eurem Smartphone die Person, die ihr auf das Schafott schickt!`;
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
        highestVoteId = pId;
      }
    }

    const condemned = players.find((p) => p.id === highestVoteId);
    const assassin = players.find((p) => p.role?.includes("Attentäter"));

    const isAssassinCaught = condemned && assassin && condemned.id === assassin.id;

    if (isAssassinCaught) {
      return {
        winnerTeam: "Die Getreuen der Krone 👑",
        title: "Gerechtigkeit siegt!",
        summary: `Der Kronrat hat ${assassin.name} als wahren Attentäter überführt! Das Königreich ist gerettet.`,
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
          { playerName: innocentName, sips: 3, reason: "Unschuldig verurteilt!" },
          ...players
            .filter((p) => p.id !== assassin?.id && p.id !== condemned?.id)
            .map((p) => ({ playerName: p.name, sips: 2, reason: "Auf die List des Mörders hereingefallen!" })),
        ],
      };
    }
  },
};
