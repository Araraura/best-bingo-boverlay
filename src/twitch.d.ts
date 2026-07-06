interface TwitchExtAuth {
  token: string;
  clientId: string;
  channelId: string;
}

interface TwitchExt {
  onAuthorized(callback: (auth: TwitchExtAuth) => void): void;
  actions: { requestIdShare(): void };
  viewer: { isLinked: boolean };
}

interface Window {
  Twitch?: { ext: TwitchExt };
  BOVERLAY_BACKEND?: string;
}
