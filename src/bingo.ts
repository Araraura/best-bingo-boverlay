export type BoardSize = 5 | 6 | 7;
export const BOARD_SIZES: readonly BoardSize[] = [5, 6, 7];

export interface Tile {
  label: string;
  isFree: boolean;
  marked: boolean;
}

export interface Sheet {
  size: BoardSize;
  tiles: Tile[]; // row-major order, length === size * size
}

export type LineType = 'row' | 'col' | 'diag-main' | 'diag-anti';

export interface Line {
  type: LineType;
  index: number; // row/column index, 0 for diagonals
  cells: number[]; // tile indices that make up the line
}

export const FREE_LABEL = 'Free Space';

// shuffles items
function shuffled<ItemType>(items: readonly ItemType[]): ItemType[] {
  const result = items.slice();
  for (let pos = result.length - 1; pos > 0; pos--) {
    const swapWith = Math.floor(Math.random() * (pos + 1));
    [result[pos], result[swapWith]] = [result[swapWith], result[pos]];
  }
  return result;
}

// Center cell for odd boards (5, 7). a random cell for even boards (6).
export function freeCellIndex(size: BoardSize): number {
  if (size % 2 === 1) {
    const middle = (size - 1) / 2;
    return middle * size + middle;
  }
  return Math.floor(Math.random() * size * size);
}

export function generateSheet(size: BoardSize, spaces: readonly string[]): Sheet {
  const cellCount = size * size;
  const spacesNeeded = cellCount - 1; // one cell is always the free space
  const pool = spaces.map((space) => space.trim()).filter((space) => space.length > 0);
  if (pool.length < spacesNeeded) {
    throw new Error(
      `A ${size}x${size} sheet needs at least ${spacesNeeded} spaces, but only ${pool.length} were provided.`,
    );
  }

  const chosenSpaces = shuffled(pool).slice(0, spacesNeeded);
  const freeCell = freeCellIndex(size);
  const tiles: Tile[] = [];
  let nextSpace = 0;
  for (let cellIndex = 0; cellIndex < cellCount; cellIndex++) {
    if (cellIndex === freeCell) {
      tiles.push({ label: FREE_LABEL, isFree: true, marked: true });
    } else {
      tiles.push({ label: chosenSpaces[nextSpace], isFree: false, marked: false });
      nextSpace++;
    }
  }
  return { size, tiles };
}

export function getLines(size: BoardSize): Line[] {
  const lines: Line[] = [];

  for (let rowIndex = 0; rowIndex < size; rowIndex++) {
    const cells: number[] = [];
    for (let colIndex = 0; colIndex < size; colIndex++) {
      cells.push(rowIndex * size + colIndex);
    }
    lines.push({ type: 'row', index: rowIndex, cells });
  }

  for (let colIndex = 0; colIndex < size; colIndex++) {
    const cells: number[] = [];
    for (let rowIndex = 0; rowIndex < size; rowIndex++) {
      cells.push(rowIndex * size + colIndex);
    }
    lines.push({ type: 'col', index: colIndex, cells });
  }

  const mainDiagonal: number[] = [];
  const antiDiagonal: number[] = [];
  for (let step = 0; step < size; step++) {
    mainDiagonal.push(step * size + step);
    antiDiagonal.push(step * size + (size - 1 - step));
  }
  lines.push({ type: 'diag-main', index: 0, cells: mainDiagonal });
  lines.push({ type: 'diag-anti', index: 0, cells: antiDiagonal });

  return lines;
}

export function toggleTile(sheet: Sheet, index: number): void {
  const tile = sheet.tiles[index];
  if (tile.isFree) return; // free space stays marked
  tile.marked = !tile.marked;
}
