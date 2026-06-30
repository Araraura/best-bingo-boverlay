// Shared game state for both views
// Saves to localStorage and pings other tabs over a BroadcastChannel, so two tabs act
// like two clients. Will be swapped later for the backend + websocket

import { type GameState, defaultGameState } from './game.js';

const STORAGE_KEY = 'boverlay.game';
const channel = new BroadcastChannel('boverlay');

type Listener = (state: GameState) => void;
const listeners = new Set<Listener>();

function read(): GameState {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultGameState();
  try {
    return { ...defaultGameState(), ...(JSON.parse(raw) as Partial<GameState>) } as GameState;
  } catch {
    return defaultGameState();
  }
}

function write(state: GameState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  channel.postMessage(state); // tell the other tabs (this one won't hear its own message)
  for (const listener of listeners) listener(state); // tell this tab
}

export function loadState(): GameState {
  return read();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

channel.addEventListener('message', (event) => {
  const state = event.data as GameState;
  for (const listener of listeners) listener(state);
});

// --- Mutators ---

export function setConfig(changes: Partial<Pick<GameState, 'name' | 'size' | 'spaceList'>>): void {
  write({ ...read(), ...changes });
}

export function toggleCalled(label: string): void {
  const state = read();
  const called = new Set(state.calledSpaces);
  if (called.has(label)) called.delete(label);
  else called.add(label);
  write({ ...state, calledSpaces: [...called] });
}

export function startNewRound(): void {
  const state = read();
  write({ ...state, roundId: state.roundId + 1, calledSpaces: [], roundWinners: [] });
}

// auto awards verified bingos, one award per player per round
export function awardBingo(player: string, lines: number): number {
  const state = read();
  if (state.roundWinners.includes(player)) return 0;
  const points = lines;
  const scores = { ...state.scores, [player]: (state.scores[player] ?? 0) + points };
  write({ ...state, scores, roundWinners: [...state.roundWinners, player] });
  return points;
}

export function resetScores(): void {
  write({ ...read(), scores: {} });
}
