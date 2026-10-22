import { matchingArtwork } from "@/lib/artwork";
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const title = params.get("title")?.trim(),
    artist = params.get("artist")?.trim();
  if (!title || !artist || title.length > 200 || artist.length > 200)
    return Response.json({ artwork: null }, { status: 400 });
  try {
    const url = new URL("https://itunes.apple.com/search");
    url.search = new URLSearchParams({
      term: `${title} ${artist}`,
      entity: "song",
      limit: "5",
    }).toString();
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      next: { revalidate: 86400 },
    });
    if (!response.ok) throw new Error("Unavailable");
    const body = await response.json();
    return Response.json({
      artwork: matchingArtwork(
        Array.isArray(body.results) ? body.results : [],
        title,
        artist,
      ),
    });
  } catch {
    return Response.json({ artwork: null });
  }
}
