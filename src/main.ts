import { BOARD_SIZES, type BoardSize, type Sheet, generateSheet, findBingos, toggleTile } from './bingo.js';

// starter list of bingo spaces. for now there are duplicates to allow for a 7x7 sheet.
// editable live in the "edit spaces" UI. real list can come from a game config later.
const DEFAULT_SPACES: string[] = [
  '"Unique" in Description',
  'Accessibility Options',
  'Weird Genre Blend',
  'Title Drop',
  'Similar Games Unrelated',
  'Wishlisted by Steam Friend',
  'At Least 20 Achievements',
  'Defaults to Windowed Mode',
  'Trailer < 1 Min',
  '4th Wall Break',
  'Steam Deck Compatible',
  'Only Made 1 Game',
  'Game Suggester is in Chat',
  'Separate Sound Sliders',
  'Stamina',
  'Upgrade System',
  'Game Has Been Updated',
  'Game is on > 1 Platform',
  'Dev Website in Store Page',
  'Collect Something',
  'Store Page has GIFs',
  'Dodge Roll or Dash',
  'Purchased by Steam Friend',
  'Additional Languages',
  'Crash To Desktop',
  'End of the World / Post Apocalyptic',
  'Multiplayer!',
  'Dialogue Box',
  'Game Over Screen',
  'File > 1GB',
  'Action or Turn-Based RPG',
  'Chat Wins Wordle',
  'Solo Dev',
  'New Person in Chat',
  'Typo',
  'Price > $10',
  '"Unique" in Description',
  'Accessibility Options',
  'Weird Genre Blend',
  'Title Drop',
  'Similar Games Unrelated',
  'Wishlisted by Steam Friend',
  'At Least 20 Achievements',
  'Defaults to Windowed Mode',
  'Trailer < 1 Min',
  '4th Wall Break',
  'Steam Deck Compatible',
  'Only Made 1 Game',
  'Game Suggester is in Chat',
  'Separate Sound Sliders',
  'Stamina',
  'Upgrade System',
  'Game Has Been Updated',
  'Game is on > 1 Platform',
  'Dev Website in Store Page',
  'Collect Something',
  'Store Page has GIFs',
  'Dodge Roll or Dash',
  'Purchased by Steam Friend',
  'Additional Languages',
  'Crash To Desktop',
  'End of the World / Post Apocalyptic',
  'Multiplayer!',
  'Dialogue Box',
  'Game Over Screen',
  'File > 1GB',
  'Action or Turn-Based RPG',
  'Chat Wins Wordle',
  'Solo Dev',
  'New Person in Chat',
  'Typo',
  'Price > $10',
];

const sizeSelect = document.getElementById('size') as HTMLSelectElement;
const spacesInput = document.getElementById('spaces') as HTMLTextAreaElement;
const newSheetBtn = document.getElementById('new-sheet') as HTMLButtonElement;
const boardEl = document.getElementById('board') as HTMLDivElement;
const bannerEl = document.getElementById('banner') as HTMLDivElement;
const errorEl = document.getElementById('error') as HTMLParagraphElement;

let sheet: Sheet | null = null;

function currentSpaces(): string[] {
  return spacesInput.value.split('\n');
}

function newSheet(): void {
  errorEl.textContent = '';
  const size = Number(sizeSelect.value) as BoardSize;
  try {
    sheet = generateSheet(size, currentSpaces());
    render();
  } catch (error) {
    sheet = null;
    boardEl.replaceChildren();
    bannerEl.hidden = true;
    errorEl.textContent = error instanceof Error ? error.message : String(error);
  }
}

// Append a label so long words stay whole, but inserd <wbr> after special characters.
function appendLabelWithBreaks(target: HTMLElement, label: string): void {
  const segments = label.split(/(?<=[/\\|,.:;-])/); // the delimiter stays on the line above
  segments.forEach((segment, index) => {
    target.append(segment);
    const isLastSegment = index === segments.length - 1;
    if (!isLastSegment) target.append(document.createElement('wbr'));
  });
}

function render(): void {
  if (!sheet) return;
  boardEl.style.setProperty('--size', String(sheet.size));
  boardEl.replaceChildren();

  const bingos = findBingos(sheet);
  const winningCells = new Set<number>();
  for (const line of bingos) {
    for (const cellIndex of line.cells) winningCells.add(cellIndex);
  }

  sheet.tiles.forEach((tile, cellIndex) => {
    const tileButton = document.createElement('button');
    tileButton.type = 'button';
    tileButton.className = 'tile';
    appendLabelWithBreaks(tileButton, tile.label);
    if (tile.isFree) tileButton.classList.add('free');
    if (tile.marked) tileButton.classList.add('marked');
    if (winningCells.has(cellIndex)) tileButton.classList.add('bingo');
    tileButton.addEventListener('click', () => {
      if (!sheet) return;
      toggleTile(sheet, cellIndex);
      render();
    });
    boardEl.appendChild(tileButton);
  });

  bannerEl.hidden = bingos.length === 0;
  bannerEl.textContent = bingos.length > 0 ? `BINGO! (${bingos.length} line${bingos.length > 1 ? 's' : ''})` : '';
}

sizeSelect.replaceChildren(
  ...BOARD_SIZES.map((size) => {
    const option = document.createElement('option');
    option.value = String(size);
    option.textContent = `${size} x ${size}`;
    return option;
  }),
);
spacesInput.value = DEFAULT_SPACES.join('\n');
newSheetBtn.addEventListener('click', newSheet);
sizeSelect.addEventListener('change', newSheet);
newSheet();
