// scribe view: set up the game, start rounds, and toggle spaces as called.
// changes go through the shared state so players update live.

import { BOARD_SIZES, type BoardSize } from './bingo.js';
import { type GameState } from './game.js';
import { loadState, subscribe, onHello, setConfig, toggleCalled, startNewRound, resetScores, callAll } from './state.js';
import { appendLabelWithBreaks } from './labels.js';

const nameInput = document.getElementById('game-name-input') as HTMLInputElement;
const sizeSelect = document.getElementById('size') as HTMLSelectElement;
const spacesInput = document.getElementById('spaces') as HTMLTextAreaElement;
const saveBtn = document.getElementById('save-config') as HTMLButtonElement;
const newRoundBtn = document.getElementById('new-round') as HTMLButtonElement;
const roundInfoEl = document.getElementById('round-info') as HTMLParagraphElement;
const callListEl = document.getElementById('call-list') as HTMLDivElement;
const scoreboardEl = document.getElementById('scoreboard') as HTMLOListElement;
const resetScoresBtn = document.getElementById('reset-scores') as HTMLButtonElement;
const callAllBtn = document.getElementById('call-all') as HTMLButtonElement;
const scribeUiEl = document.getElementById('scribe-ui') as HTMLElement;
const loginNoteEl = document.getElementById('login-note') as HTMLParagraphElement;

let state: GameState = loadState();

sizeSelect.replaceChildren(
  ...BOARD_SIZES.map((size) => {
    const option = document.createElement('option');
    option.value = String(size);
    option.textContent = `${size} x ${size}`;
    return option;
  }),
);

// put saved settings back into the form
function renderControls(): void {
  nameInput.value = state.name;
  sizeSelect.value = String(state.size);
  spacesInput.value = state.spaceList.join('\n');
}

function renderRoundInfo(): void {
  const title = state.name || 'Bingo';
  const uniqueCount = new Set(state.spaceList).size;
  roundInfoEl.textContent =
    `${title} - Round ${state.roundId} (${state.size}x${state.size}) - ` +
    `${state.calledSpaces.length}/${uniqueCount} called`;
}

function renderCallList(): void {
  const called = new Set(state.calledSpaces);
  callListEl.replaceChildren();

  const uniqueSpaces = [...new Set(state.spaceList)].sort((a, b) => a.localeCompare(b));
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
    item.textContent = `${player} - ${points}`;
    scoreboardEl.appendChild(item);
  }
}

saveBtn.addEventListener('click', () => {
  const size = Number(sizeSelect.value) as BoardSize;
  const spaceList = spacesInput.value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  setConfig({ name: nameInput.value.trim(), size, spaceList });
});

onHello((scribe) => {
  scribeUiEl.hidden = !scribe;
  loginNoteEl.hidden = scribe;
});

newRoundBtn.addEventListener('click', () => startNewRound());
resetScoresBtn.addEventListener('click', () => resetScores());
callAllBtn.addEventListener('click', () => callAll());

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
