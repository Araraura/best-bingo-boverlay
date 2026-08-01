// scribe view: set up the game, start rounds, and toggle spaces as called.
// changes go through the shared state so players update live.

import { BOARD_SIZES, type BoardSize } from './bingo.js';
import { type GameState, type BoardConfig, callableSpaces, roundOverText } from './game.js';
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
  approveSpace,
  rejectSpace,
} from './state.js';
import { appendLabelWithBreaks } from './labels.js';

const nameInput = document.getElementById('game-name-input') as HTMLInputElement;
const sizeSelect = document.getElementById('size') as HTMLSelectElement;
const spacesInput = document.getElementById('spaces') as HTMLTextAreaElement;
const centerSpaceInput = document.getElementById('center-space') as HTMLInputElement;
const centerIsFreeInput = document.getElementById('center-is-free') as HTMLInputElement;
const freeSpaceCostInput = document.getElementById('free-space-cost') as HTMLInputElement;
const freeSpaceLimitInput = document.getElementById('free-space-limit') as HTMLInputElement;
const addSpaceCostInput = document.getElementById('add-space-cost') as HTMLInputElement;
const addSpaceLimitInput = document.getElementById('add-space-limit') as HTMLInputElement;
const removeSpaceCostInput = document.getElementById('remove-space-cost') as HTMLInputElement;
const removeSpaceLimitInput = document.getElementById('remove-space-limit') as HTMLInputElement;
const spaceQueueEl = document.getElementById('space-queue') as HTMLUListElement;
const protectListEl = document.getElementById('protect-list') as HTMLDivElement;
const protectAllBtn = document.getElementById('protect-all') as HTMLButtonElement;
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
let protectedDraft: string[] = []; // edited by the chips, saved with the rest of the settings

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
  freeSpaceCostInput.value = String(state.freeSpaceCost);
  freeSpaceLimitInput.value = String(state.freeSpaceLimit);
  addSpaceCostInput.value = String(state.addSpaceCost);
  addSpaceLimitInput.value = String(state.addSpaceLimit);
  removeSpaceCostInput.value = String(state.removeSpaceCost);
  removeSpaceLimitInput.value = String(state.removeSpaceLimit);
  protectedDraft = [...state.protectedSpaces];
  renderProtectList();
}

function renderProtectList(): void {
  const protectedNow = new Set(protectedDraft);
  const going = new Set(state.removedSpaces);
  protectListEl.replaceChildren();
  for (const space of [...new Set(state.spaceList)].sort((a, b) => a.localeCompare(b))) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'call-item';
    if (protectedNow.has(space)) button.classList.add('protected');
    appendLabelWithBreaks(button, space);
    if (going.has(space)) {
      button.classList.add('going');
      button.disabled = true;
      protectListEl.appendChild(button);
      continue;
    }
    button.addEventListener('click', () => {
      protectedDraft = protectedNow.has(space)
        ? protectedDraft.filter((kept) => kept !== space)
        : [...protectedDraft, space];
      renderProtectList();
      renderSaveButton();
    });
    protectListEl.appendChild(button);
  }
}

function renderSpaceQueue(): void {
  spaceQueueEl.replaceChildren();
  for (const submission of state.spaceSubmissions) {
    const item = document.createElement('li');
    appendLabelWithBreaks(item, `${submission.player} suggests "${submission.space}"`);

    const approve = document.createElement('button');
    approve.type = 'button';
    approve.textContent = 'Approve';
    approve.addEventListener('click', () => approveSpace(submission.space));

    const reject = document.createElement('button');
    reject.type = 'button';
    reject.textContent = 'Reject';
    reject.addEventListener('click', () => rejectSpace(submission.space));

    item.append(' ', approve, ' ', reject);
    spaceQueueEl.appendChild(item);
  }

  for (const space of state.pendingSpaces) {
    const item = document.createElement('li');
    appendLabelWithBreaks(item, `${space} - joins the list next round`);
    spaceQueueEl.appendChild(item);
  }

  for (const space of state.removedSpaces) {
    const item = document.createElement('li');
    appendLabelWithBreaks(item, `${space} - leaves the list next round`);
    spaceQueueEl.appendChild(item);
  }
}

function renderRoundInfo(): void {
  const title = state.name || 'Bingo';
  const uniqueCount = callableSpaces(state).length;
  const roundOver = roundOverText(state);
  roundInfoEl.textContent =
    `${title} - Round ${state.roundId} (${state.roundSize}x${state.roundSize}) - ` +
    `${state.calledSpaces.length}/${uniqueCount} called` +
    (roundOver ? ` - ${roundOver}` : '');
}

