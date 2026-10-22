import { matchingSpotifyTrack } from "./spotify-contracts";
export class SpotifyError extends Error {
  constructor(
    public code: string,
    public status = 503,
  ) {
    super(
      status === 429
        ? "Spotify previews are busy. Please try again later or open the song on Spotify."
        : "Spotify preview is unavailable right now. You can still open the song on Spotify.",
    );
  }
}
// A process-local access-token cache saves token requests; no application data is persisted.
// Concurrent lookups share a single token request. Every upstream request has a timeout.
export function createSpotifyClient(
  fetcher: typeof fetch = (...args) => fetch(...args),
) {
  let cached: { token: string; expiresAt: number } | undefined;
  let pending: Promise<string> | undefined;
  async function accessToken() {
    const clientId = process.env.SPOTIFY_CLIENT_ID;
    const secret = process.env.SPOTIFY_CLIENT_SECRET;
    if (!clientId || !secret) throw new SpotifyError("SPOTIFY_NOT_CONFIGURED");
    if (cached && cached.expiresAt > Date.now()) return cached.token;
    if (pending) return pending;
    pending = (async () => {
      const response = await fetcher("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
        signal: AbortSignal.timeout(5000),
        cache: "no-store",
      });
      if (!response.ok)
        throw new SpotifyError(
          response.status === 429
            ? "SPOTIFY_RATE_LIMITED"
            : "SPOTIFY_AUTH_FAILED",
          response.status === 429 ? 429 : 503,
        );
      const data = await response.json();
      if (
        typeof data.access_token !== "string" ||
        !data.access_token ||
        data.token_type?.toLowerCase() !== "bearer" ||
        typeof data.expires_in !== "number" ||
        !Number.isFinite(data.expires_in) ||
        data.expires_in <= 0
      )
        throw new SpotifyError("SPOTIFY_INVALID_RESPONSE");
      cached = {
        token: data.access_token,
        expiresAt:
          Date.now() + Math.max(0, Math.min(data.expires_in, 3600) - 60) * 1000,
      };
      return cached.token;
    })();
    const current = pending;
    try {
      return await current;
    } finally {
      if (pending === current) pending = undefined;
    }
  }
  return async (title: string, artist: string) => {
    try {
      const token = await accessToken();
      const market = process.env.SPOTIFY_MARKET || "US";
      if (!/^[A-Z]{2}$/.test(market))
        throw new SpotifyError("SPOTIFY_INVALID_MARKET");
      const safeQuery = (s: string) => s.replace(/["\\]/g, " ").trim();
      const url = new URL("https://api.spotify.com/v1/search");
      url.search = new URLSearchParams({
        q: `track:"${safeQuery(title)}" artist:"${safeQuery(artist)}"`,
        type: "track",
        limit: "5",
        market,
      }).toString();
      const response = await fetcher(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
        cache: "no-store",
      });
      if (!response.ok) {
        if (response.status === 401) cached = undefined;
        throw new SpotifyError(
          response.status === 429
            ? "SPOTIFY_RATE_LIMITED"
            : "SPOTIFY_SEARCH_FAILED",
          response.status === 429 ? 429 : 503,
        );
      }
      const data = await response.json();
      if (!Array.isArray(data.tracks?.items))
        throw new SpotifyError("SPOTIFY_INVALID_RESPONSE");
      return matchingSpotifyTrack(data.tracks.items, title, artist);
    } catch (error) {
      if (error instanceof SpotifyError) throw error;
      throw new SpotifyError("SPOTIFY_UNAVAILABLE");
    }
  };
}
export const lookupSpotifyTrack = createSpotifyClient();
