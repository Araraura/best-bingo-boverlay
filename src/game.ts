import { type BoardSize, type Sheet, type Line, getLines } from './bingo.js';

// Scribes edit this list. abilities can add/remove spaces later.
export const DEFAULT_SPACES: string[] = [
  'Correct Resolution',
  'Same Developer and Publisher',
  'Weird Genre Blend',
  'Game Slaps',
  'Original Music',
  'UI is an eyesore',
  '>$10',
  'Grael Misses Something Important',
  'Typo',
  'Glitch/Bug Found',
  'Text Overlapping Something',
  'Good Tutorial',
  'At Least 20 Achievements',
  'Separate Sound Sliders',
  'Rebindable Controls',
  '"Unique" in Description',
  'Store Page has GIFS',
  'Wishlisted By Steam Friend',
  '<200 Reviews',
  'Chat Wins Wordle',
  'New Person in Chat',
  'Trailer <1 Min',
  'Game Suggester Is In Chat',
  'Similar Games Unrelated',
  'Only Made 1 Game',
  'Controller Compatibility',
  'Release date >2020',
  'Pixel Art',
  'Has a demo',
  'Soundtrack slaps',
  'Game Has Been Updated',
  'Roll Credits',
  'Steam Deck Compatible',
  'Crash To Desktop',
  'Multiplayer!',
  'Purchased by Steam friend',
  'On Sale!',
  'Borderless Fullscreen',
  '4th Wall Break',
  'File >1GB',
  'Solo Dev',
  'Title Drop',
  'Dev Logo',
  'DLC',
  'Game Engine Logo',
  'Accessibility Options',
  'Chat makes the game funnier',
  'Defaults to windowed mode',
  'Grael loses it',
  'Jump!',
  'Dialogue Box',
  'Stamina',
  'Dodge Roll or Dash',
  'Currency',
  'Branching Narrative',
  'Random or Procedural Generation',
  'Inventory or Equipment',
  'Diary Entries or Log',
  'Cutscene',
  'Dev Website in store page',
  'Dev Youtube in store page',
  'Non-Standard Movement',
  'Upgrade System',
  'Game Over Screen',
  'Lives',
  'Non-Standard Weapons',
  'Magic!',
  'Redeem Something',
  'Destructible Environment',
  'Health',
  'Aliens!',
  'Very or Overwhelmingly Positive',
  'Game is on >1 platform',
  'Additional Languages',
  'Leaderboard',
  'GenAI Used',
  'Action or Turn-Based RPG',
  'Rhythm Mechanics',
  'End of the world/post apocalyptic',
  'Dies/fails',
  'Collect something',
  'WTF???',
];

export interface GameState {
  name: string;
  size: BoardSize;
  spaceList: string[]; // shared list, abilities can change it between rounds
  calledSpaces: string[];
  roundId: number; // bumps each round, players get a new sheet
  roundWinners: string[];
  scores: Record<string, number>;
}

export function defaultGameState(): GameState {
  return {
    name: '',
    size: 5,
    spaceList: [...DEFAULT_SPACES],
    calledSpaces: [],
    roundId: 1,
    roundWinners: [],
    scores: {},
  };
}

// still works even if a space gets uncalled after someone marked it.
export function verifyBingo(sheet: Sheet, calledSpaces: string[]): Line[] {
  const called = new Set(calledSpaces);
  return getLines(sheet.size).filter((line) =>
    line.cells.every((cellIndex) => {
      const tile = sheet.tiles[cellIndex];
      return tile.marked && (tile.isFree || called.has(tile.label));
    }),
  );
}

// the only way to change state. the server applies these with reduce.
export type Action =
  | { type: 'setConfig'; changes: Partial<Pick<GameState, 'name' | 'size' | 'spaceList'>> }
  | { type: 'toggleCalled'; label: string }
  | { type: 'startNewRound' }
  | { type: 'awardBingo'; player: string; lines: number }
  | { type: 'resetScores' }
  | { type: 'callAll' };

export function reduce(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'setConfig':
      return { ...state, ...action.changes };
    case 'toggleCalled': {
      const called = new Set(state.calledSpaces);
      if (called.has(action.label)) called.delete(action.label);
      else called.add(action.label);
      return { ...state, calledSpaces: [...called] };
    }
    case 'startNewRound':
      return { ...state, roundId: state.roundId + 1, calledSpaces: [], roundWinners: [] };
    case 'awardBingo': {
      // 1 point per line
      if (state.roundWinners.includes(action.player)) return state;
      const updatedScore = (state.scores[action.player] ?? 0) + action.lines;
      return {
        ...state,
        scores: { ...state.scores, [action.player]: updatedScore },
        roundWinners: [...state.roundWinners, action.player],
      };
    }
    case 'resetScores':
      return { ...state, scores: {} };
    case 'callAll': {
      // also uncalls everything if everything's already called
      const uniqueSpaces = [...new Set(state.spaceList)];
      const allCalled = uniqueSpaces.every((space) => state.calledSpaces.includes(space));
      return { ...state, calledSpaces: allCalled ? [] : uniqueSpaces };
    }
    default:
      return state; // ignore unknown actions
  }
}
