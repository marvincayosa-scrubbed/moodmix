import { matchingItunesMedia } from "./artwork";
export async function lookupItunesSong(title: string, artist: string) {
  const url = new URL("https://itunes.apple.com/search");
  url.search = new URLSearchParams({
    term: `${title} ${artist}`,
    entity: "song",
    limit: "5",
  }).toString();
  // Artwork and preview routes share this cached request; never proxy or store audio files.
  const response = await fetch(url, {
    signal: AbortSignal.timeout(5000),
    next: { revalidate: 3600 },
  });
  if (!response.ok) throw new Error("iTunes search unavailable");
  const body = await response.json();
  if (!Array.isArray(body.results)) throw new Error("Invalid iTunes response");
  return matchingItunesMedia(body.results, title, artist);
}
