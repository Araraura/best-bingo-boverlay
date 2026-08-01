import { readFileSync, writeFileSync } from 'node:fs';
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { join } from 'node:path';

const REWARDS = [
  {
    key: 'freeSpace',
    title: 'Free Space',
    prompt: 'Pick your space in the bingo overlay first, then redeem this to call it.',
  },
  {
    key: 'addSpace',
    title: 'Add Space',
    prompt: 'Type your new space in the bingo overlay first, then redeem this to send it to the scribes.',
  },
  {
    key: 'removeSpace',
    title: 'Remove Space',
    prompt: 'Pick the space you want gone in the bingo overlay first, then redeem this to drop it next round.',
  },
];

const REDEMPTION_EVENT = 'channel.channel_points_custom_reward_redemption.add';
const SCOPES = 'channel:manage:redemptions';
const MESSAGE_AGE_LIMIT_MS = 3 * 60 * 1000;

let config = null;
let file = '';
let broadcaster = null; // { userId, login, refreshToken, rewards: { key: rewardId }, secret }

export function setup(twitchConfig, root) {
  config = twitchConfig;
  file = join(root, 'broadcaster.json');
  try {
    broadcaster = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    broadcaster = null;
  }
}

function save() {
  writeFileSync(file, JSON.stringify(broadcaster, null, 2) + '\n');
}

const clientId = () => config.loginClientId ?? config.clientId;
const clientSecret = () => config.loginClientSecret ?? config.apiClientSecret;

export function isLinked() {
  return Boolean(broadcaster?.rewards?.freeSpace);
}

export function rewardIdFor(ability) {
  return broadcaster?.rewards?.[ability] ?? '';
}

export function abilityFor(rewardId) {
  const rewards = broadcaster?.rewards ?? {};
  return Object.keys(rewards).find((key) => rewards[key] === rewardId) ?? '';
}

export function linkedLogin() {
  return broadcaster?.login ?? '';
}

export function authUrl(redirectUri, state) {
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    state,
    force_verify: 'true',
  });
  return `https://id.twitch.tv/oauth2/authorize?${params}`;
}

async function tokenRequest(extra) {
  const params = new URLSearchParams({ client_id: clientId(), client_secret: clientSecret(), ...extra });
  const response = await fetch(`https://id.twitch.tv/oauth2/token?${params}`, { method: 'POST' });
  return response.json();
}

// broadcaster token
async function userToken() {
  const data = await tokenRequest({ grant_type: 'refresh_token', refresh_token: broadcaster.refreshToken });
  if (!data.access_token) throw new Error('could not refresh the broadcaster token, they need to link again');
  if (data.refresh_token && data.refresh_token !== broadcaster.refreshToken) {
    broadcaster.refreshToken = data.refresh_token;
    save();
  }
  return data.access_token;
}

async function appToken() {
  const data = await tokenRequest({ grant_type: 'client_credentials' });
  if (!data.access_token) throw new Error('could not get an app token');
  return data.access_token;
}

async function helix(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`https://api.twitch.tv/helix/${path}`, {
    method,
    headers: {
      'Client-Id': clientId(),
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    throw new Error(`twitch ${method} ${path} failed: ${response.status} ${await response.text()}`);
  }
  return response.status === 204 ? null : response.json();
}

// only the app that made a reward can update or refund it
async function ensureRewards(costs) {
  const token = await userToken();
  const mine = await helix(
    `channel_points/custom_rewards?broadcaster_id=${broadcaster.userId}&only_manageable_rewards=true`,
    { token },
  );

  const rewards = {};
  for (const reward of REWARDS) {
    const existing = mine.data.find((made) => made.title === reward.title);
    if (existing) {
      rewards[reward.key] = existing.id;
      continue;
    }
    const created = await helix(`channel_points/custom_rewards?broadcaster_id=${broadcaster.userId}`, {
      token,
      method: 'POST',
      body: {
        title: reward.title,
        cost: costs[reward.key],
        prompt: reward.prompt,
        is_user_input_required: false, // viewer type or pick in our overlay instead
        should_redemptions_skip_request_queue: false, // fulfil or refund each one
      },
    });
    rewards[reward.key] = created.data[0].id;
  }
  return rewards;
}

async function ensureSubscriptions(callbackUrl) {
  const token = await appToken();
  const subs = await helix('eventsub/subscriptions', { token });

  for (const rewardId of Object.values(broadcaster.rewards)) {
    const alreadyThere = subs.data.some(
      (sub) =>
        sub.type === REDEMPTION_EVENT &&
        sub.condition.broadcaster_user_id === broadcaster.userId &&
        sub.condition.reward_id === rewardId &&
        sub.transport.callback === callbackUrl &&
        sub.status !== 'webhook_callback_verification_failed',
    );
    if (alreadyThere) continue;

    await helix('eventsub/subscriptions', {
      token,
      method: 'POST',
      body: {
        type: REDEMPTION_EVENT,
        version: '1',
        condition: { broadcaster_user_id: broadcaster.userId, reward_id: rewardId },
        transport: { method: 'webhook', callback: callbackUrl, secret: broadcaster.secret },
      },
    });
  }
}

export async function ensureSetUp(costs, callbackUrl) {
  if (!broadcaster?.refreshToken) return;
  broadcaster.rewards = await ensureRewards(costs);
  save();
  await ensureSubscriptions(callbackUrl);
}

export async function completeAuth(code, redirectUri, costs, callbackUrl) {
  const tokens = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
  if (!tokens.access_token) throw new Error('twitch did not return a token');

  const users = await helix('users', { token: tokens.access_token });
  const user = users.data[0];
  broadcaster = {
    userId: user.id,
    login: user.login,
    refreshToken: tokens.refresh_token,
    rewards: broadcaster?.rewards ?? {},
    secret: broadcaster?.secret ?? randomBytes(24).toString('hex'),
  };
  save();
  await ensureSetUp(costs, callbackUrl);
  return user.login;
}

export function verifyMessage(headers, rawBody) {
  const id = headers['twitch-eventsub-message-id'];
  const timestamp = headers['twitch-eventsub-message-timestamp'];
  const signature = headers['twitch-eventsub-message-signature'];
  if (!id || !timestamp || !signature || !broadcaster?.secret) return false;
  if (Math.abs(Date.now() - Date.parse(timestamp)) > MESSAGE_AGE_LIMIT_MS) return false;

  const expected = `sha256=${createHmac('sha256', broadcaster.secret).update(id + timestamp + rawBody).digest('hex')}`;
  const given = Buffer.from(signature);
  const mine = Buffer.from(expected);
  return given.length === mine.length && timingSafeEqual(given, mine);
}

export async function resolveRedemption(redemptionId, rewardId, status) {
  const token = await userToken();
  const query = new URLSearchParams({
    id: redemptionId,
    broadcaster_id: broadcaster.userId,
    reward_id: rewardId,
  });
  await helix(`channel_points/custom_rewards/redemptions?${query}`, { token, method: 'PATCH', body: { status } });
}
