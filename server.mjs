// serves the files and runs the game over websockets.
// the server owns the shared state, each player's sheet and marks, the cooldown, and
// the bingo checks. shared state goes to everyone, a sheet goes only to its player.
// with a twitch-config.json present it runs in twitch mode: joins need a valid
// extension JWT and players are identified by their twitch account.
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { extname, join, normalize } from 'node:path';
import { WebSocketServer } from 'ws';
import { defaultGameState, reduce, verifyBingo, uncalledSpaces, freeSpacesLeft } from './dist/game.js';
import { generateSheet } from './dist/bingo.js';

const root = process.cwd();
const port = Number(process.env.PORT) || 8080;
const MARK_COOLDOWN_MS = 10_000;

// twitch mode is on when the config file exists
let twitchConfig = null;
try {
  twitchConfig = JSON.parse(readFileSync(join(root, 'twitch-config.json'), 'utf8'));
} catch {
  console.log('no twitch-config.json, running in dev mode (manual name entry)');
}

// checks the signed JWT that twitch gives every extension client
function verifyExtensionJwt(token) {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) return null;
  const secret = Buffer.from(twitchConfig.extensionSecret, 'base64');
  const expected = createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest();
  let given;
  try {
    given = Buffer.from(parts[2], 'base64url');
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  if (payload.exp * 1000 < Date.now()) return null;
  return payload;
}

// scribes log in with twitch oauth. a signed cookie keeps their session.
// the whitelist is typed as usernames in twitch-config.json, but matching happens by
// twitch user id, since usernames can change hands.
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

let scribeIds = new Map(); // user id -> label
const SCRIBES_FILE = join(root, 'scribes.json');

function loadScribeEntries() {
  try {
    const raw = JSON.parse(readFileSync(SCRIBES_FILE, 'utf8'));
    return raw.map((entry) => (typeof entry === 'string' ? { name: entry } : entry));
  } catch {
    return [];
  }
}

async function resolveScribes() {
  const entries = loadScribeEntries();
  const pending = entries.filter((entry) => !entry.id && entry.name);
  if (pending.length > 0 && twitchConfig.apiClientSecret) {
    try {
      const query = pending.map((entry) => `login=${encodeURIComponent(entry.name.toLowerCase())}`).join('&');
      const byLogin = new Map((await helixGet(`users?${query}`)).map((user) => [user.login.toLowerCase(), user]));
      for (const entry of pending) {
        const user = byLogin.get(entry.name.toLowerCase());
        if (user) {
          entry.id = user.id;
          entry.name = user.display_name;
        }
      }
      writeFileSync(SCRIBES_FILE, JSON.stringify(entries, null, 2) + '\n');
    } catch {
      console.log('could not resolve new scribe usernames (needs apiClientSecret + reachable helix)');
    }
  }
  scribeIds = new Map(entries.filter((entry) => entry.id).map((entry) => [String(entry.id), entry.name]));
  console.log('scribes:', [...scribeIds.values()].join(', ') || '(none)');
}

function signSession(userId, expires) {
  const secret = Buffer.from(twitchConfig.extensionSecret, 'base64');
  return createHmac('sha256', secret).update(`${userId}.${expires}`).digest('base64url');
}

function makeSessionCookie(userId) {
  const expires = Date.now() + SESSION_TTL_MS;
  const value = `${userId}.${expires}.${signSession(userId, expires)}`;
  return `scribe=${value}; Path=/; Max-Age=${SESSION_TTL_MS / 1000}; HttpOnly; Secure; SameSite=Lax`;
}

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key) cookies[key] = rest.join('=');
  }
  return cookies;
}

function scribeFromCookies(header) {
  if (!twitchConfig) return 'dev';
  const raw = parseCookies(header).scribe;
  if (!raw) return null;
  const [userId, expires, signature] = raw.split('.');
  if (!userId || !signature || Date.now() > Number(expires)) return null;
  const expected = signSession(userId, expires);
  const given = Buffer.from(signature);
  if (given.length !== Buffer.from(expected).length || !timingSafeEqual(given, Buffer.from(expected))) return null;
  return scribeIds.get(userId) ?? null;
}

