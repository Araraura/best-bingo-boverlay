// Player view. joins with a name, renders the server's sheet, and forwards clicks and claims.
// the server owns everything, this just shows what comes back.

import { type GameState, verifyBingo } from './game.js';
import { type Sheet } from './bingo.js';
import { loadState, subscribe, onSheet, onNotice, onHello, join, mark, claimBingo } from './state.js';
import { appendLabelWithBreaks } from './labels.js';

const nameInput = document.getElementById('player-name') as HTMLInputElement;
const nameLabelEl = document.getElementById('player-name-label') as HTMLLabelElement;
const adminLinkEl = document.getElementById('admin-link') as HTMLAnchorElement;
const joinBtn = document.getElementById('join') as HTMLButtonElement;
const gameNameEl = document.getElementById('game-name') as HTMLParagraphElement;
const messageEl = document.getElementById('message') as HTMLParagraphElement;
const bannerEl = document.getElementById('banner') as HTMLDivElement;
const callBingoBtn = document.getElementById('call-bingo') as HTMLButtonElement;
const boardEl = document.getElementById('board') as HTMLDivElement;
const calledListEl = document.getElementById('called-list') as HTMLOListElement;
const scoreboardEl = document.getElementById('scoreboard') as HTMLOListElement;

const modeToggle = document.getElementById('mode-toggle') as HTMLButtonElement;
const alphaSlider = document.getElementById('alpha-slider') as HTMLInputElement;

const twitchExt = window.Twitch?.ext;

let state: GameState = loadState();
let sheet: Sheet | null = null;
let joinedName = '';
let twitchToken = '';
let lastRoundId = -1;
let cooldownTimer: number | undefined;

function hasJoined(): boolean {
  return Boolean(joinedName || twitchToken);
}

function sendJoin(): void {
  if (twitchToken) join({ token: twitchToken });
  else if (joinedName) join({ name: joinedName });
}

function fitLabel(tile: HTMLElement): void {
  if (!tile.clientHeight) return; // not laid out yet
  const style = getComputedStyle(tile);
  const roomWidth = tile.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const roomHeight = tile.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  const label = document.createRange();

  let tooSmall = 5;
  let tooBig = tile.clientHeight / 3;
  for (let step = 0; step < 7; step++) {
    const size = (tooSmall + tooBig) / 2;
    tile.style.fontSize = `${size}px`;
    label.selectNodeContents(tile);
    const text = label.getBoundingClientRect();
    if (text.width <= roomWidth && text.height <= roomHeight) tooSmall = size;
    else tooBig = size;
  }
  tile.style.fontSize = `${tooSmall}px`;
}

function fitAllLabels(): void {
  for (const tile of boardEl.children) fitLabel(tile as HTMLElement);
}

// refits when the board changes size, which also covers the first layout
new ResizeObserver(fitAllLabels).observe(boardEl);
window.addEventListener('resize', fitAllLabels);

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
    tileButton.addEventListener('click', () => {
      if (!tile.isFree) mark(cellIndex); // server decides whether it's allowed
    });
    boardEl.appendChild(tileButton);
  });
  fitAllLabels();
}

function renderGameName(): void {
  const title = state.name || 'Bingo';
  let text = `${title} - Round ${state.roundId} (${state.size}x${state.size})`;
  if (state.roundOver) {
    const winner = state.roundWinners[0];
    text += ` - ROUND OVER! ${winner ? `Winner: ${winner}` : ''} Waiting for the next round.`;
  }
  gameNameEl.textContent = text;
}

function renderCalledList(): void {
  calledListEl.replaceChildren();
  for (const space of state.calledSpaces) {
    const item = document.createElement('li');
    appendLabelWithBreaks(item, space);
    calledListEl.appendChild(item);
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

function showCooldown(baseMessage: string, cooldownMs: number): void {
  const until = Date.now() + cooldownMs;
  window.clearInterval(cooldownTimer);
  const tick = (): void => {
    const remaining = until - Date.now();
    if (remaining <= 0) {
      window.clearInterval(cooldownTimer);
      messageEl.textContent = '';
      return;
    }
    messageEl.textContent = `${baseMessage} Marking paused for ${Math.ceil(remaining / 1000)}s.`;
  };
  cooldownTimer = window.setInterval(tick, 250);
  tick();
}

onSheet((next) => {
  sheet = next;
  render();
});

onNotice((notice) => {
  if (notice.level === 'success') {
    window.clearInterval(cooldownTimer);
    messageEl.textContent = '';
    bannerEl.hidden = false;
    bannerEl.textContent = notice.message;
    return;
  }
  bannerEl.hidden = true;
  if (notice.level === 'error' && notice.cooldownMs) {
    showCooldown(notice.message, notice.cooldownMs);
  } else {
    window.clearInterval(cooldownTimer);
    messageEl.textContent = notice.message;
  }
});

subscribe((next) => {
  const roundChanged = next.roundId !== lastRoundId;
  state = next;
  lastRoundId = next.roundId;
  renderGameName();
  renderCalledList();
  renderScoreboard();
  render();
  if (roundChanged && hasJoined()) {
    sheet = null;
    render();
    sendJoin();
  }
});

joinBtn.addEventListener('click', () => {
  if (twitchToken) {
    twitchExt?.actions.requestIdShare();
    return;
  }
  const name = nameInput.value.trim();
  if (!name) {
    messageEl.textContent = 'Enter your name first.';
    return;
  }
  joinedName = name;
  localStorage.setItem('boverlay.name', name);
  bannerEl.hidden = true;
  messageEl.textContent = '';
  sendJoin();
});

onHello(({ twitch }) => {
  if (twitch || joinedName || twitchToken) return;
  const savedName = localStorage.getItem('boverlay.name');
  if (!savedName) return;
  nameInput.value = savedName;
  joinedName = savedName;
  sendJoin();
});

callBingoBtn.addEventListener('click', () => {
  if (!sheet) {
    messageEl.textContent = 'Join the game first.';
    return;
  }
  claimBingo();
});

if (twitchExt) {
  twitchExt.onAuthorized((auth) => {
    twitchToken = auth.token;
    document.body.classList.remove('local');
    nameLabelEl.hidden = true;
    adminLinkEl.hidden = true;
    if (!twitchExt.viewer.isLinked) {
      joinBtn.textContent = 'Share Twitch identity to play';
      return;
    }
    joinBtn.hidden = true;
    if (!sheet) sendJoin();
  });
}

function applyDisplaySettings(): void {
  const mode = localStorage.getItem('boverlay.mode') ?? 'dark';
  const alpha = Number(localStorage.getItem('boverlay.alpha') ?? '85');
  document.documentElement.dataset.mode = mode;
  document.documentElement.style.setProperty('--panel-alpha', String(alpha / 100));
  modeToggle.textContent = `Mode: ${mode}`;
  alphaSlider.value = String(alpha);
}

modeToggle.addEventListener('click', () => {
  const current = localStorage.getItem('boverlay.mode') ?? 'dark';
  localStorage.setItem('boverlay.mode', current === 'dark' ? 'light' : 'dark');
  applyDisplaySettings();
});

alphaSlider.addEventListener('input', () => {
  localStorage.setItem('boverlay.alpha', alphaSlider.value);
  applyDisplaySettings();
});

if (window.self === window.top) {
  document.body.classList.add('local');
} else {
  window.setTimeout(() => {
    if (!twitchToken) document.body.classList.add('local');
  }, 1000);
}

applyDisplaySettings();
renderGameName();
renderCalledList();
