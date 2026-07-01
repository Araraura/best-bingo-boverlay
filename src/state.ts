// shared game state for all clients, over a websocket to the backend.
// the server holds the state and applies every action, clients just send actions
// and re-render when the server broadcasts a new state.
import { type GameState, type Action, defaultGameState } from './game.js';

type Listener = (state: GameState) => void;
const listeners = new Set<Listener>();
let current: GameState = defaultGameState();

const pending: Action[] = [];
let socket: WebSocket;

function connect(): void {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${scheme}://${location.host}`);

  socket.addEventListener('open', () => {
    for (const action of pending) socket.send(JSON.stringify(action));
    pending.length = 0;
  });

  socket.addEventListener('message', (event) => {
    current = JSON.parse(event.data as string) as GameState;
    for (const listener of listeners) listener(current);
  });

  // reconnect if the server drops or restarts
  socket.addEventListener('close', () => {
    window.setTimeout(connect, 1000);
  });
}

connect();

function send(action: Action): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(action));
  else pending.push(action); // queue until the socket is open
}

export function loadState(): GameState {
  return current;
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// --- Mutators ---

export function setConfig(changes: Partial<Pick<GameState, 'name' | 'size' | 'spaceList'>>): void {
  send({ type: 'setConfig', changes });
}

export function toggleCalled(label: string): void {
  send({ type: 'toggleCalled', label });
}

export function startNewRound(): void {
  send({ type: 'startNewRound' });
}

export function awardBingo(player: string, lines: number): void {
  send({ type: 'awardBingo', player, lines });
}

export function resetScores(): void {
  send({ type: 'resetScores' });
}
