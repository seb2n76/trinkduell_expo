import { StoryGameDefinition, StoryGameId } from "../storyEngine/types";
import { courtTreasonGame } from "./courtTreason";
import { murderExpressGame } from "./murderExpress";
import { hauntedManorGame } from "./hauntedManor";

export const STORY_GAMES: Record<StoryGameId, StoryGameDefinition> = {
  court_treason: courtTreasonGame,
  murder_express: murderExpressGame,
  haunted_manor: hauntedManorGame,
};

export const STORY_GAMES_LIST: StoryGameDefinition[] = [
  courtTreasonGame,
  murderExpressGame,
  hauntedManorGame,
];

export function getStoryGame(id: StoryGameId): StoryGameDefinition {
  return STORY_GAMES[id] || courtTreasonGame;
}
