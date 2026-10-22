import { lookupSpotifyTrack, SpotifyError } from "@/lib/spotify";
export const runtime = "nodejs";
export const maxDuration = 15;
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const title = params.get("title")?.trim();
  const artist = params.get("artist")?.trim();
  const headers = { "Cache-Control": "no-store" };
  if (!title || !artist || title.length > 200 || artist.length > 200)
    return Response.json(
      {
        error: {
          code: "INVALID_INPUT",
          message:
            "Provide a song title and artist of up to 200 characters each.",
        },
      },
      { status: 400, headers },
    );
  try {
    return Response.json(
      { track: await lookupSpotifyTrack(title, artist) },
      { headers },
    );
  } catch (error) {
    const e =
      error instanceof SpotifyError
        ? error
        : new SpotifyError("SPOTIFY_UNAVAILABLE");
    return Response.json(
      { error: { code: e.code, message: e.message } },
      { status: e.status, headers },
    );
  }
}
