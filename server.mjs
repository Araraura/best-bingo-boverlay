// serves the static files and syncs game state over websockets.
// holds the one GameState in memory and applies every action through
// reduce(), then broadcasts the new state to all clients.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { WebSocketServer } from 'ws';
import { defaultGameState, reduce } from './dist/game.js';

const root = process.cwd();
const port = Number(process.env.PORT) || 8080;

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

function broadcast() {
  const payload = JSON.stringify(game);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(payload);
  }
}

wss.on('connection', (socket) => {
  socket.send(JSON.stringify(game)); // hand the new client the current state
  socket.on('message', (raw) => {
    let action;
    try {
      action = JSON.parse(raw.toString());
    } catch {
      return;
    }
    game = reduce(game, action);
    broadcast();
  });
});

httpServer.listen(port, () => {
  console.log(`Serving ${root}\n  player: http://localhost:${port}/index.html\n  scribe: http://localhost:${port}/admin.html`);
});
