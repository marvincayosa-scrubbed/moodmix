import { lookupItunesSong } from "@/lib/itunes";
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const title = params.get("title")?.trim(),
    artist = params.get("artist")?.trim();
  if (!title || !artist || title.length > 200 || artist.length > 200)
    return Response.json({ artwork: null }, { status: 400 });
  try {
    return Response.json({
      artwork: (await lookupItunesSong(title, artist)).artwork,
    });
  } catch {
    return Response.json({ artwork: null });
  }
}
