// talks to the server over a websocket.
// sends actions and passes incoming messages to listeners.

import { type GameState, type Action, defaultGameState } from './game.js';
import { type Sheet } from './bingo.js';

export interface Notice {
  level: 'error' | 'info' | 'success';
  message: string;
  cooldownMs?: number;
}

type ServerMessage =
  | { type: 'state'; game: GameState }
  | { type: 'sheet'; sheet: Sheet }
  | ({ type: 'notice' } & Notice);

type StateListener = (state: GameState) => void;
type SheetListener = (sheet: Sheet) => void;
type NoticeListener = (notice: Notice) => void;

const stateListeners = new Set<StateListener>();
const sheetListeners = new Set<SheetListener>();
const noticeListeners = new Set<NoticeListener>();
let current: GameState = defaultGameState();

type Outgoing =
  | Action
  | { type: 'join'; name: string }
  | { type: 'mark'; cellIndex: number }
  | { type: 'claimBingo' };

const pending: Outgoing[] = [];
let socket: WebSocket;

function connect(): void {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${scheme}://${location.host}`);

  socket.addEventListener('open', () => {
    for (const action of pending) socket.send(JSON.stringify(action));
    pending.length = 0;
  });

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data as string) as ServerMessage;
    if (message.type === 'state') {
      current = message.game;
      for (const listener of stateListeners) listener(current);
    } else if (message.type === 'sheet') {
      for (const listener of sheetListeners) listener(message.sheet);
    } else if (message.type === 'notice') {
      for (const listener of noticeListeners) listener(message);
    }
  });

  socket.addEventListener('close', () => window.setTimeout(connect, 1000));
}

connect();

function send(action: Outgoing): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(action));
  else pending.push(action);
}

export function loadState(): GameState {
  return current;
}

export function subscribe(listener: StateListener): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

export function onSheet(listener: SheetListener): () => void {
  sheetListeners.add(listener);
  return () => sheetListeners.delete(listener);
}

export function onNotice(listener: NoticeListener): () => void {
  noticeListeners.add(listener);
  return () => noticeListeners.delete(listener);
}

// scribe actions
export function setConfig(changes: Partial<Pick<GameState, 'name' | 'size' | 'spaceList'>>): void {
  send({ type: 'setConfig', changes });
}
export function toggleCalled(label: string): void {
  send({ type: 'toggleCalled', label });
}
export function startNewRound(): void {
  send({ type: 'startNewRound' });
}
export function resetScores(): void {
  send({ type: 'resetScores' });
}
export function callAll(): void {
  send({ type: 'callAll' });
}

// player actions
export function join(name: string): void {
  send({ type: 'join', name });
}
export function mark(cellIndex: number): void {
  send({ type: 'mark', cellIndex });
}
export function claimBingo(): void {
  send({ type: 'claimBingo' });
}
