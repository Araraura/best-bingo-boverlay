// serves the files and runs the game over websockets.
// the server owns the shared state, each player's sheet and marks, the cooldown, and
// the bingo checks. shared state goes to everyone, a sheet goes only to its player.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { WebSocketServer } from 'ws';
import { defaultGameState, reduce, verifyBingo } from './dist/game.js';
import { generateSheet } from './dist/bingo.js';

const root = process.cwd();
const port = Number(process.env.PORT) || 8080;
const MARK_COOLDOWN_MS = 10_000;

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

let game = defaultGameState();
const sheets = new Map();
const cooldowns = new Map();

const httpServer = createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';
    const filePath = normalize(join(root, urlPath));
    if (!filePath.startsWith(root)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': types[extname(filePath)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

const wss = new WebSocketServer({ server: httpServer });

function broadcastState() {
  const payload = JSON.stringify({ type: 'state', game });
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(payload);
  }
}

const sendSheet = (socket, sheet) => socket.send(JSON.stringify({ type: 'sheet', sheet }));
const sendNotice = (socket, level, message, cooldownMs) =>
  socket.send(JSON.stringify({ type: 'notice', level, message, cooldownMs }));

wss.on('connection', (socket) => {
  socket.send(JSON.stringify({ type: 'state', game }));

  socket.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.type) {
      // scribe actions
      case 'setConfig':
      case 'toggleCalled':
      case 'resetScores':
      case 'callAll':
        game = reduce(game, msg);
        broadcastState();
        break;

      case 'startNewRound':
        game = reduce(game, msg);
        sheets.clear(); // fresh sheets next round
        cooldowns.clear();
        broadcastState();
        break;

      // player actions
      case 'join': {
        const name = String(msg.name ?? '').trim();
        if (!name) return;
        socket.playerName = name;
        if (!sheets.has(name)) {
          try {
            sheets.set(name, generateSheet(game.size, game.spaceList));
          } catch (error) {
            sendNotice(socket, 'error', error instanceof Error ? error.message : String(error));
            return;
          }
        }
        sendSheet(socket, sheets.get(name));
        break;
      }

      case 'mark': {
        const name = socket.playerName;
        const sheet = name && sheets.get(name);
        if (!sheet) return;
        const tile = sheet.tiles[msg.cellIndex];
        if (!tile || tile.isFree) return;

        const cooldownUntil = cooldowns.get(name) ?? 0;
        if (cooldownUntil > Date.now()) {
          sendNotice(socket, 'error', 'Slow down.', cooldownUntil - Date.now());
          return;
        }
        if (tile.marked) {
          tile.marked = false; // unmarking is fine
        } else if (!game.calledSpaces.includes(tile.label)) {
          cooldowns.set(name, Date.now() + MARK_COOLDOWN_MS);
          sendNotice(socket, 'error', `"${tile.label}" hasn't been called yet.`, MARK_COOLDOWN_MS);
          return;
        } else {
          tile.marked = true;
        }
        sendSheet(socket, sheet);
        break;
      }

      case 'claimBingo': {
        const name = socket.playerName;
        const sheet = name && sheets.get(name);
        if (!sheet) return;
        if (game.roundWinners.includes(name)) {
          sendNotice(socket, 'info', 'You already scored a bingo this round.');
          return;
        }
        const wins = verifyBingo(sheet, game.calledSpaces);
        if (wins.length === 0) {
          sendNotice(socket, 'error', 'No valid bingo yet - mark a full called line first.');
          return;
        }
        game = reduce(game, { type: 'awardBingo', player: name, lines: wins.length });
        broadcastState();
        const lineText = `${wins.length} line${wins.length > 1 ? 's' : ''}`;
        sendNotice(socket, 'success', `BINGO! ${lineText} - +${wins.length} point${wins.length > 1 ? 's' : ''}!`);
        break;
      }
    }
  });
});

httpServer.listen(port, () => {
  console.log(`Serving ${root}\n  player: http://localhost:${port}/index.html\n  scribe: http://localhost:${port}/admin.html`);
});
