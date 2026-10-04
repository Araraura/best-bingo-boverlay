// OBS browser source.

import { type GameState, winText } from './game.js';
import { subscribe, onAlert } from './state.js';

const ALERT_MS = 5000;
const FADE_MS = 400;

const alertEl = document.getElementById('alert') as HTMLParagraphElement;
const winSound = new Audio('assets/snd_won.wav');
const abilitySound = new Audio('assets/snd_ability.wav');

const queue: { text: string; sound: HTMLAudioElement | null }[] = [];
let showing = false;
let previous: GameState | null = null;

function showNext(): void {
  const next = queue.shift();
  if (!next) {
    showing = false;
    return;
  }
  showing = true;
  alertEl.textContent = next.text;
  alertEl.classList.add('shown');
  if (next.sound) {
    next.sound.currentTime = 0;
    next.sound.play().catch(() => undefined);
  }
  window.setTimeout(() => {
    alertEl.classList.remove('shown');
    window.setTimeout(showNext, FADE_MS);
  }, ALERT_MS);
}

onAlert((text) => {
  queue.push({ text, sound: abilitySound });
  if (!showing) showNext();
});

subscribe((next) => {
  // the first state is what was already going on, so a reload doesn't replay it
  if (previous) {
    if (next.roundId !== previous.roundId) {
      queue.push({ text: `Round ${next.roundId} has started - ${next.roundSize}x${next.roundSize}`, sound: null });
    }
    if (next.roundWin && !previous.roundWin) {
      queue.push({ text: winText(next.roundWin), sound: winSound });
    }
  }
  previous = next;
  if (!showing) showNext();
});
