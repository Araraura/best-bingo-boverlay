import { type BoardSize, type Sheet, type Line, getLines, FREE_LABEL } from './bingo.js';

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
  centerSpace: string;
  centerIsFree: boolean; // free means it starts marked, otherwise it has to be called
  freeSpaceCost: number; // shown on the button, the real cost lives on the twitch reward
  freeSpaceLimit: number; // how many free spaces a round allows, prevents point spamming
  calledSpaces: string[];
  roundId: number; // bumps each round, players get a new sheet
  roundSize: BoardSize; // what sheets actually use, a size change waits for the next round
  roundOver: boolean; // a bingo ends the round, no marking or claims until the next one
  roundWin: { player: string; lines: number; points: number } | null;
  roundWinners: string[];
  scores: Record<string, number>;
  freeSpaces: string[]; // called by the ability, scribes can't take these back
}

export function defaultGameState(): GameState {
  return {
    name: '',
    size: 5,
    spaceList: [...DEFAULT_SPACES],
    centerSpace: FREE_LABEL,
    centerIsFree: true,
    freeSpaceCost: 50,
    freeSpaceLimit: 3,
    calledSpaces: [],
    roundId: 1,
    roundSize: 5,
    roundOver: false,
    roundWin: null,
    roundWinners: [],
    scores: {},
    freeSpaces: [],
  };
}

export function freeSpacesLeft(state: GameState): number {
  return Math.max(0, state.freeSpaceLimit - state.freeSpaces.length);
}

// the spaces a player can pick for a free space
export function uncalledSpaces(state: GameState): string[] {
  const called = new Set(state.calledSpaces);
  return [...new Set(state.spaceList)].filter((space) => !called.has(space)).sort((a, b) => a.localeCompare(b));
}

export const POINTS_PER_LINE: Record<BoardSize, number> = { 5: 1, 6: 2, 7: 3 };

// the win announcement everyone sees, empty while a round is underway
export function roundOverText(state: GameState): string {
  if (!state.roundOver) return '';
  const win = state.roundWin;
  if (!win) return 'ROUND OVER! Waiting for the next round.';
  const lineText = `${win.lines} line${win.lines > 1 ? 's' : ''}`;
  const pointText = `${win.points} point${win.points > 1 ? 's' : ''}`;
  return `ROUND OVER! ${win.player} got a BINGO - ${lineText}, +${pointText}. Waiting for the next round.`;
}

// what scribes can call. a center space that isn't free has to be callable too,
// but 6x6 boards have no center at all
export function callableSpaces(state: GameState): string[] {
  const spaces = [...new Set(state.spaceList)];
  const center = state.centerSpace.trim();
  const hasCenter = state.roundSize % 2 === 1;
  if (hasCenter && !state.centerIsFree && center && !spaces.includes(center)) spaces.push(center);
  return spaces;
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

// what scribes can change from the admin page
export type BoardConfig = Pick<
  GameState,
  'name' | 'size' | 'spaceList' | 'centerSpace' | 'centerIsFree' | 'freeSpaceCost' | 'freeSpaceLimit'
>;

// the only way to change state. the server applies these with reduce.
export type Action =
  | { type: 'setConfig'; changes: Partial<BoardConfig> }
  | { type: 'toggleCalled'; label: string }
  | { type: 'startNewRound' }
  | { type: 'awardBingo'; player: string; lines: number }
  | { type: 'resetScores' }
  | { type: 'callAll' }
  | { type: 'useFreeSpace'; space: string };

export function reduce(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'setConfig':
      return { ...state, ...action.changes };
    case 'toggleCalled': {
      if (state.freeSpaces.includes(action.label)) return state;
      const called = new Set(state.calledSpaces);
      if (called.has(action.label)) called.delete(action.label);
      else called.add(action.label);
      return { ...state, calledSpaces: [...called] };
    }
    case 'startNewRound':
      return {
        ...state,
        roundId: state.roundId + 1,
        roundSize: state.size,
        calledSpaces: [],
        roundWinners: [],
        roundOver: false,
        roundWin: null,
        freeSpaces: [],
      };
    case 'awardBingo': {
      if (state.roundWinners.includes(action.player)) return state;
      const points = action.lines * POINTS_PER_LINE[state.roundSize];
      return {
        ...state,
        scores: { ...state.scores, [action.player]: (state.scores[action.player] ?? 0) + points },
        roundWinners: [...state.roundWinners, action.player],
        roundOver: true,
        roundWin: { player: action.player, lines: action.lines, points },
      };
    }
    case 'resetScores':
      return {
        ...state,
        scores: {},
        roundId: 1,
        roundSize: state.size,
        calledSpaces: [],
        roundWinners: [],
        roundOver: false,
        roundWin: null,
        freeSpaces: [],
      };
    case 'callAll': {
      const uniqueSpaces = callableSpaces(state);
      const allCalled = uniqueSpaces.every((space) => state.calledSpaces.includes(space));
      if (allCalled) return { ...state, calledSpaces: [], freeSpaces: [] };
      return { ...state, calledSpaces: uniqueSpaces };
    }
    case 'useFreeSpace':
      if (!uncalledSpaces(state).includes(action.space) || freeSpacesLeft(state) === 0) return state;
      return {
        ...state,
        calledSpaces: [...state.calledSpaces, action.space],
        freeSpaces: [...state.freeSpaces, action.space],
      };
    default:
      return state;
  }
}
