// Player view: shows your sheet + the called list, lets you mark called tiles, and
// checks your "Call Bingo".

import { type Sheet, generateSheet, toggleTile } from './bingo.js';
import { type GameState, verifyBingo } from './game.js';
import { loadState, subscribe, awardBingo } from './state.js';
import { appendLabelWithBreaks } from './labels.js';

// marking is locked for this long after clicking a space that hasn't been called (prevents spam).
const MARK_COOLDOWN_MS = 10_000;

const nameInput = document.getElementById('player-name') as HTMLInputElement;
const gameNameEl = document.getElementById('game-name') as HTMLParagraphElement;
const messageEl = document.getElementById('message') as HTMLParagraphElement;
const bannerEl = document.getElementById('banner') as HTMLDivElement;
const callBingoBtn = document.getElementById('call-bingo') as HTMLButtonElement;
const boardEl = document.getElementById('board') as HTMLDivElement;
const calledListEl = document.getElementById('called-list') as HTMLOListElement;

let state: GameState = loadState();
let sheet: Sheet | null = null;
let lastRoundId = -1;

let cooldownUntil = 0;
let cooldownReason = '';
let cooldownTimer: number | undefined;

function onCooldown(): boolean {
  return Date.now() < cooldownUntil;
}

function renderCooldown(): void {
  const remainingMs = cooldownUntil - Date.now();
  if (remainingMs <= 0) {
    window.clearInterval(cooldownTimer);
    cooldownTimer = undefined;
    messageEl.textContent = '';
    return;
  }
  messageEl.textContent = `${cooldownReason} Marking paused for ${Math.ceil(remainingMs / 1000)}s.`;
}

function startCooldown(reason: string): void {
  cooldownReason = reason;
  cooldownUntil = Date.now() + MARK_COOLDOWN_MS;
  window.clearInterval(cooldownTimer);
  cooldownTimer = window.setInterval(renderCooldown, 250);
  renderCooldown();
}

function regenerateSheet(): void {
  try {
    sheet = generateSheet(state.size, state.spaceList);
    messageEl.textContent = '';
  } catch (error) {
    sheet = null;
    messageEl.textContent = error instanceof Error ? error.message : String(error);
  }
}

function handleTileClick(cellIndex: number): void {
  if (!sheet) return;
  const tile = sheet.tiles[cellIndex];
  if (tile.isFree) return;
  if (onCooldown()) {
    renderCooldown();
    return;
  }
  // unmarking is always fine (in case of misclicks)
  if (tile.marked) {
    toggleTile(sheet, cellIndex);
    render();
    return;
  }
  // can only mark a space once it's been called
  if (!state.calledSpaces.includes(tile.label)) {
    startCooldown(`"${tile.label}" hasn't been called yet.`);
    return;
  }
  toggleTile(sheet, cellIndex);
  messageEl.textContent = '';
  render();
}

function render(): void {
  boardEl.replaceChildren();
  if (!sheet) return;
  boardEl.style.setProperty('--size', String(sheet.size));

  const called = new Set(state.calledSpaces);
  const winningCells = new Set<number>();
  for (const line of verifyBingo(sheet, state.calledSpaces)) {
    for (const cellIndex of line.cells) winningCells.add(cellIndex);
  }

  sheet.tiles.forEach((tile, cellIndex) => {
    const tileButton = document.createElement('button');
    tileButton.type = 'button';
    tileButton.className = 'tile';
    appendLabelWithBreaks(tileButton, tile.label);
    if (tile.isFree) tileButton.classList.add('free');
    if (tile.marked) tileButton.classList.add('marked');
    if (!tile.isFree && called.has(tile.label)) tileButton.classList.add('called');
    if (winningCells.has(cellIndex)) tileButton.classList.add('bingo');
    tileButton.addEventListener('click', () => handleTileClick(cellIndex));
    boardEl.appendChild(tileButton);
  });
}

function renderGameName(): void {
  const title = state.name || 'Bingo';
  gameNameEl.textContent = `${title} - Round ${state.roundId} (${state.size}x${state.size})`;
}

function renderCalledList(): void {
  calledListEl.replaceChildren();
  for (const space of state.calledSpaces) {
    const item = document.createElement('li');
    appendLabelWithBreaks(item, space);
    calledListEl.appendChild(item);
  }
}

function applyState(next: GameState): void {
  const needNewSheet =
    !sheet ||
    next.roundId !== lastRoundId ||
    next.size !== state.size ||
    JSON.stringify(next.spaceList) !== JSON.stringify(state.spaceList);
  state = next;
  if (needNewSheet) {
    lastRoundId = next.roundId;
    bannerEl.hidden = true;
    regenerateSheet();
  }
  renderGameName();
  renderCalledList();
  render();
}

callBingoBtn.addEventListener('click', () => {
  if (!sheet) return;
  const player = nameInput.value.trim();
  if (!player) {
    bannerEl.hidden = true;
    messageEl.textContent = 'Enter your name first, then call bingo.';
    return;
  }
  const wins = verifyBingo(sheet, state.calledSpaces);
  if (wins.length === 0) {
    bannerEl.hidden = true;
    messageEl.textContent = 'No valid bingo yet - mark a full called row, column, or diagonal first.';
    return;
  }
  if (state.roundWinners.includes(player)) {
    bannerEl.hidden = true;
    messageEl.textContent = 'You already scored a bingo this round.';
    return;
  }
  awardBingo(player, wins.length);
  const points = wins.length;
  messageEl.textContent = '';
  bannerEl.hidden = false;
  bannerEl.textContent = `BINGO! +${points} point${points !== 1 ? 's' : ''}!`;
});

subscribe(applyState);
applyState(state);
