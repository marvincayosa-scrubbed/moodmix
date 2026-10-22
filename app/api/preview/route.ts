import { lookupItunesSong } from "@/lib/itunes";
export const maxDuration = 10;
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const title = params.get("title")?.trim(),
    artist = params.get("artist")?.trim();
  if (!title || !artist || title.length > 200 || artist.length > 200)
    return Response.json(
      {
        error: {
          code: "INVALID_INPUT",
          message:
            "Provide a song title and artist of up to 200 characters each.",
        },
      },
      { status: 400 },
    );
  try {
    return Response.json({
      preview: (await lookupItunesSong(title, artist)).preview,
    });
  } catch {
    return Response.json(
      {
        error: {
          code: "PREVIEW_UNAVAILABLE",
          message:
            "Audio previews are temporarily unavailable. You can still open this song on Spotify.",
        },
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
