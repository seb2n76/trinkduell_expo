import { StoryGameDefinition, StoryPlayer, RoleAssignment } from "../storyEngine/types";

/**
 * 🏚️ ESCAPE THE HAUNTED MANOR
 * Ein kooperatives Horror-Survival-Trinkspiel für 3–8 Spieler mit gemeinsamer HP-Leiste und Verräter-Mechanik.
 */
export const hauntedManorGame: StoryGameDefinition = {
  id: "haunted_manor",
  title: "Escape the Haunted Manor",
  subtitle: "Co-Op Horror Survival & Geister-Besessenheit",
  genre: "Survival-Horror & Co-Op",
  durationMinutes: 20,
  minPlayers: 3,
  maxPlayers: 8,
  themeColor: "#4c1d95",
  accentColor: "#a855f7",
  icon: "skull",
  tagline: "Überlebt die Nacht in der verfluchten Villa.",
  description:
    "Ihr seid in einer Geistervilla gefangen! Das Team teilt sich 100 Lebenspunkte. Findet die 3 Bann-Schlüssel, bevor der Dämon euch alle besitzt!",

  assignRoles: (players: StoryPlayer[]): RoleAssignment[] => {
    const shuffled = [...players].sort(() => Math.random() - 0.5);
    const assignments: RoleAssignment[] = [];

    // Player 0: Besessener (Verräter)
    assignments.push({
      playerId: shuffled[0].id,
      role: "Vom Geist Besessen 👻",
      secretPrompt: "Du wurdest vom Hausgeist verflucht! Tue so, als würdest du helfen, aber versuche die HP der Gruppe auf 0 zu bringen!",
    });

    // Player 1: Medium / Heiler
    assignments.push({
      playerId: shuffled[1].id,
      role: "Das Medium 🔮",
      secretPrompt: "Du spürst Geisterpräsenzen! Deine Heiltränke stellen für das Team verlorene HP wieder her.",
    });

    // Player 2: Okkultist / Gelehrter
    if (shuffled[2]) {
      assignments.push({
        playerId: shuffled[2].id,
        role: "Der Gelehrte 📜",
        secretPrompt: "Du kannst alte Schutzrunen entziffern und Flüche abwehren.",
      });
    }

    // Remaining: Überlebende
    for (let i = 3; i < shuffled.length; i++) {
      assignments.push({
        playerId: shuffled[i].id,
        role: `Forscher ${i - 2} 🔦`,
        secretPrompt: "Halte die Taschenlampe fest und hilf der Gruppe, die verfluchte Villa lebend zu verlassen!",
      });
    }

    return assignments;
  },

  chapters: [
    {
      id: "act_1_library",
      act: 1,
      title: "Akt I: Das Flüstern in der Bibliothek",
      atmosphereHint: "Alte Bücher fliegen durch die Luft. Die Kerzen verlöschen.",
      generateText: (players) => {
        const p1 = players[0]?.name || "Jemand";
        const p2 = players[1]?.name || "Ein Forscher";
        return `Die Eingangstür schlägt mit lautem Knall zu! Das Schloss rastet ein.
${p1} und ${p2} betreten die verstaubte Bibliothek. Auf dem Tisch liegt ein aufgeschlagenes Grimoire.
Ein eisiger Hauch streift euren Nacken: Das Herrenhaus erwacht!`;
      },
      interactivePrompt: {
        title: "Die Geistererscheinung",
        description: "Wie schützt du die Gruppe?",
        choices: [
          {
            id: "drink_shield",
            label: "Schutz-Schluck nehmen (1 Schluck = +10 Team-HP)",
            outcomeText: "Dein Schluck bannt den Fluch und stärkt die Gruppe!",
            sips: 1,
            damage: -10, // Heals 10 HP
            rewardPoints: 15,
          },
          {
            id: "panic_run",
            label: "In Panik davonrennen (-15 Team-HP)",
            outcomeText: "Du stößt eine Vase um — der Geist fügt der Gruppe Schaden zu!",
            damage: 15,
            rewardPoints: 5,
          },
        ],
      },
    },
    {
      id: "act_2_cellar",
      act: 2,
      title: "Akt II: Das Ritual im Weinkeller",
      atmosphereHint: "Tropfendes Wasser und schleifende Schritte in den Katakomben.",
      generateText: (players) => {
        const pRand = players[Math.floor(Math.random() * players.length)]?.name || "Ein Gefährte";
        return `Ihr steigt hinab in den feuchten Weinkeller.
${pRand} entdeckt ein altes Holzfass mit mysteriösen Schriftzeichen.
"Ein Opfer muss erbracht werden, um das Portal zu öffnen!"`;
      },
      interactivePrompt: {
        title: "Das Trank-Opfer",
        description: "Bannst du den Dämon oder opferst du Kraft?",
        choices: [
          {
            id: "sacrifice_sips",
            label: "2 Schlucke opfern (+20 Team-HP)",
            outcomeText: "Du nimmst 2 Schlucke und vertreibst die Dämonenfratze!",
            sips: 2,
            damage: -20,
            rewardPoints: 25,
          },
          {
            id: "pass_chalice",
            label: "Den Kelch weiterreichen (Ziel trinkt 1 Schluck)",
            outcomeText: "Du reichst den Kelch an einen Mitspieler weiter!",
            targetRequired: true,
            sips: 0,
            rewardPoints: 10,
          },
        ],
      },
    },
    {
      id: "act_3_exorcism",
      act: 3,
      title: "Akt III: Der Große Exorzismus & Die Flucht",
      atmosphereHint: "Der Kronleuchter stürzt herab. Die Mauern beben.",
      generateText: () => {
        return `Das Portal zum Ausgang öffnet sich, doch der Dämon blockiert das Tor!
Er hat Besitz von einem eurer Gefährten ergriffen.
Entlarvt den Besessenen, um gemeinsam durch das Lichttor zu entkommen!`;
      },
      hasVoting: true,
      votingPrompt: "Wer aus eurer Gruppe ist vom Dämon besessen?",
    },
  ],

  evaluateFinale: (players, votes, customVars) => {
    const hp = customVars.healthPoints ?? 100;
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
    const possessed = players.find((p) => p.role?.includes("Besessen"));

    const isPossessedCaught = condemned && possessed && condemned.id === possessed.id;

    if (hp > 0 && isPossessedCaught) {
      return {
        winnerTeam: "Die Überlebenden 🏰",
        title: "Flucht geglückt!",
        summary: `Der Dämon in ${possessed.name} wurde erfolgreich exorziert! Ihr entkommt mit ${hp} HP ins Morgengrauen.`,
        drinkPenalties: [
          { playerName: possessed.name, sips: 3, reason: "Vom Geist befreit & durchgespült!" },
        ],
      };
    } else {
      const demonName = possessed ? possessed.name : "Der Dämon";
      return {
        winnerTeam: "Das Spukhaus & der Dämon 👻",
        title: "Für immer gefangen!",
        summary: `${demonName} hat die Gruppe in die Irre geführt. Ihr bleibt auf ewig Gefangene der Geistervilla!`,
        drinkPenalties: players.map((p) => ({
          playerName: p.name,
          sips: 2,
          reason: "Vom Herrenhaus verschlungen!",
        })),
      };
    }
  },
};
