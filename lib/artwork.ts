export function normalize(s: string) {
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}
export function matchingArtwork(
  results: unknown[],
  title: string,
  artist: string,
): string | null {
  for (const item of results) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (
      typeof r.trackName !== "string" ||
      typeof r.artistName !== "string" ||
      typeof r.artworkUrl100 !== "string"
    )
      continue;
    if (
      normalize(r.trackName) !== normalize(title) ||
      normalize(r.artistName) !== normalize(artist)
    )
      continue;
    try {
      const url = new URL(r.artworkUrl100);
      if (url.protocol === "https:" && url.hostname.endsWith(".mzstatic.com"))
        return url.href;
    } catch {
      /* use placeholder */
    }
  }
  return null;
}
