import { normalize } from "./artwork";
export type SpotifyTrack = { id: string; title: string; artists: string[] };
export const spotifyIdPattern = /^[A-Za-z0-9]{22}$/;
export function matchingSpotifyTrack(
  items: unknown[],
  title: string,
  artist: string,
): SpotifyTrack | null {
  if (!normalize(title) || !normalize(artist)) return null;
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const track = item as Record<string, unknown>;
    if (
      track.type !== "track" ||
      typeof track.id !== "string" ||
      !spotifyIdPattern.test(track.id) ||
      typeof track.name !== "string" ||
      track.name.length > 200 ||
      !Array.isArray(track.artists) ||
      track.is_playable === false
    )
      continue;
    const artists = track.artists.flatMap((a: unknown) =>
      a &&
      typeof a === "object" &&
      typeof (a as { name?: unknown }).name === "string"
        ? [(a as { name: string }).name]
        : [],
    );
    if (!artists.length || artists.some((a) => !a.trim() || a.length > 200))
      continue;
    if (normalize(track.name) !== normalize(title)) continue;
    if (
      !artists.some((a) => normalize(a) === normalize(artist)) &&
      normalize(artists.join(", ")) !== normalize(artist)
    )
      continue;
    return { id: track.id, title: track.name, artists };
  }
  return null;
}
export function spotifyEmbedUrl(id: string) {
  if (!spotifyIdPattern.test(id)) throw new Error("Invalid Spotify track ID");
  return `https://open.spotify.com/embed/track/${id}?utm_source=moodmix&theme=0`;
}