async function handleAuth(urlPath, req, res) {
  if (!twitchConfig) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const loginClientId = twitchConfig.loginClientId ?? twitchConfig.clientId;
  const loginClientSecret = twitchConfig.loginClientSecret ?? twitchConfig.apiClientSecret;
  const baseUrl = twitchConfig.publicUrl ?? `https://${req.headers.host}`;
  const redirectUri = `${baseUrl}/auth/callback`;

  if (urlPath === '/auth/login') {
    const state = randomBytes(16).toString('hex');
    const params = new URLSearchParams({
      client_id: loginClientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: '',
      state,
    });
    res.writeHead(302, {
      'Set-Cookie': `oauth_state=${state}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
      Location: `https://id.twitch.tv/oauth2/authorize?${params}`,
    });
    res.end();
    return;
  }

  if (urlPath === '/auth/callback') {
    const query = new URL(req.url, 'https://localhost').searchParams;
    const cookies = parseCookies(req.headers.cookie);
    if (!query.get('code') || !query.get('state') || query.get('state') !== cookies.oauth_state) {
      res.writeHead(403);
      res.end('Login failed. Try again from /auth/login');
      return;
    }
    try {
      const tokenParams = new URLSearchParams({
        client_id: loginClientId,
        client_secret: loginClientSecret,
        code: query.get('code'),
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      });
      const tokenResponse = await fetch(`https://id.twitch.tv/oauth2/token?${tokenParams}`, { method: 'POST' });
      const userToken = (await tokenResponse.json()).access_token;
      const userResponse = await fetch('https://api.twitch.tv/helix/users', {
        headers: { 'Client-Id': loginClientId, Authorization: `Bearer ${userToken}` },
      });
      const user = (await userResponse.json()).data[0];
      if (scribeIds.size === 0) await resolveScribes();
      if (!scribeIds.has(user.id)) {
        res.writeHead(403);
        res.end(`${user.login} is not on the scribe list.`);
        return;
      }
      res.writeHead(302, { 'Set-Cookie': makeSessionCookie(user.id), Location: '/admin.html' });
      res.end();
    } catch {
      res.writeHead(403);
      res.end('Login failed. Try again from /auth/login');
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
}

let appToken = null;

async function fetchAppToken() {
  const params = new URLSearchParams({
    client_id: twitchConfig.clientId,
    client_secret: twitchConfig.apiClientSecret,
    grant_type: 'client_credentials',
  });
  const response = await fetch(`https://id.twitch.tv/oauth2/token?${params}`, { method: 'POST' });
  appToken = (await response.json()).access_token;
}

async function helixGet(query) {
  if (!appToken) await fetchAppToken();
  let response = await fetch(`https://api.twitch.tv/helix/${query}`, {
    headers: { 'Client-Id': twitchConfig.clientId, Authorization: `Bearer ${appToken}` },
  });
  if (response.status === 401) {
    await fetchAppToken();
    response = await fetch(`https://api.twitch.tv/helix/${query}`, {
      headers: { 'Client-Id': twitchConfig.clientId, Authorization: `Bearer ${appToken}` },
    });
  }
  return (await response.json()).data;
}

const displayNames = new Map();

async function displayName(userId) {
  if (displayNames.has(userId)) return displayNames.get(userId);
  const fallback = `Viewer ${userId}`;
  if (!twitchConfig.apiClientSecret) return fallback;
  try {
    const name = (await helixGet(`users?id=${userId}`))[0].display_name;
    displayNames.set(userId, name);
    return name;
  } catch {
    return fallback;
  }
}

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const STATE_FILE = join(root, 'game-state.json');

function loadGame() {
  try {
    const saved = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    // states from before roundSize existed keep their board size
    return { ...defaultGameState(), roundSize: saved.size ?? 5, ...saved };
  } catch {
    return defaultGameState();
  }
}

function saveGame() {
  try {
    writeFileSync(STATE_FILE, JSON.stringify(game));
  } catch {
    // ignoring write errors for now
  }
}

let game = loadGame();
const sheets = new Map();
const cooldowns = new Map();

// runs before a reset wipes the scores
function exportScores() {
  const ranked = Object.entries(game.scores).sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) return null;
  const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  const fileName = `scores-${stamp}.txt`;
  try {
    mkdirSync(join(root, 'score-exports'), { recursive: true });
    const lines = ranked.map(([player, points]) => `${player} - ${points}`);
    writeFileSync(join(root, 'score-exports', fileName), lines.join('\n') + '\n');
    return fileName;
  } catch {
    return null;
  }
}

async function serveFile(req, res) {
  try {
    let urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
    if (urlPath.startsWith('/auth/')) return handleAuth(urlPath, req, res);
    if (urlPath === '/') urlPath = '/video_overlay.html';
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
}

let httpServer;
let scheme = 'http';
try {
  const key = readFileSync(join(root, 'certs', 'localhost-key.pem'));
  const cert = readFileSync(join(root, 'certs', 'localhost-cert.pem'));
  httpServer = createHttpsServer({ key, cert }, serveFile);
  scheme = 'https';
} catch {
  httpServer = createHttpServer(serveFile);
}

const wss = new WebSocketServer({ server: httpServer });

function broadcastState() {
  saveGame();
  const payload = JSON.stringify({ type: 'state', game });
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(payload);
  }
}

const sendSheet = (socket, sheet) => socket.send(JSON.stringify({ type: 'sheet', sheet }));
const sendNotice = (socket, level, message, cooldownMs) =>
  socket.send(JSON.stringify({ type: 'notice', level, message, cooldownMs }));

wss.on('connection', (socket, request) => {
  socket.scribeLogin = scribeFromCookies(request.headers.cookie);
  socket.send(JSON.stringify({ type: 'hello', scribe: Boolean(socket.scribeLogin), twitch: Boolean(twitchConfig) }));
  socket.send(JSON.stringify({ type: 'state', game }));

  socket.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    const scribeActions = [
      'setConfig',
      'toggleCalled',
      'resetScores',
      'callAll',
      'startNewRound',
      'addScribe',
    ];
    if (scribeActions.includes(msg.type) && !socket.scribeLogin) {
      sendNotice(socket, 'error', 'Scribes only.');
      return;
    }

    switch (msg.type) {
      // scribe actions
      case 'setConfig':
      case 'toggleCalled':
      case 'callAll':
        game = reduce(game, msg);
        broadcastState();
        break;

      case 'resetScores': {
        const exportedTo = exportScores();
        game = reduce(game, msg);
        sheets.clear(); // the reset goes back to round 1, so everyone gets a fresh sheet
        cooldowns.clear();
        broadcastState();
        sendNotice(socket, 'success', exportedTo ? `Scores reset. Backup: score-exports/${exportedTo}` : 'Scores reset.');
        break;
      }

      case 'startNewRound':
        game = reduce(game, msg);
        sheets.clear();
        cooldowns.clear();
        broadcastState();
        break;

      case 'addScribe': {
        const name = String(msg.name ?? '').trim();
        if (!name) return;
        if (!twitchConfig) {
          sendNotice(socket, 'error', 'Adding scribes only works in twitch mode.');
          return;
        }
        try {
          const users = await helixGet(`users?login=${encodeURIComponent(name.toLowerCase())}`);
          if (!users || users.length === 0) {
            sendNotice(socket, 'error', `No twitch user named "${name}".`);
            return;
          }
          const user = users[0];
          if (scribeIds.has(user.id)) {
            sendNotice(socket, 'info', `${user.display_name} is already a scribe.`);
            return;
          }
          const entries = loadScribeEntries();
          entries.push({ name: user.display_name, id: user.id });
          writeFileSync(SCRIBES_FILE, JSON.stringify(entries, null, 2) + '\n');
          scribeIds.set(user.id, user.display_name);
          sendNotice(socket, 'success', `${user.display_name} is now a scribe.`);
        } catch {
          sendNotice(socket, 'error', 'Could not look up that username, try again.');
        }
        break;
      }

      // player actions
      case 'useFreeSpace': {
        const name = socket.playerName;
        if (!name) {
          sendNotice(socket, 'error', 'Join the game first.');
          return;
        }
        if (game.roundOver) {
          sendNotice(socket, 'info', 'The round is over, wait for the next one to use a free space.');
          return;
        }
        if (freeSpacesLeft(game) === 0) {
          sendNotice(socket, 'info', `All ${game.freeSpaceLimit} free spaces for this round have been used.`);
          return;
        }
        const space = String(msg.space ?? '');
        if (!uncalledSpaces(game).includes(space)) {
          sendNotice(socket, 'error', `"${space}" can't be called right now.`);
          return;
        }
        game = reduce(game, { type: 'useFreeSpace', space });
        broadcastState();
        break;
      }

      case 'join': {
        let name;
        let sheetKey;
        if (twitchConfig) {
          const payload = verifyExtensionJwt(msg.token);
          if (!payload) {
            sendNotice(socket, 'error', 'Could not verify your Twitch identity.');
            return;
          }
          if (!payload.user_id) {
            sendNotice(socket, 'error', 'Share your Twitch identity to play.');
            return;
          }
          sheetKey = payload.user_id;
          name = await displayName(payload.user_id);
        } else {
          name = String(msg.name ?? '').trim();
          if (!name) return;
          sheetKey = name;
        }
        socket.playerName = name;
        socket.sheetKey = sheetKey;
        if (!sheets.has(sheetKey)) {
          try {
            sheets.set(sheetKey, generateSheet(game.roundSize, game.spaceList, game.centerSpace, game.centerIsFree));
          } catch (error) {
            sendNotice(socket, 'error', error instanceof Error ? error.message : String(error));
            return;
          }
        }
        sendSheet(socket, sheets.get(sheetKey));
        break;
      }

      case 'mark': {
        const sheetKey = socket.sheetKey;
        const sheet = sheetKey && sheets.get(sheetKey);
        if (!sheet) return;
        const tile = sheet.tiles[msg.cellIndex];
        if (!tile || tile.isFree) return;

        if (game.roundOver) {
          sendNotice(socket, 'info', 'Round is over. Waiting for the next one to start.');
          return;
        }
        const cooldownUntil = cooldowns.get(sheetKey) ?? 0;
        if (cooldownUntil > Date.now()) {
          sendNotice(socket, 'error', 'Slow down.', cooldownUntil - Date.now());
          return;
        }
        if (tile.marked) {
          tile.marked = false; // unmarking is fine
        } else if (!game.calledSpaces.includes(tile.label)) {
          cooldowns.set(sheetKey, Date.now() + MARK_COOLDOWN_MS);
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
        const sheet = socket.sheetKey && sheets.get(socket.sheetKey);
        if (!sheet) return;
        if (game.roundOver) {
          sendNotice(socket, 'info', 'Round is over. Waiting for the next one to start.');
          return;
        }
        const wins = verifyBingo(sheet, game.calledSpaces);
        if (wins.length === 0) {
          sendNotice(socket, 'error', 'No valid bingo yet - mark a full called line first.');
          return;
        }
        // a win freezes the round until a scribe starts the next one
        game = reduce(game, { type: 'awardBingo', player: name, lines: wins.length });
        broadcastState();
        break;
      }
    }
  });
});

httpServer.listen(port, () => {
  console.log(`serving on ${scheme}://localhost:${port} (overlay: /video_overlay.html, scribe: /admin.html)`);
});

if (twitchConfig) resolveScribes();
