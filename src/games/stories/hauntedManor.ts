import { StoryGameDefinition, StoryPlayer, RoleAssignment } from "../storyEngine/types";

/**
 * 🏚️ ESCAPE THE HAUNTED MANOR
 * Ein kooperatives Horror-Survival-Trinkspiel für 3–12 Spieler mit gemeinsamer HP-Leiste und Verräter-Mechanik.
 */
export const hauntedManorGame: StoryGameDefinition = {
  id: "haunted_manor",
  title: "Escape the Haunted Manor",
  subtitle: "Co-Op Horror Survival & Geister-Besessenheit",
  genre: "Survival-Horror & Co-Op",
  durationMinutes: 20,
  minPlayers: 3,
  maxPlayers: 12,
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
      secretPrompt: `Du wurdest vom Hausgeist verflucht! Tue so, als würdest du helfen, aber versuche unauffällig die Team-HP auf 0 zu senken und ${shuffled[1]?.name || "andere"} zu opfern!`,
    });

    // Player 1: Medium / Heiler
    assignments.push({
      playerId: shuffled[1].id,
      role: "Das Medium 🔮",
      secretPrompt: "Du spürst paranormale Auren! Deine Trank-Rituale heilen die verlorenen Lebenspunkte der Gruppe.",
    });

    // Player 2: Okkultist / Gelehrter
    if (shuffled[2]) {
      assignments.push({
        playerId: shuffled[2].id,
        role: "Der Gelehrte 📜",
        secretPrompt: "Du kannst alte Bann-Runen entziffern. Deine Aktionen können Flüche neutralisieren.",
      });
    }

    // Player 3: Exorzist
    if (shuffled[3]) {
      assignments.push({
        playerId: shuffled[3].id,
        role: "Der Exorzist ✝️",
        secretPrompt: "Du trägst geweihtes Wasser bei dir. Du darfst im Finale jemanden vor dem Geisterbefall retten.",
      });
    }

    // Remaining: Mutige Forscher
    const explorerRoles = [
      "Der Ghostbuster ⚡",
      "Die Archäologin 🏺",
      "Der Schlosswächter 🗝️",
      "Die Wahrsagerin 🎴",
      "Der Kameramann 📹",
      "Der Parapsychologe 🧠",
      "Die Überlebenskünstlerin 🔦",
      "Der Nachtwächter 🕯️",
    ];

    for (let i = 4; i < shuffled.length; i++) {
      const eRole = explorerRoles[(i - 4) % explorerRoles.length];
      assignments.push({
        playerId: shuffled[i].id,
        role: eRole,
        secretPrompt: `Du erkundest als ${eRole} das Anwesen. Halte die Gruppe zusammen und lass die Team-HP nicht fallen!`,
      });
    }

    return assignments;
  },

  chapters: [
    {
      id: "act_1_library",
      act: 1,
      title: "Akt I: Das Flüstern in der Bibliothek",
      atmosphereHint: "Alte Folianten fliegen durch die Luft. Die Kronleuchter flackern.",
      generateText: (players) => {
        const p1 = players[0]?.name || "Jemand";
        const p2 = players[1]?.name || "Ein Forscher";
        return `Die schwere Eingangstür schlägt mit ohrenbetäubendem Krachen zu! Das rostige Schloss rastet ein.
${p1} und ${p2} betreten die verstaubte Ahnengalerie. Auf dem Kamin lodert blaues Feuer.
Ein eisiger Hauch streift eure Nacken: Die Geister des Schlosses verlangen ein Trinkopfer!`;
      },
      interactivePrompt: {
        title: "Die erste Geistererscheinung",
        description: "Wie schützt du die Gruppe vor dem Kälteeinbruch?",
        choices: [
          {
            id: "drink_shield",
            label: "Schutz-Schluck nehmen (1 Schluck = +10 Team-HP)",
            outcomeText: "Dein mutiger Schluck bannt den Kältefluch und stärkt das Team!",
            sips: 1,
            damage: -10, // Heals 10 HP
            rewardPoints: 15,
          },
          {
            id: "panic_run",
            label: "In Panik davonrennen (-15 Team-HP)",
            outcomeText: "Du stößt eine antike Standuhr um — der Geist fügt der Gruppe Schaden zu!",
            damage: 15,
            rewardPoints: 5,
          },
          {
            id: "read_spell",
            label: "Bannformel laut aufsagen",
            outcomeText: "Deine Worte hallen durch die Hallen – der Geist weicht kurz zurück!",
            rewardPoints: 20,
          },
        ],
      },
    },
    {
      id: "act_2_cellar",
      act: 2,
      title: "Akt II: Das Ritual im Weinkeller",
      atmosphereHint: "Tropfendes Wasser, modriger Geruch und klirrende Weinflaschen in den Katakomben.",
      generateText: (players) => {
        const pSuspect = players[Math.floor(Math.random() * players.length)]?.name || "Jemand";
        return `Ihr steigt über eine modrige Wendeltreppe in den Gewölbekeller hinab.
Ein riesiges Pentagramm leuchtet rot am Boden. Plötzlich verzieht sich das Gesicht von ${pSuspect} zu einer unheimlichen Fratze!
Ist ${pSuspect} vom Hausgeist besessen worden?`;
      },
      interactivePrompt: {
        title: "Das dunkle Katakomben-Ritual",
        description: "Wie reagierst du auf das Leuchten im Keller?",
        choices: [
          {
            id: "holy_toast",
            label: "Geisterbann-Trunk (2 Schlucke = +20 Team-HP)",
            outcomeText: "Du nimmst 2 kräftige Schlucke und heilst das Team spürbar!",
            sips: 2,
            damage: -20,
            rewardPoints: 25,
          },
          {
            id: "sabotage_team",
            label: "Kerzen austreten (-20 Team-HP)",
            outcomeText: "Die Dunkelheit bricht herein – der Dämon schlägt zu!",
            damage: 20,
            rewardPoints: 10,
          },
          {
            id: "share_potion",
            label: "Gemeinsam anstoßen (Alle trinken 1 Schluck)",
            outcomeText: "Die gesamte Gruppe trinkt zusammen und trotzt der Finsternis!",
            sips: 1,
            damage: -10,
            rewardPoints: 20,
          },
        ],
      },
    },
    {
      id: "act_3_exorcism",
      act: 3,
      title: "Akt III: Der finale Exorzismus",
      atmosphereHint: "Der Glockenturm schlägt Mitternacht. Das Finale entscheidet über Leben und Tod!",
      generateText: () => {
        return `Die Geisterstunde hat ihren Höhepunkt erreicht!
Das Portal öffnet sich nur, wenn ihr den Besessenen unter euch enttarnt und das Ritual vollendet.
Stimmt jetzt ab: Wer von euch beherbergt den bösen Geist der Villa?`;
      },
      hasVoting: true,
      votingPrompt: "Wer ist der vom Dämon Besessene?",
    },
  ],

  evaluateFinale: (players, votes, finalGameState) => {
    const remainingHp = finalGameState?.healthPoints ?? 50;

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
    const possessed = players.find((p) => p.role?.includes("Besessen"));

    const isPossessedCaught = condemned && possessed && condemned.id === possessed.id;

    if (remainingHp <= 0) {
      return {
        winnerTeam: "Der Hausdämon 👻",
        title: "Team ausgelöscht!",
        summary: "Die Team-HP sind auf 0 gesunken! Die Geister haben das Herrenhaus für immer für sich beansprucht.",
        drinkPenalties: players.map((p) => ({
          playerName: p.name,
          sips: 3,
          reason: "Als Geisterfutter in der Villa!",
        })),
      };
    }

    if (isPossessedCaught) {
      return {
        winnerTeam: "Die mutigen Forscher 🔦",
        title: "Erfolgreich entkommen!",
        summary: `Der Exorzismus war erfolgreich! ${possessed.name} wurde vom Geist befreit und alle konnten mit ${remainingHp} HP entkommen.`,
        drinkPenalties: [
          { playerName: possessed.name, sips: 4, reason: "Für den erfolgreichen Exorzismus!" },
        ],
      };
    } else {
      const innocentName = condemned ? condemned.name : "Niemand";
      const possessedName = possessed ? possessed.name : "Der Besessene";
      return {
        winnerTeam: "Der Besessene 👻",
        title: "Der Dämon triumphiert!",
        summary: `Ihr habt ${innocentName} beschuldigt, während ${possessedName} den Fluch vollendet hat!`,
        drinkPenalties: [
          { playerName: innocentName, sips: 3, reason: "Fälschlicherweise exorziert!" },
          ...players
            .filter((p) => p.id !== possessed?.id && p.id !== condemned?.id)
            .map((p) => ({ playerName: p.name, sips: 2, reason: "Vom Dämon getäuscht worden!" })),
        ],
      };
    }
  },
};
