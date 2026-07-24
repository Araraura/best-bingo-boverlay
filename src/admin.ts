// scribe view: set up the game, start rounds, and toggle spaces as called.
// changes go through the shared state so players update live.

import { BOARD_SIZES, type BoardSize } from './bingo.js';
import { type GameState, callableSpaces } from './game.js';
import {
  loadState,
  subscribe,
  onHello,
  onNotice,
  setConfig,
  toggleCalled,
  startNewRound,
  resetScores,
  callAll,
  addScribe,
} from './state.js';
import { appendLabelWithBreaks } from './labels.js';

const nameInput = document.getElementById('game-name-input') as HTMLInputElement;
const sizeSelect = document.getElementById('size') as HTMLSelectElement;
const spacesInput = document.getElementById('spaces') as HTMLTextAreaElement;
const centerSpaceInput = document.getElementById('center-space') as HTMLInputElement;
const centerIsFreeInput = document.getElementById('center-is-free') as HTMLInputElement;
const saveBtn = document.getElementById('save-config') as HTMLButtonElement;
const newRoundBtn = document.getElementById('new-round') as HTMLButtonElement;
const roundInfoEl = document.getElementById('round-info') as HTMLParagraphElement;
const callListEl = document.getElementById('call-list') as HTMLDivElement;
const scoreboardEl = document.getElementById('scoreboard') as HTMLOListElement;
const resetScoresBtn = document.getElementById('reset-scores') as HTMLButtonElement;
const callAllBtn = document.getElementById('call-all') as HTMLButtonElement;
const scribeUiEl = document.getElementById('scribe-ui') as HTMLElement;
const loginNoteEl = document.getElementById('login-note') as HTMLParagraphElement;
const scribeNameInput = document.getElementById('scribe-name') as HTMLInputElement;
const addScribeBtn = document.getElementById('add-scribe') as HTMLButtonElement;
const adminMessageEl = document.getElementById('admin-message') as HTMLParagraphElement;

let state: GameState = loadState();

sizeSelect.replaceChildren(
  ...BOARD_SIZES.map((size) => {
    const option = document.createElement('option');
    option.value = String(size);
    option.textContent = `${size} x ${size}`;
    return option;
  }),
);

function renderControls(): void {
  nameInput.value = state.name;
  sizeSelect.value = String(state.size);
  spacesInput.value = state.spaceList.join('\n');
  centerSpaceInput.value = state.centerSpace;
  centerIsFreeInput.checked = state.centerIsFree;
}

function renderRoundInfo(): void {
  const title = state.name || 'Bingo';
  const uniqueCount = callableSpaces(state).length;
  roundInfoEl.textContent =
    `${title} - Round ${state.roundId} (${state.size}x${state.size}) - ` +
    `${state.calledSpaces.length}/${uniqueCount} called`;
}

function renderCallList(): void {
  const called = new Set(state.calledSpaces);
  callListEl.replaceChildren();

  const uniqueSpaces = callableSpaces(state).sort((a, b) => a.localeCompare(b));
  for (const space of uniqueSpaces) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'call-item';
    if (called.has(space)) button.classList.add('called');
    appendLabelWithBreaks(button, space);
    button.addEventListener('click', () => toggleCalled(space));
    callListEl.appendChild(button);
  }
}

function renderScoreboard(): void {
  const ranked = Object.entries(state.scores).sort((a, b) => b[1] - a[1]);
  scoreboardEl.replaceChildren();
  for (const [player, points] of ranked) {
    const item = document.createElement('li');
    const profileLink = document.createElement('a');
    profileLink.href = `https://www.twitch.tv/${encodeURIComponent(player.toLowerCase())}`;
    profileLink.target = '_blank';
    profileLink.rel = 'noopener';
    profileLink.textContent = player;
    item.append(profileLink, ` - ${points}`);
    scoreboardEl.appendChild(item);
  }
}

saveBtn.addEventListener('click', () => {
  const size = Number(sizeSelect.value) as BoardSize;
  const spaceList = spacesInput.value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  setConfig({
    name: nameInput.value.trim(),
    size,
    spaceList,
    centerSpace: centerSpaceInput.value.trim(),
    centerIsFree: centerIsFreeInput.checked,
  });
});

onHello(({ scribe }) => {
  scribeUiEl.hidden = !scribe;
  loginNoteEl.hidden = scribe;
});

newRoundBtn.addEventListener('click', () => startNewRound());
resetScoresBtn.addEventListener('click', () => {
  if (window.confirm('Reset all scores?')) {
    resetScores();
  }
});
callAllBtn.addEventListener('click', () => callAll());

addScribeBtn.addEventListener('click', () => {
  const name = scribeNameInput.value.trim();
  if (!name) return;
  addScribe(name);
  scribeNameInput.value = '';
});

onNotice((notice) => {
  adminMessageEl.textContent = notice.message;
});

subscribe((next) => {
  const configChanged =
    next.name !== state.name ||
    next.size !== state.size ||
    next.spaceList.join('\n') !== state.spaceList.join('\n');
  state = next;
  if (configChanged) renderControls();
  renderRoundInfo();
  renderCallList();
  renderScoreboard();
});

renderControls();
renderRoundInfo();
renderCallList();
renderScoreboard();
