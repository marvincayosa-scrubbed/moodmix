export function normalize(s: string) {
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}
export type AudioPreview = { url: string; storeUrl: string };
export type ItunesMedia = {
  artwork: string | null;
  preview: AudioPreview | null;
};
function appleUrl(
  value: unknown,
  kind: "artwork" | "audio" | "store",
): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    const host = url.hostname;
    const assets = host.endsWith(".mzstatic.com");
    const allowed =
      kind === "artwork"
        ? assets
        : kind === "audio"
          ? assets ||
            ["audio-ssl.itunes.apple.com", "audio.itunes.apple.com"].includes(
              host,
            )
          : ["music.apple.com", "itunes.apple.com"].includes(host);
    return allowed ? url.href : null;
  } catch {
    return null;
  }
}
export function isAudioPreview(value: unknown): value is AudioPreview {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  return !!appleUrl(p.url, "audio") && !!appleUrl(p.storeUrl, "store");
}
export function matchingItunesMedia(
  results: unknown[],
  title: string,
  artist: string,
): ItunesMedia {
  const media: ItunesMedia = { artwork: null, preview: null };
  if (!normalize(title) || !normalize(artist)) return media;
  for (const item of results) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (
      typeof r.trackName !== "string" ||
      typeof r.artistName !== "string" ||
      (r.kind !== undefined && r.kind !== "song")
    )
      continue;
    if (
      normalize(r.trackName) !== normalize(title) ||
      normalize(r.artistName) !== normalize(artist)
    )
      continue;
    media.artwork ??= appleUrl(r.artworkUrl100, "artwork");
    const url = appleUrl(r.previewUrl, "audio");
    const storeUrl = appleUrl(r.trackViewUrl, "store");
    if (!media.preview && url && storeUrl) media.preview = { url, storeUrl };
    if (media.artwork && media.preview) break;
  }
  return media;
}
export function matchingArtwork(
  results: unknown[],
  title: string,
  artist: string,
): string | null {
  return matchingItunesMedia(results, title, artist).artwork;
}