function renderCallList(): void {
  const called = new Set(state.calledSpaces);
  callListEl.replaceChildren();

  const freeSpaces = new Set(state.freeSpaces);
  const going = new Set(state.removedSpaces);
  const uniqueSpaces = callableSpaces(state).sort((a, b) => a.localeCompare(b));
  for (const space of uniqueSpaces) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'call-item';
    if (called.has(space)) button.classList.add('called');
    if (going.has(space)) button.classList.add('going');
    appendLabelWithBreaks(button, space);
    if (freeSpaces.has(space)) {
      button.classList.add('free-called');
      button.disabled = true;
    } else {
      button.addEventListener('click', () => toggleCalled(space));
    }
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

// the settings side of the state, so the form knows when the server's copy changed
function savedConfig(from: GameState): BoardConfig {
  return {
    name: from.name,
    size: from.size,
    spaceList: from.spaceList,
    centerSpace: from.centerSpace,
    centerIsFree: from.centerIsFree,
    freeSpaceCost: from.freeSpaceCost,
    freeSpaceLimit: from.freeSpaceLimit,
    addSpaceCost: from.addSpaceCost,
    addSpaceLimit: from.addSpaceLimit,
    removeSpaceCost: from.removeSpaceCost,
    removeSpaceLimit: from.removeSpaceLimit,
    protectedSpaces: from.protectedSpaces,
  };
}

function formConfig(): BoardConfig {
  return {
    name: nameInput.value.trim(),
    size: Number(sizeSelect.value) as BoardSize,
    spaceList: spacesInput.value
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
    centerSpace: centerSpaceInput.value.trim(),
    centerIsFree: centerIsFreeInput.checked,
    freeSpaceCost: Math.max(0, Number(freeSpaceCostInput.value) || 0),
    freeSpaceLimit: Math.max(0, Number(freeSpaceLimitInput.value) || 0),
    addSpaceCost: Math.max(0, Number(addSpaceCostInput.value) || 0),
    addSpaceLimit: Math.max(0, Number(addSpaceLimitInput.value) || 0),
    removeSpaceCost: Math.max(0, Number(removeSpaceCostInput.value) || 0),
    removeSpaceLimit: Math.max(0, Number(removeSpaceLimitInput.value) || 0),
    protectedSpaces: protectedDraft,
  };
}

// highlights save while the form differs from the settings the server has
function renderSaveButton(): void {
  const form = formConfig();
  const unsaved =
    form.name !== state.name ||
    form.size !== state.size ||
    form.spaceList.join('\n') !== state.spaceList.join('\n') ||
    form.centerSpace !== state.centerSpace ||
    form.centerIsFree !== state.centerIsFree ||
    form.freeSpaceCost !== state.freeSpaceCost ||
    form.freeSpaceLimit !== state.freeSpaceLimit ||
    form.addSpaceCost !== state.addSpaceCost ||
    form.addSpaceLimit !== state.addSpaceLimit ||
    form.removeSpaceCost !== state.removeSpaceCost ||
    form.removeSpaceLimit !== state.removeSpaceLimit ||
    [...form.protectedSpaces].sort().join('\n') !== [...state.protectedSpaces].sort().join('\n');
  saveBtn.classList.toggle('unsaved', unsaved);
}

const configFields = [
  nameInput,
  sizeSelect,
  spacesInput,
  centerSpaceInput,
  centerIsFreeInput,
  freeSpaceCostInput,
  freeSpaceLimitInput,
  addSpaceCostInput,
  addSpaceLimitInput,
  removeSpaceCostInput,
  removeSpaceLimitInput,
];
for (const field of configFields) {
  field.addEventListener('input', renderSaveButton);
  field.addEventListener('change', renderSaveButton);
}

saveBtn.addEventListener('click', () => setConfig(formConfig()));

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

protectAllBtn.addEventListener('click', () => {
  const spaces = [...new Set(state.spaceList)];
  protectedDraft = spaces.every((space) => protectedDraft.includes(space)) ? [] : spaces;
  renderProtectList();
  renderSaveButton();
});

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
  const configChanged = JSON.stringify(savedConfig(next)) !== JSON.stringify(savedConfig(state));
  state = next;
  if (configChanged) renderControls();
  renderSaveButton();
  renderRoundInfo();
  renderCallList();
  renderScoreboard();
  renderSpaceQueue();
});

renderControls();
renderSaveButton();
renderRoundInfo();
renderCallList();
renderScoreboard();
renderSpaceQueue();
