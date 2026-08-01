// talks to the server over a websocket.
// sends actions and passes incoming messages to listeners.

import { type GameState, type Action, type BoardConfig, defaultGameState } from './game.js';
import { type Sheet } from './bingo.js';

export interface Notice {
  level: 'error' | 'info' | 'success';
  message: string;
  cooldownMs?: number;
}

export interface Hello {
  scribe: boolean;
  twitch: boolean;
}

type ServerMessage =
  | ({ type: 'hello' } & Hello)
  | { type: 'state'; game: GameState }
  | { type: 'sheet'; sheet: Sheet }
  | ({ type: 'notice' } & Notice);

type StateListener = (state: GameState) => void;
type SheetListener = (sheet: Sheet) => void;
type NoticeListener = (notice: Notice) => void;
type HelloListener = (hello: Hello) => void;

const stateListeners = new Set<StateListener>();
const sheetListeners = new Set<SheetListener>();
const noticeListeners = new Set<NoticeListener>();
const helloListeners = new Set<HelloListener>();
let current: GameState = defaultGameState();
let lastHello: Hello | null = null;

type Outgoing =
  | Action
  | { type: 'join'; name?: string; token?: string }
  | { type: 'mark'; cellIndex: number }
  | { type: 'claimBingo' }
  | { type: 'addScribe'; name: string }
  | { type: 'useFreeSpace'; space: string }
  | { type: 'submitSpace'; space: string } // the server fills in who sent it
  | { type: 'removeSpace'; space: string };

const pending: Outgoing[] = [];
let socket: WebSocket;

function backendUrl(): string {
  if (window.BOVERLAY_BACKEND) return window.BOVERLAY_BACKEND;
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${location.host}`;
}

function connect(): void {
  socket = new WebSocket(backendUrl());

  socket.addEventListener('open', () => {
    for (const action of pending) socket.send(JSON.stringify(action));
    pending.length = 0;
  });

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data as string) as ServerMessage;
    if (message.type === 'state') {
      current = { ...defaultGameState(), ...message.game };
      for (const listener of stateListeners) listener(current);
    } else if (message.type === 'sheet') {
      for (const listener of sheetListeners) listener(message.sheet);
    } else if (message.type === 'notice') {
      for (const listener of noticeListeners) listener(message);
    } else if (message.type === 'hello') {
      lastHello = { scribe: message.scribe, twitch: message.twitch };
      for (const listener of helloListeners) listener(lastHello);
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

export function onHello(listener: HelloListener): () => void {
  helloListeners.add(listener);
  if (lastHello !== null) listener(lastHello);
  return () => helloListeners.delete(listener);
}

// scribe actions
export function setConfig(changes: Partial<BoardConfig>): void {
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
export function addScribe(name: string): void {
  send({ type: 'addScribe', name });
}
export function approveSpace(space: string): void {
  send({ type: 'approveSpace', space });
}
export function rejectSpace(space: string): void {
  send({ type: 'rejectSpace', space });
}

// player actions
export function join(payload: { name?: string; token?: string }): void {
  send({ type: 'join', ...payload });
}
export function mark(cellIndex: number): void {
  send({ type: 'mark', cellIndex });
}
export function claimBingo(): void {
  send({ type: 'claimBingo' });
}
export function useFreeSpace(space: string): void {
  send({ type: 'useFreeSpace', space });
}
export function submitSpace(space: string): void {
  send({ type: 'submitSpace', space });
}
export function removeSpace(space: string): void {
  send({ type: 'removeSpace', space });
}
