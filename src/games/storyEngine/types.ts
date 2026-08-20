export type StoryGameId = "court_treason" | "murder_express" | "haunted_manor";

export interface StoryPlayer {
  id: string;
  name: string;
  avatar?: string | null;
  isHost: boolean;
  role?: string | null;
  secretPrompt?: string | null;
  points: number;
  sipsTaken: number;
  hasSubmittedAction?: boolean;
}

export interface StoryRole {
  id: string;
  name: string;
  icon: string;
  description: string;
  secretPrompt: string;
  allegiance?: "town" | "traitor" | "neutral";
}

export interface RoleAssignment {
  playerId: string;
  role: string;
  secretPrompt: string;
}

export interface StoryChoice {
  id: string;
  label: string;
  icon?: string;
  outcomeText: string;
  sips?: number;
  targetRequired?: boolean;
  damage?: number;
  rewardPoints?: number;
}

export interface StoryChapter {
  id: string;
  act: number;
  title: string;
  atmosphereHint?: string;
  generateText: (players: StoryPlayer[], customVars: Record<string, any>) => string;
  /** Optional interactive prompt for a specific role or everyone */
  interactivePrompt?: {
    forRole?: string; // If undefined, applies to all
    title: string;
    description: string;
    choices: StoryChoice[];
  };
  /** Optional voting phase at the end of the chapter */
  hasVoting?: boolean;
  votingPrompt?: string;
  votingTargetFilter?: (candidate: StoryPlayer, voter: StoryPlayer) => boolean;
}

export interface StoryGameDefinition {
  id: StoryGameId;
  title: string;
  subtitle: string;
  genre: string;
  durationMinutes: number;
  minPlayers: number;
  maxPlayers: number;
  themeColor: string;
  accentColor: string;
  icon: string;
  tagline: string;
  description: string;
  assignRoles: (players: StoryPlayer[]) => RoleAssignment[];
  chapters: StoryChapter[];
  evaluateFinale: (
    players: StoryPlayer[],
    votes: Record<string, string>,
    customVars: Record<string, any>
  ) => {
    winnerTeam: string;
    title: string;
    summary: string;
    drinkPenalties: { playerName: string; sips: number; reason: string }[];
  };
}
